import { describe, it, expect } from 'vitest';
import {
  gcd, reduce, randInt, randNumerator, generateProblem,
  buildSimilarFractionsLayout, buildMultiplicationLayout,
  buildDivisionLayout, buildDissimilarAddSubLayout, buildProblemLayout,
  appendSimplifyStep, buildPool,
} from './logic.js';

describe('gcd', () => {
  it('finds the greatest common divisor of two positive numbers', () => {
    expect(gcd(12, 18)).toBe(6);
    expect(gcd(7, 13)).toBe(1); // coprime
    expect(gcd(9, 3)).toBe(3); // one divides the other
  });

  it('treats negative inputs as their magnitude', () => {
    expect(gcd(-12, 18)).toBe(6);
    expect(gcd(12, -18)).toBe(6);
    expect(gcd(-12, -18)).toBe(6);
  });

  it('returns 1 rather than 0 when both inputs are 0 (avoids a divide-by-zero downstream in reduce())', () => {
    expect(gcd(0, 0)).toBe(1);
  });

  it('returns the other number when one side is 0', () => {
    expect(gcd(6, 0)).toBe(6);
    expect(gcd(0, 6)).toBe(6);
  });
});

describe('reduce', () => {
  it('reduces a fraction to lowest terms', () => {
    expect(reduce(2, 12)).toEqual([1, 6]);
    expect(reduce(6, 2)).toEqual([3, 1]);
  });

  it('leaves an already-reduced fraction unchanged', () => {
    expect(reduce(3, 7)).toEqual([3, 7]);
  });

  it('keeps the denominator positive, flipping the numerator sign instead', () => {
    expect(reduce(3, -6)).toEqual([-1, 2]);
    expect(reduce(-3, -6)).toEqual([1, 2]); // both negative -> positive fraction
  });

  it('preserves a negative numerator when the denominator is already positive', () => {
    expect(reduce(-4, 8)).toEqual([-1, 2]);
  });
});

describe('randInt', () => {
  it('always returns an integer within [min, max] inclusive', () => {
    for(let i = 0; i < 500; i++){
      const n = randInt(3, 9);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(9);
    }
  });

  it('handles a zero-width range (min === max)', () => {
    for(let i = 0; i < 20; i++){
      expect(randInt(5, 5)).toBe(5);
    }
  });
});

describe('randNumerator', () => {
  it('never returns 0 and stays within magnitude 1-10', () => {
    for(let i = 0; i < 500; i++){
      const n = randNumerator(true);
      expect(n).not.toBe(0);
      expect(Math.abs(n)).toBeGreaterThanOrEqual(1);
      expect(Math.abs(n)).toBeLessThanOrEqual(10);
    }
  });

  it('never returns negative when allowNegatives is false', () => {
    for(let i = 0; i < 500; i++){
      expect(randNumerator(false)).toBeGreaterThan(0);
    }
  });

  it('does return negative values sometimes when allowNegatives is true', () => {
    const results = Array.from({ length: 300 }, () => randNumerator(true));
    expect(results.some((n) => n < 0)).toBe(true);
    expect(results.some((n) => n > 0)).toBe(true); // and not ALWAYS negative either
  });
});

describe('generateProblem', () => {
  it('only ever picks an operation from the allowed list', () => {
    for(let i = 0; i < 100; i++){
      const p = generateProblem({ allowedOps: ['+', '\u00D7'], allowNegatives: false });
      expect(['+', '\u00D7']).toContain(p.op);
    }
  });

  it('always produces denominators in range 1-9 and non-zero numerators', () => {
    for(let i = 0; i < 200; i++){
      const p = generateProblem({ allowedOps: ['+', '-', '\u00D7', '\u00F7'], allowNegatives: true });
      expect(p.b).toBeGreaterThanOrEqual(1);
      expect(p.b).toBeLessThanOrEqual(9);
      expect(p.d).toBeGreaterThanOrEqual(1);
      expect(p.d).toBeLessThanOrEqual(9);
      expect(p.a).not.toBe(0);
      expect(p.c).not.toBe(0);
    }
  });

  it('keeps numerators positive when allowNegatives is false', () => {
    for(let i = 0; i < 200; i++){
      const p = generateProblem({ allowedOps: ['+', '-', '\u00D7', '\u00F7'], allowNegatives: false });
      expect(p.a).toBeGreaterThan(0);
      expect(p.c).toBeGreaterThan(0);
    }
  });

  it('produces both similar (b===d) and dissimilar (b!==d) pairs for +/- over many draws', () => {
    const pairs = Array.from({ length: 300 }, () => generateProblem({ allowedOps: ['+'], allowNegatives: false }));
    expect(pairs.some((p) => p.b === p.d)).toBe(true);
    expect(pairs.some((p) => p.b !== p.d)).toBe(true);
  });
});

