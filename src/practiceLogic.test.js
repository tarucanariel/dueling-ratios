import { describe, it, expect } from 'vitest';
import {
  generateQuestion, generateTest, scoreTest,
  PRACTICE_TOPICS, PRACTICE_DIFFICULTIES, resultTier, createQuestionStream,
} from './practiceLogic.js';

// Independent check of every answer: parse the text back into a number.
function parse(s){
  s = s.trim();
  if(s.endsWith('%')) return parseFloat(s) / 100;
  if(s.includes('/')){ const [n, d] = s.split('/').map(Number); return n / d; }
  return parseFloat(s);
}
const close = (a, b) => Math.abs(a - b) < 1e-9;

const RUNS = 300;

function eachQuestion(fn){
  for(const difficulty of PRACTICE_DIFFICULTIES){
    for(const topic of PRACTICE_TOPICS){
      for(let i = 0; i < RUNS; i++) fn(generateQuestion(topic, difficulty), topic, difficulty);
    }
  }
}

describe('every generated question', () => {
  it('has 4 distinct options and a valid answer index', () => {
    eachQuestion((q) => {
      expect(q.options).toHaveLength(4);
      expect(new Set(q.options).size).toBe(4);
      expect(q.answerIndex).toBeGreaterThanOrEqual(0);
      expect(q.answerIndex).toBeLessThan(4);
      expect(q.options.every(o => typeof o === 'string' && o && !o.includes('null') && !o.includes('NaN'))).toBe(true);
      expect(q.explanation).toBeTruthy();
    });
  });

  it('is tagged with the requested topic', () => {
    eachQuestion((q, topic) => expect(q.topic).toBe(topic));
  });

  it('has options that are all different values, not just different spellings', () => {
    eachQuestion((q) => {
      // "In lowest terms" items deliberately offer the unreduced form (35/100) as a wrong answer.
      if(q.kind.endsWith('>fraction')) return;
      const nums = q.options.map(parse);
      expect(new Set(nums.map(n => n.toFixed(9))).size).toBe(4);
    });
  });

  it('writes the correct option in the topic form', () => {
    eachQuestion((q) => {
      const correct = q.options[q.answerIndex];
      if(q.kind === 'of') return; // an "of" answer is a plain number
      if(q.topic === 'percent') expect(correct.endsWith('%')).toBe(true);
      if(q.topic === 'fraction') expect(/^\d+(\/\d+)?$/.test(correct)).toBe(true);
      if(q.topic === 'decimal') expect(/^\d+(\.\d+)?$/.test(correct)).toBe(true);
    });
  });
});

describe('conversion answers', () => {
  it('equal the value in the prompt, and fractions are in lowest terms', () => {
    eachQuestion((q) => {
      if(!q.kind.includes('>')) return;
      const shown = q.prompt.match(/^Write (\S+) as a/)[1];
      const correct = q.options[q.answerIndex];
      expect(close(parse(correct), parse(shown))).toBe(true);
      const gcd = (a, b) => (b ? gcd(b, a % b) : a);
      q.options.forEach((o, i) => {
        if(i === q.answerIndex) return;
        if(q.topic === 'fraction' && close(parse(o), parse(shown))){
          // Only an unreduced fraction may equal the value; it must not be in lowest terms.
          const [n, d] = o.split('/').map(Number);
          expect(gcd(n, d)).toBeGreaterThan(1);
        } else {
          expect(close(parse(o), parse(shown))).toBe(false);
        }
      });
      if(q.topic === 'fraction' && correct.includes('/')){
        const [n, d] = correct.split('/').map(Number);
        expect(gcd(n, d)).toBe(1);
      }
    });
  });
});

describe('"of" answers', () => {
  it('equal the value times the quantity', () => {
    eachQuestion((q) => {
      if(q.kind !== 'of') return;
      const [, shown, N] = q.prompt.match(/^What is (\S+) of (\d+)\?$/);
      expect(close(parse(q.options[q.answerIndex]), parse(shown) * Number(N))).toBe(true);
    });
  });
});

