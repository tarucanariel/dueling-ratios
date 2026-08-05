/* =========================================================
   Pure game logic — fraction generation, board templates, tile
   pool building. No DOM access, no global mutable state, so this
   module is safe to import from both local (solo/same-device)
   play and the online sync engine without any duplication.
   ========================================================= */

export function gcd(x, y){
  x = Math.abs(x); y = Math.abs(y);
  while(y){ [x, y] = [y, x % y]; }
  return x || 1;
}

export function reduce(n, d){
  const g = gcd(n, d);
  let rn = n / g, rd = d / g;
  if(rd < 0){ rn = -rn; rd = -rd; } // keep denominator positive
  return [rn, rd];
}

export function randInt(min, max){
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/* Appends a "Simplify" (or "Reduce to a whole number") step to cells/rows,
   if the raw result actually simplifies. Mutates cells & rows in place;
   does nothing if the result is already in lowest terms.

   resultNumCellIndex/resultDenCellIndex are the cellIndex of the ALREADY
   -solved result cells one row up (every call site's "Result"/"Multiply
   across" row) — needed so the new GCF row can point back at them rather
   than re-asking for numbers the player just typed a moment ago.

   Two cases:
     - Reduces to a whole number (e.g. 6/2 -> 3): unchanged from before —
       a single whole-number cell, no GCF step. Kept simple deliberately;
       there's no meaningful "divide numerator and denominator by the
       GCF" framing once the denominator disappears entirely.
     - Reduces to a smaller fraction (e.g. 2/12 -> 1/6): finds the GCF
       first (the ONE new tappable point), then a pure restatement row
       showing resultNum/resultDen divided by that GCF — reusing the
       already-solved resultNum/resultDen cells and the just-solved GCF
       cell, so it costs zero additional taps, same pattern as the LCD
       cell reappearing across multiple rows on the dissimilar board —
       and only then the two real blanks for the simplified result,
       exactly as before. */
export function appendSimplifyStep(cells, rows, resultNum, resultDen, resultNumCellIndex, resultDenCellIndex){
  const [simpNum, simpDen] = reduce(resultNum, resultDen);
  const reducible = simpDen !== resultDen || Math.abs(simpNum) !== Math.abs(resultNum);
  if(!reducible) return;

  if(simpDen === 1){
    const idx = cells.length;
    cells.push({ key: 'simpWhole', label: 'simplified whole number', correct: simpNum });
    rows.push({
      kind: 'whole',
      caption: 'Simplify to a whole number',
      value: { type: 'cell', cellIndex: idx },
    });
    return;
  }

  const g = gcd(resultNum, resultDen); // gcd() already works on magnitudes internally

  const gcfIdx = cells.length;
  cells.push({ key: 'gcf', label: 'GCF of the numerator and denominator', correct: g });

  rows.push({
    kind: 'whole',
    caption: 'Find the GCF of the numerator and denominator',
    value: { type: 'cell', cellIndex: gcfIdx },
  });

  rows.push({
    caption: 'Divide both by the GCF',
    numerator: [ { type: 'cell', cellIndex: resultNumCellIndex }, { type: 'op', symbol: '\u00F7' }, { type: 'cell', cellIndex: gcfIdx } ],
    denominator: [ { type: 'cell', cellIndex: resultDenCellIndex }, { type: 'op', symbol: '\u00F7' }, { type: 'cell', cellIndex: gcfIdx } ],
  });

  const numIdx = cells.length;
  cells.push({ key: 'simpNum', label: 'simplified numerator', correct: simpNum });
  const denIdx = cells.length;
  cells.push({ key: 'simpDen', label: 'simplified denominator', correct: simpDen });
  rows.push({
    caption: 'Simplified fraction',
    numerator: [ { type: 'cell', cellIndex: numIdx } ],
    denominator: [ { type: 'cell', cellIndex: denIdx } ],
  });
}

/* =========================================================
   Fraction pair generation
   ========================================================= */

/* Numerator draw: 1-10 (no zero — a zero numerator isn't a meaningful
   fraction to solve), randomly signed when negatives are enabled.
   Denominators go through a separate 1-9 draw (see generateProblem) and
   are untouched by this change — a zero denominator was already excluded
   from the start since it's undefined, so there was nothing to remove there. */
export function randNumerator(allowNegatives){
  const magnitude = randInt(1, 10);
  if(allowNegatives && randInt(0, 1) === 1){
    return -magnitude;
  }
  return magnitude;
}

// Chance a "+"/"-" problem draws a dissimilar (different-denominator) pair
// rather than a similar (same-denominator) one. Tune this single number if
// 70/30 isn't right for a given class — 0.5 would be back to an even split.
const DISSIMILAR_CHANCE = 0.7;

/* opts: { allowedOps: ['+','-','×','÷'], allowNegatives: bool } */
export function generateProblem(opts){
  const { allowedOps, allowNegatives } = opts;
  const op = allowedOps[randInt(0, allowedOps.length - 1)];

  let a, b, c, d;
  b = randInt(1, 9);
  a = randNumerator(allowNegatives);
  c = randNumerator(allowNegatives); // never 0 now, so division-by-zero-fraction can't happen

  if(op === '+' || op === '-'){
    // Math.random() < DISSIMILAR_CHANCE is true with exactly that
    // probability, so this is DISSIMILAR_CHANCE (70%) dissimilar and
    // (1 - DISSIMILAR_CHANCE) (30%) similar — not just on average, but
    // as an exact per-draw probability, same guarantee as the original
    // 50/50 coin flip had.
    const wantDissimilar = Math.random() < DISSIMILAR_CHANCE;
    d = wantDissimilar
      ? (() => { let x; do { x = randInt(1, 9); } while(x === b); return x; })()
      : b;
  } else {
    d = randInt(1, 9);
  }

  return { a, b, op, c, d };
}

/* Similar fractions (equal denominators), addition/subtraction:
     a/b op c/b  =  (a op c) / b  =  result
   Denominator is one shared cell (glows first, same pattern as cross-multiply). */
export function buildSimilarFractionsLayout(problem){
  const { a, b, op, c } = problem; // b === d here
  const denom = b;
  const resultNum = op === '+' ? a + c : a - c;

  const cells = [
    { key: 'denom',     label: 'common denominator', correct: denom },
    { key: 'num1',      label: 'numerator 1', correct: a },
    { key: 'num2',      label: 'numerator 2', correct: c },
    { key: 'resultNum', label: 'result numerator', correct: resultNum },
  ];
  const DENOM = 0;

  const rows = [
    {
      caption: op === '+' ? 'Add the numerators' : 'Subtract the numerators',
      numerator: [ { type: 'cell', cellIndex: 1 }, { type: 'op', symbol: op }, { type: 'cell', cellIndex: 2 } ],
      denominator: [ { type: 'cell', cellIndex: DENOM } ],
    },
    {
      caption: 'Result',
      numerator: [ { type: 'cell', cellIndex: 3 } ],
      denominator: [ { type: 'cell', cellIndex: DENOM } ],
    },
  ];

  appendSimplifyStep(cells, rows, resultNum, denom, 3, DENOM);

  return { cells, render: 'crossMultiply', rows };
}

/* Multiplication: a/b × c/d = (a×c) / (b×d) = result
   Denominator glows first, then numerator. */
export function buildMultiplicationLayout(problem){
  const { a, b, c, d } = problem;
  const resultDen = b * d;
  const resultNum = a * c;

  const cells = [
    { key: 'resultNum', label: 'result numerator', correct: resultNum },
    { key: 'resultDen', label: 'result denominator', correct: resultDen },
  ];

  const rows = [
    {
      caption: 'Multiply across',
      numerator: [ { type: 'cell', cellIndex: 0 } ],
      denominator: [ { type: 'cell', cellIndex: 1 } ],
    },
  ];

  appendSimplifyStep(cells, rows, resultNum, resultDen, 0, 1);

  return { cells, render: 'crossMultiply', rows };
}

/* Division: a/b ÷ c/d  =  a/b × d/c  =  (a×d)/(b×c)  =  result
   Row 1 restates a, b, d, c left-to-right (flipping the 2nd fraction).
   Row 2 multiplies straight across, numerator first. */
export function buildDivisionLayout(problem){
  const { a, b, c, d } = problem;
  const resultDen = b * c;
  const resultNum = a * d;

  const cells = [
    { key: 'crossA',    label: 'numerator of fraction 1', correct: a },
    { key: 'crossB',    label: 'denominator of fraction 1', correct: b },
    { key: 'flipNum',   label: 'flipped numerator', correct: d },
    { key: 'flipDen',   label: 'flipped denominator', correct: c },
    { key: 'resultNum', label: 'result numerator', correct: resultNum },
    { key: 'resultDen', label: 'result denominator', correct: resultDen },
  ];

  const rows = [
    {
      kind: 'product',
      operator: '\u00D7',
      caption: 'Flip the second fraction and multiply',
      fractions: [
        { numerator: { type: 'cell', cellIndex: 0 }, denominator: { type: 'cell', cellIndex: 1 } },
        { numerator: { type: 'cell', cellIndex: 2 }, denominator: { type: 'cell', cellIndex: 3 } },
      ],
    },
    {
      caption: 'Multiply across',
      numerator: [ { type: 'cell', cellIndex: 4 } ],
      denominator: [ { type: 'cell', cellIndex: 5 } ],
    },
  ];

  appendSimplifyStep(cells, rows, resultNum, resultDen, 4, 5);

  return { cells, render: 'crossMultiply', rows };
}

/* LCD layout for DISSIMILAR fraction addition/subtraction:
     a/b op c/d  =  (mult1×a) op (mult2×c) / LCD  =  convNum1 op convNum2 / LCD  =  result
   where mult1 = LCD/b and mult2 = LCD/d are the conversion multipliers.

   The denominator is ONE cell (LCD, solved first). All three places it
   visually appears just point back at cellIndex 0, so answering it once
   fills all three boxes and none of them glow again. a and c are restated
   as their own cells too, matching the same "every visible number is a
   fillable slot" pattern used across the other boards. */
export function buildDissimilarAddSubLayout(problem){
  const { a, b, op, c, d } = problem;
  const lcd = (b * d) / gcd(b, d);
  const mult1 = lcd / b;
  const mult2 = lcd / d;
  const convNum1 = mult1 * a;
  const convNum2 = mult2 * c;
  const resultNum = op === '+' ? convNum1 + convNum2 : convNum1 - convNum2;

  const cells = [
    { key: 'lcd',      label: 'LCD', correct: lcd },
    { key: 'mult1',    label: 'multiplier for fraction 1', correct: mult1 },
    { key: 'restateA', label: 'numerator of fraction 1', correct: a },
    { key: 'mult2',    label: 'multiplier for fraction 2', correct: mult2 },
    { key: 'restateC', label: 'numerator of fraction 2', correct: c },
    { key: 'convNum1', label: 'converted numerator 1', correct: convNum1 },
    { key: 'convNum2', label: 'converted numerator 2', correct: convNum2 },
    { key: 'resultNum',label: 'result numerator', correct: resultNum },
  ];

  const DENOM = 0;

  const rows = [
    {
      caption: 'Multiply each fraction up to the LCD',
      numerator: [
        { type: 'cell', cellIndex: 1 }, { type: 'op', symbol: '\u00D7' }, { type: 'cell', cellIndex: 2 },
        { type: 'op', symbol: op },
        { type: 'cell', cellIndex: 3 }, { type: 'op', symbol: '\u00D7' }, { type: 'cell', cellIndex: 4 },
      ],
      denominator: [ { type: 'cell', cellIndex: DENOM } ],
    },
    {
      caption: op === '+' ? 'Add the converted numerators' : 'Subtract the converted numerators',
      numerator: [ { type: 'cell', cellIndex: 5 }, { type: 'op', symbol: op }, { type: 'cell', cellIndex: 6 } ],
      denominator: [ { type: 'cell', cellIndex: DENOM } ],
    },
    {
      caption: 'Result',
      numerator: [ { type: 'cell', cellIndex: 7 } ],
      denominator: [ { type: 'cell', cellIndex: DENOM } ],
    },
  ];

  appendSimplifyStep(cells, rows, resultNum, lcd, 7, DENOM);

  return { cells, render: 'crossMultiply', rows };
}

/* Picks the right board template for the generated operation. */
export function buildProblemLayout(problem){
  if(problem.op === '+' || problem.op === '-'){
    return problem.b === problem.d
      ? buildSimilarFractionsLayout(problem)
      : buildDissimilarAddSubLayout(problem);
  }
  if(problem.op === '\u00D7') return buildMultiplicationLayout(problem);
  return buildDivisionLayout(problem); // \u00F7
}

/* =========================================================
   Pool generation — shared across the whole fraction pair
   ========================================================= */

let tileIdCounter = 0;

export function buildPool(cells){
  const values = cells.map(c => c.correct);
  const maxVal = Math.max(...values, 10);
  const minVal = Math.min(...values, 0);
  const numDistractors = randInt(3, 5);

  const pool = values.map(v => ({ id: 'tile-' + (tileIdCounter++), value: v }));

  for(let i = 0; i < numDistractors; i++){
    const distractor = randInt(minVal - 5, maxVal + 6);
    pool.push({ id: 'tile-' + (tileIdCounter++), value: distractor });
  }

  // shuffle (Fisher-Yates)
  for(let i = pool.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}
