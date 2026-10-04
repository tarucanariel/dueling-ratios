/* =========================================================
   Practice Test — pure question generation and scoring (no Firebase,
   no DOM), so it can be unit-tested directly. practiceUI.js builds on it.

   Every question is multiple choice with exactly 4 options. Values are
   kept as exact reduced fractions [n, d] until the moment they are
   formatted, so there is never any floating-point drift in an answer.

   A question's `topic` is the form of its answer ("fraction", "decimal"
   or "percent"), which is what the results breakdown is grouped by.
   ========================================================= */

import { reduce, randInt } from './logic.js';

export const PRACTICE_TOPICS = ['fraction', 'decimal', 'percent'];
export const PRACTICE_LENGTHS = [5, 10, 15];
export const PRACTICE_DIFFICULTIES = ['easy', 'hard'];

// A perfect score only counts as an achievement on a test at least this long.
export const PERFECT_TEST_MIN_QUESTIONS = 10;

const OPTION_COUNT = 4;

/* ---------- small helpers ---------- */

function shuffle(arr){
  const a = arr.slice();
  for(let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pick(arr){
  return arr[Math.floor(Math.random() * arr.length)];
}

/* ---------- exact rational arithmetic on reduced [n, d] ---------- */

const mulR = ([n1, d1], [n2, d2]) => reduce(n1 * n2, d1 * d2);
const addR = ([n1, d1], [n2, d2]) => reduce(n1 * d2 + n2 * d1, d1 * d2);
const subR = ([n1, d1], [n2, d2]) => reduce(n1 * d2 - n2 * d1, d1 * d2);
const eqR = (a, b) => a[0] === b[0] && a[1] === b[1];
const cmpR = ([n1, d1], [n2, d2]) => n1 * d2 - n2 * d1;

/* ---------- formatting ---------- */

const MAX_DECIMAL_PLACES = 6;

// n/d as a plain decimal string, or null if it does not terminate (or is negative).
function decimalString(n, d){
  if(n < 0) return null;
  for(let k = 0; k <= MAX_DECIMAL_PLACES; k++){
    const scaled = n * 10 ** k;
    if(scaled % d === 0){
      const s = String(scaled / d).padStart(k + 1, '0');
      return k === 0 ? s : s.slice(0, -k) + '.' + s.slice(-k);
    }
  }
  return null;
}

const FORMAT = {
  fraction: ([n, d]) => (n < 0 ? null : d === 1 ? String(n) : `${n}/${d}`),
  decimal: ([n, d]) => decimalString(n, d),
  percent: ([n, d]) => {
    const s = decimalString(n * 100, d);
    return s === null ? null : s + '%';
  },
};

// A plain number (for "x of N" answers).
function formatNumber([n, d]){
  return decimalString(n, d) ?? (n / d).toFixed(2);
}

/* ---------- value pools ---------- */

const DENOMINATORS = {
  easy: [2, 4, 5, 10],
  hard: [2, 4, 5, 8, 10, 20, 25, 40, 50],
};
// Mixed arithmetic keeps denominators small so a sum is still a tidy decimal.
const ARITHMETIC_DENOMINATORS = {
  easy: [2, 4, 5, 10],
  hard: [2, 4, 5, 10, 20, 25],
};

// A reduced value strictly between 0 and 1 (hard mode sometimes goes above 1).
function pickValue(difficulty, { allowImproper = difficulty === 'hard' } = {}){
  for(;;){
    const d = pick(DENOMINATORS[difficulty]);
    const maxN = allowImproper && Math.random() < 0.25 ? 2 * d - 1 : d - 1;
    const v = reduce(randInt(1, maxN), d);
    if(v[1] !== 1) return v;
  }
}

function pickArithmeticValue(difficulty){
  const d = pick(ARITHMETIC_DENOMINATORS[difficulty]);
  return reduce(randInt(1, d - 1), d);
}

/* ---------- building a question from a correct answer + likely mistakes ---------- */

// Values near v, formatted — a fallback so there are always enough distinct options.
function nearValues(v, fmt, steps = [[1, 10], [1, 20], [1, 4], [1, 5], [1, 100], [1, 2]]){
  const out = [];
  for(const [a, b] of steps){
    for(const sign of [1, -1]) out.push(fmt(addR(v, [sign * a, b])));
  }
  return out;
}

/* `candidates` are the wrong answers a student would make from a specific
   misconception (null entries are ignored). They are preferred; `near()`
   only fills any gap. */
function buildQuestion({ kind, topic, prompt, correct, candidates, near, explanation }){
  const seen = new Set([correct]);
  const wrong = [];
  const take = (list) => {
    for(const s of list){
      if(wrong.length >= OPTION_COUNT - 1) return;
      if(s != null && !seen.has(s)){ seen.add(s); wrong.push(s); }
    }
  };
  take(shuffle(candidates));
  take(near());
  const options = shuffle([correct, ...wrong]);
  return { kind, topic, prompt, options, answerIndex: options.indexOf(correct), explanation };
}

/* ---------- question kinds ---------- */

const CONVERT_HINT = {
  'fraction>decimal': 'Divide the numerator by the denominator.',
  'fraction>percent': 'Convert to a decimal, then multiply by 100.',
  'decimal>fraction': 'Write the decimal over a power of 10, then reduce.',
  'percent>fraction': 'Write the percent over 100, then reduce.',
  'decimal>percent': 'Multiply by 100.',
  'percent>decimal': 'Divide by 100.',
};

function convertQuestion(from, to, difficulty){
  const v = pickValue(difficulty);
  const [n, d] = v;
  const fmt = FORMAT[to];
  const correct = fmt(v);

  const candidates = [
    fmt(mulR(v, [10, 1])),
    fmt(mulR(v, [1, 10])),
  ];
  if(to === 'decimal') candidates.push(fmt(mulR(v, [100, 1])), fmt(mulR(v, [1, 100])));
  if(to === 'percent') candidates.push(fmt(mulR(v, [1, 100])));

  if(from === 'fraction' && n < d){
    // Treating "3/4" as "3 and 4".
    if(to === 'decimal') candidates.push(`0.${n}${d}`);
    if(to === 'percent') candidates.push(`${n}${d}%`);
  }
  if(to === 'fraction'){
    candidates.push(FORMAT.fraction([d, n])); // upside down
    // Left unreduced.
    const dec = decimalString(n, d);
    if(from === 'decimal' && dec !== null){
      const k = (dec.split('.')[1] || '').length;
      candidates.push(`${n * 10 ** k / d}/${10 ** k}`);
    }
    if(from === 'percent'){
      const p = decimalString(n * 100, d);
      if(p !== null && !p.includes('.')) candidates.push(`${p}/100`);
    }
  }

  const explanation = `${FORMAT.fraction(v)} = ${FORMAT.decimal(v)} = ${FORMAT.percent(v)}. ${CONVERT_HINT[`${from}>${to}`]}`;
  return buildQuestion({
    kind: `${from}>${to}`,
    topic: to,
    prompt: `Write ${FORMAT[from](v)} as a ${to}${to === 'fraction' ? ' in lowest terms' : ''}.`,
    correct,
    candidates,
    near: () => nearValues(v, fmt),
    explanation,
  });
}

// "x of N" where x is written as a fraction, decimal or percent (that form is the topic).
function ofQuestion(form, difficulty){
  const v = pickValue(difficulty, { allowImproper: false });
  const [n, d] = v;
  const N = d * randInt(2, difficulty === 'hard' ? 20 : 8); // v × N is always whole
  const answer = mulR(v, [N, 1]);
  const correct = formatNumber(answer);

  const candidates = [
    formatNumber(mulR(answer, [10, 1])),
    formatNumber(mulR(answer, [1, 10])),
    formatNumber(subR([N, 1], answer)), // the part that is left over
    formatNumber(addR([N, 1], answer)),
    formatNumber(mulR([N, 1], [d, n])), // dividing by the fraction instead
  ];

  const shown = FORMAT[form](v);
  const how = {
    fraction: `Divide ${N} by ${d}, then multiply by ${n}.`,
    decimal: `Multiply ${N} by ${shown}.`,
    percent: `${shown} = ${FORMAT.decimal(v)}, so multiply ${N} by ${FORMAT.decimal(v)}.`,
  }[form];
  return buildQuestion({
    kind: 'of',
    topic: form,
    prompt: `What is ${shown} of ${N}?`,
    correct,
    candidates,
    near: () => nearValues(answer, formatNumber, [[1, 1], [2, 1], [5, 1], [10, 1]]),
    explanation: `${shown} of ${N} = ${correct}. ${how}`,
  });
}

// Add or subtract two values written in different forms; the answer's form is the topic.
function mixedQuestion(topic, difficulty){
  const op = Math.random() < 0.5 ? '+' : '−';
  let a, b;
  do {
    a = pickArithmeticValue(difficulty);
    b = pickArithmeticValue(difficulty);
    if(op === '−' && cmpR(a, b) < 0) [a, b] = [b, a];
  } while(eqR(a, b));

  const formA = pick(PRACTICE_TOPICS);
  const formB = pick(PRACTICE_TOPICS.filter(f => f !== formA));
  const result = op === '+' ? addR(a, b) : subR(a, b);
  const fmt = FORMAT[topic];
  const correct = fmt(result);

  const candidates = [
    fmt(op === '+' ? subR(a, b) : addR(a, b)), // the other operation
    fmt(mulR(result, [10, 1])),
    fmt(mulR(result, [1, 10])),
  ];
  if(topic === 'fraction' && op === '+'){
    candidates.push(FORMAT.fraction(reduce(a[0] + b[0], a[1] + b[1]))); // add tops and bottoms
  }

  return buildQuestion({
    kind: 'mixed',
    topic,
    prompt: `${FORMAT[formA](a)} ${op} ${FORMAT[formB](b)} = ? (answer as a ${topic})`,
    correct,
    candidates,
    near: () => nearValues(result, fmt),
    explanation: `Write both as ${topic === 'fraction' ? 'fractions' : topic === 'decimal' ? 'decimals' : 'percents'} first: ${fmt(a)} ${op} ${fmt(b)} = ${correct}.`,
  });
}

// Pick the greatest or least of four values written in different forms.
function compareQuestion(topic, difficulty){
  const values = [];
  while(values.length < OPTION_COUNT){
    const v = pickValue(difficulty);
    if(!values.some(x => eqR(x, v))) values.push(v);
  }
  values.sort(cmpR);
  const wantGreatest = Math.random() < 0.5;
  const winner = wantGreatest ? values[OPTION_COUNT - 1] : values[0];

  // The answer is written in the topic's form; the others in any form.
  const forms = values.map(v => (v === winner ? topic : pick(PRACTICE_TOPICS)));
  const written = values.map((v, i) => FORMAT[forms[i]](v));
  const correct = written[values.indexOf(winner)];
  const options = shuffle(written);

  const inTopic = values.map(FORMAT[topic]);
  return {
    kind: 'compare',
    topic,
    prompt: `Which of these is the ${wantGreatest ? 'greatest' : 'least'} value?`,
    options,
    answerIndex: options.indexOf(correct),
    explanation: `As ${topic === 'fraction' ? 'fractions' : topic === 'decimal' ? 'decimals' : 'percents'}, from least to greatest: ${inTopic.join(' < ')}. The ${wantGreatest ? 'greatest' : 'least'} is ${correct}.`,
  };
}

const KINDS = {
  fraction: [
    d => convertQuestion('decimal', 'fraction', d),
    d => convertQuestion('percent', 'fraction', d),
    d => ofQuestion('fraction', d),
    d => mixedQuestion('fraction', d),
    d => compareQuestion('fraction', d),
  ],
  decimal: [
    d => convertQuestion('fraction', 'decimal', d),
    d => convertQuestion('percent', 'decimal', d),
    d => ofQuestion('decimal', d),
    d => mixedQuestion('decimal', d),
    d => compareQuestion('decimal', d),
  ],
  percent: [
    d => convertQuestion('fraction', 'percent', d),
    d => convertQuestion('decimal', 'percent', d),
    d => ofQuestion('percent', d),
    d => mixedQuestion('percent', d),
    d => compareQuestion('percent', d),
  ],
};

/* ---------- public API ---------- */

export function generateQuestion(topic, difficulty = 'easy'){
  return pick(KINDS[topic])(difficulty);
}

/* A fixed set of `count` questions, spread evenly across the chosen topics
   and shuffled, with no repeated prompt. */
export function generateTest({ topics = PRACTICE_TOPICS, count = 10, difficulty = 'easy' } = {}){
  const chosen = PRACTICE_TOPICS.filter(t => topics.includes(t));
  const pool = shuffle(chosen.length ? chosen : PRACTICE_TOPICS);
  const questions = [];
  const prompts = new Set();
  for(let i = 0; i < count; i++){
    const topic = pool[i % pool.length];
    let q;
    for(let tries = 0; tries < 30; tries++){
      q = generateQuestion(topic, difficulty);
      if(!prompts.has(q.prompt)) break;
    }
    prompts.add(q.prompt);
    questions.push(q);
  }
  return shuffle(questions);
}

/* `answers[i]` is the option index the student chose for question i
   (null/undefined = unanswered, counted as wrong). */
export function scoreTest(questions, answers){
  const byTopic = {};
  let correct = 0;
  questions.forEach((q, i) => {
    const t = (byTopic[q.topic] ??= { correct: 0, total: 0 });
    t.total++;
    if(answers[i] === q.answerIndex){ t.correct++; correct++; }
  });
  const total = questions.length;
  return { correct, total, accuracy: total ? (correct / total) * 100 : 0, byTopic };
}

/* The score band a result falls in. The results screen's verdict line and
   the results sound both key off this, so they always agree. */
export function resultTier(accuracy){
  if(accuracy >= 100) return 'perfect';
  if(accuracy >= 80) return 'great';
  if(accuracy >= 60) return 'good';
  return 'keepgoing';
}
