import {
  AssetRegistry,
  Engine,
  MemorySaveStorage,
  ModeRegistry,
  Rng,
  loadProjectBundle,
  type ProjectBundle,
} from '@forge/core';
import { describe, expect, it } from 'vitest';
import { BattleSystem, autoBattle } from './battle';
import { rpgMode } from './index';
import { loadRpgProject, type RpgProjectData } from './loader';
import { getSelfSwitch } from './state';
import { DEMO_POSITIONS as P, demoTemplate } from './templates';
import { DT, answer, frames, interact, talkTo, templateFiles, walkTo } from './test-helpers';
import { RpgWorld } from './world';

async function loadDemo(): Promise<{ bundle: ProjectBundle; data: RpgProjectData }> {
  const bundle = await loadProjectBundle(templateFiles(demoTemplate));
  const assets = new AssetRegistry(bundle.manifest.assets, bundle.files);
  const data = await loadRpgProject(bundle.files, { entry: bundle.manifest.entry, assets });
  return { bundle, data };
}

/** Démarre la démo et passe l'introduction automatique. */
function startDemo(data: RpgProjectData, seed = 2026): RpgWorld {
  const world = new RpgWorld({ ...data, rng: new Rng(seed) });
  world.state.flags.encounters = false;
  frames(world, 1);
  const intro = answer(world);
  expect(intro).toEqual(['Nous voici enfin au village de Brume !', expect.stringContaining('L\'Ancien du village')]);
  frames(world, 30);
  expect(world.busy).toBe(false);
  expect(world.state.player).toMatchObject({ x: P.start.x, y: P.start.y - 1 });
  return world;
}

