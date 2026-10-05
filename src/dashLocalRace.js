/* =========================================================
   Ratio Dash — offline, in-memory race layer. No Firebase, no DOM.

   Exposes the same functions main.js uses from dashRace.js (createRace,
   startRace, reportProgress, finishRace, leaveRace, deleteRace,
   trackDashPresence, listenToRace) over a race object kept in memory, in
   the same shape as dashRaces/{code}. main.js picks this backend instead
   of the Firebase one for an "offline practice" race, so the track, bots,
   countdown and results screens all work unchanged with no internet.

   One backend holds at most one race: a single student racing bots on
   their own device. `now` is the clock used for startedAt; main.js passes
   serverNow so the countdown uses the same clock it does online.
   ========================================================= */

import {
  DASH_MAX_BOTS, DASH_TRACK_LENGTH, DASH_WRONG_STEP_BACK,
  buildPlayerEntry, buildBotEntry, shuffledBotNames,
} from "./dashLogic.js";

export const LOCAL_RACE_CODE = "LOCAL";
export const LOCAL_PLAYER_UID = "local-me";

export function createLocalDashBackend({ now = Date.now } = {}){
  let race = null;
  const listeners = new Set();

  // Listeners get a copy, as they would a database snapshot, so main.js
  // can never mutate the stored race by accident.
  function snapshot(){
    return race ? structuredClone(race) : null;
  }

  // Delivered on a microtask, like a database callback: never re-entrantly
  // inside the call that changed the race, and skipped for a listener that
  // unsubscribed in the meantime.
  function notify(){
    const snap = snapshot();
    [...listeners].forEach((cb) => {
      queueMicrotask(() => { if(listeners.has(cb)) cb(snap ? structuredClone(snap) : null); });
    });
  }

  function touch(){
    race.lastActivityAt = Date.now();
  }

  async function createRace(hostName, settings){
    const botCount = Math.min(DASH_MAX_BOTS, Math.max(0, Math.floor(settings.botCount) || 0));
    const players = { [LOCAL_PLAYER_UID]: buildPlayerEntry(LOCAL_PLAYER_UID, hostName) };
    const botNames = shuffledBotNames();
    for(let i = 0; i < botCount; i++){
      const bot = buildBotEntry(i, botNames[i]);
      players[bot.uid] = bot;
    }
    race = {
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      hostUid: LOCAL_PLAYER_UID,
      status: "waiting",
      startedAt: null,
      winnerUid: null,
      settings: { trackLength: DASH_TRACK_LENGTH, wrongStepBack: DASH_WRONG_STEP_BACK, botSkill: "medium", ...settings, botCount },
      players,
    };
    notify();
    return { code: LOCAL_RACE_CODE, uid: LOCAL_PLAYER_UID };
  }

  async function startRace(code){
    if(!race || code !== LOCAL_RACE_CODE) return;
    race.status = "active";
    race.startedAt = now();
    touch();
    notify();
  }

  async function reportProgress(code, uid, { position, correctCount, wrongCount }){
    if(!race || code !== LOCAL_RACE_CODE || !race.players[uid]) return;
    Object.assign(race.players[uid], { position, correctCount, wrongCount });
    touch();
    notify();
  }

  /* First finisher takes the win, as the online transaction guarantees;
     a later finisher still gets finished:true so standings stay right.
     Returns true if this player won. */
  async function finishRace(code, uid, { position, correctCount, wrongCount }){
    if(!race || code !== LOCAL_RACE_CODE || !race.players[uid]) return false;
    Object.assign(race.players[uid], { position, correctCount, wrongCount, finished: true, finishedAt: now() });
    const won = race.winnerUid === null;
    if(won){
      race.winnerUid = uid;
      race.status = "completed";
    }
    touch();
    notify();
    return won;
  }

  /* There is only ever one human here, so leaving always ends the race. */
  async function leaveRace(code){
    await deleteRace(code);
  }

  async function deleteRace(code){
    if(!race || code !== LOCAL_RACE_CODE) return;
    race = null;
    notify();
  }

  // Nothing to disconnect from: no database connection to lose.
  function trackDashPresence(){
    return { markStarted(){}, stop(){} };
  }

  function listenToRace(code, callback){
    listeners.add(callback);
    queueMicrotask(() => {
      if(listeners.has(callback)) callback(code === LOCAL_RACE_CODE ? snapshot() : null);
    });
    return () => { listeners.delete(callback); };
  }

  return { createRace, startRace, reportProgress, finishRace, leaveRace, deleteRace, trackDashPresence, listenToRace };
}
