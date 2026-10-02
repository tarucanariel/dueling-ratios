/* =========================================================
   Ratio Dash — Realtime Database layer (rooms, joining, progress,
   presence). No DOM in here; main.js owns all the UI.

   Up to 10 players race avatars toward a finish line. Nobody shares
   problems or turns: each client generates and solves its own stream of
   fraction problems locally, and only the *result* of each tile
   placement (a new track position) is written. One listener per race
   lets every client watch everyone else's avatar move live.

   dashRaces/{code}:
     createdAt, lastActivityAt, hostUid, startedAt, winnerUid,
     status: 'waiting' | 'active' | 'completed'
     settings: { allowedOps, allowNegatives, trackLength }
     players/{uid}: { uid, name, avatarSeed, joinedAt, position,
                      correctCount, wrongCount, finished, finishedAt,
                      connected }

   Identity is the Firebase Auth uid (anonymous or Google) — the same
   guarantee online.js relies on via ensureSignedIn(). See
   database.rules.json for the matching security rules.
   ========================================================= */

import { ref, set, get, update, remove, onValue, off, onDisconnect, serverTimestamp, runTransaction } from "firebase/database";
import { db, auth, ensureSignedIn } from "./firebase.js";
import { DASH_MAX_PLAYERS, DASH_TRACK_LENGTH, DASH_WRONG_STEP_BACK, isRaceOver } from "./dashLogic.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I, same as online.js
export const DASH_CODE_LENGTH = 4;
export const DASH_WAITING_TIMEOUT_MS = 10 * 60 * 1000; // an un-started lobby is auto-cancelled after this
const STALE_RACE_MS = 2 * 60 * 60 * 1000; // any race this long without activity is just DB clutter

