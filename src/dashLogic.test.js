import { describe, it, expect } from 'vitest';
import { nextPosition, sortStandings, hasPlayerLeft, isRaceOver, rankOf, ordinal, DASH_TRACK_LENGTH } from './dashLogic.js';

describe('nextPosition', () => {
  it('moves one step forward on a correct answer', () => {
    expect(nextPosition(0, true)).toBe(1);
    expect(nextPosition(10, true)).toBe(11);
  });

  it('moves two steps back on a wrong answer', () => {
    expect(nextPosition(10, false)).toBe(8);
  });

  it('never goes below the start', () => {
    expect(nextPosition(0, false)).toBe(0);
    expect(nextPosition(1, false)).toBe(0);
  });

  it('caps at the finish line', () => {
    expect(nextPosition(DASH_TRACK_LENGTH - 1, true)).toBe(DASH_TRACK_LENGTH);
    expect(nextPosition(DASH_TRACK_LENGTH, true)).toBe(DASH_TRACK_LENGTH);
  });

  it('needs two correct answers to recover from one mistake', () => {
    const afterMistake = nextPosition(5, false);
    expect(nextPosition(nextPosition(afterMistake, true), true)).toBe(5);
  });
});

describe('sortStandings', () => {
  it('puts the winner first even if someone else has the same position', () => {
    const players = {
      a: { uid: 'a', position: 25, correctCount: 30 },
      b: { uid: 'b', position: 25, correctCount: 25 },
    };
    expect(sortStandings(players, 'b').map(p => p.uid)).toEqual(['b', 'a']);
  });

  it('orders the rest by position, then correct count, then join time', () => {
    const players = {
      a: { uid: 'a', position: 10, correctCount: 12, joinedAt: 3 },
      b: { uid: 'b', position: 14, correctCount: 14, joinedAt: 2 },
      c: { uid: 'c', position: 10, correctCount: 15, joinedAt: 4 },
      d: { uid: 'd', position: 10, correctCount: 12, joinedAt: 1 },
    };
    expect(sortStandings(players, null).map(p => p.uid)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('copes with a missing players object', () => {
    expect(sortStandings(null, null)).toEqual([]);
  });
});

describe('hasPlayerLeft', () => {
  it('is true only for a disconnected racer who has not finished', () => {
    expect(hasPlayerLeft({ connected: false, finished: false })).toBe(true);
    expect(hasPlayerLeft({ connected: false, finished: true })).toBe(false);
    expect(hasPlayerLeft({ connected: true })).toBe(false);
    expect(hasPlayerLeft({})).toBe(false);
  });
});

describe('isRaceOver', () => {
  it('ends on a completed status or a recorded winner', () => {
    expect(isRaceOver({ status: 'completed' })).toBe(true);
    expect(isRaceOver({ status: 'active', winnerUid: 'a' })).toBe(true);
    expect(isRaceOver({ status: 'active' })).toBe(false);
    expect(isRaceOver(null)).toBe(false);
  });
});

describe('nextPosition with host settings', () => {
  it('uses the chosen setback', () => {
    expect(nextPosition(10, false, 25, 1)).toBe(9);
    expect(nextPosition(10, false, 25, 2)).toBe(8);
    expect(nextPosition(0, false, 25, 1)).toBe(0);
  });

  it('caps at the chosen track length', () => {
    expect(nextPosition(14, true, 15)).toBe(15);
    expect(nextPosition(15, true, 15)).toBe(15);
    expect(nextPosition(24, true, 40)).toBe(25);
  });
});

describe('rankOf', () => {
  const players = {
    a: { uid: 'a', position: 10 },
    b: { uid: 'b', position: 7 },
    c: { uid: 'c', position: 7 },
    d: { uid: 'd', position: 0 },
  };

  it('ranks by how many racers are strictly ahead', () => {
    expect(rankOf(players, 'a')).toEqual({ rank: 1, tied: false, of: 4 });
    expect(rankOf(players, 'd')).toEqual({ rank: 4, tied: false, of: 4 });
  });

  it('gives tied racers the same rank and flags the tie', () => {
    expect(rankOf(players, 'b')).toEqual({ rank: 2, tied: true, of: 4 });
    expect(rankOf(players, 'c')).toEqual({ rank: 2, tied: true, of: 4 });
  });

  it('has no rank before anyone has moved, or for an unknown player', () => {
    expect(rankOf({ a: { uid: 'a', position: 0 }, b: { uid: 'b', position: 0 } }, 'a')).toBeNull();
    expect(rankOf(players, 'zzz')).toBeNull();
  });
});

describe('ordinal', () => {
  it('formats ordinals, including the teens', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
  });
});
