/* =========================================================
   Ratio Dash — pure race rules (no Firebase, no DOM), so they can be
   unit-tested directly. dashRace.js and main.js both build on these.
   ========================================================= */

export const DASH_MAX_PLAYERS = 10;
export const DASH_MIN_PLAYERS = 2;
export const DASH_TRACK_LENGTH = 25; // default steps from start to finish line
export const DASH_TRACK_OPTIONS = [15, 25, 40]; // lengths the host can choose from
export const DASH_CORRECT_STEP = 1;
export const DASH_WRONG_STEP_BACK = 2; // default setback for a wrong tile
export const DASH_PENALTY_OPTIONS = [1, 2]; // setbacks the host can choose from
export const DASH_COUNTDOWN_MS = 3000; // 3-2-1 before the race begins

/* A racer counts as "left" once their presence flag flips to false
   (see trackDashPresence in dashRace.js). Finished racers are never
   "left" — closing the tab after crossing the line is normal. */
export function hasPlayerLeft(player){
  return !player.finished && player.connected === false;
}

/* New track position after one placement. A correct tile moves forward
   one step; a wrong tile moves back wrongStepBack steps (the host's
   race setting), never below the start. The position is capped at the
   finish line. */
export function nextPosition(position, isCorrect, trackLength = DASH_TRACK_LENGTH, wrongStepBack = DASH_WRONG_STEP_BACK){
  const delta = isCorrect ? DASH_CORRECT_STEP : -wrongStepBack;
  return Math.min(trackLength, Math.max(0, position + delta));
}

/* Where a player currently stands: rank 1 + the number of racers strictly
   further along, so equal positions share a rank (and "tied" is true).
   Before anyone has moved there is no meaningful order, so rank is null. */
export function rankOf(playersObj, uid){
  const players = Object.values(playersObj || {});
  const me = players.find(p => p.uid === uid);
  if(!me) return null;
  if(!players.some(p => (p.position || 0) > 0)) return null;
  const myPos = me.position || 0;
  const ahead = players.filter(p => (p.position || 0) > myPos).length;
  const sharing = players.filter(p => p.uid !== uid && (p.position || 0) === myPos).length;
  return { rank: ahead + 1, tied: sharing > 0, of: players.length };
}

export function ordinal(n){
  const mod100 = n % 100;
  if(mod100 >= 11 && mod100 <= 13) return n + 'th';
  return n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
}

/* Ranking shown on the results screen. The race winner is always first;
   everyone else is ordered by how far along they got, then by how many
   correct answers they made, then by who joined first — all values every
   client already has, so every device computes identical standings with
   no extra writes. */
export function sortStandings(playersObj, winnerUid){
  return Object.values(playersObj || {}).sort((a, b) => {
    const aWon = a.uid === winnerUid ? 1 : 0;
    const bWon = b.uid === winnerUid ? 1 : 0;
    if(aWon !== bWon) return bWon - aWon;
    if((b.position || 0) !== (a.position || 0)) return (b.position || 0) - (a.position || 0);
    if((b.correctCount || 0) !== (a.correctCount || 0)) return (b.correctCount || 0) - (a.correctCount || 0);
    return (a.joinedAt || 0) - (b.joinedAt || 0);
  });
}

/* A race is over as soon as a winner is recorded, even if the winner's
   follow-up status write never lands (e.g. their tab closed right after
   crossing the line). */
export function isRaceOver(race){
  return !!race && (race.status === 'completed' || !!race.winnerUid);
}