describe('buildSimilarFractionsLayout (a/b + c/b, same denominator)', () => {
  it('computes the correct sum and shares one denominator cell across both rows', () => {
    // 2/5 + 1/5 = 3/5 (already lowest terms, no simplify step)
    const { cells, rows } = buildSimilarFractionsLayout({ a: 2, b: 5, op: '+', c: 1, d: 5 });
    expect(cells.find((c) => c.key === 'denom').correct).toBe(5);
    expect(cells.find((c) => c.key === 'num1').correct).toBe(2);
    expect(cells.find((c) => c.key === 'num2').correct).toBe(1);
    expect(cells.find((c) => c.key === 'resultNum').correct).toBe(3);
    expect(rows).toHaveLength(2); // no simplify step needed: 3/5 is already lowest terms
  });

  it('computes the correct difference, including a negative result', () => {
    // 1/4 - 3/4 = -2/4, which simplifies to -1/2
    const { cells, rows } = buildSimilarFractionsLayout({ a: 1, b: 4, op: '-', c: 3, d: 4 });
    expect(cells.find((c) => c.key === 'resultNum').correct).toBe(-2);
    expect(rows.length).toBeGreaterThan(2); // simplify step got appended
    expect(cells.find((c) => c.key === 'simpNum').correct).toBe(-1);
    expect(cells.find((c) => c.key === 'simpDen').correct).toBe(2);
  });
});

describe('buildMultiplicationLayout (a/b \u00D7 c/d)', () => {
  it('multiplies straight across', () => {
    // 2/3 x 3/4 = 6/12, simplifies to 1/2
    const { cells } = buildMultiplicationLayout({ a: 2, b: 3, c: 3, d: 4 });
    expect(cells.find((c) => c.key === 'resultNum').correct).toBe(6);
    expect(cells.find((c) => c.key === 'resultDen').correct).toBe(12);
    expect(cells.find((c) => c.key === 'simpNum').correct).toBe(1);
    expect(cells.find((c) => c.key === 'simpDen').correct).toBe(2);
  });

  it('leaves an already-lowest-terms result alone (no simplify cells)', () => {
    // 1/2 x 1/3 = 1/6, already lowest terms
    const { cells } = buildMultiplicationLayout({ a: 1, b: 2, c: 1, d: 3 });
    expect(cells.find((c) => c.key === 'resultNum').correct).toBe(1);
    expect(cells.find((c) => c.key === 'resultDen').correct).toBe(6);
    expect(cells.find((c) => c.key === 'simpNum')).toBeUndefined();
  });
});

describe('buildDivisionLayout (a/b \u00F7 c/d = a/b \u00D7 d/c)', () => {
  it('flips the second fraction and multiplies across', () => {
    // 1/2 / 3/4 = 1/2 x 4/3 = 4/6, simplifies to 2/3
    const { cells } = buildDivisionLayout({ a: 1, b: 2, c: 3, d: 4 });
    expect(cells.find((c) => c.key === 'flipNum').correct).toBe(4); // d
    expect(cells.find((c) => c.key === 'flipDen').correct).toBe(3); // c
    expect(cells.find((c) => c.key === 'resultNum').correct).toBe(4); // a*d
    expect(cells.find((c) => c.key === 'resultDen').correct).toBe(6); // b*c
    expect(cells.find((c) => c.key === 'simpNum').correct).toBe(2);
    expect(cells.find((c) => c.key === 'simpDen').correct).toBe(3);
  });

  it('reduces a negative-over-negative result to a positive fraction first', () => {
    // -1/2 / -1/4  =  -1/2 x -4/1  =  4/2, both negative before that ->
    // exercises appendSimplifyStep's "both negative" rewrite branch.
    const { cells } = buildDivisionLayout({ a: -1, b: 2, c: -1, d: 4 });
    expect(cells.find((c) => c.key === 'resultNum').correct).toBe(-4);
    expect(cells.find((c) => c.key === 'resultDen').correct).toBe(-2);
    const signNum = cells.find((c) => c.key === 'signNum');
    const signDen = cells.find((c) => c.key === 'signDen');
    expect(signNum.correct).toBe(4);
    expect(signDen.correct).toBe(2);
    expect(cells.find((c) => c.key === 'simpWhole').correct).toBe(2); // 4/2 reduces to the whole number 2
  });
});

describe('buildDissimilarAddSubLayout (different denominators)', () => {
  it('finds the LCD, converts both numerators, and adds', () => {
    // 1/4 + 1/6 -> LCD 12, converted to 3/12 + 2/12 = 5/12 (already lowest terms)
    const { cells } = buildDissimilarAddSubLayout({ a: 1, b: 4, op: '+', c: 1, d: 6 });
    expect(cells.find((c) => c.key === 'lcd').correct).toBe(12);
    expect(cells.find((c) => c.key === 'mult1').correct).toBe(3); // 12/4
    expect(cells.find((c) => c.key === 'mult2').correct).toBe(2); // 12/6
    expect(cells.find((c) => c.key === 'convNum1').correct).toBe(3); // 1*3
    expect(cells.find((c) => c.key === 'convNum2').correct).toBe(2); // 1*2
    expect(cells.find((c) => c.key === 'resultNum').correct).toBe(5);
  });

  it('subtracts converted numerators correctly', () => {
    // 3/4 - 1/6 -> LCD 12 -> 9/12 - 2/12 = 7/12
    const { cells } = buildDissimilarAddSubLayout({ a: 3, b: 4, op: '-', c: 1, d: 6 });
    expect(cells.find((c) => c.key === 'resultNum').correct).toBe(7);
  });
});

