import { describe, it, expect } from 'vitest';
import {
  practiceSortKey, accuracySortKey, practiceEntry, dashEntry, accuracyEntry,
  rankEntries, buildLeaderboardRows, MIN_ANSWERS_FOR_ACCURACY,
  practiceBoardKey, practiceRankReason, PRACTICE_BOARDS,
} from './leaderboardLogic.js';

describe('sort keys', () => {
  it('practice: higher accuracy beats a faster time', () => {
    expect(practiceSortKey(10, 10, 300)).toBeGreaterThan(practiceSortKey(9, 10, 5));
  });
  it('practice: same accuracy, faster time wins', () => {
    expect(practiceSortKey(8, 10, 40)).toBeGreaterThan(practiceSortKey(8, 10, 90));
  });
  it('practice: clamps absurd times', () => {
    expect(practiceSortKey(5, 10, 1e9)).toBe(practiceSortKey(5, 10, 9999));
  });
  it('accuracy: higher percentage wins, more answers breaks a tie', () => {
    expect(accuracySortKey(95, 100)).toBeGreaterThan(accuracySortKey(940, 1000));
    expect(accuracySortKey(190, 200)).toBeGreaterThan(accuracySortKey(95, 100));
  });
});

describe('entry builders', () => {
  it('practice entry records score and time', () => {
    expect(practiceEntry('A', { correct: 9, total: 10 }, 30)).toMatchObject({ correct: 9, total: 10, seconds: 30 });
  });
  it('dash needs at least one win', () => {
    expect(dashEntry('A', { wins: 0, podiums: 2, gamesPlayed: 5 })).toBeNull();
    expect(dashEntry('A', { wins: 3, podiums: 1, gamesPlayed: 5 })).toMatchObject({ wins: 3, sortKey: 3 });
  });
  it('accuracy needs the minimum number of answers', () => {
    expect(accuracyEntry('A', 99, MIN_ANSWERS_FOR_ACCURACY - 1)).toBeNull();
    expect(accuracyEntry('A', 90, MIN_ANSWERS_FOR_ACCURACY)).not.toBeNull();
  });
});

describe('practice boards', () => {
  const all = ['fraction', 'decimal', 'percent'];
  it('maps a full-topic 10/15-item easy/hard test to its board', () => {
    expect(practiceBoardKey({ topics: all, total: 10, difficulty: 'easy' })).toBe('practice-easy-10');
    expect(practiceBoardKey({ topics: all, total: 15, difficulty: 'hard' })).toBe('practice-hard-15');
  });
  it('does not rank single/two-topic tests', () => {
    expect(practiceBoardKey({ topics: ['fraction'], total: 10, difficulty: 'easy' })).toBeNull();
    expect(practiceRankReason({ topics: ['fraction', 'decimal'], total: 10, difficulty: 'easy' })).toMatch(/all three topics/);
  });
  it('does not rank 5-item tests', () => {
    expect(practiceRankReason({ topics: all, total: 5, difficulty: 'hard' })).toMatch(/10 or 15/);
  });
  it('exposes four boards', () => {
    expect(PRACTICE_BOARDS.map(b => b.key)).toEqual(['practice-easy-10', 'practice-easy-15', 'practice-hard-10', 'practice-hard-15']);
  });
});

describe('rankEntries', () => {
  it('orders best-first and shares ranks on ties (1, 1, 3)', () => {
    const ranked = rankEntries([
      { name: 'c', sortKey: 5, at: 3 }, { name: 'a', sortKey: 9, at: 2 }, { name: 'b', sortKey: 9, at: 1 },
    ]);
    expect(ranked.map(r => [r.name, r.rank])).toEqual([['b', 1], ['a', 1], ['c', 3]]);
  });
  it('caps to the limit', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ name: String(i), sortKey: i }));
    expect(rankEntries(many, 50)).toHaveLength(50);
  });
});

describe('buildLeaderboardRows', () => {
  it('formats a practice row and flags the viewer', () => {
    const rows = buildLeaderboardRows('practice-hard-10', {
      u1: { name: 'Ana', correct: 9, total: 10, seconds: 75, sortKey: practiceSortKey(9, 10, 75), at: 1 },
      u2: { name: 'Ben', correct: 7, total: 10, seconds: 60, sortKey: practiceSortKey(7, 10, 60), at: 1 },
    }, 'u2');
    expect(rows[0]).toMatchObject({ rank: 1, name: 'Ana', value: '90%', detail: '9/10 · 01:15', isMe: false });
    expect(rows[1]).toMatchObject({ rank: 2, name: 'Ben', isMe: true });
  });
  it('formats dash and accuracy rows', () => {
    const d = buildLeaderboardRows('dash', { u: { name: 'A', wins: 1, podiums: 1, games: 4, sortKey: 1, at: 1 } }, 'x');
    expect(d[0]).toMatchObject({ value: '1 win', detail: '1 podium · 4 races' });
    const a = buildLeaderboardRows('accuracy', { u: { name: 'A', correct: 957, total: 1000, sortKey: accuracySortKey(957, 1000), at: 1 } }, 'x');
    expect(a[0]).toMatchObject({ value: '95.7%', detail: '957 of 1000 correct' });
  });
  it('ignores malformed and empty data', () => {
    expect(buildLeaderboardRows('dash', null, 'x')).toEqual([]);
    expect(buildLeaderboardRows('dash', { u: { name: 'A' } }, 'x')).toEqual([]);
  });
});