describe('démo « Le Village de Brume »', () => {
  it('charge toutes les cartes atteignables', async () => {
    const { data } = await loadDemo();
    expect([...data.maps.keys()].sort()).toEqual(['auberge', 'village']);
    expect(data.problems).toEqual([]);
    expect(data.maps.get('village')).toMatchObject({ width: 32, height: 24 });
  });

  it('se joue : coffre, villageoise, quête et combat contre le Roi Slime', async () => {
    const { data } = await loadDemo();
    const world = startDemo(data);

    // Coffre : 3 potions, puis page « ouvert »
    walkTo(world, P.chest.x + 1, P.chest.y);
    interact(world, P.chest.x, P.chest.y);
    expect(answer(world)).toEqual(['Vous trouvez 3 Potions !']);
    expect(world.state.items.potion).toBe(3);
    expect(getSelfSwitch(world.state, 'village', 'coffre', 'A')).toBe(true);
    interact(world, P.chest.x, P.chest.y);
    expect(answer(world)).toEqual(['Le coffre est vide.']);
    expect(world.state.items.potion).toBe(3);

    // Villageoise : dialogue à choix
    talkTo(world, 'mila');
    expect(world.request).toMatchObject({ kind: 'message', speaker: 'Mila' });
    expect(answer(world, [1])).toEqual([
      'Bonjour ! Vous êtes nouveaux à Brume, n\'est-ce pas ?',
      'Ah bon ? Je ne vous ai pourtant jamais vus… Bonne journée !',
      'Des slimes rôdent dans les hautes herbes au sud-ouest. Prudence ! (Discussions : 1)',
    ]);
    expect(world.state.variables.discussions_mila).toBe(1);

    // Le Roi Slime dort tant que la quête n'est pas acceptée
    walkTo(world, P.boss.x - 1, P.boss.y);
    interact(world, P.boss.x, P.boss.y);
    expect(answer(world)).toEqual([expect.stringContaining('Zzz')]);

    // L'Ancien confie la quête
    talkTo(world, 'ancien');
    answer(world, [0]);
    expect(world.state.switches.quete_roi_slime).toBe(true);
    expect(world.state.variables.quete).toBe(1);

    // Combat contre le boss (équipe renforcée, hasard déterministe)
    walkTo(world, P.boss.x - 1, P.boss.y);
    interact(world, P.boss.x, P.boss.y);
    expect(world.request).toEqual({ kind: 'message', speaker: 'Roi Slime', text: 'Blorp ! Qui ose troubler ma sieste royale ?!' });
    world.resume();
    expect(world.request).toEqual({ kind: 'battle', troop: 'roi_slime', canEscape: false, canLose: false });
    for (const actor of world.state.party) {
      actor.atk = 40;
      actor.maxHp = actor.hp = 400;
    }
    const battle = new BattleSystem({ state: world.state, database: data.database, troop: 'roi_slime', rng: new Rng(9) });
    const { result } = autoBattle(battle);
    expect(result).toBe('win');
    expect(battle.rewards).toMatchObject({ exp: 60, gold: 80, items: [{ item: 'plume_phenix', count: 1 }] });
    expect(world.state.party.every((a) => a.level >= 2)).toBe(true);
    world.resume(result);
    expect(answer(world)).toEqual([expect.stringContaining('flaque inoffensive')]);
    expect(world.state.switches.roi_slime_vaincu).toBe(true);
    expect(world.state.variables.quete).toBe(2);
    expect(world.event('roi_slime')!.visible).toBe(false);
    expect(world.isPassable(P.boss.x, P.boss.y)).toBe(true);

    // Récompense de l'Ancien
    const gold = world.state.gold;
    talkTo(world, 'ancien');
    answer(world);
    expect(world.state.gold).toBe(gold + 100);
    expect(world.state.items.cle_coffre).toBe(1);
    expect(getSelfSwitch(world.state, 'village', 'ancien', 'A')).toBe(true);
  });

  it('entre dans l\'auberge, s\'y repose, ouvre le coffre verrouillé et ressort', async () => {
    const { data } = await loadDemo();
    const world = startDemo(data, 7);
    world.state.party[0]!.hp = 1;
    world.state.items.cle_coffre = 1;

    walkTo(world, P.innDoor.x, P.innDoor.y);
    expect(world.request).toEqual({ kind: 'teleport', map: 'auberge', x: P.innEntry.x, y: P.innEntry.y, direction: 'up' });
    world.resume();
    expect(world.map.id).toBe('auberge');

    walkTo(world, P.innkeeper.x, P.innkeeper.y + 1);
    interact(world, P.innkeeper.x, P.innkeeper.y);
    expect(world.request).toMatchObject({ kind: 'message', text: expect.stringContaining('(Vous avez 50 PO.)') });
    world.resume();
    world.resume(0);
    frames(world, 40);
    expect(answer(world)).toEqual(['Bonne nuit ! … Toute l\'équipe est en pleine forme !']);
    expect(world.state.gold).toBe(40);
    expect(world.state.party[0]!.hp).toBe(world.state.party[0]!.maxHp);

    walkTo(world, P.innChest.x, P.innChest.y + 1);
    interact(world, P.innChest.x, P.innChest.y);
    expect(answer(world)).toEqual([expect.stringContaining('Plume de phénix')]);
    expect(world.state.items).toMatchObject({ plume_phenix: 1, ether: 2 });
    expect(world.state.items.cle_coffre).toBeUndefined();

    walkTo(world, P.innExit.x, P.innExit.y);
    world.resume();
    expect(world.map.id).toBe('village');
    expect(world.state.player).toEqual({ x: P.innDoor.x, y: P.innDoor.y + 1, direction: 'down' });
  });

  it('déclenche des rencontres dans les hautes herbes', async () => {
    const { data } = await loadDemo();
    const world = startDemo(data, 3);
    world.state.flags.encounters = true;
    walkTo(world, 6, 14);
    let request = world.request;
    for (let i = 0; i < 60 && !request; i++) {
      walkTo(world, 6, i % 2 ? 14 : 20);
      request = world.request;
    }
    expect(request?.kind).toBe('battle');
    expect(['slimes', 'chauve_souris', 'mixte']).toContain(request?.kind === 'battle' ? request.troop : '');
  });

  it('tourne dans le moteur sans affichage : entrées, inspecteur et sauvegardes', async () => {
    const bundle = await loadProjectBundle(templateFiles(demoTemplate));
    const engine = new Engine({
      bundle,
      modes: new ModeRegistry([rpgMode]),
      autoLoop: false,
      saveStorage: new MemorySaveStorage(),
      seed: 1,
    });
    const reasons: string[] = [];
    engine.events.on('state-changed', (e) => reasons.push(e.reason));
    await engine.start();
    engine.step(DT);
    expect(engine.debugState()).toMatchObject({ map: 'village', gold: 50, player: { x: 15, y: 20 } });
    for (let i = 0; i < 2; i++) {
      engine.input.tap('confirm');
      engine.step(DT);
    }
    engine.step(0.6);
    expect(engine.debugState().player).toMatchObject({ x: 15, y: 19 });

    engine.input.press('left');
    engine.step(0.2);
    engine.input.release('left');
    engine.step(0.5);
    expect(engine.debugState().player).toMatchObject({ x: 14, y: 19, direction: 'left' });

    engine.setDebugValue('switches.quete_roi_slime', true);
    engine.setDebugValue('variables.quete', '1');
    engine.setDebugValue('gold', 999);
    engine.setDebugValue('items.potion', 4);
    expect(engine.debugState()).toMatchObject({
      gold: 999,
      switches: { quete_roi_slime: true },
      variables: { quete: 1 },
      items: { potion: 4 },
    });
    expect(reasons).toContain('debug');
    await engine.save('1');
    engine.setDebugValue('gold', 0);
    expect(await engine.load('1')).toBe(true);
    expect(engine.debugState()).toMatchObject({ gold: 999, map: 'village', player: { x: 14, y: 19 } });
    engine.destroy();
  });
});
