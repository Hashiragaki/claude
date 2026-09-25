import { describe, expect, it } from 'vitest';
import { compileSource } from './compiler';
import { VNInterpreter, VNRuntimeError, type VNInterpreterOptions } from './interpreter';
import type { MenuStep, SayStep, VNStep } from './types';

function vn(lines: string[], options: VNInterpreterOptions = {}): VNInterpreter {
  const { program, diagnostics } = compileSource(lines.join('\n'));
  expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return new VNInterpreter(program, options);
}

function say(step: VNStep): SayStep {
  if (step.kind !== 'say') throw new Error(`réplique attendue, obtenu ${step.kind}`);
  return step;
}

function menu(step: VNStep): MenuStep {
  if (step.kind !== 'menu') throw new Error(`menu attendu, obtenu ${step.kind}`);
  return step;
}

/** Avance jusqu'au prochain menu ou à la fin et renvoie les textes rencontrés. */
function readUntilChoice(interp: VNInterpreter, first: VNStep): { texts: string[]; step: VNStep } {
  const texts: string[] = [];
  let step = first;
  while (step.kind === 'say' || step.kind === 'pause') {
    if (step.kind === 'say') texts.push(step.text);
    step = interp.advance();
  }
  return { texts, step };
}

const CAST = [
  'define mina = Character("Mina", color="#f48fb1", image="mina")',
  'define nom = Character("[joueur]")',
  'default joueur = "Sacha"',
  'default points = 0',
];

describe('VNInterpreter : répliques et texte', () => {
  it('produit narrateur, personnage, nom littéral et interpolation', () => {
    const interp = vn([
      ...CAST,
      'label start:',
      '    "Il était une fois…"',
      '    mina "Bonjour [joueur] ! Tu as [points + 2] points."',
      '    "Inconnue" "Qui es-tu ?"',
      '    nom "Moi, c\'est {b}[joueur]{/b}.\\nEnchanté."',
      '    "Un [[crochet] et [absente]."',
      '    centered "Chapitre 1"',
    ]);
    expect(interp.start()).toEqual({
      kind: 'say',
      speaker: null,
      text: 'Il était une fois…',
      centered: false,
      effects: [],
    });
    expect(say(interp.advance())).toMatchObject({
      speaker: { name: 'Mina', color: '#f48fb1' },
      text: 'Bonjour Sacha ! Tu as 2 points.',
    });
    expect(say(interp.advance()).speaker).toEqual({ name: 'Inconnue', color: null });
    expect(say(interp.advance())).toMatchObject({
      speaker: { name: 'Sacha', color: null },
      text: 'Moi, c\'est Sacha.\nEnchanté.',
    });
    expect(say(interp.advance()).text).toBe('Un [crochet] et None.');
    expect(say(interp.advance())).toMatchObject({ speaker: null, text: 'Chapitre 1', centered: true });
    expect(interp.advance()).toEqual({ kind: 'end', effects: [] });
    expect(interp.ended).toBe(true);
    expect(interp.advance().kind).toBe('end');
    expect(interp.history.map((h) => h.text)).toEqual([
      'Il était une fois…',
      'Bonjour Sacha ! Tu as 2 points.',
      'Qui es-tu ?',
      'Moi, c\'est Sacha.\nEnchanté.',
      'Un [crochet] et None.',
      'Chapitre 1',
    ]);
  });

  it('expose ligne et label courants, variables et setVariable', () => {
    const interp = vn([...CAST, 'label start:', '    "a"', '    jump suite', 'label suite:', '    "b [points]"']);
    interp.start();
    expect([interp.currentLabel, interp.currentLine]).toEqual(['start', 6]);
    interp.setVariable('points', 7);
    expect(say(interp.advance()).text).toBe('b 7');
    expect([interp.currentLabel, interp.currentLine]).toEqual(['suite', 9]);
    expect(interp.getVariables()).toMatchObject({
      joueur: 'Sacha',
      points: 7,
      mina: { __character: true, name: 'Mina' },
    });
  });

  it('démarre depuis un label donné et refuse un label inconnu', () => {
    const interp = vn(['label start:', '    "début"', 'label milieu:', '    "milieu"']);
    expect(say(interp.start('milieu')).text).toBe('milieu');
    expect(() => interp.start('absent')).toThrow(/introuvable/);
    expect(() => new VNInterpreter(interp.program).advance()).toThrow(/start/);
  });
});

