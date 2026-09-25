import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FakeLlmClient, textBlock, toolUseBlock } from './fake';
import type { BetaToolResultBlockParam } from './llm';
import { generateStructured, type StructuredReview } from './structured';

// Schéma minimal : `color` doit être l'une des valeurs autorisées, ce qui permet de simuler
// facilement une correction invalide (valeur hors énumération) sans dépendre d'un `superRefine`.
const Spec = z.object({ color: z.enum(['red', 'green', 'blue']) });
type SpecT = z.infer<typeof Spec>;

const fakePng = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const fakePngBase64 = Buffer.from(fakePng).toString('base64');

/** Dernier message utilisateur envoyé au modèle dans une requête préparée par FakeLlmClient. */
function lastUserContent(llm: FakeLlmClient, requestIndex: number): BetaToolResultBlockParam[] {
  const req = llm.requests[requestIndex]!;
  const last = req.messages[req.messages.length - 1]!;
  expect(last.role).toBe('user');
  return last.content as BetaToolResultBlockParam[];
}

describe('generateStructured avec critique visuelle', () => {
  it('accepte le rendu quand le modèle répond « OK » (reviews = 1)', async () => {
    const llm = new FakeLlmClient([
      { content: [toolUseBlock('submit_result', { color: 'red' }, 'toolu_1')] },
      { content: [textBlock('OK')] },
    ]);
    const rounds: number[] = [];
    const review: StructuredReview<SpecT> = {
      render: async () => ({ image: { data: fakePng, mediaType: 'image/png' } }),
    };
    const result = await generateStructured({
      llm,
      system: 's',
      prompt: 'p',
      schema: Spec,
      review,
      onReview: (r) => rounds.push(r),
    });

    expect(result.value).toEqual({ color: 'red' });
    expect(result.reviews).toBe(1);
    expect(rounds).toEqual([1]);
    expect(llm.requests).toHaveLength(2);

    const content = lastUserContent(llm, 1);
    expect(content).toHaveLength(1);
    const toolResult = content[0]!;
    expect(toolResult.type).toBe('tool_result');
    expect(toolResult.tool_use_id).toBe('toolu_1');
    expect(toolResult.is_error).toBeFalsy();
    const blocks = toolResult.content as {
      type: string;
      text?: string;
      source?: { media_type?: string; data?: string };
    }[];
    expect(blocks.some((b) => b.type === 'text' && typeof b.text === 'string' && b.text.length > 0)).toBe(true);
    const imageBlock = blocks.find((b) => b.type === 'image');
    expect(imageBlock?.source?.media_type).toBe('image/png');
    expect(imageBlock?.source?.data).toBe(fakePngBase64);
  });

  it('retient la spec corrigée pendant la critique', async () => {
    const llm = new FakeLlmClient([
      { content: [toolUseBlock('submit_result', { color: 'red' }, 'toolu_1')] },
      { content: [toolUseBlock('submit_result', { color: 'blue' }, 'toolu_2')] },
    ]);
    const review: StructuredReview<SpecT> = {
      render: async () => ({ image: { data: fakePng, mediaType: 'image/png' } }),
    };
    const result = await generateStructured({ llm, system: 's', prompt: 'p', schema: Spec, review });

    expect(result.value).toEqual({ color: 'blue' });
    expect(result.reviews).toBe(1);
    expect(llm.requests).toHaveLength(2);
  });

  it('revient à la dernière valeur valide après épuisement des essais de correction', async () => {
    const llm = new FakeLlmClient([
      { content: [toolUseBlock('submit_result', { color: 'red' }, 'toolu_1')] },
      // Corrections invalides successives (hors énumération) en réponse à la critique.
      { content: [toolUseBlock('submit_result', { color: 'purple' }, 'toolu_2')] },
      { content: [toolUseBlock('submit_result', { color: 'purple' }, 'toolu_3')] },
      { content: [toolUseBlock('submit_result', { color: 'purple' }, 'toolu_4')] },
    ]);
    const review: StructuredReview<SpecT> = {
      render: async () => ({ image: { data: fakePng, mediaType: 'image/png' } }),
    };
    const result = await generateStructured({ llm, system: 's', prompt: 'p', schema: Spec, maxAttempts: 3, review });

    expect(result.value).toEqual({ color: 'red' });
    expect(result.reviews).toBe(1);
    expect(llm.requests).toHaveLength(4);
    // La 2e requête porte la demande de critique (pas d'erreur) ; la correction invalide qui
    // suit est bien renvoyée comme résultat d'outil en erreur dans la requête suivante.
    expect(lastUserContent(llm, 1)[0]?.is_error).toBeFalsy();
    expect(lastUserContent(llm, 2)[0]?.is_error).toBe(true);
  });

  it('effectue deux tours quand maxRounds = 2 puis retourne la dernière valeur validée', async () => {
    const llm = new FakeLlmClient([
      { content: [toolUseBlock('submit_result', { color: 'red' }, 'toolu_1')] },
      { content: [toolUseBlock('submit_result', { color: 'green' }, 'toolu_2')] },
      { content: [textBlock('OK')] },
    ]);
    const rounds: number[] = [];
    const review: StructuredReview<SpecT> = {
      maxRounds: 2,
      render: async () => ({ image: { data: fakePng, mediaType: 'image/png' } }),
    };
    const result = await generateStructured({
      llm,
      system: 's',
      prompt: 'p',
      schema: Spec,
      review,
      onReview: (r) => rounds.push(r),
    });

    expect(result.value).toEqual({ color: 'green' });
    expect(result.reviews).toBe(2);
    expect(rounds).toEqual([1, 2]);
    expect(llm.requests).toHaveLength(3);
  });

  it('ne critique pas quand render renvoie null (reviews = 0, une seule requête)', async () => {
    const llm = new FakeLlmClient([{ content: [toolUseBlock('submit_result', { color: 'red' }, 'toolu_1')] }]);
    const review: StructuredReview<SpecT> = { render: async () => null };
    const result = await generateStructured({ llm, system: 's', prompt: 'p', schema: Spec, review });

    expect(result.value).toEqual({ color: 'red' });
    expect(result.reviews).toBe(0);
    expect(llm.requests).toHaveLength(1);
  });

  it("renvoie au modèle l'erreur de rendu de la première valeur puis accepte la seconde", async () => {
    const llm = new FakeLlmClient([
      { content: [toolUseBlock('submit_result', { color: 'red' }, 'toolu_1')] },
      { content: [toolUseBlock('submit_result', { color: 'green' }, 'toolu_2')] },
    ]);
    let calls = 0;
    const review: StructuredReview<SpecT> = {
      render: async () => {
        calls++;
        if (calls === 1) throw new Error('rendu impossible');
        return null;
      },
    };
    const result = await generateStructured({ llm, system: 's', prompt: 'p', schema: Spec, review });

    expect(result.value).toEqual({ color: 'green' });
    expect(result.reviews).toBe(0);
    expect(result.attempts).toBe(2);
    expect(llm.requests).toHaveLength(2);

    const secondContent = lastUserContent(llm, 1);
    expect(secondContent[0]?.tool_use_id).toBe('toolu_1');
    expect(secondContent[0]?.is_error).toBe(true);
    expect(JSON.stringify(secondContent[0]?.content)).toContain('rendu impossible');
  });

  it('sans review, le comportement est identique à avant (une seule requête, reviews = 0)', async () => {
    const llm = new FakeLlmClient([{ content: [toolUseBlock('submit_result', { color: 'red' }, 'toolu_1')] }]);
    const result = await generateStructured({ llm, system: 's', prompt: 'p', schema: Spec });

    expect(result.value).toEqual({ color: 'red' });
    expect(result.reviews).toBe(0);
    expect(result.attempts).toBe(1);
    expect(llm.requests).toHaveLength(1);
  });
});
