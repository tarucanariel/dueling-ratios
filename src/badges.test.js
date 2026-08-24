import { describe, it, expect } from 'vitest';
import { checkGameEndBadges, checkStreakBadge, getNextBadgeProgress, BADGE_DEFS, BADGE_DEFS_BY_ID } from './badges.js';

// A blank stats object matching what getPlayerStats() in firebase.js
// returns — every mode present, all zeros, plus an empty opStats. Tests
// below spread over this and fill in only what they need.
function blankStats(){
  return {
    solo: { gamesPlayed: 0, correctCount: 0, wrongCount: 0 },
    sameDevice: { gamesPlayed: 0, correctCount: 0, wrongCount: 0 },
    vsComputer: { gamesPlayed: 0, correctCount: 0, wrongCount: 0 },
    online: { gamesPlayed: 0, correctCount: 0, wrongCount: 0 },
    opStats: {
      '+': { correctCount: 0, wrongCount: 0 },
      '-': { correctCount: 0, wrongCount: 0 },
      '\u00D7': { correctCount: 0, wrongCount: 0 },
      '\u00F7': { correctCount: 0, wrongCount: 0 },
    },
  };
}

describe('BADGE_DEFS / BADGE_DEFS_BY_ID', () => {
  it('has a unique id for every badge, and BADGE_DEFS_BY_ID indexes all of them', () => {
    const ids = BADGE_DEFS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach((id) => expect(BADGE_DEFS_BY_ID[id]).toBeDefined());
  });
});

describe('checkGameEndBadges — persistence', () => {
  it('awards persistence-5 the moment total games reaches 5, not before', () => {
    const stats = blankStats();
    stats.solo.gamesPlayed = 4;
    expect(checkGameEndBadges(stats, new Set(), 0, 0, false)).not.toContain('persistence-5');
    stats.solo.gamesPlayed = 5;
    expect(checkGameEndBadges(stats, new Set(), 0, 0, false)).toContain('persistence-5');
  });

  it('never re-awards a badge the player already has', () => {
    const stats = blankStats();
    stats.solo.gamesPlayed = 50;
    const earned = checkGameEndBadges(stats, new Set(['persistence-5']), 0, 0, false);
    expect(earned).not.toContain('persistence-5');
    expect(earned).toContain('persistence-25');
  });

  it('sums games played across all modes, not just one', () => {
    const stats = blankStats();
    stats.solo.gamesPlayed = 2;
    stats.sameDevice.gamesPlayed = 2;
    stats.vsComputer.gamesPlayed = 1;
    expect(checkGameEndBadges(stats, new Set(), 0, 0, false)).toContain('persistence-5');
  });
});

describe('checkGameEndBadges — accuracy badges (sharpshooter / accuracy-98)', () => {
  it('requires BOTH the volume and the accuracy threshold, not just one', () => {
    const stats = blankStats();
    // High accuracy, but not enough total answers yet (sharpshooter needs 50)
    stats.solo.correctCount = 18;
    stats.solo.wrongCount = 1; // 19 answered, ~95% accuracy
    expect(checkGameEndBadges(stats, new Set(), 0, 0, false)).not.toContain('sharpshooter');

    // Enough volume, but accuracy too low
    stats.solo.correctCount = 30;
    stats.solo.wrongCount = 30; // 60 answered, 50% accuracy
    expect(checkGameEndBadges(stats, new Set(), 0, 0, false)).not.toContain('sharpshooter');

    // Both satisfied
    stats.solo.correctCount = 46;
    stats.solo.wrongCount = 4; // 50 answered, 92% accuracy
    expect(checkGameEndBadges(stats, new Set(), 0, 0, false)).toContain('sharpshooter');
  });

  it('accuracy-98 needs a much larger sample and higher bar than sharpshooter', () => {
    const stats = blankStats();
    stats.solo.correctCount = 190;
    stats.solo.wrongCount = 10; // 200 answered, 95% accuracy — clears sharpshooter, not accuracy-98
    const earned = checkGameEndBadges(stats, new Set(['sharpshooter']), 0, 0, false);
    expect(earned).not.toContain('accuracy-98');

    stats.solo.correctCount = 197;
    stats.solo.wrongCount = 3; // 200 answered, 98.5% accuracy
    expect(checkGameEndBadges(stats, new Set(['sharpshooter']), 0, 0, false)).toContain('accuracy-98');
  });
});

describe('checkGameEndBadges — lifetime-1000', () => {
  it('sums correct answers across all modes against the 1000 threshold', () => {
    const stats = blankStats();
    stats.solo.correctCount = 400;
    stats.online.correctCount = 599;
    expect(checkGameEndBadges(stats, new Set(), 0, 0, false)).not.toContain('lifetime-1000');
    stats.online.correctCount = 600;
    expect(checkGameEndBadges(stats, new Set(), 0, 0, false)).toContain('lifetime-1000');
  });
});

