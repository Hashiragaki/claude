import { describe, expect, it } from 'vitest';
import { toColor } from './theme';
import { Tweens } from './tween';

describe('Tweens', () => {
  it('interpole et résout la promesse à la fin', async () => {
    const tweens = new Tweens();
    const obj = { x: 0, alpha: 1 };
    let done = false;
    void tweens.to(obj, { x: 100, alpha: 0 }, 1, { easing: 'linear' }).then(() => (done = true));
    tweens.update(0.5);
    expect(obj.x).toBeCloseTo(50);
    expect(obj.alpha).toBeCloseTo(0.5);
    tweens.update(0.6);
    expect(obj.x).toBe(100);
    await Promise.resolve();
    expect(done).toBe(true);
    expect(tweens.active).toBe(0);
  });

  it('gère les délais sans affecter les autres animations', () => {
    const tweens = new Tweens();
    const a = { v: 0 };
    const b = { v: 0 };
    void tweens.to(a, { v: 10 }, 1, { easing: 'linear', delay: 0.5 });
    void tweens.to(b, { v: 10 }, 1, { easing: 'linear' });
    tweens.update(0.75);
    expect(a.v).toBeCloseTo(2.5);
    expect(b.v).toBeCloseTo(7.5);
  });

  it('finishAll applique les valeurs finales', () => {
    const tweens = new Tweens();
    const o = { x: 0 };
    void tweens.to(o, { x: 5 }, 10);
    tweens.finishAll();
    expect(o.x).toBe(5);
  });
});

describe('toColor', () => {
  it('convertit les couleurs hexadécimales', () => {
    expect(toColor('#ff0000', 0)).toBe(0xff0000);
    expect(toColor('#0f0', 0)).toBe(0x00ff00);
    expect(toColor('nope', 7)).toBe(7);
  });
});
