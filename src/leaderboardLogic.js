/* =========================================================
   Leaderboard — pure ranking logic (no DOM, no Firebase), so it can be
   unit-tested and imported anywhere.

   Each board is stored at leaderboard/{board}/{uid} as one entry per
   player. `sortKey` is the single number the database orders by (RTDB can
   only order by one child), so every board folds its tie-breakers into it.
   ========================================================= */

import { PRACTICE_TOPICS } from './practiceLogic.js';

// The three tabs. "practice" is itself split into PRACTICE_BOARDS below.
export const LEADERBOARD_BOARDS = ['practice', 'dash', 'accuracy'];

export const LEADERBOARD_LABELS = {
  practice: 'Practice Test',
  dash: 'Ratio Dash',
  accuracy: 'Accuracy',
};

export const LEADERBOARD_SIZE = 50;

// Lifetime accuracy only ranks once there are enough answers behind it,
// so one lucky 1/1 can't top the board.
export const MIN_ANSWERS_FOR_ACCURACY = 100;

/* Practice Test is ranked per (difficulty, length) so results are
   comparable, and only for tests covering every topic — a single-topic
   test is easier to ace. 5-question tests are too coarse to rank. */
export const PRACTICE_RANKED_LENGTHS = [10, 15];
export const PRACTICE_RANKED_DIFFICULTIES = ['easy', 'hard'];
export const PRACTICE_BOARDS = PRACTICE_RANKED_DIFFICULTIES.flatMap(
  (d) => PRACTICE_RANKED_LENGTHS.map((n) => ({ key: `practice-${d}-${n}`, difficulty: d, count: n })));
export const DEFAULT_PRACTICE_BOARD = 'practice-easy-10';

const cap = (w) => w[0].toUpperCase() + w.slice(1);
export function practiceBoardLabel({ difficulty, count }){ return `${cap(difficulty)} · ${count} items`; }

export function isPracticeBoard(board){ return typeof board === 'string' && board.startsWith('practice'); }

/* Why a finished test doesn't rank, or null if it does. `result` is the
   practiceUI completion object ({ total, topics, difficulty, ... }). */
export function practiceRankReason(result){
  const topics = result.topics || [];
  if(!PRACTICE_TOPICS.every((t) => topics.includes(t))) return 'Include all three topics to appear on the Leaderboard.';
  if(!PRACTICE_RANKED_LENGTHS.includes(result.total)) return 'Use 10 or 15 items to appear on the Leaderboard.';
  if(!PRACTICE_RANKED_DIFFICULTIES.includes(result.difficulty)) return 'Choose Easy or Hard to appear on the Leaderboard.';
  return null;
}

/* The board a finished test is ranked on, or null if it isn't ranked. */
export function practiceBoardKey(result){
  return practiceRankReason(result) ? null : `practice-${result.difficulty}-${result.total}`;
}

const MAX_SECONDS = 9999;

/* Practice: higher accuracy first, then faster time. Accuracy is kept to
   0.1% (permille) and time is inverted into the low 4 digits. */
export function practiceSortKey(correct, total, seconds){
  const permille = total ? Math.round((correct / total) * 1000) : 0;
  const t = Math.min(Math.max(Math.round(seconds) || 0, 0), MAX_SECONDS);
  return permille * 10000 + (MAX_SECONDS - t);
}

/* Lifetime accuracy: permille, then more answers breaks ties (capped so
   it can never outweigh a permille step). */
export function accuracySortKey(correct, total){
  const permille = total ? Math.round((correct / total) * 1000) : 0;
  return permille * 1000000 + Math.min(total, 999999);
}

/* The entry a board stores, or null when the player doesn't qualify. */
export function practiceEntry(name, { correct, total }, seconds, now = Date.now()){
  return {
    name, correct, total, seconds: Math.min(Math.max(Math.round(seconds) || 0, 0), MAX_SECONDS),
    sortKey: practiceSortKey(correct, total, seconds), at: now,
  };
}

export function dashEntry(name, { wins, podiums, gamesPlayed }, now = Date.now()){
  if(!(wins > 0)) return null;
  return { name, wins, podiums: podiums || 0, games: gamesPlayed || 0, sortKey: wins, at: now };
}

export function accuracyEntry(name, correct, total, now = Date.now()){
  if(!(total >= MIN_ANSWERS_FOR_ACCURACY)) return null;
  return { name, correct, total, sortKey: accuracySortKey(correct, total), at: now };
}

/* Competition ranking ("1, 1, 3"): entries with equal sortKey share a rank.
   Input order is irrelevant; output is best-first, capped to `limit`. */
export function rankEntries(entries, limit = LEADERBOARD_SIZE){
  const sorted = [...entries].sort((a, b) => (b.sortKey - a.sortKey) || ((a.at || 0) - (b.at || 0)));
  const ranked = [];
  sorted.slice(0, limit).forEach((e, i) => {
    const tied = i > 0 && sorted[i - 1].sortKey === e.sortKey;
    ranked.push({ ...e, rank: tied ? ranked[i - 1].rank : i + 1 });
  });
  return ranked;
}

export function formatPracticeTime(seconds){
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/* One display row per ranked entry: a headline value, a smaller detail
   line, and whether it's the viewer. `raw` is the snapshot value map
   ({ uid: entry }) from the database. */
export function buildLeaderboardRows(board, raw, myUid){
  const entries = Object.entries(raw || {})
    .filter(([, e]) => e && typeof e.sortKey === 'number')
    .map(([uid, e]) => ({ ...e, uid }));
  return rankEntries(entries).map((e) => {
    let value, detail;
    if(isPracticeBoard(board)){
      value = `${Math.round((e.correct / e.total) * 100)}%`;
      detail = `${e.correct}/${e.total} · ${formatPracticeTime(e.seconds || 0)}`;
    } else if(board === 'dash'){
      value = `${e.wins} ${e.wins === 1 ? 'win' : 'wins'}`;
      detail = `${e.podiums || 0} podium${e.podiums === 1 ? '' : 's'} · ${e.games || 0} races`;
    } else {
      value = `${(Math.round((e.correct / e.total) * 1000) / 10).toFixed(1)}%`;
      detail = `${e.correct} of ${e.total} correct`;
    }
    return { rank: e.rank, uid: e.uid, name: e.name || 'Player', value, detail, isMe: e.uid === myUid };
  });
}
