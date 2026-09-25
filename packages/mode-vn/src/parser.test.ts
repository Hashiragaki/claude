import { Rng } from '@forge/core';
import { describe, expect, it } from 'vitest';
import { compileSource } from './compiler';
import { listCharacters, listLabels } from './editor';
import { parseScript } from './parser';
import { stripTextTags } from './text';
import type { MenuNode, VNNode } from './types';

const errors = (source: string) => parseScript(source).diagnostics.filter((d) => d.severity === 'error');

/** Instructions d'un label (premier niveau). */
function body(source: string): VNNode[] {
  const { ast, diagnostics } = parseScript(source);
  expect(diagnostics).toEqual([]);
  const label = ast.nodes.find((n) => n.kind === 'label');
  if (!label || label.kind !== 'label') throw new Error('label attendu');
  return label.body;
}

describe('parseScript : instructions', () => {
  it('analyse define (Character), default, image et include', () => {
    const { ast, diagnostics } = parseScript(
      [
        'define mina = Character("Mina", color="#f48fb1", image="mina")',
        'define narr = Character(None)',
        'define vitesse = 2 * 3',
        'default affection = 0',
        'image bg cafe nuit = "images/cafe.png"',
        'include "scripts/chapitre2.vn"',
      ].join('\n'),
      'main.vn',
    );
    expect(diagnostics).toEqual([]);
    expect(ast.file).toBe('main.vn');
    expect(ast.nodes).toMatchObject([
      { kind: 'define', name: 'mina', character: { name: 'Mina', color: '#f48fb1', image: 'mina' }, line: 1 },
      { kind: 'define', name: 'narr', character: { name: null, color: null, image: null } },
      { kind: 'define', name: 'vitesse', expr: '2 * 3', character: null },
      { kind: 'default', name: 'affection', expr: '0' },
      { kind: 'image', tag: 'bg', attrs: ['cafe', 'nuit'], ref: 'images/cafe.png' },
      { kind: 'include', path: 'scripts/chapitre2.vn', line: 6 },
    ]);
  });

  it('analyse les répliques sous toutes leurs formes', () => {
    const nodes = body(
      [
        'label start:',
        '    "Narration."',
        '    "Inconnu" \'Bonjour\'',
        '    mina "Salut !"',
        '    mina happy uniform "Youpi"',
        '    mina "Aïe !" with vpunch',
        "    'Il a dit \\'oui\\'\\nPuis « non ».'",
      ].join('\n'),
    );
    expect(nodes).toMatchObject([
      { kind: 'say', who: null, whoName: null, text: 'Narration.', line: 2, column: 5 },
      { kind: 'say', who: null, whoName: 'Inconnu', text: 'Bonjour' },
      { kind: 'say', who: 'mina', attrs: [], text: 'Salut !' },
      { kind: 'say', who: 'mina', attrs: ['happy', 'uniform'], text: 'Youpi' },
      { kind: 'say', who: 'mina', text: 'Aïe !', transition: 'vpunch' },
      { kind: 'say', text: "Il a dit 'oui'\nPuis « non »." },
    ]);
  });

  it('analyse scene / show / hide / with et les positions', () => {
    const nodes = body(
      [
        'label start:',
        '    scene bg cafe with fade',
        '    scene',
        '    show mina happy at left with dissolve',
        '    show leo with moveinright',
        '    hide mina with None',
        '    with hpunch',
      ].join('\n'),
    );
    expect(nodes).toMatchObject([
      { kind: 'scene', image: ['bg', 'cafe'], transition: 'fade' },
      { kind: 'scene', image: null, transition: null },
      { kind: 'show', tag: 'mina', attrs: ['happy'], at: 'left', transition: 'dissolve' },
      { kind: 'show', tag: 'leo', attrs: [], at: null, transition: 'moveinright' },
      { kind: 'hide', tag: 'mina', transition: 'none' },
      { kind: 'with', transition: 'hpunch' },
    ]);
  });

  it('analyse contrôle, audio et divers', () => {
    const nodes = body(
      [
        'label start:',
        '    $ score += 1',
        '    jump suite',
        '    call scene2 from retour',
        '    return',
        '    pause',
        '    pause 1.5',
        '    play music "theme" fadein 2 loop',
        "    play sound 'porte' noloop",
        '    voice "v001"',
        '    stop music fadeout 1.0',
        '    stop voice',
        '    window hide',
        '    window show',
        '    pass',
        '    centered "{b}Chapitre 1{/b}"',
        'label suite:',
        '    return',
        'label scene2:',
        '    return',
      ].join('\n'),
    );
    expect(nodes).toMatchObject([
      { kind: 'exec', code: 'score += 1' },
      { kind: 'jump', label: 'suite' },
      { kind: 'call', label: 'scene2' },
      { kind: 'return' },
      { kind: 'pause', seconds: null },
      { kind: 'pause', seconds: 1.5 },
      { kind: 'play', channel: 'music', ref: 'theme', fadein: 2, loop: true },
      { kind: 'play', channel: 'sound', ref: 'porte', fadein: null, loop: false },
      { kind: 'play', channel: 'voice', ref: 'v001', loop: false },
      { kind: 'stop', channel: 'music', fadeout: 1 },
      { kind: 'stop', channel: 'voice', fadeout: null },
      { kind: 'window', shown: false },
      { kind: 'window', shown: true },
      { kind: 'pass' },
      { kind: 'centered', text: '{b}Chapitre 1{/b}' },
    ]);
  });

  it('analyse menu (légende, choix conditionnels) et if / elif / else', () => {
    const nodes = body(
      [
        'label start:',
        '    menu:',
        '        "Que faire ?"',
        '        "Rester":',
        '            $ x = 1',
        '        "Partir" if x > 2 and not fatigue:',
        '            jump start',
        '    if x == 1:',
        '        "un"',
        '    elif x == 2:',
        '        "deux"',
        '    else:',
        '        "autre"',
        '        "encore"',
      ].join('\n'),
    );
    const menu = nodes[0] as MenuNode;
    expect(menu).toMatchObject({ kind: 'menu', caption: { kind: 'say', text: 'Que faire ?' } });
    expect(menu.choices).toMatchObject([
      { text: 'Rester', cond: null, body: [{ kind: 'exec', code: 'x = 1' }] },
      { text: 'Partir', cond: 'x > 2 and not fatigue', body: [{ kind: 'jump', label: 'start' }] },
    ]);
    expect(nodes[1]).toMatchObject({
      kind: 'if',
      branches: [
        { cond: 'x == 1', body: [{ text: 'un' }] },
        { cond: 'x == 2', body: [{ text: 'deux' }] },
        { cond: null, body: [{ text: 'autre' }, { text: 'encore' }] },
      ],
    });
  });

  it('ignore commentaires et lignes vides, garde les # dans les chaînes', () => {
    const nodes = body(
      [
        '# en-tête',
        '',
        'label start:  # commentaire de fin',
        '    # commentaire indenté bizarrement',
        '        ',
        '    "Couleur #1 : rouge" # vraiment',
        '# fin',
      ].join('\n'),
    );
    expect(nodes).toMatchObject([{ kind: 'say', text: 'Couleur #1 : rouge', line: 6 }]);
  });
});

