import { describe, it, expect } from 'vitest';
import { TILE_EFFECTS, TILE_EFFECTS_BY_ID, isTileEffectUnlocked } from './tileEffects.js';

describe('TILE_EFFECTS / TILE_EFFECTS_BY_ID', () => {
  it('has a unique id for every effect, and TILE_EFFECTS_BY_ID indexes all of them', () => {
    const ids = TILE_EFFECTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach((id) => expect(TILE_EFFECTS_BY_ID[id]).toBeDefined());
  });
});

describe('isTileEffectUnlocked — single-badge effects', () => {
  it('Classic Arc is always unlocked, even with no badges earned', () => {
    expect(isTileEffectUnlocked('classic', new Set())).toBe(true);
  });

  it('is locked until its one required badge is earned', () => {
    expect(isTileEffectUnlocked('bounce-drop', new Set())).toBe(false);
    expect(isTileEffectUnlocked('bounce-drop', new Set(['persistence-5']))).toBe(true);
  });

  it('is not unlocked by an unrelated badge', () => {
    expect(isTileEffectUnlocked('spin-toss', new Set(['persistence-5']))).toBe(false);
  });

  it('returns false for an unrecognized effect id', () => {
    expect(isTileEffectUnlocked('not-a-real-effect', new Set(['speed-master']))).toBe(false);
  });
});

describe('isTileEffectUnlocked — Gear 5 (two-badge unlock)', () => {
  it('is locked with neither required badge', () => {
    expect(isTileEffectUnlocked('gear-5', new Set())).toBe(false);
  });

  it('is locked with only Flawless Forty', () => {
    expect(isTileEffectUnlocked('gear-5', new Set(['streak-40']))).toBe(false);
  });

  it('is locked with only Fraction Champion', () => {
    expect(isTileEffectUnlocked('gear-5', new Set(['operations-mastered']))).toBe(false);
  });

  it('is unlocked once both required badges are earned', () => {
    expect(isTileEffectUnlocked('gear-5', new Set(['streak-40', 'operations-mastered']))).toBe(true);
  });

  it('is unlocked when extra, unrelated badges are also present', () => {
    const earned = new Set(['streak-40', 'operations-mastered', 'persistence-5', 'speed-master']);
    expect(isTileEffectUnlocked('gear-5', earned)).toBe(true);
  });
});
