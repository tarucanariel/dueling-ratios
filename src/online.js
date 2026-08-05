/* =========================================================
   Online play — Firebase Realtime Database room management.
   Data model:
     /rooms/{code}/
       status: "waiting" | "active" | "finished"
       endReason: "completed" | "timeout" (only once finished)
       timedOutRole: "host" | "guest" (only if endReason is "timeout")
       settings: { allowedOps, totalPairs, allowNegatives, timeControlSeconds }
       players: { host: {name,score}, guest?: {name,score} }
       turn: "host" | "guest"
       pairIndex, problem, cellIndex, pool
       timeRemaining: { host: seconds, guest: seconds } — "banked" time for
         whoever ISN'T currently active; the active player's true remaining
         time is always computed fresh as (turnDeadline - now), never stored
         as a ticking number, so the two devices can't drift apart.
       turnDeadline: ms timestamp the current turn expires at (null until
         the game actually starts, i.e. once a guest joins — not counted
         down while the host is alone waiting for someone to join).
       createdAt: ms timestamp the room was created.
       lastActivityAt: ms timestamp of the most recent write to the room
         (move, join, rematch request...). Used for the staleness sweep
         below, as a fallback for whichever player role presence (below)
         doesn't cover.
       presence: { host?: {connected, lastSeen}, guest?: {connected, lastSeen} }
         — set up via trackPresence() using Firebase's onDisconnect(),
         so `connected` flips to false automatically the moment that
         player's browser tab/connection drops, without either device
         having to poll for it. Absent entirely for rooms created before
         this existed, or for the brief window before the first write
         lands — always treat "no presence data" as "assume connected"
         rather than "assume gone".

   Reconnection: nothing about "who's in this room" lives only in
   Firebase — main.js also saves {code, role, name} to localStorage the
   moment a player creates/joins/rejoins, refreshed on every room update
   while actively playing. So the last-saved copy is effectively "the
   moment we were last confirmed connected". If the browser closes
   entirely (not just a refresh — onDisconnect already handles that),
   reopening it within REJOIN_WINDOW_MS prompts to rejoin the same seat;
   see main.js's rejoin-banner flow. This module has no concept of
   "seats" itself — it just exposes getRoomOnce() for validating one
   still exists before main.js commits to reconnecting.

   Only `problem` (the {a,b,op,c,d} numbers) is synced, not the full
   derived board — buildProblemLayout() is a pure function, so both
   devices independently compute identical cells/rows from it. This
   keeps payloads small and reuses all the existing pure logic as-is.
   ========================================================= */

import { ref, set, get, update, remove, onValue, off, onDisconnect, serverTimestamp } from "firebase/database";
import { db, ensureSignedIn } from "./firebase.js";
import { generateProblem, buildProblemLayout, buildPool } from "./logic.js";

// No 0/O or 1/I — easy to read aloud/type on a shared classroom code.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/* Staleness thresholds for the auto-cleanup sweep (see pruneStaleRooms
   below). Tune these directly here if 5/30/60 minutes doesn't fit your
   class period — no other code needs to change. */
const STALE_WAITING_MS = 5 * 60 * 1000;   // created, nobody ever joined
const STALE_ACTIVE_MS = 30 * 60 * 1000;   // no move/join/rematch activity — likely both players left

/* How long a browser that closed can still reclaim its seat (see
   trackPresence/getRoomOnce below, used by main.js's rejoin-prompt flow).
   STALE_ACTIVE_BOTH_GONE_MS is deliberately kept a bit longer than this —
   a room must never get pruned before a legitimate rejoin attempt within
   the promised window would still have worked. */
export const REJOIN_WINDOW_MS = 10 * 60 * 1000;
const STALE_ACTIVE_BOTH_GONE_MS = REJOIN_WINDOW_MS + 2 * 60 * 1000; // presence confirms BOTH disconnected

const STALE_FINISHED_MS = 60 * 60 * 1000; // finished games are just DB clutter after this long