describe('checkGameEndBadges — operation mastery + capstone', () => {
  it('awards one operation badge independently of the others', () => {
    const stats = blankStats();
    stats.opStats['+'] = { correctCount: 46, wrongCount: 4 }; // 50 answered, 92%
    const earned = checkGameEndBadges(stats, new Set(), 0, 0, false);
    expect(earned).toContain('addition-mastery');
    expect(earned).not.toContain('subtraction-mastery');
    expect(earned).not.toContain('operations-mastered');
  });

  it('awards the capstone in the SAME pass as the 4th operation badge', () => {
    const stats = blankStats();
    // 3 already earned; the 4th (division) crosses the line this exact check
    stats.opStats['\u00F7'] = { correctCount: 46, wrongCount: 4 };
    const earned = checkGameEndBadges(
      stats,
      new Set(['addition-mastery', 'subtraction-mastery', 'multiplication-mastery']),
      0, 0, false,
    );
    expect(earned).toContain('division-mastery');
    expect(earned).toContain('operations-mastered');
  });

  it('does not award the capstone early if only some operations are mastered', () => {
    const stats = blankStats();
    stats.opStats['+'] = { correctCount: 46, wrongCount: 4 };
    const earned = checkGameEndBadges(stats, new Set(['subtraction-mastery']), 0, 0, false);
    expect(earned).toContain('addition-mastery');
    expect(earned).not.toContain('operations-mastered');
  });

  it('treats a missing opStats object as all-zero rather than throwing', () => {
    const stats = blankStats();
    delete stats.opStats;
    expect(() => checkGameEndBadges(stats, new Set(), 0, 0, false)).not.toThrow();
  });
});

describe('checkGameEndBadges — per-game badges (perfect-game / beat-the-clock)', () => {
  it('awards perfect-game only when the game had at least one correct answer and zero misses', () => {
    const stats = blankStats();
    expect(checkGameEndBadges(stats, new Set(), 5, 0, false)).toContain('perfect-game');
    expect(checkGameEndBadges(stats, new Set(), 0, 0, false)).not.toContain('perfect-game'); // no answers at all
    expect(checkGameEndBadges(stats, new Set(), 5, 1, false)).not.toContain('perfect-game'); // had a miss
  });

  it('awards beat-the-clock only when a time control was on and at least one answer was correct', () => {
    const stats = blankStats();
    expect(checkGameEndBadges(stats, new Set(), 3, 0, true)).toContain('beat-the-clock');
    expect(checkGameEndBadges(stats, new Set(), 3, 0, false)).not.toContain('beat-the-clock');
    expect(checkGameEndBadges(stats, new Set(), 0, 0, true)).not.toContain('beat-the-clock');
  });
});

describe('checkStreakBadge', () => {
  it('fires exactly at 10, 20, and 50, and nowhere else', () => {
    expect(checkStreakBadge(9, new Set())).toBeNull();
    expect(checkStreakBadge(10, new Set())).toBe('streak-10');
    expect(checkStreakBadge(11, new Set())).toBeNull();
    expect(checkStreakBadge(20, new Set())).toBe('streak-20');
    expect(checkStreakBadge(50, new Set())).toBe('streak-50');
  });

  it('does not re-fire an already-earned streak badge', () => {
    expect(checkStreakBadge(10, new Set(['streak-10']))).toBeNull();
  });
});

describe('getNextBadgeProgress', () => {
  it('advances a family to the next badge once the current one is earned', () => {
    const stats = blankStats();
    stats.solo.gamesPlayed = 12;
    const notEarnedYet = getNextBadgeProgress(stats, new Set());
    expect(notEarnedYet.find((p) => p.id === 'persistence-5')).toBeDefined();

    const afterFirst = getNextBadgeProgress(stats, new Set(['persistence-5']));
    expect(afterFirst.find((p) => p.id === 'persistence-5')).toBeUndefined();
    expect(afterFirst.find((p) => p.id === 'persistence-25')).toBeDefined();
  });

  it('omits a family entirely once every badge in it is earned', () => {
    const stats = blankStats();
    const earned = new Set(['persistence-5', 'persistence-25', 'persistence-100']);
    const progress = getNextBadgeProgress(stats, earned);
    expect(progress.some((p) => p.id.startsWith('persistence'))).toBe(false);
  });

  it('reports percent as the MORE limiting of volume vs accuracy, not either alone', () => {
    const stats = blankStats();
    // Volume already maxed out (way past 50), but accuracy is the bottleneck at 80%
    stats.solo.correctCount = 80;
    stats.solo.wrongCount = 20; // 100 answered, 80% accuracy, need 90%
    const progress = getNextBadgeProgress(stats, new Set());
    const sharpshooter = progress.find((p) => p.id === 'sharpshooter');
    // accuracyFrac = 0.80/0.90 ≈ 0.889 -> 89%; volumeFrac would be 100% -> the min (accuracy) should win
    expect(sharpshooter.percent).toBe(89);
  });

  it('sources operation-mastery progress from that operation alone, not the combined total', () => {
    const stats = blankStats();
    stats.opStats['+'] = { correctCount: 40, wrongCount: 0 }; // great addition accuracy
    stats.opStats['-'] = { correctCount: 5, wrongCount: 45 }; // terrible subtraction accuracy
    const progress = getNextBadgeProgress(stats, new Set());
    const addition = progress.find((p) => p.id === 'addition-mastery');
    const subtraction = progress.find((p) => p.id === 'subtraction-mastery');
    expect(addition.percent).toBeGreaterThan(subtraction.percent);
  });

  it('never returns a percent above 100', () => {
    const stats = blankStats();
    stats.solo.gamesPlayed = 999999;
    stats.solo.correctCount = 999999;
    const progress = getNextBadgeProgress(stats, new Set());
    progress.forEach((p) => expect(p.percent).toBeLessThanOrEqual(100));
  });
});
