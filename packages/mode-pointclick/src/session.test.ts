import { describe, expect, it } from 'vitest';
import { PointClickStateSchema } from './schema';
import type { ItemsFileInput, PointClickAction, SceneInput } from './schema';
import { PointClickSession } from './session';
import { FLOOR, makeData, makeSession } from './test-helpers';

const say = (text: string): PointClickAction => ({ type: 'say', text });

/** Scène sans personnage (pas de zone de marche) avec une zone cliquable. */
function sceneWith(hotspots: SceneInput['hotspots'], extra: Partial<SceneInput> = {}): SceneInput {
  return { id: 'a', background: 'bg-a', hotspots, ...extra };
}

const box = { type: 'rect', x: 100, y: 100, w: 50, h: 50 } as const;
const IN_BOX = { x: 120, y: 120 };

describe('démarrage et scènes', () => {
  it('exécute onFirstEnter puis onEnter à la première visite, seulement onEnter ensuite', () => {
    const { session } = makeSession({
      scenes: [
        {
          id: 'a',
          background: 'bg-a',
          onFirstEnter: [say('premier')],
          onEnter: [say('entrée')],
          hotspots: [
            { id: 'door', name: 'Porte', shape: box, interactions: [{ actions: [{ type: 'goto', scene: 'b' }] }] },
          ],
        },
        {
          id: 'b',
          background: 'bg-b',
          hotspots: [
            { id: 'back', name: 'Retour', shape: box, interactions: [{ actions: [{ type: 'goto', scene: 'a' }] }] },
          ],
        },
      ],
    });
    expect(session.view().message?.text).toBe('premier');
    session.advance();
    expect(session.view().message?.text).toBe('entrée');
    session.advance();
    expect(session.view().phase).toBe('explore');
    session.click(IN_BOX, 'interact');
    expect(session.view().scene.id).toBe('b');
    session.click(IN_BOX, 'interact');
    expect(session.view().scene.id).toBe('a');
    expect(session.view().message?.text).toBe('entrée');
    session.advance();
    expect(session.view().phase).toBe('explore');
  });

  it('émet scene-changed et music seulement quand la musique change', () => {
    const { session } = makeSession({
      scenes: [
        {
          id: 'a',
          background: 'bg-a',
          music: 'song1',
          onEnter: [{ type: 'goto', scene: 'b' }],
        },
        { id: 'b', background: 'bg-b', music: 'song1', onEnter: [{ type: 'goto', scene: 'c' }] },
        { id: 'c', background: 'bg-c', music: 'song2' },
      ],
    });
    const events = session.drainEvents();
    expect(events.filter((e) => e.type === 'scene-changed').map((e) => (e as { scene: string }).scene)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(events.filter((e) => e.type === 'music')).toEqual([
      { type: 'music', asset: 'song1' },
      { type: 'music', asset: 'song2' },
    ]);
    expect(session.drainEvents()).toEqual([]);
    expect(events.filter((e) => e.type === 'scene-changed')[1]).toEqual({
      type: 'scene-changed',
      scene: 'b',
      previous: 'a',
    });
  });

  it('goto avec coordonnées place le joueur ; sinon playerStart', () => {
    const area = { walkArea: [FLOOR] };
    const { session } = makeSession({
      system: { playerCharset: 'char' },
      scenes: [
        {
          id: 'a',
          background: 'bg-a',
          ...area,
          playerStart: { x: 10, y: 20 },
          onEnter: [{ type: 'goto', scene: 'b', x: 300, y: 400 }],
        },
        { id: 'b', background: 'bg-b', ...area, playerStart: { x: 1, y: 2 } },
      ],
    });
    expect(session.view().player).toMatchObject({ x: 300, y: 400 });
  });

  it('goto vers une scène inconnue est journalisé et ignoré', () => {
    const { session, logs } = makeSession({
      scenes: [{ id: 'a', background: 'bg-a', onEnter: [{ type: 'goto', scene: 'nulle' }, say('suite')] }],
    });
    expect(logs.some((l) => l.includes('nulle'))).toBe(true);
    expect(session.view().message?.text).toBe('suite');
  });
});

describe('actions', () => {
  it("say : phase message, interpolation et orateur, jusqu'à advance", () => {
    const { session } = makeSession({
      system: { variables: { gold: 7, nom: 'Léa' } },
      scenes: [
        sceneWith([], { onEnter: [{ type: 'say', text: '{nom} a {gold} pièces', speaker: '{nom}' }, say('fin')] }),
      ],
    });
    const v = session.view();
    expect(v.phase).toBe('message');
    expect(v.message).toEqual({ text: 'Léa a 7 pièces', speaker: 'Léa' });
    session.advance();
    expect(session.view().message?.text).toBe('fin');
    session.advance();
    expect(session.view().phase).toBe('explore');
    expect(session.view().message).toBeUndefined();
  });

  it('give et remove : inventaire, événements, son de ramassage', () => {
    const { session, logs } = makeSession({
      system: { sfx: { pickup: 'pick.wav' } },
      scenes: [
        sceneWith([], {
          onEnter: [
            { type: 'give', item: 'key' },
            { type: 'give', item: 'key' },
            { type: 'give', item: 'fantome' },
            { type: 'remove', item: 'rope' },
          ],
        }),
      ],
    });
    expect(session.view().inventory.map((i) => i.id)).toEqual(['key']);
    expect(session.view().inventory[0]).toMatchObject({ name: 'Clé', icon: 'icon-key' });
    const events = session.drainEvents();
    expect(events.filter((e) => e.type === 'item-gained')).toEqual([{ type: 'item-gained', item: 'key' }]);
    expect(events).toContainEqual({ type: 'sound', asset: 'pick.wav' });
    expect(logs.filter((l) => l.includes('fantome') || l.includes('rope'))).toHaveLength(2);
    // remove
    const s2 = makeSession({
      system: { startItems: ['key'] },
      scenes: [sceneWith([], { onEnter: [{ type: 'remove', item: 'key' }] })],
    }).session;
    expect(s2.view().inventory).toEqual([]);
    expect(s2.drainEvents()).toContainEqual({ type: 'item-lost', item: 'key' });
  });

  it("set : valeur issue de l'expression, variables lues par les conditions", () => {
    const { session } = makeSession({
      system: { variables: { n: 1 } },
      scenes: [
        sceneWith([], {
          onEnter: [
            { type: 'set', var: 'n', value: 'n + 4' },
            { type: 'set', var: 'nom', value: '"Zed"' },
            { type: 'if', condition: 'n == 5', then: [say('cinq {nom}')], else: [say('autre')] },
          ],
        }),
      ],
    });
    expect(session.view().message?.text).toBe('cinq Zed');
    expect(session.debugState().variables).toMatchObject({ n: 5, nom: 'Zed' });
  });

  it('une expression en erreur est journalisée et traitée comme fausse', () => {
    const { session, logs } = makeSession({
      scenes: [
        sceneWith([], {
          onEnter: [
            { type: 'if', condition: 'inconnue > 1', then: [say('oui')], else: [say('non')] },
            { type: 'set', var: 'x', value: '1 +' },
          ],
        }),
      ],
    });
    expect(session.view().message?.text).toBe('non');
    session.advance();
    expect(session.view().phase).toBe('explore');
    expect(logs.length).toBeGreaterThanOrEqual(2);
  });

  it('has() et visited() sont disponibles dans les expressions', () => {
    const { session } = makeSession({
      system: { startItems: ['key'] },
      scenes: [
        sceneWith([], {
          onEnter: [
            { type: 'if', condition: 'has("key") and not has("rope")', then: [say('clé seule')] },
            { type: 'if', condition: 'visited("a") and not visited("b")', then: [say('a vue')] },
          ],
        }),
      ],
    });
    expect(session.view().message?.text).toBe('clé seule');
    session.advance();
    expect(session.view().message?.text).toBe('a vue');
  });

  it('hide / show : zones masquées exclues des clics, du survol et de la vue', () => {
    const { session } = makeSession({
      scenes: [
        sceneWith([
          { id: 'h1', name: 'Boîte', shape: box, interactions: [{ actions: [say('clic')] }] },
          {
            id: 'sec',
            name: 'Secret',
            shape: { type: 'rect', x: 300, y: 300, w: 20, h: 20 },
            hidden: true,
            interactions: [{ actions: [say('secret')] }],
          },
        ]),
      ],
    });
    expect(session.view().hotspots.map((h) => h.id)).toEqual(['h1']);
    expect(session.hover({ x: 310, y: 310 }).hotspot).toBeUndefined();
    session.click({ x: 310, y: 310 }, 'interact');
    expect(session.view().phase).toBe('explore');

    const s = makeSession({
      scenes: [
        sceneWith(
          [
            {
              id: 'sec',
              name: 'Secret',
              shape: box,
              hidden: true,
              interactions: [{ actions: [{ type: 'hide', hotspot: 'sec' }, say('vu')] }],
            },
            { id: 'btn', name: 'Bouton', shape: { type: 'rect', x: 0, y: 0, w: 10, h: 10 } },
          ],
          { onEnter: [{ type: 'show', hotspot: 'sec' }] },
        ),
      ],
    }).session;
    expect(s.view().hotspots.map((h) => h.id)).toEqual(['sec', 'btn']);
    s.click(IN_BOX, 'interact');
    s.advance();
    expect(s.view().hotspots.map((h) => h.id)).toEqual(['btn']);
  });

  it('hide / show sur une autre scène ou une zone inconnue : journal sans exception', () => {
    const { session, logs } = makeSession({
      scenes: [
        {
          id: 'a',
          background: 'bg-a',
          onEnter: [
            { type: 'hide', hotspot: 'x', scene: 'b' },
            { type: 'show', hotspot: 'nulle', scene: 'b' },
            { type: 'show', hotspot: 'x', scene: 'zzz' },
          ],
        },
        { id: 'b', background: 'bg-b', hotspots: [{ id: 'x', name: 'X', shape: box }] },
      ],
    });
    expect(logs).toHaveLength(2);
    expect(session.serialize().hotspots).toEqual({ b: { x: false } });
  });

  it('sound et music émettent des événements', () => {
    const { session } = makeSession({
      scenes: [
        sceneWith([], {
          onEnter: [
            { type: 'sound', asset: 'boum' },
            { type: 'music', asset: 'm1' },
            { type: 'music', asset: 'm1' },
            { type: 'music' },
          ],
        }),
      ],
    });
    expect(session.drainEvents().filter((e) => e.type !== 'scene-changed')).toEqual([
      { type: 'sound', asset: 'boum' },
      { type: 'music', asset: 'm1' },
      { type: 'music' },
    ]);
  });

  it('wait : phase busy décomptée par update, clics ignorés', () => {
    const { session } = makeSession({
      scenes: [
        sceneWith([{ id: 'h', name: 'H', shape: box, interactions: [{ actions: [say('x')] }] }], {
          onEnter: [{ type: 'wait', seconds: 1 }, say('après')],
        }),
      ],
    });
    expect(session.view().phase).toBe('busy');
    session.click(IN_BOX, 'interact');
    expect(session.view().phase).toBe('busy');
    session.update(0.4);
    expect(session.view().phase).toBe('busy');
    session.update(0.7);
    expect(session.view().message?.text).toBe('après');
  });

  it('end : phase ended, texte interpolé, événement, plus aucune action', () => {
    const { session } = makeSession({
      system: { variables: { score: 3 } },
      scenes: [sceneWith([], { onEnter: [{ type: 'end', text: 'Score {score}' }, say('jamais')] })],
    });
    expect(session.view().phase).toBe('ended');
    expect(session.view().endText).toBe('Score 3');
    expect(session.drainEvents()).toContainEqual({ type: 'ended', text: 'Score 3' });
    session.advance();
    session.click(IN_BOX, 'interact');
    expect(session.view().phase).toBe('ended');
  });

  it("garde-fou : une boucle d'actions infinie est interrompue", () => {
    const loop: PointClickAction[] = [];
    // 1500 actions `set` d'affilée dépassent le plafond de 1000
    for (let i = 0; i < 1500; i++) loop.push({ type: 'set', var: 'n', value: 'n + 1' });
    const { session, logs } = makeSession({
      system: { variables: { n: 0 } },
      scenes: [sceneWith([], { onEnter: [...loop, say('jamais')] })],
    });
    expect(session.view().phase).toBe('explore');
    expect(session.debugState().variables).toMatchObject({ n: 1000 });
    expect(logs.some((l) => l.includes('1000'))).toBe(true);
  });
});

describe('dialogues', () => {
  const dialogue: PointClickAction = {
    type: 'dialogue',
    speaker: 'Vieux',
    prompt: 'Alors ?',
    choices: [
      { text: 'Bonjour', once: true, actions: [say('Salut')] },
      { text: 'Secret', condition: 'knows', actions: [say('Chut')] },
      { text: 'Au revoir', actions: [{ type: 'set', var: 'knows', value: 'True' }] },
    ],
  };
  const talk = () =>
    makeSession({
      system: { variables: { knows: false } },
      scenes: [
        sceneWith([
          { id: 'npc', name: 'Vieux', kind: 'character', shape: box, interactions: [{ actions: [dialogue] }] },
        ]),
      ],
    });

  it("affiche les choix visibles avec leur index d'origine", () => {
    const { session } = talk();
    session.click(IN_BOX, 'interact');
    const v = session.view();
    expect(v.phase).toBe('choice');
    expect(v.choice?.speaker).toBe('Vieux');
    expect(v.choice?.prompt).toBe('Alors ?');
    expect(v.choice?.options).toEqual([
      { index: 0, text: 'Bonjour' },
      { index: 2, text: 'Au revoir' },
    ]);
  });

  it('refuse un choix masqué ou hors phase', () => {
    const { session } = talk();
    session.choose(0);
    expect(session.view().phase).toBe('explore');
    session.click(IN_BOX, 'interact');
    session.choose(1);
    expect(session.view().phase).toBe('choice');
  });

  it('un choix once disparaît après usage, avec une clé stable mémorisée', () => {
    const { session } = talk();
    session.click(IN_BOX, 'interact');
    session.choose(0);
    expect(session.view().message?.text).toBe('Salut');
    session.advance();
    expect(session.view().phase).toBe('explore');
    expect(session.serialize().usedChoices).toEqual(['a/npc/0/0/0']);
    session.click(IN_BOX, 'interact');
    expect(session.view().choice?.options.map((o) => o.index)).toEqual([2]);
  });

  it('le choix « once » reste masqué après sauvegarde et restauration', () => {
    const { session } = talk();
    session.click(IN_BOX, 'interact');
    session.choose(0);
    session.advance();
    const state = session.serialize();
    const other = makeSession(
      {
        system: { variables: { knows: false } },
        scenes: [sceneWith([{ id: 'npc', name: 'Vieux', shape: box, interactions: [{ actions: [dialogue] }] }])],
      },
      { state },
    ).session;
    other.click(IN_BOX, 'interact');
    expect(other.view().choice?.options.map((o) => o.index)).toEqual([2]);
  });

  it('un choix qui modifie une variable rend un autre choix disponible', () => {
    const { session } = talk();
    session.click(IN_BOX, 'interact');
    session.choose(2);
    expect(session.view().phase).toBe('explore');
    session.click(IN_BOX, 'interact');
    expect(session.view().choice?.options.map((o) => o.index)).toEqual([0, 1, 2]);
  });

  it('un dialogue sans choix visible est ignoré', () => {
    const { session } = makeSession({
      scenes: [
        sceneWith([], {
          onEnter: [
            { type: 'dialogue', choices: [{ text: 'x', condition: 'False', actions: [say('x')] }] },
            say('suite'),
          ],
        }),
      ],
    });
    expect(session.view().message?.text).toBe('suite');
  });

  it('les dialogues imbriqués dans un if gardent des clés distinctes', () => {
    const { session } = makeSession({
      scenes: [
        sceneWith([], {
          onEnter: [
            {
              type: 'if',
              condition: 'True',
              then: [{ type: 'dialogue', choices: [{ text: 'A', once: true, actions: [say('a')] }] }],
            },
          ],
        }),
      ],
    });
    session.choose(0);
    expect(session.serialize().usedChoices).toEqual(['a/onEnter/0/then/0/0']);
  });
});

describe('interactions sur les zones (sans personnage)', () => {
  const hotspots: SceneInput['hotspots'] = [
    {
      id: 'door',
      name: 'Porte',
      shape: box,
      description: 'Une lourde porte.',
      interactions: [
        { item: 'key', actions: [say('Ouverte !'), { type: 'remove', item: 'key' }] },
        { condition: 'has("rope")', actions: [say('Avec la corde')] },
        { actions: [say('Verrouillée')] },
        { verb: 'look', condition: 'seen', actions: [say('Déjà vue')] },
      ],
    },
    { id: 'rock', name: 'Rocher', shape: { type: 'rect', x: 400, y: 100, w: 50, h: 50 }, description: 'Un rocher.' },
    { id: 'wall', name: 'Mur', shape: { type: 'rect', x: 600, y: 100, w: 50, h: 50 } },
  ];
  const setup = (startItems: string[] = []) =>
    makeSession({
      system: { startItems, defaultFail: 'Rien à faire.', variables: { seen: false } },
      scenes: [sceneWith(hotspots)],
    });

  it('exécute immédiatement la première interaction qui correspond', () => {
    const { session } = setup();
    session.click(IN_BOX, 'interact');
    expect(session.view().message?.text).toBe('Verrouillée');
  });

  it("prend en compte la condition (has) avant l'interaction à mains nues", () => {
    const { session } = setup(['rope']);
    session.click(IN_BOX, 'interact');
    expect(session.view().message?.text).toBe('Avec la corde');
  });

  it("utilise l'objet sélectionné puis le désélectionne", () => {
    const { session } = setup(['key']);
    session.selectItem('key');
    expect(session.hover(IN_BOX).label).toBe('Utiliser Clé sur Porte');
    session.click(IN_BOX, 'interact');
    expect(session.view().message?.text).toBe('Ouverte !');
    expect(session.view().selectedItem).toBeUndefined();
    session.advance();
    expect(session.view().inventory).toEqual([]);
  });

  it('un objet sans interaction correspondante : defaultFail et événement fail, sélection conservée', () => {
    const { session } = setup(['key', 'rope']);
    session.drainEvents();
    session.selectItem('rope');
    session.click(IN_BOX, 'interact');
    expect(session.view().message?.text).toBe('Rien à faire.');
    expect(session.drainEvents()).toContainEqual({ type: 'fail' });
    expect(session.view().selectedItem).toBe('rope');
  });

  it('look : description par défaut, interaction look conditionnelle, valeur par défaut', () => {
    const { session } = setup();
    session.click(IN_BOX, 'look');
    expect(session.view().message?.text).toBe('Une lourde porte.');
    session.advance();
    session.click({ x: 410, y: 110 }, 'look');
    expect(session.view().message?.text).toBe('Un rocher.');
    session.advance();
    session.click({ x: 610, y: 110 }, 'look');
    expect(session.view().message?.text).toBe('Rien de spécial.');
  });

  it('look préfère une interaction look dont la condition est vraie', () => {
    const { session } = makeSession({
      system: { variables: { seen: true } },
      scenes: [sceneWith(hotspots)],
    });
    session.click(IN_BOX, 'look');
    expect(session.view().message?.text).toBe('Déjà vue');
  });

  it('zone sans interaction : rien ne se passe ; avec objet : défaut', () => {
    const { session } = setup(['key']);
    session.click({ x: 610, y: 110 }, 'interact');
    expect(session.view().phase).toBe('explore');
    session.selectItem('key');
    session.click({ x: 610, y: 110 }, 'interact');
    expect(session.view().message?.text).toBe('Rien à faire.');
  });

  it('hover : nom de la zone, libellé vide sur le sol, topmost en cas de chevauchement', () => {
    const { session } = makeSession({
      scenes: [
        sceneWith([
          { id: 'bas', name: 'Bas', shape: box },
          { id: 'haut', name: 'Haut', kind: 'exit', shape: { type: 'rect', x: 120, y: 120, w: 100, h: 100 } },
        ]),
      ],
    });
    expect(session.hover({ x: 110, y: 110 })).toEqual({
      hotspot: { id: 'bas', name: 'Bas', kind: 'object' },
      label: 'Bas',
    });
    expect(session.hover({ x: 130, y: 130 }).hotspot?.id).toBe('haut');
    expect(session.hover({ x: 900, y: 900 })).toEqual({ label: '' });
  });

  it('ignore les clics pendant un message', () => {
    const { session } = setup();
    session.click(IN_BOX, 'interact');
    session.click({ x: 410, y: 110 }, 'look');
    expect(session.view().message?.text).toBe('Verrouillée');
  });

  it('vue : boîte englobante, sprite et sprite par défaut', () => {
    const { session } = makeSession({
      scenes: [
        sceneWith([
          { id: 'o', name: 'O', shape: box, sprite: 'o.png' },
          { id: 'p', name: 'P', shape: box, sprite: 'p.png', spriteAt: { x: 1, y: 2, w: 3, h: 4 } },
        ]),
      ],
    });
    const [o, p] = session.view().hotspots;
    expect(o).toMatchObject({
      bounds: { x: 100, y: 100, w: 50, h: 50 },
      sprite: 'o.png',
      spriteAt: { x: 100, y: 100, w: 50, h: 50 },
    });
    expect(p?.spriteAt).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(session.view().player).toBeUndefined();
  });
});

describe('inventaire et combinaisons', () => {
  const items = {
    items: [
      { id: 'key', name: 'Clé', icon: 'k' },
      { id: 'rope', name: 'Corde', icon: 'r', description: 'Une corde solide.' },
      { id: 'hook', name: 'Crochet', icon: 'h' },
      { id: 'grapple', name: 'Grappin', icon: 'g' },
    ],
    combinations: [
      { a: 'rope', b: 'hook', result: 'grapple', actions: [{ type: 'set', var: 'built', value: 'True' }] },
      { a: 'key', b: 'rope', consume: false, condition: 'allowed', actions: [say('Ça tient')] },
    ],
  } satisfies ItemsFileInput;
  const setup = (allowed = true) =>
    makeSession({
      system: {
        startItems: ['rope', 'hook', 'key'],
        sfx: { combine: 'combo.wav', fail: 'fail.wav' },
        variables: { allowed, built: false },
      },
      items,
    }).session;

  it('combine dans les deux sens, consomme, donne le résultat et exécute les actions', () => {
    const s = setup();
    s.drainEvents();
    s.selectItem('hook');
    s.useItemOnItem('rope');
    expect(s.view().inventory.map((i) => i.id)).toEqual(['key', 'grapple']);
    expect(s.view().selectedItem).toBeUndefined();
    expect(s.debugState().variables).toMatchObject({ built: true });
    const events = s.drainEvents();
    expect(events).toContainEqual({ type: 'combined', a: 'hook', b: 'rope', result: 'grapple' });
    expect(events).toContainEqual({ type: 'sound', asset: 'combo.wav' });
    expect(events).toContainEqual({ type: 'item-gained', item: 'grapple' });
    expect(events.filter((e) => e.type === 'item-lost')).toHaveLength(2);
  });

  it('consume: false conserve les objets ; la condition est respectée', () => {
    const s = setup();
    s.selectItem('key');
    s.useItemOnItem('rope');
    expect(s.view().inventory.map((i) => i.id)).toEqual(['rope', 'hook', 'key']);
    expect(s.view().message?.text).toBe('Ça tient');

    const refuse = setup(false);
    refuse.drainEvents();
    refuse.selectItem('key');
    refuse.useItemOnItem('rope');
    expect(refuse.view().message?.text).toBe('Ça ne donne rien.');
    expect(refuse.drainEvents()).toEqual(
      expect.arrayContaining([{ type: 'fail' }, { type: 'sound', asset: 'fail.wav' }]),
    );
  });

  it('sans combinaison : defaultFail + fail ; sans sélection ou sur soi-même : rien', () => {
    const s = setup();
    s.useItemOnItem('rope');
    expect(s.view().phase).toBe('explore');
    s.selectItem('hook');
    s.useItemOnItem('key');
    expect(s.view().message?.text).toBe('Ça ne donne rien.');
    s.advance();
    s.selectItem('hook');
    s.useItemOnItem('hook');
    expect(s.view().selectedItem).toBeUndefined();
    expect(s.view().phase).toBe('explore');
  });

  it('selectItem : bascule, rejette un objet absent', () => {
    const { session, logs } = makeSession({ system: { startItems: ['key'] } });
    session.selectItem('key');
    expect(session.view().selectedItem).toBe('key');
    session.selectItem('key');
    expect(session.view().selectedItem).toBeUndefined();
    session.selectItem('rope');
    expect(session.view().selectedItem).toBeUndefined();
    expect(logs).toHaveLength(1);
  });

  it('lookItem affiche la description (ou la valeur par défaut)', () => {
    const s = setup();
    s.lookItem('rope');
    expect(s.view().message).toEqual({ text: 'Une corde solide.', speaker: 'Corde' });
    s.advance();
    s.lookItem('key');
    expect(s.view().message?.text).toBe('Rien de spécial.');
    s.advance();
    s.lookItem('grapple');
    expect(s.view().phase).toBe('explore');
  });
});

describe('personnage : marche et interaction différée', () => {
  const hotspots: SceneInput['hotspots'] = [
    {
      id: 'chest',
      name: 'Coffre',
      shape: { type: 'rect', x: 600, y: 100, w: 100, h: 100 },
      walkTo: { x: 650, y: 300 },
      interactions: [{ actions: [say('ouvert')] }],
    },
    {
      id: 'tree',
      name: 'Arbre',
      shape: { type: 'rect', x: 100, y: 600, w: 100, h: 100 },
      interactions: [{ actions: [say('arbre')] }],
    },
  ];
  const setup = (extra: Partial<SceneInput> = {}) =>
    makeSession({
      system: { playerCharset: 'char', walkSpeed: 100, playerScale: 2 },
      scenes: [sceneWith(hotspots, { walkArea: [FLOOR], playerStart: { x: 100, y: 300 }, ...extra })],
    }).session;

  it('affiche le personnage à playerStart, face au bas', () => {
    const s = setup();
    expect(s.view().player).toEqual({ x: 100, y: 300, scale: 2, facing: 'down', walking: false });
  });

  it('un clic sur le sol lance la marche, update avance à walkSpeed, direction et arrivée', () => {
    const s = setup();
    s.click({ x: 300, y: 300 }, 'interact');
    expect(s.view().phase).toBe('walking');
    s.update(1);
    expect(s.view().player).toMatchObject({ x: 200, y: 300, facing: 'right', walking: true });
    s.update(5);
    expect(s.view().player).toMatchObject({ x: 300, y: 300, walking: false });
    expect(s.view().phase).toBe('explore');
    s.click({ x: 300, y: 100 }, 'interact');
    s.update(10);
    expect(s.view().player).toMatchObject({ x: 300, y: 100, facing: 'up' });
    s.click({ x: 100, y: 100 }, 'interact');
    s.update(1);
    expect(s.view().player?.facing).toBe('left');
  });

  it('un clic hors de la zone de marche mène au point le plus proche', () => {
    const s = setup();
    s.click({ x: 1200, y: 300 }, 'interact');
    s.update(100);
    expect(s.view().player).toMatchObject({ x: 1000, y: 300 });
  });

  it('un clic pendant la marche redirige', () => {
    const s = setup();
    s.click({ x: 900, y: 300 }, 'interact');
    s.update(1);
    s.click({ x: 50, y: 300 }, 'interact');
    s.update(0.5);
    expect(s.view().player?.x).toBe(150);
    expect(s.view().player?.facing).toBe('left');
    s.update(10);
    expect(s.view().player?.x).toBe(50);
  });

  it("interagit à l'arrivée à walkTo, pas avant", () => {
    const s = setup();
    s.click({ x: 650, y: 150 }, 'interact');
    expect(s.view().phase).toBe('walking');
    expect(s.view().message).toBeUndefined();
    s.update(1);
    expect(s.view().phase).toBe('walking');
    s.update(10);
    expect(s.view().message?.text).toBe('ouvert');
    expect(s.view().player).toMatchObject({ x: 650, y: 300 });
  });

  it("sans walkTo, marche jusqu'au point de la zone le plus proche du centre de la zone", () => {
    const s = setup();
    s.click({ x: 150, y: 650 }, 'interact');
    s.update(20);
    expect(s.view().message?.text).toBe('arbre');
    expect(s.view().player).toMatchObject({ x: 150, y: 500 });
  });

  it("un clic sur le sol pendant la marche annule l'interaction différée", () => {
    const s = setup();
    s.click({ x: 650, y: 150 }, 'interact');
    s.update(1);
    s.click({ x: 100, y: 300 }, 'interact');
    s.update(20);
    expect(s.view().message).toBeUndefined();
    expect(s.view().phase).toBe('explore');
  });

  it('look ne fait pas marcher et interrompt la marche', () => {
    const s = setup();
    s.click({ x: 900, y: 300 }, 'interact');
    s.update(1);
    s.click({ x: 650, y: 150 }, 'look');
    expect(s.view().phase).toBe('message');
    expect(s.view().player?.x).toBe(200);
    s.advance();
    s.update(5);
    expect(s.view().player?.x).toBe(200);
  });

  it('interaction immédiate si le personnage est déjà sur place', () => {
    const s = setup({ playerStart: { x: 650, y: 300 } });
    s.click({ x: 650, y: 150 }, 'interact');
    expect(s.view().message?.text).toBe('ouvert');
  });

  it('contourne un obstacle (zone de marche en L)', () => {
    const ell = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 200 },
      { x: 200, y: 200 },
      { x: 200, y: 500 },
      { x: 0, y: 500 },
    ];
    const s = setup({ walkArea: [ell], playerStart: { x: 100, y: 450 } });
    s.click({ x: 900, y: 100 }, 'interact');
    for (let i = 0; i < 100; i++) s.update(0.1);
    expect(s.view().phase).toBe('explore');
    expect(s.view().player?.x).toBeCloseTo(900);
    expect(s.view().player?.y).toBeCloseTo(100);
  });

  it('échelle de profondeur interpolée et bornée × playerScale', () => {
    const s = setup({
      depthScale: { topY: 100, topScale: 0.5, bottomY: 500, bottomScale: 1.5 },
      playerStart: { x: 0, y: 300 },
    });
    expect(s.view().player?.scale).toBeCloseTo(2 * 1.0);
    s.click({ x: 0, y: 0 }, 'interact');
    s.update(10);
    expect(s.view().player?.scale).toBeCloseTo(2 * 0.5);
    s.click({ x: 0, y: 500 }, 'interact');
    s.update(10);
    expect(s.view().player?.scale).toBeCloseTo(2 * 1.5);
  });

  it('pas de personnage sans charset ou sans zone de marche', () => {
    const noCharset = makeSession({ scenes: [sceneWith(hotspots, { walkArea: [FLOOR] })] }).session;
    expect(noCharset.view().player).toBeUndefined();
    noCharset.click({ x: 650, y: 150 }, 'interact');
    expect(noCharset.view().message?.text).toBe('ouvert');
    const noArea = makeSession({ system: { playerCharset: 'c' }, scenes: [sceneWith(hotspots)] }).session;
    expect(noArea.view().player).toBeUndefined();
    noArea.click({ x: 150, y: 650 }, 'interact');
    expect(noArea.view().message?.text).toBe('arbre');
  });

  it("un objet sélectionné est utilisé à l'arrivée", () => {
    const { session } = makeSession({
      system: { playerCharset: 'c', startItems: ['key'], walkSpeed: 1000 },
      scenes: [
        sceneWith(
          [
            {
              id: 'door',
              name: 'Porte',
              shape: { type: 'rect', x: 800, y: 100, w: 50, h: 50 },
              interactions: [{ item: 'key', actions: [say('déverrouillée')] }],
            },
          ],
          { walkArea: [FLOOR], playerStart: { x: 0, y: 0 } },
        ),
      ],
    });
    session.selectItem('key');
    session.click({ x: 820, y: 120 }, 'interact');
    session.update(2);
    expect(session.view().message?.text).toBe('déverrouillée');
    expect(session.view().selectedItem).toBeUndefined();
  });

  it("goto pendant l'arrivée change de scène", () => {
    const { session } = makeSession({
      system: { playerCharset: 'c', walkSpeed: 1000 },
      scenes: [
        sceneWith(
          [
            {
              id: 'door',
              name: 'Porte',
              kind: 'exit',
              shape: { type: 'rect', x: 800, y: 100, w: 50, h: 50 },
              interactions: [{ actions: [{ type: 'goto', scene: 'b', x: 50, y: 60 }] }],
            },
          ],
          { walkArea: [FLOOR], playerStart: { x: 0, y: 0 } },
        ),
        { id: 'b', background: 'bg-b', walkArea: [FLOOR] },
      ],
    });
    session.click({ x: 820, y: 120 }, 'interact');
    session.update(2);
    expect(session.view().scene.id).toBe('b');
    expect(session.view().player).toMatchObject({ x: 50, y: 60 });
    expect(session.view().phase).toBe('explore');
  });
});