describe('parseScript : diagnostics', () => {
  it('signale une instruction inconnue avec sa ligne et continue', () => {
    const { ast, diagnostics } = parseScript('label start:\n    shw mina\n    "ok"\n', 'a.vn');
    expect(diagnostics).toEqual([
      { file: 'a.vn', line: 2, column: 5, severity: 'error', message: 'Instruction inconnue : « shw »' },
    ]);
    expect(ast.nodes[0]).toMatchObject({ kind: 'label', body: [{ kind: 'say', text: 'ok' }] });
  });

  it('signale chaînes non terminées, expressions invalides et « : » manquants', () => {
    const src = [
      'label start:',
      '    "pas fini',
      '    $ x = = 2',
      '    if x >:',
      '        pass',
      '    menu',
      '        "a":',
      '            pass',
      '    "Bonjour [nom" ',
      '    "Vide []"',
    ].join('\n');
    const diags = parseScript(src).diagnostics;
    const byLine = (line: number) =>
      diags
        .filter((d) => d.line === line)
        .map((d) => d.message)
        .join(' | ');
    expect(byLine(2)).toMatch(/Chaîne non terminée/);
    expect(byLine(3)).toMatch(/Expression invalide/);
    expect(byLine(4)).toMatch(/Expression invalide/);
    expect(byLine(6)).toMatch(/« : » attendu/);
    expect(diags.find((d) => d.line === 9)).toMatchObject({
      severity: 'warning',
      message: expect.stringMatching(/non fermé/),
    });
    expect(byLine(10)).toMatch(/Interpolation vide/);
  });

  it("signale les erreurs d'indentation", () => {
    const inconsistent = errors('label start:\n    "a"\n  "b"\n');
    expect(inconsistent).toMatchObject([{ line: 3, message: expect.stringMatching(/Indentation incohérente/) }]);
    const unexpected = errors('label start:\n    "a"\n        "b"\n');
    expect(unexpected).toMatchObject([{ line: 3, message: 'Indentation inattendue' }]);
    const first = errors('    "a"\n');
    expect(first).toMatchObject([{ line: 1, message: 'Indentation inattendue' }]);
    const empty = errors('label start:\nlabel fin:\n    return\n');
    expect(empty).toMatchObject([{ line: 1, message: expect.stringMatching(/Bloc indenté attendu/) }]);
    const tabs = parseScript('label start:\n\t"a"\n').diagnostics;
    expect(tabs).toMatchObject([{ line: 2, severity: 'warning', message: expect.stringMatching(/Tabulation/) }]);
  });

  it('signale menu sans choix, elif orphelin, include imbriqué et transitions inconnues', () => {
    const src = [
      'label start:',
      '    menu:',
      '        "Juste une légende"',
      '    elif x:',
      '        "?"',
      '    include "autre.vn"',
      '    show mina at milieu with zoom',
      '    play radio "x"',
      '    window maybe',
    ].join('\n');
    const diags = parseScript(src).diagnostics;
    expect(diags.map((d) => [d.line, d.severity, d.message])).toEqual([
      [2, 'error', 'Menu sans choix'],
      [4, 'error', '« elif » sans « if » correspondant'],
      [6, 'error', '« include » doit être au niveau principal du script'],
      [7, 'warning', expect.stringMatching(/^Position inconnue : « milieu »/)],
      [7, 'warning', expect.stringMatching(/^Transition inconnue : « zoom »/)],
      [8, 'error', expect.stringMatching(/Canal audio inconnu/)],
      [9, 'error', expect.stringMatching(/window show/)],
    ]);
  });

  it('valide les arguments de Character', () => {
    const src = 'define a = Character("A", color="rouge", taille=3)\ndefine b = Character(nom)\n';
    const diags = parseScript(src).diagnostics;
    expect(diags).toMatchObject([
      { line: 1, severity: 'warning', message: expect.stringMatching(/Couleur invalide/) },
      { line: 1, severity: 'warning', message: expect.stringMatching(/taille/) },
      { line: 2, severity: 'error', message: expect.stringMatching(/Argument de Character invalide/) },
    ]);
  });

  it('le compilateur signale labels et personnages inconnus, doublons et start manquant', () => {
    const src = ['label intro:', '    bob "Salut"', '    jump nulle_part', '    call ailleurs'];
    src.push('label intro:', '    return');
    const { diagnostics } = compileSource(src.join('\n'), 'x.vn');
    expect(diagnostics.map((d) => [d.line, d.severity, d.message])).toEqual([
      [5, 'error', expect.stringMatching(/Label « intro » déjà défini/)],
      [3, 'error', 'Label « nulle_part » introuvable'],
      [4, 'error', 'Label « ailleurs » introuvable'],
      [2, 'error', expect.stringMatching(/Personnage « bob » non défini/)],
      [1, 'warning', expect.stringMatching(/Label « start » introuvable/)],
    ]);
  });

  it("ne lève jamais d'exception sur une entrée aléatoire", () => {
    const rng = new Rng(1234);
    const pieces = [
      'label ',
      'menu',
      ':',
      '"',
      "'",
      '\\',
      ' ',
      '    ',
      '\t',
      '\n',
      '\n    ',
      'if ',
      'elif',
      'else',
      '$ ',
      '[',
      ']',
      '{',
      '}',
      '(',
      ')',
      'Character(',
      'show ',
      'scene ',
      'with ',
      'at ',
      '=',
      '#',
      'jump ',
      'x',
      'mina',
      '1.5',
      'play ',
      'music',
      'é',
      '\u0000',
      '\r',
      'define ',
      'image ',
      'include ',
      'pause ',
      '__proto__',
      'constructor',
    ];
    for (let n = 0; n < 400; n++) {
      let src = '';
      const len = rng.int(0, 60);
      for (let i = 0; i < len; i++) src += rng.pick(pieces);
      expect(() => compileSource(src)).not.toThrow();
    }
    expect(() => parseScript(undefined as unknown as string)).not.toThrow();
  });
});

describe('aides éditeur et texte', () => {
  it('liste les labels et personnages', () => {
    const src = 'define mina = Character("Mina")\nlabel start:\n    "x"\n  label   fin :\n# label pas_ici:\n';
    expect(listLabels(src)).toEqual([
      { name: 'start', line: 2 },
      { name: 'fin', line: 4 },
    ]);
    expect(listCharacters(src)).toEqual([{ id: 'mina', name: 'Mina', line: 1 }]);
  });

  it('retire les balises de texte', () => {
    expect(stripTextTags('{b}Gras{/b}, {i}italique{/i}, {color=#f00}rouge{/color}{w=0.5} {{accolade}')).toBe(
      'Gras, italique, rouge {accolade}',
    );
    expect(stripTextTags('Un{p}Deux')).toBe('Un\nDeux');
  });
});