describe('appendSimplifyStep', () => {
  it('adds nothing when the fraction is already in lowest terms', () => {
    const cells = [];
    const rows = [];
    appendSimplifyStep(cells, rows, 3, 7, 0, 1);
    expect(cells).toHaveLength(0);
    expect(rows).toHaveLength(0);
  });

  it('adds a single whole-number cell when the result reduces to a whole number', () => {
    const cells = [];
    const rows = [];
    appendSimplifyStep(cells, rows, 6, 2, 0, 1); // 6/2 = 3
    expect(cells.find((c) => c.key === 'simpWhole').correct).toBe(3);
    expect(cells.find((c) => c.key === 'gcf')).toBeUndefined(); // no GCF step for the whole-number case
  });

  it('adds a GCF cell and a simplified-fraction row when the result reduces but stays a fraction', () => {
    const cells = [];
    const rows = [];
    appendSimplifyStep(cells, rows, 2, 12, 0, 1); // 2/12 -> 1/6, GCF 2
    expect(cells.find((c) => c.key === 'gcf').correct).toBe(2);
    expect(cells.find((c) => c.key === 'simpNum').correct).toBe(1);
    expect(cells.find((c) => c.key === 'simpDen').correct).toBe(6);
  });

  // Regression test: a result that's already in lowest terms in
  // magnitude (GCF 1) but landed with a negative denominator (e.g.
  // 3/-4) used to fall straight into the GCF/divide-by-GCF flow,
  // ask for a GCF of 1, "divide" 3/1 and -4/1 (still negative-over-
  // positive), and then expect the final blanks to be -3/4 anyway —
  // a mismatch between what the "divide by the GCF" row showed and
  // what the final answer cells required. It should instead just ask
  // for the sign rewrite, with no separate GCF step, since there's
  // nothing left to divide out.
  it('rewrites a negative denominator with no real GCF as a sign fix, not a GCF step', () => {
    const cells = [];
    const rows = [];
    appendSimplifyStep(cells, rows, 3, -4, 0, 1); // 3/-4, already lowest terms in magnitude
    expect(cells.find((c) => c.key === 'gcf')).toBeUndefined(); // GCF of 1 isn't a real simplify step
    const signNum = cells.find((c) => c.key === 'signNum');
    const signDen = cells.find((c) => c.key === 'signDen');
    expect(signNum.correct).toBe(-3);
    expect(signDen.correct).toBe(4);
    // No further "simplified numerator/denominator" row — the sign
    // rewrite cells above ARE the final answer.
    expect(cells.find((c) => c.key === 'simpNum')).toBeUndefined();
  });

  it('rewrites a negative denominator AND divides out a real GCF, staying consistent', () => {
    const cells = [];
    const rows = [];
    appendSimplifyStep(cells, rows, 6, -8, 0, 1); // 6/-8 -> -3/4, GCF 2
    const signNum = cells.find((c) => c.key === 'signNum');
    const signDen = cells.find((c) => c.key === 'signDen');
    expect(signNum.correct).toBe(-6);
    expect(signDen.correct).toBe(8);
    expect(cells.find((c) => c.key === 'gcf').correct).toBe(2);
    expect(cells.find((c) => c.key === 'simpNum').correct).toBe(-3);
    expect(cells.find((c) => c.key === 'simpDen').correct).toBe(4);
  });
});

describe('buildProblemLayout (routing)', () => {
  it('routes same-denominator +/- to the similar-fractions layout', () => {
    const { rows } = buildProblemLayout({ a: 1, b: 3, op: '+', c: 1, d: 3 });
    expect(rows[0].caption).toBe('Add the numerators');
  });

  it('routes different-denominator +/- to the dissimilar (LCD) layout', () => {
    const { rows } = buildProblemLayout({ a: 1, b: 3, op: '+', c: 1, d: 4 });
    expect(rows[0].caption).toBe('Multiply each fraction up to the LCD');
  });

  it('routes \u00D7 to the multiplication layout', () => {
    const { rows } = buildProblemLayout({ a: 1, b: 3, op: '\u00D7', c: 1, d: 4 });
    expect(rows[0].caption).toBe('Multiply across');
  });

  it('routes \u00F7 to the division layout', () => {
    const { rows } = buildProblemLayout({ a: 1, b: 3, op: '\u00F7', c: 1, d: 4 });
    expect(rows[0].caption).toBe('Flip the second fraction and multiply');
  });
});

describe('buildPool', () => {
  it('includes every correct cell value plus 3-5 distractors, all with unique ids', () => {
    const cells = [
      { key: 'a', label: 'a', correct: 3 },
      { key: 'b', label: 'b', correct: 7 },
    ];
    const pool = buildPool(cells);
    expect(pool.length).toBeGreaterThanOrEqual(2 + 3);
    expect(pool.length).toBeLessThanOrEqual(2 + 5);

    const ids = pool.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate ids

    const values = pool.map((t) => t.value);
    expect(values).toContain(3);
    expect(values).toContain(7);
  });
});