function generateRoomCode(){
  let code = '';
  for(let i = 0; i < 4; i++){
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

/* settings: { allowedOps, totalPairs, allowNegatives, timeControlSeconds } */
export async function createRoom(hostName, settings){
  await ensureSignedIn();

  let code = generateRoomCode();
  for(let attempt = 0; attempt < 5; attempt++){
    const snap = await get(ref(db, 'rooms/' + code));
    if(!snap.exists()) break;
    code = generateRoomCode();
  }

  const problem = generateProblem(settings);
  const layout = buildProblemLayout(problem);
  const pool = buildPool(layout.cells);
  const t = settings.timeControlSeconds || 0;

  const roomData = {
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    status: 'waiting',
    settings,
    players: {
      host: { name: hostName, score: 0, correctCount: 0, wrongCount: 0 },
    },
    turn: 'host',
    pairIndex: 1,
    problem,
    cellIndex: 0,
    pool,
    timeRemaining: { host: t, guest: t },
    turnDeadline: null, // set once the guest joins and the clock actually starts
    missLog: [],
  };

  await set(ref(db, 'rooms/' + code), roomData);
  return code;
}

export async function joinRoom(code, guestName){
  await ensureSignedIn();
  const roomRef = ref(db, 'rooms/' + code);
  const snap = await get(roomRef);

  if(!snap.exists()){
    throw new Error('Room not found. Check the code and try again.');
  }
  const room = snap.val();
  if(room.status !== 'waiting'){
    throw new Error('This room already has two players.');
  }

  const updates = {
    'players/guest': { name: guestName, score: 0, correctCount: 0, wrongCount: 0 },
    status: 'active',
    lastActivityAt: Date.now(),
  };

  // Start the clock now — not at room creation, so the host waiting
  // alone for someone to join doesn't silently burn their own time.
  if(room.settings.timeControlSeconds > 0){
    updates.turnDeadline = Date.now() + room.timeRemaining.host * 1000; // turn starts with host
  }

  await update(roomRef, updates);
}

/* Registers this browser's live connection as `role` (host/guest) in
   `rooms/{code}/presence`. Uses Firebase's onDisconnect(), which is a
   write registered with the server itself — it fires even if this tab
   crashes or loses power, since it's the server noticing the socket
   drop, not client code that has to run at the moment of disconnecting.

   `.info/connected` is a special per-connection path that flips true
   every time this client (re)establishes a live connection — including
   after a network blip — and Firebase's documented pattern is to
   re-register the onDisconnect() hook every single time it does, since
   a fresh connection needs its own hook. Detection is near-instant for
   a closed tab; a silent network drop (WiFi dying without the tab
   closing) can take up to ~60s for the server to notice the socket has
   gone stale — that's an inherent limit of this approach, not something
   client code can speed up.

   Returns a cleanup function for a deliberate exit (New Game / Exit),
   so we don't wait out that ~60s when we already know we're leaving. */
export function trackPresence(code, role){
  const connectedRef = ref(db, '.info/connected');
  const presenceRef = ref(db, `rooms/${code}/presence/${role}`);

  const handler = (snap) => {
    if(snap.val() !== true) return;
    onDisconnect(presenceRef)
      .set({ connected: false, lastSeen: serverTimestamp() })
      .then(() => set(presenceRef, { connected: true, lastSeen: serverTimestamp() }));
  };
  onValue(connectedRef, handler);

  return () => {
    off(connectedRef, 'value', handler);
    onDisconnect(presenceRef).cancel();
    set(presenceRef, { connected: false, lastSeen: serverTimestamp() }).catch(() => { /* best-effort */ });
  };
}

/* Returns an unsubscribe function. */
export function listenToRoom(code, callback){
  const roomRef = ref(db, 'rooms/' + code);
  const handler = (snap) => callback(snap.val());
  onValue(roomRef, handler);
  return () => off(roomRef, 'value', handler);
}

/* One-off read (no subscription) — used to validate a saved seat exists
   before committing to a rejoin, without wiring up a live listener for
   a room that might turn out to be gone. */
export async function getRoomOnce(code){
  const snap = await get(ref(db, 'rooms/' + code));
  return snap.exists() ? snap.val() : null;
}

/* For the teacher "Watch Games" view: subscribes to the whole /rooms
   node so the list can update live as games start, progress, and
   finish. Fine at classroom scale (dozens of rooms); callback receives
   a plain object keyed by room code, or {} if there are none. */
export function listenToAllRooms(callback){
  const roomsRef = ref(db, 'rooms');
  const handler = (snap) => callback(snap.val() || {});
  onValue(roomsRef, handler);
  return () => off(roomsRef, 'value', handler);
}

/* Every gameplay update (tile taps, timeouts) flows through here, so
   stamping lastActivityAt in one place covers all of it automatically —
   nothing else has to remember to do it. */
export function submitRoomUpdate(code, updates){
  return update(ref(db, 'rooms/' + code), { ...updates, lastActivityAt: Date.now() });
}

/* True once a room looks abandoned enough to be safe to prune — see the
   STALE_*_MS thresholds above. "waiting" rooms are unambiguous (nobody's
   game data is lost by deleting one); "active"/"finished" ones use a much
   longer window since there's no presence detection to be sure someone
   isn't just thinking. */
export function isRoomStale(room, now = Date.now()){
  if(!room) return false;
  const lastActivity = room.lastActivityAt || room.createdAt || 0;

  if(room.status === 'waiting') return now - (room.createdAt || 0) > STALE_WAITING_MS;
  if(room.status === 'active'){
    const h = room.presence?.host;
    const g = room.presence?.guest;
    const bothConfirmedGone = h && g && h.connected === false && g.connected === false;
    const threshold = bothConfirmedGone ? STALE_ACTIVE_BOTH_GONE_MS : STALE_ACTIVE_MS;
    return now - lastActivity > threshold;
  }
  if(room.status === 'finished') return now - lastActivity > STALE_FINISHED_MS;
  return false;
}

/* Best-effort cleanup: there's no server-side cron here, so this runs
   opportunistically whenever the teacher's watch list is open (each
   snapshot from listenToAllRooms). Deleting an already-deleted room is a
   harmless no-op, so overlapping sweeps from multiple open tabs are fine. */
export async function pruneStaleRooms(roomsObj){
  const now = Date.now();
  const staleCodes = Object.entries(roomsObj || {})
    .filter(([, room]) => isRoomStale(room, now))
    .map(([code]) => code);

  await Promise.all(
    staleCodes.map(code => remove(ref(db, 'rooms/' + code)).catch(() => { /* best-effort */ }))
  );
}

/* Opt-in rematch: each player flips their own flag. Once both flags are
   true, resetRoomForRematch() actually restarts the room (see main.js,
   which has exactly one device — the host — do that, to avoid both
   players racing to reset the same room at once). */
export function requestRematch(code, role){
  return update(ref(db, 'rooms/' + code), { [`rematch/${role}`]: true, lastActivityAt: Date.now() });
}

/* Restarts a finished room in place: fresh problem/pool, scores and
   clocks reset, rematch flags cleared. Reuses the room's original
   settings, so a rematch always matches the game that was just played. */
export async function resetRoomForRematch(code, settings){
  const problem = generateProblem(settings);
  const layout = buildProblemLayout(problem);
  const pool = buildPool(layout.cells);
  const t = settings.timeControlSeconds || 0;

  const updates = {
    status: 'active',
    endReason: null,
    timedOutRole: null,
    'players/host/score': 0,
    'players/host/correctCount': 0,
    'players/host/wrongCount': 0,
    'players/guest/score': 0,
    'players/guest/correctCount': 0,
    'players/guest/wrongCount': 0,
    turn: 'host',
    pairIndex: 1,
    problem,
    cellIndex: 0,
    pool,
    timeRemaining: { host: t, guest: t },
    turnDeadline: t > 0 ? Date.now() + t * 1000 : null,
    missLog: [],
    rematch: { host: false, guest: false },
    lastActivityAt: Date.now(),
  };

  await update(ref(db, 'rooms/' + code), updates);
}
