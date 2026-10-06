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

/* Bots are computer racers the host adds to a race. They are stored as
   ordinary player entries (uid "bot1", "bot2", ...) flagged isBot, and the
   host's client plays them. */
export const DASH_MAX_BOTS = DASH_MAX_PLAYERS - 1; // the host always takes one slot

export function humanCount(playersObj){
  return Object.values(playersObj || {}).filter(p => !p.isBot).length;
}

/* Wins, podiums and the race-result badges only count when at least two
   real people raced — otherwise one human could farm them against easy
   bots. Games played, accuracy and streaks still count either way. */
export function isCompetitiveRace(playersObj){
  return humanCount(playersObj) >= 2;
}

// A race with no activity (no answer, join or start) for this long is
// considered dead: hidden from the teacher's list and deleted from the
// database. Every answer refreshes lastActivityAt, so a live race never
// goes this quiet.
export const DASH_STALE_MS = 15 * 60 * 1000;

/* True once a race is no longer worth listing or keeping:
   - it has been idle past DASH_STALE_MS, or
   - it has already ended, or
   - it is mid-race but every real player has disconnected (abandoned).
   `idleOnly` limits the check to the idle test — that is the only part
   the database rules let a non-host delete. */
export function isRaceStale(race, now = Date.now(), { idleOnly = false } = {}){
  if(!race) return true;
  const idle = now - (race.lastActivityAt || race.createdAt || 0) > DASH_STALE_MS;
  if(idleOnly) return idle;
  if(idle || isRaceOver(race)) return true;
  if(race.status === 'active'){
    const humans = Object.values(race.players || {}).filter(p => !p.isBot);
    if(humans.length > 0 && humans.every(p => p.connected === false)) return true;
  }
  return false;
}

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

/* ---------- Player and bot entries ----------
   Shared by the Firebase layer (dashRace.js) and the offline in-memory
   one (dashLocalRace.js), so both build identical race objects. */

export function randomAvatarSeed(){
  return Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
}

export function buildPlayerEntry(uid, name){
  return {
    uid,
    name,
    avatarSeed: randomAvatarSeed(),
    joinedAt: Date.now(),
    position: 0,
    correctCount: 0,
    wrongCount: 0,
    finished: false,
    connected: true,
  };
}

export const BOT_NAMES = ["Ying", "Guiller", "Merlie", "Romel", "Divz", "Chatt", "Zan", "Oding", "Rycanz"];

/* A fresh random order of the bot names for each race, so a host adding
   3 bots doesn't always get the same 3. */
export function shuffledBotNames(){
  const names = [...BOT_NAMES];
  for(let i = names.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }
  return names;
}

/* A bot is a normal player entry the host's client plays (see
   startDashBots in main.js). Its uid has the form "bot1", "bot2", ... —
   the database rules let only the host write those entries. */
export function buildBotEntry(index, name){
  return {
    uid: "bot" + (index + 1),
    name: "\u{1F916} " + name,
    avatarSeed: "bot-" + name,
    isBot: true,
    joinedAt: Date.now() + index + 1,
    position: 0,
    correctCount: 0,
    wrongCount: 0,
    finished: false,
    connected: true,
  };
}