describe('VNInterpreter : contrôle', () => {
  it('gère menus, choix conditionnels et $', () => {
    const interp = vn([
      ...CAST,
      'label start:',
      '    menu:',
      '        mina "Tu choisis quoi ?"',
      '        "Thé":',
      '            $ points += 2',
      '            "Thé choisi."',
      '        "Café" if points > 5:',
      '            "Café choisi."',
      '        "Rien":',
      '            pass',
      '    "Fin avec [points] points."',
    ]);
    const m = menu(interp.start());
    expect(m.caption).toEqual({ speaker: { name: 'Mina', color: '#f48fb1' }, text: 'Tu choisis quoi ?' });
    expect(m.choices).toEqual([
      { text: 'Thé', enabled: true },
      { text: 'Café', enabled: false },
      { text: 'Rien', enabled: true },
    ]);
    expect(interp.advance()).toBe(m);
    expect(() => interp.choose(1)).toThrow(/indisponible/);
    expect(() => interp.choose(9)).toThrow(/inexistant/);
    expect(say(interp.choose(0)).text).toBe('Thé choisi.');
    expect(say(interp.advance()).text).toBe('Fin avec 2 points.');
    expect(interp.history).toContainEqual({ speaker: null, text: 'Thé', choice: true });
    expect(() => interp.choose(0)).toThrow(/Aucun menu/);
  });

  it('suit if / elif / else', () => {
    const src = (value: number) => [
      `default x = ${value}`,
      'label start:',
      '    if x > 10:',
      '        "grand"',
      '    elif x > 5:',
      '        "moyen"',
      '    else:',
      '        "petit"',
      '    "suite"',
    ];
    for (const [value, expected] of [[20, 'grand'], [7, 'moyen'], [1, 'petit']] as const) {
      const interp = vn(src(value));
      expect(say(interp.start()).text).toBe(expected);
      expect(say(interp.advance()).text).toBe('suite');
    }
  });

  it('gère jump, call, return et fin de fichier', () => {
    const interp = vn([
      'label start:',
      '    "1"',
      '    call sous',
      '    "3"',
      '    jump fin',
      '    "jamais"',
      'label sous:',
      '    "2"',
      '    return',
      'label fin:',
      '    "4"',
    ]);
    const { texts, step } = readUntilChoice(interp, interp.start());
    expect(texts).toEqual(['1', '2', '3', '4']);
    expect(step.kind).toBe('end');
  });

  it('return sans appel termine le jeu', () => {
    const interp = vn(['label start:', '    "a"', '    return', '    "jamais"']);
    interp.start();
    expect(interp.advance().kind).toBe('end');
  });

  it('utilise la source de hasard injectée', () => {
    const lines = ['default de = 0', 'label start:', '    $ de = randint(1, 6)', '    "[de]"'];
    const interp = vn(lines, { random: () => 0.99 });
    expect(say(interp.start()).text).toBe('6');
  });

  it('gère les pauses', () => {
    const interp = vn(['label start:', '    pause', '    pause 0.5', '    "fin"']);
    expect(interp.start()).toEqual({ kind: 'pause', seconds: null, effects: [] });
    expect(interp.advance()).toEqual({ kind: 'pause', seconds: 0.5, effects: [] });
    expect(say(interp.advance()).text).toBe('fin');
  });

  it('lève une erreur (sans bloquer) sur une boucle infinie', () => {
    const interp = vn(['default x = 0', 'label start:', '    $ x += 1', '    jump start']);
    expect(() => interp.start()).toThrow(VNRuntimeError);
    expect(() => interp.start()).toThrow(/boucle infinie/);
  });

  it('localise les erreurs d\'exécution et permet de continuer', () => {
    const logs: string[] = [];
    const interp = vn(['label start:', '    "a"', '    $ x = inconnue + 1', '    "b [1/0]"', '    "c"'], {
      log: (_level, message) => logs.push(message),
    });
    interp.start();
    expect(() => interp.advance()).toThrow(/script\.vn, ligne 3 : Variable inconnue « inconnue »/);
    // L'interpolation fautive affiche le texte brut et journalise l'erreur.
    expect(say(interp.advance()).text).toBe('b [1/0]');
    expect(logs[0]).toMatch(/ligne 4 : Division par zéro/);
    expect(say(interp.advance()).text).toBe('c');
  });
});

