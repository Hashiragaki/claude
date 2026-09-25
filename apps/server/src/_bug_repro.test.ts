import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { UsageLedger } from './usage';
import { EventHub } from './events';
import { ProjectStore } from './storage';

describe('repro cold-cache double count', () => {
  let dir: string;
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('checkBudget sees doubled spend right after the first record for a project', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'forge-bug-'));
    const store = new ProjectStore(dir);
    await store.init();
    const hub = new EventHub();
    const ledger = new UsageLedger(store, hub, { defaultBudgetUsd: null });
    const project = await store.create({ name: 'Bug', mode: 'vn', template: undefined } as never).catch(() => null);
    // Fallback: create manually if projects service needed; just use store directly.
    console.log('project', project);
  });
});
