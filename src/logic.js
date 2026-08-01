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

/* Appends a "Simplify" (or "Reduce to a whole number") row to cells/rows,
   if the raw result actually simplifies. If the fully-reduced fraction has
   a denominator of 1 (e.g. 6/2 -> 3), only a single whole-number cell is
   asked for instead of a numerator/denominator pair. Mutates cells & rows
   in place; does nothing if the result is already in lowest terms. */
export function appendSimplifyStep(cells, rows, resultNum, resultDen){
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
  } else {
    const numIdx = cells.length;
    cells.push({ key: 'simpNum', label: 'simplified numerator', correct: simpNum });
    const denIdx = cells.length;
    cells.push({ key: 'simpDen', label: 'simplified denominator', correct: simpDen });
    rows.push({
      caption: 'Simplify',
      numerator: [ { type: 'cell', cellIndex: numIdx } ],
      denominator: [ { type: 'cell', cellIndex: denIdx } ],
    });
  }
}

/* =========================================================
   Fraction pair generation
   ========================================================= */

/* Numerator draw: 0-9, randomly signed when negatives are enabled.
   Denominators never go through this — they always stay positive,
   which is the standard convention (a negative fraction is written
   as -3/4, not with a negative denominator). */
export function randNumerator(allowNegatives){
  const magnitude = randInt(0, 9);
  if(allowNegatives && magnitude !== 0 && randInt(0, 1) === 1){
    return -magnitude;
  }
  return magnitude;
}

/* opts: { allowedOps: ['+','-','×','÷'], allowNegatives: bool } */
export function generateProblem(opts){
  const { allowedOps, allowNegatives } = opts;
  const op = allowedOps[randInt(0, allowedOps.length - 1)];

  let a, b, c, d;
  b = randInt(1, 9);
  a = randNumerator(allowNegatives);
  do { c = randNumerator(allowNegatives); } while(op === '\u00F7' && c === 0); // can't divide by 0/d

  if(op === '+' || op === '-'){
    // 50/50 between similar (equal denominators) and dissimilar boards
    const wantSimilar = randInt(0, 1) === 0;
    d = wantSimilar ? b : (() => { let x; do { x = randInt(1, 9); } while(x === b); return x; })();
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

  appendSimplifyStep(cells, rows, resultNum, denom);

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

  appendSimplifyStep(cells, rows, resultNum, resultDen);

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
    { key: 'crossA',    label: 'a', correct: a },
    { key: 'crossB',    label: 'b', correct: b },
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

  appendSimplifyStep(cells, rows, resultNum, resultDen);

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
    { key: 'restateA', label: 'a', correct: a },
    { key: 'mult2',    label: 'multiplier for fraction 2', correct: mult2 },
    { key: 'restateC', label: 'c', correct: c },
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

  appendSimplifyStep(cells, rows, resultNum, lcd);

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
  const maxVal = Math.max(...values, 9);
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