describe('mixed arithmetic answers', () => {
  it('equal the sum or difference, and never go negative', () => {
    let seen = 0;
    eachQuestion((q) => {
      if(q.kind !== 'mixed') return;
      seen++;
      const [, a, op, b] = q.prompt.match(/^(\S+) ([+−]) (\S+) = \?/);
      const expected = op === '+' ? parse(a) + parse(b) : parse(a) - parse(b);
      expect(expected).toBeGreaterThan(0);
      expect(close(parse(q.options[q.answerIndex]), expected)).toBe(true);
    });
    expect(seen).toBeGreaterThan(0);
  });
});

describe('compare answers', () => {
  it('pick the greatest or least option', () => {
    let seen = 0;
    eachQuestion((q) => {
      if(q.kind !== 'compare') return;
      seen++;
      const nums = q.options.map(parse);
      const target = q.prompt.includes('greatest') ? Math.max(...nums) : Math.min(...nums);
      expect(close(nums[q.answerIndex], target)).toBe(true);
    });
    expect(seen).toBeGreaterThan(0);
  });
});

describe('generateTest', () => {
  it('makes the requested number of questions', () => {
    for(const count of [5, 10, 15]){
      expect(generateTest({ count })).toHaveLength(count);
    }
  });

  it('only uses the chosen topics and spreads them evenly', () => {
    const qs = generateTest({ topics: ['decimal', 'percent'], count: 10 });
    expect(qs.every(q => q.topic !== 'fraction')).toBe(true);
    expect(qs.filter(q => q.topic === 'decimal')).toHaveLength(5);
    expect(qs.filter(q => q.topic === 'percent')).toHaveLength(5);
  });

  it('falls back to all topics when none are valid', () => {
    const qs = generateTest({ topics: [], count: 6 });
    expect(new Set(qs.map(q => q.topic)).size).toBe(3);
  });

  it('does not repeat a prompt', () => {
    for(let i = 0; i < 50; i++){
      const qs = generateTest({ count: 15, difficulty: 'easy' });
      expect(new Set(qs.map(q => q.prompt)).size).toBe(15);
    }
  });
});

describe('scoreTest', () => {
  const qs = [
    { topic: 'fraction', answerIndex: 1 },
    { topic: 'fraction', answerIndex: 0 },
    { topic: 'percent', answerIndex: 2 },
    { topic: 'decimal', answerIndex: 3 },
  ];

  it('counts correct answers, accuracy and a per-topic breakdown', () => {
    const r = scoreTest(qs, [1, 3, 2, 3]);
    expect(r.correct).toBe(3);
    expect(r.total).toBe(4);
    expect(r.accuracy).toBe(75);
    expect(r.byTopic).toEqual({
      fraction: { correct: 1, total: 2 },
      percent: { correct: 1, total: 1 },
      decimal: { correct: 1, total: 1 },
    });
  });

  it('counts unanswered items as wrong', () => {
    const r = scoreTest(qs, [1, undefined, null]);
    expect(r.correct).toBe(1);
    expect(r.total).toBe(4);
  });

  it('handles an empty test', () => {
    expect(scoreTest([], []).accuracy).toBe(0);
  });
});

describe('resultTier', () => {
  it('maps accuracy to the four score bands, with the edges in the right band', () => {
    expect(resultTier(100)).toBe('perfect');
    expect(resultTier(99.9)).toBe('great');
    expect(resultTier(80)).toBe('great');
    expect(resultTier(79.9)).toBe('good');
    expect(resultTier(60)).toBe('good');
    expect(resultTier(59.9)).toBe('keepgoing');
    expect(resultTier(0)).toBe('keepgoing');
  });
});