describe('sauvegarde et restauration', () => {
  const scenes: SceneInput[] = [
    {
      id: 'a',
      background: 'bg-a',
      walkArea: [FLOOR],
      playerStart: { x: 10, y: 10 },
      onFirstEnter: [
        { type: 'give', item: 'key' },
        { type: 'set', var: 'count', value: 'count + 1' },
      ],
      hotspots: [
        { id: 'door', name: 'Porte', shape: box, interactions: [{ actions: [{ type: 'goto', scene: 'b' }] }] },
        { id: 'gem', name: 'Gemme', shape: { type: 'rect', x: 400, y: 100, w: 20, h: 20 }, hidden: true },
      ],
      onEnter: [{ type: 'show', hotspot: 'gem' }],
    },
    { id: 'b', background: 'bg-b', onFirstEnter: [{ type: 'set', var: 'count', value: 'count + 10' }] },
  ];
  const system = { playerCharset: 'c', variables: { count: 0 } };

  it('serialize est conforme à PointClickStateSchema', () => {
    const { session } = makeSession({ system, scenes });
    const state = session.serialize();
    expect(PointClickStateSchema.parse(state)).toEqual(state);
    expect(state).toMatchObject({
      scene: 'a',
      player: { x: 10, y: 10 },
      inventory: ['key'],
      variables: { count: 1 },
      hotspots: { a: { gem: true } },
      visited: ['a'],
      usedChoices: [],
    });
  });

  it('ne sérialise pas les valeurs non primitives', () => {
    const { session } = makeSession({
      system,
      scenes: [sceneWith([], { onEnter: [{ type: 'set', var: 'liste', value: '[1, 2]' }] })],
    });
    expect(session.serialize().variables).not.toHaveProperty('liste');
    expect(PointClickStateSchema.safeParse(session.serialize()).success).toBe(true);
  });

  it("restore recrée l'état sans rejouer onFirstEnter et émet scene-changed", () => {
    const { session } = makeSession({ system, scenes });
    session.click({ x: 120, y: 120 }, 'interact');
    session.update(10);
    expect(session.view().scene.id).toBe('b');
    const state = session.serialize();
    expect(state.visited).toEqual(['a', 'b']);
    const copy = JSON.parse(JSON.stringify(state)) as typeof state;

    const { session: other } = makeSession({ system, scenes });
    other.drainEvents();
    other.restore(copy);
    expect(other.view().scene.id).toBe('b');
    expect(other.serialize()).toEqual(state);
    expect(other.debugState().variables).toMatchObject({ count: 11 });
    expect(other.drainEvents()).toContainEqual({ type: 'scene-changed', scene: 'b' });
    other.restore({ ...copy, scene: 'a' });
    expect(other.view().phase).toBe('explore');
    expect(other.debugState().variables).toMatchObject({ count: 11 });
  });

  it('options.state : start() reprend la scène sauvegardée sans onFirstEnter', () => {
    const { session } = makeSession({ system, scenes });
    session.click({ x: 120, y: 120 }, 'interact');
    session.update(10);
    const state = session.serialize();
    const { session: loaded } = makeSession({ system, scenes }, { state });
    expect(loaded.view().scene.id).toBe('b');
    expect(loaded.serialize().variables).toEqual({ count: 11 });
    expect(loaded.serialize().inventory).toEqual(['key']);
  });

  it('une sauvegarde sur une scène inconnue est refusée sans exception', () => {
    const { session, logs } = makeSession({ system, scenes });
    session.restore({ scene: 'zzz', inventory: [], variables: {}, hotspots: {}, visited: [], usedChoices: [] });
    expect(session.view().scene.id).toBe('a');
    expect(logs.some((l) => l.includes('zzz'))).toBe(true);
  });
});

describe('robustesse', () => {
  it('ne lève jamais malgré des références inconnues', () => {
    const data = makeData({
      scenes: [
        sceneWith([{ id: 'h', name: 'H', shape: box, interactions: [{ actions: [{ type: 'give', item: 'nul' }] }] }]),
      ],
    });
    const logs: string[] = [];
    const s = new PointClickSession(data, { log: (_l, m) => logs.push(m) });
    s.start();
    expect(() => {
      s.selectItem('nul');
      s.useItemOnItem('nul');
      s.lookItem('nul');
      s.choose(3);
      s.advance();
      s.click(IN_BOX, 'interact');
      s.update(1);
    }).not.toThrow();
    expect(logs.length).toBeGreaterThan(0);
  });

  it('une clé de variable interdite est journalisée', () => {
    const { session, logs } = makeSession({
      scenes: [sceneWith([], { onEnter: [{ type: 'set', var: '__proto__', value: '1' }, say('ok')] })],
    });
    expect(logs).toHaveLength(1);
    expect(session.view().message?.text).toBe('ok');
  });
});
