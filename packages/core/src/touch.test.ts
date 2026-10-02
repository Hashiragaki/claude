import { describe, expect, it } from 'vitest';
import { InputManager } from './input';
import { applyDirections, joystickDirections, touchLayoutForMode } from './touch';

describe('joystickDirections', () => {
  it('ignore la zone morte', () => {
    expect([...joystickDirections(5, 5, 100)]).toEqual([]);
  });

  it('donne les quatre directions cardinales', () => {
    expect([...joystickDirections(60, 0, 75)]).toEqual(['right']);
    expect([...joystickDirections(-60, 2, 75)]).toEqual(['left']);
    expect([...joystickDirections(0, -60, 75)]).toEqual(['up']);
    expect([...joystickDirections(1, 60, 75)]).toEqual(['down']);
  });

  it('donne les diagonales', () => {
    expect(new Set(joystickDirections(50, -50, 75))).toEqual(new Set(['right', 'up']));
    expect(new Set(joystickDirections(-50, 50, 75))).toEqual(new Set(['left', 'down']));
  });

  it('gère un rayon nul', () => {
    expect(joystickDirections(10, 10, 0).size).toBe(0);
  });
});

describe('état virtuel tactile de InputManager', () => {
  it('expose isDown et justPressed comme une manette', () => {
    const input = new InputManager();
    input.setVirtual('confirm', true);
    input.update();
    expect(input.isDown('confirm')).toBe(true);
    expect(input.justPressed('confirm')).toBe(true);
    input.update();
    expect(input.isDown('confirm')).toBe(true);
    expect(input.justPressed('confirm')).toBe(false);
    input.setVirtual('confirm', false);
    input.update();
    expect(input.isDown('confirm')).toBe(false);
  });

  it('ne se mélange pas avec press/release', () => {
    const input = new InputManager();
    input.press('menu');
    input.setVirtual('menu', true);
    input.setVirtual('menu', false);
    input.update();
    expect(input.isDown('menu')).toBe(true);
  });

  it('applique et relâche des directions, et clearVirtual relâche tout', () => {
    const input = new InputManager();
    applyDirections(input, new Set(['up', 'right']));
    input.update();
    expect(input.isDown('up') && input.isDown('right')).toBe(true);
    applyDirections(input, new Set(['right']));
    input.update();
    expect(input.isDown('up')).toBe(false);
    expect(input.direction()).toBe('right');
    input.clearVirtual();
    input.update();
    expect(input.isDown('right')).toBe(false);
  });
});

describe('touchLayoutForMode', () => {
  it('choisit la disposition selon le mode', () => {
    expect(touchLayoutForMode('rpg').dpad).toBe(true);
    expect(touchLayoutForMode('vn')).toMatchObject({ dpad: false, buttons: ['menu'] });
    expect(touchLayoutForMode('inconnu').dpad).toBe(true);
  });
});