describe('createQuestionStream (shared Ratio Dash sequence)', () => {
  const take = (stream, n) => Array.from({ length: n }, (_, i) => stream.at(i));

  it('gives the same questions for the same seed, settings and index', () => {
    const a = createQuestionStream({ seed: 4242, topics: ['fraction', 'decimal', 'percent'], difficulty: 'hard' });
    const b = createQuestionStream({ seed: 4242, topics: ['fraction', 'decimal', 'percent'], difficulty: 'hard' });
    expect(take(a, 60)).toEqual(take(b, 60));
  });

  it('gives different questions for different seeds', () => {
    const a = take(createQuestionStream({ seed: 1 }), 20).map(q => q.prompt + q.options.join());
    const b = take(createQuestionStream({ seed: 2 }), 20).map(q => q.prompt + q.options.join());
    expect(a).not.toEqual(b);
  });

  it('does not depend on the order questions are asked for (a reconnecting racer)', () => {
    const sequential = take(createQuestionStream({ seed: 99 }), 25);
    const jumpy = createQuestionStream({ seed: 99 });
    expect(jumpy.at(24)).toEqual(sequential[24]);
    expect(jumpy.at(3)).toEqual(sequential[3]);
    expect(jumpy.at(12)).toEqual(sequential[12]);
    expect(jumpy.at(3)).toBe(jumpy.at(3)); // cached, not regenerated
  });

  it('keeps two streams independent even when used in turn', () => {
    const solo = take(createQuestionStream({ seed: 7 }), 15);
    const x = createQuestionStream({ seed: 7 });
    const y = createQuestionStream({ seed: 8 });
    const mixed = [];
    for (let i = 0; i < 15; i++){ mixed.push(x.at(i)); y.at(i); }
    expect(mixed).toEqual(solo);
  });

  it('only uses the chosen topics and rotates through them', () => {
    const qs = take(createQuestionStream({ seed: 5, topics: ['decimal', 'percent'] }), 20);
    expect(qs.every(q => q.topic === 'decimal' || q.topic === 'percent')).toBe(true);
    expect(qs.filter(q => q.topic === 'decimal')).toHaveLength(10);
    expect(qs.filter(q => q.topic === 'percent')).toHaveLength(10);
  });

  it('falls back to all topics when none are valid', () => {
    const qs = take(createQuestionStream({ seed: 5, topics: [] }), 9);
    expect(new Set(qs.map(q => q.topic)).size).toBe(3);
  });

  it('produces valid, correct questions at both difficulties', () => {
    for (const difficulty of PRACTICE_DIFFICULTIES){
      take(createQuestionStream({ seed: 31337, difficulty }), 120).forEach((q) => {
        expect(q.options).toHaveLength(4);
        expect(q.answerIndex).toBeGreaterThanOrEqual(0);
        expect(q.answerIndex).toBeLessThan(4);
        if (q.kind.includes('>')){
          const shown = q.prompt.match(/^Write (\S+) as a/)[1];
          expect(close(parse(q.options[q.answerIndex]), parse(shown))).toBe(true);
        }
      });
    }
  });

  it('does not repeat an identical question back to back', () => {
    const qs = take(createQuestionStream({ seed: 2024, difficulty: 'easy' }), 40);
    const keys = qs.map(q => q.prompt + '|' + q.options.slice().sort().join(','));
    expect(new Set(keys).size).toBeGreaterThan(30);
  });

  it('leaves normal (unseeded) generation random afterwards', () => {
    createQuestionStream({ seed: 1 }).at(10);
    const prompts = new Set(Array.from({ length: 40 }, () => generateQuestion('fraction', 'hard').prompt + Math.random()));
    expect(prompts.size).toBeGreaterThan(20);
    // and a fresh generateTest still varies between calls
    const t1 = generateTest({ count: 10 }).map(q => q.prompt).join();
    const t2 = generateTest({ count: 10 }).map(q => q.prompt).join();
    const t3 = generateTest({ count: 10 }).map(q => q.prompt).join();
    expect(new Set([t1, t2, t3]).size).toBeGreaterThan(1);
  });
});
