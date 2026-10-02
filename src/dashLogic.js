/* =========================================================
   Ratio Dash — pure race rules (no Firebase, no DOM), so they can be
   unit-tested directly. dashRace.js and main.js both build on these.
   ========================================================= */

export const DASH_MAX_PLAYERS = 10;
export const DASH_MIN_PLAYERS = 2;
export const DASH_TRACK_LENGTH = 25; // steps from start to finish line
export const DASH_CORRECT_STEP = 1;
export const DASH_WRONG_STEP_BACK = 2;

/* A racer counts as "left" once their presence flag flips to false
   (see trackDashPresence in dashRace.js). Finished racers are never
   "left" — closing the tab after crossing the line is normal. */
export function hasPlayerLeft(player){
  return !player.finished && player.connected === false;
}

/* New track position after one placement. A correct tile moves forward
   one step; a wrong tile moves back two, never below the start. The
   position is capped at the finish line. */
export function nextPosition(position, isCorrect, trackLength = DASH_TRACK_LENGTH){
  const delta = isCorrect ? DASH_CORRECT_STEP : -DASH_WRONG_STEP_BACK;
  return Math.min(trackLength, Math.max(0, position + delta));
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
