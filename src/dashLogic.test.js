import { describe, it, expect } from 'vitest';
import { nextPosition, sortStandings, hasPlayerLeft, isRaceOver, DASH_TRACK_LENGTH } from './dashLogic.js';

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