describe('VNInterpreter : effets', () => {
  it('produit les effets de scène, d\'images, d\'audio et de fenêtre', () => {
    const interp = vn([
      ...CAST,
      'image bg cafe = "images/cafe.png"',
      'label start:',
      '    scene bg cafe with fade',
      '    show mina happy at left',
      '    show leo',
      '    play music "theme" fadein 1.5',
      '    play sound "clochette"',
      '    window hide',
      '    "Premier"',
      '    show mina at right with dissolve',
      '    mina sad "Hum."',
      '    hide leo with dissolve',
      '    hide personne',
      '    stop music fadeout 2',
      '    with vpunch',
      '    window show',
      '    "Second"',
      '    scene',
      '    "Noir"',
    ]);
    const first = interp.start();
    expect(first.effects).toEqual([
      { type: 'scene', background: 'images/cafe.png', transition: 'fade' },
      { type: 'show', image: { tag: 'mina', attrs: ['happy'], position: 'left', ref: 'mina happy' }, transition: null },
      { type: 'show', image: { tag: 'leo', attrs: [], position: 'center', ref: 'leo' }, transition: null },
      { type: 'play', channel: 'music', ref: 'theme', fadein: 1.5, loop: true },
      { type: 'play', channel: 'sound', ref: 'clochette', fadein: null, loop: false },
      { type: 'window', shown: false },
    ]);
    expect(interp.state).toMatchObject({ audio: { music: 'theme' }, windowShown: false });
    expect(interp.advance().effects).toEqual([
      // `show mina` garde les attributs, `mina sad "…"` change l'expression.
      {
        type: 'show',
        image: { tag: 'mina', attrs: ['happy'], position: 'right', ref: 'mina happy' },
        transition: 'dissolve',
      },
      { type: 'show', image: { tag: 'mina', attrs: ['sad'], position: 'right', ref: 'mina sad' }, transition: null },
    ]);
    expect(interp.advance().effects).toEqual([
      { type: 'hide', tag: 'leo', transition: 'dissolve' },
      { type: 'stop', channel: 'music', fadeout: 2 },
      { type: 'with', transition: 'vpunch' },
      { type: 'window', shown: true },
    ]);
    expect(interp.scene).toEqual({
      background: 'images/cafe.png',
      images: [{ tag: 'mina', attrs: ['sad'], position: 'right', ref: 'mina sad' }],
    });
    expect(interp.advance().effects).toEqual([{ type: 'scene', background: null, transition: null }]);
    expect(interp.state.audio).toEqual({});
  });
});

