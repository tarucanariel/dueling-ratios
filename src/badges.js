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

import { STATS_MODES, OPERATIONS } from './firebase.js';

// Maps a problem's operation symbol (as used throughout logic.js/main.js)
// to its operation-mastery badge id and a plain-English noun for badge
// captions — kept together here since every operation-mastery badge
// needs both.
const OP_BADGE_IDS = { '+': 'addition-mastery', '-': 'subtraction-mastery', '×': 'multiplication-mastery', '÷': 'division-mastery' };
const OP_NOUNS = { '+': 'addition', '-': 'subtraction', '×': 'multiplication', '÷': 'division' };
const OP_MASTERY_MIN_ANSWERED = 50;
const OP_MASTERY_MIN_ACCURACY = 0.9;
const CAPSTONE_ID = 'operations-mastered';

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
  { id: 'addition-mastery',       emoji: '➕', name: 'Addition Ace',         description: `90%+ accuracy over at least ${OP_MASTERY_MIN_ANSWERED} addition answers, lifetime.` },
  { id: 'subtraction-mastery',    emoji: '➖', name: 'Subtraction Star',     description: `90%+ accuracy over at least ${OP_MASTERY_MIN_ANSWERED} subtraction answers, lifetime.` },
  { id: 'multiplication-mastery', emoji: '✖️', name: 'Multiplication Master', description: `90%+ accuracy over at least ${OP_MASTERY_MIN_ANSWERED} multiplication answers, lifetime.` },
  { id: 'division-mastery',       emoji: '➗', name: 'Division Dynamo',      description: `90%+ accuracy over at least ${OP_MASTERY_MIN_ANSWERED} division answers, lifetime.` },
  { id: CAPSTONE_ID, emoji: '🧠', name: 'Fraction Champion', description: 'Earn all four operation-mastery badges.' },
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

  // Operation mastery — lifetime, per operation, same volume+accuracy
  // shape as sharpshooter/accuracy-98 above but scoped to stats.opStats
  // instead of the combined totals. stats.opStats may be missing on
  // very old cached stats objects (pre-dates this feature) — treated
  // as zero/zero, same defensive default getPlayerStats() itself uses.
  OPERATIONS.forEach((op) => {
    const badgeId = OP_BADGE_IDS[op];
    const opStat = stats.opStats?.[op] || { correctCount: 0, wrongCount: 0 };
    const answered = opStat.correctCount + opStat.wrongCount;
    if(answered >= OP_MASTERY_MIN_ANSWERED && opStat.correctCount / answered >= OP_MASTERY_MIN_ACCURACY && !earnedBadgeIds.has(badgeId)){
      newlyEarned.push(badgeId);
    }
  });
  // Capstone — checked against earnedBadgeIds OR this same check's own
  // newlyEarned array, so it can fire in the same pass as the 4th
  // operation badge rather than needing a second game/visit after it.
  if(!earnedBadgeIds.has(CAPSTONE_ID)){
    const allMastered = Object.values(OP_BADGE_IDS).every((id) => earnedBadgeIds.has(id) || newlyEarned.includes(id));
    if(allMastered) newlyEarned.push(CAPSTONE_ID);
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

/* =========================================================
   "Up next" progress bars — for My Stats, showing how close a player
   is to their next not-yet-earned badge. Grouped into families so
   that once persistence-5 is earned, the bar shows progress toward
   persistence-25 instead of just disappearing; a fully-earned family
   is left out of the results entirely.

   Deliberately covers only the threshold/counter badges above
   (persistence-*, sharpshooter, accuracy-98, lifetime-1000, and the
   4 operation-mastery badges) — every one of them is driven by a
   running total this file already reads off `stats`. The streak
   badges (10/20/50), the per-game ones (perfect-game, beat-the-clock),
   and the operations-mastered capstone are left out on purpose: each
   is either instant/event-based or itself a compound of other badges
   rather than a running count, so there's no meaningful "62% of the
   way there" number to show for them — see the ranks/progress-bar
   discussion this was built from. */

const PROGRESS_FAMILIES = [
  ['persistence-5', 'persistence-25', 'persistence-100'],
  ['sharpshooter', 'accuracy-98'],
  ['lifetime-1000'],
  ['addition-mastery'],
  ['subtraction-mastery'],
  ['multiplication-mastery'],
  ['division-mastery'],
];

const PROGRESS_TARGETS = {
  'persistence-5':   { kind: 'count', target: 5 },
  'persistence-25':  { kind: 'count', target: 25 },
  'persistence-100': { kind: 'count', target: 100 },
  'sharpshooter':    { kind: 'accuracy', minAnswered: 50, minAccuracy: 0.9 },
  'accuracy-98':     { kind: 'accuracy', minAnswered: 200, minAccuracy: 0.98 },
  'lifetime-1000':   { kind: 'count', target: 1000 },
  'addition-mastery':       { kind: 'accuracy', minAnswered: OP_MASTERY_MIN_ANSWERED, minAccuracy: OP_MASTERY_MIN_ACCURACY, op: '+' },
  'subtraction-mastery':    { kind: 'accuracy', minAnswered: OP_MASTERY_MIN_ANSWERED, minAccuracy: OP_MASTERY_MIN_ACCURACY, op: '-' },
  'multiplication-mastery': { kind: 'accuracy', minAnswered: OP_MASTERY_MIN_ANSWERED, minAccuracy: OP_MASTERY_MIN_ACCURACY, op: '×' },
  'division-mastery':       { kind: 'accuracy', minAnswered: OP_MASTERY_MIN_ANSWERED, minAccuracy: OP_MASTERY_MIN_ACCURACY, op: '÷' },
};

/* Returns one "up next" entry per family above (skipping any family
   that's fully earned), each as:
     { id, emoji, name, percent, caption }
   `percent` (0-100, already rounded/clamped) is ready to plug straight
   into a progress-bar's width. For every accuracy-kind badge, which
   has BOTH a minimum-volume and a minimum-accuracy requirement,
   `percent` is the more-limiting of the two (i.e. whichever the player
   is furthest from), and `caption` always states both numbers so
   nothing about the requirement is hidden. An operation-mastery target
   (`target.op` set) reads its volume/accuracy from that operation's own
   stats.opStats entry instead of the combined across-all-operations
   totals the plain accuracy badges use. */
export function getNextBadgeProgress(stats, earnedBadgeIds){
  const totalGames = totalGamesPlayed(stats);
  const { correct, wrong } = totalCorrectAndWrong(stats);
  const totalAnswered = correct + wrong;

  const results = [];
  PROGRESS_FAMILIES.forEach((family) => {
    const nextId = family.find((id) => !earnedBadgeIds.has(id));
    if(!nextId) return; // every badge in this family is already earned
    const def = BADGE_DEFS_BY_ID[nextId];
    const target = PROGRESS_TARGETS[nextId];
    let percent, caption;

    if(target.kind === 'count'){
      const current = nextId === 'lifetime-1000' ? correct : totalGames;
      percent = Math.min(100, Math.round((current / target.target) * 100));
      const noun = nextId === 'lifetime-1000' ? 'correct answers' : 'games played';
      caption = `${current} / ${target.target} ${noun}`;
    } else { // 'accuracy'
      // Plain accuracy badges (sharpshooter/accuracy-98) use the
      // combined-across-all-operations totals; operation-mastery
      // badges (target.op set) use that one operation's own tally.
      let opCorrect = correct, opAnswered = totalAnswered;
      if(target.op){
        const opStat = stats.opStats?.[target.op] || { correctCount: 0, wrongCount: 0 };
        opCorrect = opStat.correctCount;
        opAnswered = opStat.correctCount + opStat.wrongCount;
      }
      const volumeFrac = Math.min(1, opAnswered / target.minAnswered);
      const accuracy = opAnswered > 0 ? opCorrect / opAnswered : 0;
      const accuracyFrac = Math.min(1, accuracy / target.minAccuracy);
      percent = Math.round(Math.min(volumeFrac, accuracyFrac) * 100);
      const accuracyPct = Math.round(accuracy * 100);
      const minAccuracyPct = Math.round(target.minAccuracy * 100);
      const noun = target.op ? `${OP_NOUNS[target.op]} problems` : 'answered';
      caption = `${opAnswered} / ${target.minAnswered} ${noun} \u2022 ${accuracyPct}% accuracy (need ${minAccuracyPct}%)`;
    }

    results.push({ id: nextId, emoji: def.emoji, name: def.name, percent, caption });
  });
  return results;
}