function generateCode(){
  let code = "";
  for(let i = 0; i < DASH_CODE_LENGTH; i++){
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

function randomAvatarSeed(){
  return Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
}

function buildPlayerEntry(uid, name){
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

const raceRef = (code) => ref(db, "dashRaces/" + code);
const playerRef = (code, uid) => ref(db, `dashRaces/${code}/players/${uid}`);

/* Always read the live uid from auth rather than ensureSignedIn()'s
   cached promise — that one can still hold the earlier anonymous user
   after the player signs in with Google. */
async function currentUid(){
  await ensureSignedIn();
  return auth.currentUser.uid;
}

/* Best-effort sweep so finished/abandoned races don't pile up. Rules let
   anyone delete a race that's been idle past STALE_RACE_MS. */
async function pruneStaleRaces(){
  try{
    const snap = await get(ref(db, "dashRaces"));
    const races = snap.val() || {};
    const now = Date.now();
    await Promise.all(Object.entries(races)
      .filter(([, race]) => now - (race.lastActivityAt || race.createdAt || 0) > STALE_RACE_MS)
      .map(([code]) => remove(raceRef(code))));
  } catch (err){ /* best-effort */ }
}

/* settings: { allowedOps, allowNegatives, trackLength, wrongStepBack } — the
   last two default to 25 and 2. */
export async function createRace(hostName, settings){
  const uid = await currentUid();
  pruneStaleRaces();

  let code = generateCode();
  for(let attempt = 0; attempt < 5; attempt++){
    const snap = await get(raceRef(code));
    if(!snap.exists()) break;
    code = generateCode();
  }

  await set(raceRef(code), {
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    hostUid: uid,
    status: "waiting",
    startedAt: null,
    winnerUid: null,
    settings: { trackLength: DASH_TRACK_LENGTH, wrongStepBack: DASH_WRONG_STEP_BACK, ...settings },
    players: { [uid]: buildPlayerEntry(uid, hostName) },
  });
  return { code, uid };
}

/* Instant join — no host approval, since approving up to 9 joiners one
   by one would be pure friction for a casual classroom race. Returns
   { ok, code, uid } or { ok: false, message }. The database rules
   enforce the same waiting-only / max-10 limits server-side. */
export async function joinRace(code, name){
  const uid = await currentUid();
  code = (code || "").trim().toUpperCase();

  try{
    const snap = await get(raceRef(code));
    if(!snap.exists()) return { ok: false, message: "No race found with that code." };
    const race = snap.val();
    if(race.status !== "waiting") return { ok: false, message: "That race has already started." };
    if(race.players?.[uid]) return { ok: false, message: "You're already in this race." };
    if(Object.keys(race.players || {}).length >= DASH_MAX_PLAYERS){
      return { ok: false, message: "That race is full." };
    }
    await set(playerRef(code, uid), buildPlayerEntry(uid, name));
    return { ok: true, code, uid };
  } catch (err){
    console.error("Failed to join Ratio Dash race:", err);
    return { ok: false, message: "Couldn't join that race. It may be full or already started." };
  }
}

export function startRace(code){
  return update(ref(db), {
    [`dashRaces/${code}/status`]: "active",
    [`dashRaces/${code}/startedAt`]: serverTimestamp(),
    [`dashRaces/${code}/lastActivityAt`]: Date.now(),
  });
}

/* Called after every tile placement with this player's new totals. Only
   ever touches the player's own subtree. */
export function reportProgress(code, uid, { position, correctCount, wrongCount }){
  return update(ref(db), {
    [`dashRaces/${code}/players/${uid}/position`]: position,
    [`dashRaces/${code}/players/${uid}/correctCount`]: correctCount,
    [`dashRaces/${code}/players/${uid}/wrongCount`]: wrongCount,
    [`dashRaces/${code}/lastActivityAt`]: Date.now(),
  });
}

/* Records that this player crossed the line and tries to claim the win.
   The transaction on winnerUid guarantees exactly one winner even if two
   players finish in the same instant — the loser still gets
   finished:true, so standings stay accurate. Returns true if this
   player won. */
export async function finishRace(code, uid, { position, correctCount, wrongCount }){
  await update(playerRef(code, uid), {
    position, correctCount, wrongCount,
    finished: true,
    finishedAt: serverTimestamp(),
  });

  const result = await runTransaction(ref(db, `dashRaces/${code}/winnerUid`), (current) => {
    return current === null ? uid : undefined; // undefined aborts: someone else already won
  });
  const won = result.committed && result.snapshot.val() === uid;
  if(won){
    // Best-effort: listeners already treat a recorded winner as the end
    // of the race (see isRaceOver), so a failure here is harmless.
    update(ref(db), {
      [`dashRaces/${code}/status`]: "completed",
      [`dashRaces/${code}/lastActivityAt`]: Date.now(),
    }).catch(() => {});
  }
  return won;
}

/* Waiting lobby: the host leaving cancels the whole room, a joiner
   leaving just removes their own entry. Mid-race or after: just mark
   this player as gone — the race goes on for everyone else. If the
   race is already over, the host also clears the finished room. */
export async function leaveRace(code, uid, { isHost, status, raceOver }){
  try{
    if(status === "waiting"){
      if(isHost) await remove(raceRef(code));
      else await remove(playerRef(code, uid));
    } else if(raceOver){
      // The host clears the finished room; everyone else has nothing to
      // update (and writing to a room that may already be gone would
      // leave a stray entry behind).
      if(isHost) await remove(raceRef(code));
    } else {
      await update(playerRef(code, uid), { connected: false });
    }
  } catch (err){
    console.error("Failed to leave Ratio Dash race:", err);
  }
}

/* Validates a saved seat and, if the player can still get back into the
   race, returns what enterDash needs. Only an active, unfinished race
   whose player entry still exists can be rejoined — a lobby drops
   disconnected players, and a finished race has nothing to rejoin. */
export async function rejoinRace(code){
  const uid = await currentUid();
  const snap = await get(raceRef(code));
  if(!snap.exists()) return { ok: false, message: "That race is no longer available." };
  const race = snap.val();
  if(isRaceOver(race)) return { ok: false, message: "That race has already finished." };
  if(race.status !== "active" || !race.players?.[uid]){
    return { ok: false, message: "That race is no longer available." };
  }
  return { ok: true, code, uid, isHost: race.hostUid === uid };
}

/* Presence. While the race is still in the lobby, a dropped connection
   removes the player (or, for the host, the whole room — a lobby with
   no host can never start). Once the race is active it only flips
   connected:false, so the avatar stays on the track marked as "left".
   Call markStarted() when the race goes active. Returns
   { markStarted, stop }. */
export function trackDashPresence(code, uid, isHost, { started: alreadyStarted = false } = {}){
  const connectedRef = ref(db, ".info/connected");
  const entry = playerRef(code, uid);
  const lobbyTarget = isHost ? raceRef(code) : entry;
  let started = alreadyStarted; // true when rejoining a race that is already underway

  const arm = async () => {
    if(started){
      await onDisconnect(entry).cancel();
      await onDisconnect(ref(db, `dashRaces/${code}/players/${uid}/connected`)).set(false);
      await set(ref(db, `dashRaces/${code}/players/${uid}/connected`), true);
    } else {
      await onDisconnect(lobbyTarget).remove();
    }
  };

  const handler = (snap) => {
    if(snap.val() !== true) return;
    arm().catch(() => {});
  };
  onValue(connectedRef, handler);

  return {
    markStarted(){
      started = true;
      onDisconnect(raceRef(code)).cancel()
        .then(arm)
        .catch(() => {});
    },
    stop(){
      off(connectedRef, "value", handler);
      onDisconnect(lobbyTarget).cancel().catch(() => {});
      onDisconnect(entry).cancel().catch(() => {});
    },
  };
}

/* Returns an unsubscribe function. The callback gets null if the race
   doesn't exist (anymore). */
export function listenToRace(code, callback){
  const r = raceRef(code);
  const handler = (snap) => callback(snap.val());
  onValue(r, handler);
  return () => off(r, "value", handler);
}

export function deleteRace(code){
  return remove(raceRef(code));
}