describe('VNInterpreter : retour arrière et sauvegardes', () => {
  const STORY = [
    ...CAST,
    'label start:',
    '    scene bg parc',
    '    "Un"',
    '    $ points += 1',
    '    show mina happy',
    '    mina "Deux ([points])"',
    '    menu:',
    '        "Choix A":',
    '            $ points += 10',
    '            scene bg cafe',
    '            "Trois A ([points])"',
    '        "Choix B":',
    '            "Trois B"',
    '    call bonus',
    '    "Cinq"',
    '    return',
    'label bonus:',
    '    play music "bonus"',
    '    "Quatre"',
    '    return',
  ];

  it('restaure variables, historique et scène', () => {
    const interp = vn(STORY);
    interp.start();
    expect(interp.canRollback).toBe(false);
    expect(interp.rollback()).toBeNull();
    interp.advance();
    menu(interp.advance());
    expect(say(interp.choose(0)).text).toBe('Trois A (11)');
    expect(interp.scene.background).toBe('bg cafe');
    expect(interp.getVariables().points).toBe(11);

    // Retour au menu : le choix est annulé.
    const back = menu(interp.rollback() as VNStep);
    expect(back.choices.map((c) => c.text)).toEqual(['Choix A', 'Choix B']);
    expect(interp.getVariables().points).toBe(1);
    expect(interp.scene).toEqual({
      background: 'bg parc',
      images: [{ tag: 'mina', attrs: ['happy'], position: 'center', ref: 'mina happy' }],
    });
    expect(interp.history.map((h) => h.text)).toEqual(['Un', 'Deux (1)']);

    // Encore en arrière, puis rejouer autrement.
    expect(say(interp.rollback() as VNStep).text).toBe('Deux (1)');
    expect(say(interp.rollback() as VNStep).text).toBe('Un');
    expect(interp.getVariables().points).toBe(0);
    expect(interp.scene.images).toEqual([]);
    expect(interp.history.map((h) => h.text)).toEqual(['Un']);
    expect(interp.canRollback).toBe(false);
    interp.advance();
    menu(interp.advance());
    expect(say(interp.choose(1)).text).toBe('Trois B');
    expect(say(interp.advance()).text).toBe('Quatre');
    expect(interp.history.map((h) => h.text)).toEqual(['Un', 'Deux (1)', 'Choix B', 'Trois B', 'Quatre']);
  });

  it('revient de la fin vers la dernière réplique et limite la profondeur', () => {
    const interp = vn(['label start:', '    "a"', '    "b"', '    "c"'], { maxRollback: 2 });
    interp.start();
    interp.advance();
    interp.advance();
    expect(interp.advance().kind).toBe('end');
    expect(say(interp.rollback() as VNStep).text).toBe('c');
    expect(say(interp.rollback() as VNStep).text).toBe('b');
    expect(interp.rollback()).toBeNull();
  });

  it('sérialise puis restaure à l\'identique (aller-retour JSON)', () => {
    const interp = vn(STORY);
    interp.start();
    interp.advance();
    interp.advance();
    interp.choose(0);
    expect(say(interp.advance()).text).toBe('Quatre');
    const saved = JSON.parse(JSON.stringify(interp.serialize()));
    expect(saved).toMatchObject({ callStack: [expect.any(Number)], audio: { music: 'bonus' }, vars: { points: 11 } });

    const copy = new VNInterpreter(interp.program);
    const step = copy.restore(saved);
    expect(say(step).text).toBe('Quatre');
    expect(copy.getVariables()).toEqual(interp.getVariables());
    expect(copy.scene).toEqual(interp.scene);
    expect(copy.history).toEqual(interp.history);
    expect([copy.currentLabel, copy.currentLine]).toEqual(['bonus', interp.currentLine]);
    expect(say(copy.advance()).text).toBe('Cinq');
    expect(copy.advance().kind).toBe('end');
  });

  it('recale la position si le script a changé et réapplique define / default', () => {
    const before = vn(['define v = 1', 'label start:', '    "a"', 'label deux:', '    "b"', '    "c"']);
    before.start();
    before.advance();
    const saved = before.serialize();
    const after = vn([
      'define v = 2',
      'default nouveau = "oui"',
      'label start:',
      '    "a"',
      '    "ajout"',
      'label deux:',
      '    "b"',
      '    "c"',
    ]);
    expect(say(after.restore(saved)).text).toBe('b');
    expect(after.getVariables()).toMatchObject({ v: 2, nouveau: 'oui' });
  });

  it('refuse une sauvegarde invalide', () => {
    const interp = vn(['label start:', '    "a"']);
    expect(() => interp.restore({ pc: 'x' })).toThrow(/Sauvegarde invalide/);
    expect(() => interp.restore(null)).toThrow(/Sauvegarde invalide/);
  });
});
