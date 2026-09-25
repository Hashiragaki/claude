import { describe, expect, it } from 'vitest';
import { FakeLlmClient, textBlock, toolUseBlock } from './fake';
import type { LlmCallMeta } from './llm';
import {
  BudgetExceededError,
  DEFAULT_PRICES,
  DEFAULT_ROUTING,
  RoutedLlmClient,
  escalate,
  estimateCost,
  routingFromEnv,
  type UsageEvent,
} from './router';

describe('routingFromEnv', () => {
  it('reprend DEFAULT_ROUTING sans variables', () => {
    expect(routingFromEnv({})).toEqual(DEFAULT_ROUTING);
  });

  it('désactive le routage avec FORGE_ROUTING=off', () => {
    const table = routingFromEnv({ FORGE_ROUTING: 'off' });
    for (const role of Object.keys(table) as (keyof typeof table)[]) {
      expect(table[role]).toEqual({});
    }
  });

  it('surcharge le modèle et l\'effort d\'un rôle', () => {
    const table = routingFromEnv({
      FORGE_MODEL_GENERATE: 'claude-opus-5',
      FORGE_EFFORT_CHAT: 'medium',
    });
    expect(table.generate).toEqual({ model: 'claude-opus-5', effort: 'medium' });
    expect(table.chat).toEqual({ effort: 'medium' });
    // Les autres rôles restent aux valeurs par défaut.
    expect(table.summary).toEqual(DEFAULT_ROUTING.summary);
  });

  it('« default » retire le réglage du rôle (modèle/effort du client)', () => {
    const table = routingFromEnv({ FORGE_MODEL_GENERATE: 'default', FORGE_EFFORT_GENERATE: 'default' });
    expect(table.generate).toEqual({});
  });

  it('ignore un effort inconnu', () => {
    const table = routingFromEnv({ FORGE_EFFORT_CHAT: 'ultra' });
    expect(table.chat).toEqual(DEFAULT_ROUTING.chat);
  });
});

describe('escalate', () => {
  it('sonnet medium -> high (même modèle)', () => {
    expect(escalate({ model: 'claude-sonnet-5', effort: 'medium' }, 'claude-opus-5')).toEqual({
      model: 'claude-sonnet-5',
      effort: 'high',
    });
  });

  it('sonnet high -> modèle principal à effort high', () => {
    expect(escalate({ model: 'claude-sonnet-5', effort: 'high' }, 'claude-opus-5')).toEqual({ effort: 'high' });
  });

  it('modèle principal à effort high -> null (déjà au plus haut)', () => {
    expect(escalate({ effort: 'high' }, 'claude-opus-5')).toBeNull();
  });

  it('haiku (pas de réflexion adaptative) -> modèle principal directement', () => {
    expect(escalate({ model: 'claude-haiku-4-5' }, 'claude-opus-5')).toEqual({ effort: 'high' });
  });
});

describe('estimateCost', () => {
  it('applique les multiplicateurs de cache (lecture 0,1x, écriture 1,25x)', () => {
    const cost = estimateCost(
      'claude-sonnet-5',
      { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 },
      DEFAULT_PRICES,
    );
    const price = DEFAULT_PRICES['claude-sonnet-5']!;
    expect(cost).toBeCloseTo(price.input * (1 + 0.1 + 1.25), 6);
  });

  it('0 pour un modèle inconnu', () => {
    expect(estimateCost('modele-inconnu', { inputTokens: 100, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(
      0,
    );
  });
});

describe('RoutedLlmClient', () => {
  const meta: LlmCallMeta = { role: 'generate', projectId: 'p1' };

  it('applique le réglage du rôle quand model/effort ne sont pas déjà fixés', async () => {
    const fake = new FakeLlmClient([{ content: [textBlock('ok')] }]);
    const client = new RoutedLlmClient(fake, { routing: DEFAULT_ROUTING });
    await client.send({ messages: [{ role: 'user', content: 'hop' }], meta });
    expect(fake.requests[0]?.model).toBe(DEFAULT_ROUTING.generate.model);
    expect(fake.requests[0]?.effort).toBe(DEFAULT_ROUTING.generate.effort);
  });

  it('ne remplace pas un model/effort déjà explicite', async () => {
    const fake = new FakeLlmClient([{ content: [textBlock('ok')] }]);
    const client = new RoutedLlmClient(fake, { routing: DEFAULT_ROUTING });
    await client.send({ messages: [{ role: 'user', content: 'hop' }], meta, model: 'claude-opus-5', effort: 'xhigh' });
    expect(fake.requests[0]?.model).toBe('claude-opus-5');
    expect(fake.requests[0]?.effort).toBe('xhigh');
  });

  it('laisse passer une requête sans meta', async () => {
    const fake = new FakeLlmClient([{ content: [textBlock('ok')] }]);
    const client = new RoutedLlmClient(fake, { routing: DEFAULT_ROUTING });
    await client.send({ messages: [{ role: 'user', content: 'hop' }] });
    expect(fake.requests[0]?.model).toBeUndefined();
    expect(fake.requests[0]?.effort).toBeUndefined();
  });

  it('appelle beforeSend puis onUsage avec le coût estimé', async () => {
    const fake = new FakeLlmClient([{ content: [toolUseBlock('x', {})] }]);
    const calls: string[] = [];
    const events: UsageEvent[] = [];
    const client = new RoutedLlmClient(fake, {
      routing: DEFAULT_ROUTING,
      beforeSend: () => calls.push('before'),
      onUsage: (e) => {
        calls.push('usage');
        events.push(e);
      },
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });
    await client.send({ messages: [{ role: 'user', content: 'hop' }], meta });
    expect(calls).toEqual(['before', 'usage']);
    expect(events[0]?.meta).toEqual(meta);
    expect(events[0]?.model).toBe(DEFAULT_ROUTING.generate.model);
    expect(events[0]?.costUsd).toBeGreaterThan(0);
    expect(events[0]?.at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('BudgetExceededError levée par beforeSend annule l\'appel', async () => {
    const fake = new FakeLlmClient([{ content: [textBlock('ok')] }]);
    const client = new RoutedLlmClient(fake, {
      beforeSend: () => {
        throw new BudgetExceededError();
      },
    });
    await expect(client.send({ messages: [{ role: 'user', content: 'hop' }], meta })).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
    expect(fake.requests).toHaveLength(0);
  });
});
