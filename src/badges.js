/* =========================================================
   Achievement badges — definitions and pure eligibility checks.
   No DOM, no Firebase calls here on purpose: main.js owns showing the
   celebration popup and actually persisting a newly-earned badge (via
   awardBadge() in firebase.js); this file just answers "given these
   stats, what's newly earned?".

   Deliberately personal-progress only, not competitive/ranking —
   every badge measures a player against their own history, never
   against classmates. See the badge-design discussion this was built
   from for why: ranking-based badges can feel discouraging for kids
   who aren't naturally fastest, which cuts against what a classroom
   practice tool should be doing.
   ========================================================= */

import { STATS_MODES } from './firebase.js';

export const BADGE_DEFS = [
  { id: 'persistence-5',   emoji: '🌱', name: 'Getting Started', description: 'Play 5 games.' },
  { id: 'persistence-25',  emoji: '📚', name: 'Regular Player',  description: 'Play 25 games.' },
  { id: 'persistence-100', emoji: '🏆', name: 'Dedicated',       description: 'Play 100 games.' },
  { id: 'perfect-game',    emoji: '🎯', name: 'Perfect Game',    description: 'Finish a game with zero misses.' },
  { id: 'sharpshooter',    emoji: '💯', name: 'Sharpshooter',    description: '90%+ accuracy over at least 50 answers.' },
  { id: 'streak-10',       emoji: '🔥', name: 'On a Roll',       description: 'Reach a 10-streak in a single game.' },
  { id: 'streak-20',       emoji: '⚡', name: 'Unstoppable',     description: 'Reach a 20-streak in a single game.' },
  { id: 'beat-the-clock',  emoji: '⏱️', name: 'Beat the Clock',  description: 'Finish a game with a time control on.' },
  { id: 'streak-50',       emoji: '🌟', name: 'Flawless Fifty',  description: 'Reach a 50-streak in a single game.' },
  { id: 'lifetime-1000',   emoji: '🧮', name: 'Math Machine',    description: 'Answer 1,000 questions correctly, lifetime.' },
  { id: 'accuracy-98',     emoji: '🎓', name: 'Math Whiz',       description: '98%+ accuracy over at least 200 answers.' },
];

export const BADGE_DEFS_BY_ID = Object.fromEntries(BADGE_DEFS.map((b) => [b.id, b]));

function totalGamesPlayed(stats){
  return STATS_MODES.reduce((sum, k) => sum + (stats[k]?.gamesPlayed || 0), 0);
}

function totalCorrectAndWrong(stats){
  let correct = 0, wrong = 0;
  STATS_MODES.forEach((k) => {
    correct += stats[k]?.correctCount || 0;
    wrong += stats[k]?.wrongCount || 0;
  });
  return { correct, wrong };
}

/* Call right after a game's result has been recorded (i.e. `stats` is
   already the freshly-updated totals, not the pre-game snapshot).
   `earnedBadgeIds` is a Set of badge ids the player already has —
   already-earned ones are never returned again. `gameCorrectCount`/
   `gameWrongCount` are THIS game's own numbers (not the cumulative
   totals) — needed for perfect-game, which is a per-game property
   `stats` alone can't tell us. `gameHadTimeControl` is likewise a
   per-game flag (was a time control on for THIS game), for the same
   reason. Returns an array of newly-earned badge ids, in a stable/
   sensible display order — usually empty. */
export function checkGameEndBadges(stats, earnedBadgeIds, gameCorrectCount, gameWrongCount, gameHadTimeControl){
  const newlyEarned = [];
  const totalGames = totalGamesPlayed(stats);

  if(totalGames >= 5 && !earnedBadgeIds.has('persistence-5')) newlyEarned.push('persistence-5');
  if(totalGames >= 25 && !earnedBadgeIds.has('persistence-25')) newlyEarned.push('persistence-25');
  if(totalGames >= 100 && !earnedBadgeIds.has('persistence-100')) newlyEarned.push('persistence-100');

  const { correct, wrong } = totalCorrectAndWrong(stats);
  const totalAnswered = correct + wrong;
  if(totalAnswered >= 50 && correct / totalAnswered >= 0.9 && !earnedBadgeIds.has('sharpshooter')){
    newlyEarned.push('sharpshooter');
  }
  if(totalAnswered >= 200 && correct / totalAnswered >= 0.98 && !earnedBadgeIds.has('accuracy-98')){
    newlyEarned.push('accuracy-98');
  }
  if(correct >= 1000 && !earnedBadgeIds.has('lifetime-1000')){
    newlyEarned.push('lifetime-1000');
  }

  if(gameCorrectCount > 0 && gameWrongCount === 0 && !earnedBadgeIds.has('perfect-game')){
    newlyEarned.push('perfect-game');
  }

  if(gameHadTimeControl && gameCorrectCount > 0 && !earnedBadgeIds.has('beat-the-clock')){
    newlyEarned.push('beat-the-clock');
  }

  return newlyEarned;
}

/* Call live, mid-game, right where streak milestones are already
   detected (see isStreakMilestone/streakTierFor in main.js) — passed
   the player's current streak count. Exact-equality checks are safe
   here (not >=) since a streak only ever increments by 1, so play
   always passes through exactly 10, 20, and 50 on the way past them;
   no risk of "jumping over" a threshold. Returns a single badge id or
   null — at most one badge can newly trigger per streak increment,
   since 10/20/50 can't all be hit by the same +1 step. */
export function checkStreakBadge(streakCount, earnedBadgeIds){
  if(streakCount === 10 && !earnedBadgeIds.has('streak-10')) return 'streak-10';
  if(streakCount === 20 && !earnedBadgeIds.has('streak-20')) return 'streak-20';
  if(streakCount === 50 && !earnedBadgeIds.has('streak-50')) return 'streak-50';
  return null;
}
