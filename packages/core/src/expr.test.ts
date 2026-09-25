import { describe, expect, it } from 'vitest';
import { ObjectScope, evalExpression, execute, interpolate, parseExpression } from './expr';

describe('expressions', () => {
  it('évalue arithmétique et priorités à la Python', () => {
    const s = new ObjectScope();
    expect(evalExpression('1 + 2 * 3', s)).toBe(7);
    expect(evalExpression('(1 + 2) * 3', s)).toBe(9);
    expect(evalExpression('2 ** 3 ** 2', s)).toBe(512);
    expect(evalExpression('-2 ** 2', s)).toBe(-4);
    expect(evalExpression('7 // 2', s)).toBe(3);
    expect(evalExpression('-7 % 3', s)).toBe(2);
    expect(evalExpression('7 / 2', s)).toBe(3.5);
  });

  it('gère logique, comparaisons chaînées et appartenance', () => {
    const s = new ObjectScope({ score: 12, met: false, items: ['clé', 'potion'], name: 'Alice' });
    expect(evalExpression('score >= 10 and not met', s)).toBe(true);
    expect(evalExpression('0 < score < 20', s)).toBe(true);
    expect(evalExpression('0 < score < 5', s)).toBe(false);
    expect(evalExpression('"clé" in items', s)).toBe(true);
    expect(evalExpression('"épée" not in items', s)).toBe(true);
    expect(evalExpression('met or "défaut"', s)).toBe('défaut');
    expect(evalExpression('"oui" if score > 5 else "non"', s)).toBe('oui');
    expect(evalExpression('score > 5 && !met', s)).toBe(true);
    expect(evalExpression('met is None', s)).toBe(false);
  });

  it('exécute des affectations et des méthodes sûres', () => {
    const s = new ObjectScope({ affection: 0, inv: [], stats: { hp: 10 } });
    execute('affection += 2', s);
    execute('affection *= 3', s);
    execute('inv.append("clé")', s);
    execute('stats["hp"] -= 4', s);
    execute('stats.mp = 5', s);
    expect(s.vars).toEqual({ affection: 6, inv: ['clé'], stats: { hp: 6, mp: 5 } });
    expect(evalExpression('len(inv) == 1 and inv[0].upper() == "CLÉ"', s)).toBe(true);
  });

  it('refuse les accès dangereux et les fonctions inconnues', () => {
    const s = new ObjectScope({ o: {} });
    expect(() => evalExpression('o.__proto__', s)).toThrow(/interdit/);
    expect(() => evalExpression('o["constructor"]', s)).toThrow(/interdit/);
    expect(() => execute('__proto__ = 1', s)).toThrow(/interdit/);
    expect(() => evalExpression('eval("1")', s)).toThrow(/inconnue/);
    expect(() => evalExpression('inconnue + 1', s)).toThrow(/inconnue/);
  });

  it('signale les erreurs de syntaxe avec la position', () => {
    expect(() => parseExpression('1 +')).toThrow(/position/);
    expect(() => parseExpression('"non terminée')).toThrow(/Chaîne non terminée/);
    expect(() => parseExpression('a b')).toThrow(/inattendu/);
  });

  it('utilise la source de hasard fournie', () => {
    const s = new ObjectScope();
    expect(evalExpression('randint(1, 6)', s, { random: () => 0.999 })).toBe(6);
    expect(evalExpression('choice(["a", "b"])', s, { random: () => 0 })).toBe('a');
  });

  it('interpole les [expressions] dans un texte', () => {
    const s = new ObjectScope({ name: 'Alice', items: ['clé'], n: 3 });
    expect(interpolate('Bonjour [name] ! Tu as [n * 2] points et [items[0]].', s)).toBe(
      'Bonjour Alice ! Tu as 6 points et clé.',
    );
    expect(interpolate('Crochet littéral : [[ok]', s)).toBe('Crochet littéral : [ok]');
    expect(interpolate('Inconnue : [absent]', s)).toBe('Inconnue : None');
  });
});
