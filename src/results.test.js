import { describe, it, expect } from 'vitest';
import { haveEqualAccuracy, isResultTie } from './results.js';

function player(correctCount, wrongCount, score){
  return { correctCount, wrongCount, score };
}

describe('haveEqualAccuracy', () => {
  it('is true when both players never attempted anything', () => {
    expect(haveEqualAccuracy(player(0, 0, 0), player(0, 0, 0))).toBe(true);
  });

  it('is false when only one player has zero attempts', () => {
    expect(haveEqualAccuracy(player(0, 0, 0), player(3, 1, 2))).toBe(false);
    expect(haveEqualAccuracy(player(3, 1, 2), player(0, 0, 0))).toBe(false);
  });

  it('is true for equal fractions even at different attempt counts (the reported 5/5 vs 6/6 case)', () => {
    expect(haveEqualAccuracy(player(5, 0, 5), player(6, 0, 6))).toBe(true);
  });

  it('is true for equal fractions that are not simply reducible to each other at a glance', () => {
    // 2/4 (50%) vs 3/6 (50%) — different totals, same underlying ratio
    expect(haveEqualAccuracy(player(2, 2, 0), player(3, 3, 0))).toBe(true);
  });

  it('is false when fractions genuinely differ, even if rounded percentages might look close', () => {
    // 2/3 = 66.67% vs 67/100 = 67% — not equal, must not be conflated
    expect(haveEqualAccuracy(player(2, 1, 1), player(67, 33, 34))).toBe(false);
  });

  it('is false for clearly different accuracy', () => {
    expect(haveEqualAccuracy(player(5, 0, 5), player(6, 4, 2))).toBe(false);
  });
});

describe('isResultTie', () => {
  it('is a tie when scores match and accuracy also matches (the common case)', () => {
    expect(isResultTie(player(5, 0, 5), player(5, 0, 5))).toBe(true);
  });

  it('is a tie when scores differ but accuracy matches — the reported bug', () => {
    expect(isResultTie(player(5, 0, 5), player(6, 0, 6))).toBe(true);
  });

  it('is a tie when scores happen to match even if accuracy differs', () => {
    // 5/5 (score 5) vs 6 correct/1 wrong (score 5) — same score, different accuracy
    expect(isResultTie(player(5, 0, 5), player(6, 1, 5))).toBe(true);
  });

  it('is not a tie when both score and accuracy differ', () => {
    expect(isResultTie(player(5, 0, 5), player(9, 1, 8))).toBe(false);
  });
});
