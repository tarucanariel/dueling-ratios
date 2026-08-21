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
       pendingChallenge?: { name, requestedAt, requestId } — set while a
         lobby "Challenge" is awaiting the host's Accept/Decline (see
         sendChallenge/acceptChallenge/clearChallenge below). Only
         present on a "waiting" room, and only one at a time — a fresh
         challenge on a room that already has one fails outright rather
         than queuing. A typed-room-code join (joinRoom) never touches
         this field at all — it claims the seat in one step, since
         already knowing the code is treated as implicit consent.
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

import { ref, set, get, update, remove, onValue, off, onDisconnect, serverTimestamp, runTransaction } from "firebase/database";
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
      host: { name: hostName, score: 0, correctCount: 0, wrongCount: 0, streak: 0 },
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

/* Firebase RTDB gotcha, not specific to this app: a transaction's update
   function can be invoked with `room === null` on its very first call
   purely because that path isn't cached locally yet — not because the
   data doesn't actually exist on the server (e.g. someone typing a room
   code they've never seen before, versus a lobby browser who already
   has the whole /rooms tree cached). A plain get() right before the
   transaction is a cheap, common way to warm the local cache so that
   first call is more likely to already have real data, cutting down on
   retries. It's a latency nicety, though, not a correctness requirement —
   every transaction below handles a null room by echoing it through
   rather than assuming "not found," which is what actually makes them
   correct regardless of whether this warm-up landed in time; see the
   comment on room===null inside joinRoom() for the full explanation. */
async function warmRoomCache(roomRef){
  try{ await get(roomRef); } catch (err){ /* best-effort — the transaction below is correct either way */ }
}

/* Runs as a Firebase transaction rather than a plain read-then-write —
   a manually-typed code was only ever known by two people, so a race
   was near-impossible, but a public lobby (see listenToAllRooms) means
   multiple strangers can tap "Challenge" on the same waiting room within
   the same second. The transaction guarantees only one of them actually
   claims it; everyone else gets a clean, accurate error instead of a
   silently-clobbered write. */
export async function joinRoom(code, guestName){
  await ensureSignedIn();
  const roomRef = ref(db, 'rooms/' + code);
  await warmRoomCache(roomRef); // cheap latency win in the common case — see warmRoomCache() above. Correctness below no longer depends on this actually working, though — see the room===null handling next.

  let failReason = null; // set inside the transaction so the catch below can report *why* it aborted
  const result = await runTransaction(roomRef, (room) => {
    if(room === null){
      // IMPORTANT: do NOT hard-abort here (i.e. do NOT `return;`/undefined).
      // A transaction's first invocation can see null purely because this
      // path isn't cached locally yet — not because the room doesn't
      // exist. Returning `room` (null) UNCHANGED, instead of aborting,
      // hands this off to Firebase's own conflict detection: it's really
      // a "write null" attempt, which the server only actually commits
      // if its real current value still matches null. If the room
      // genuinely exists, that mismatch is detected server-side and
      // Firebase automatically retries this function with the real,
      // verified data — no guesswork or cache assumptions needed on our
      // end. Only once we're looking at trustworthy (real or genuinely-
      // null) data do the checks below mean anything.
      return room;
    }
    if(room.status !== 'waiting'){
      failReason = 'taken';
      return; // abort — this is real, verified data: someone beat us to it (or it's not joinable for some other reason)
    }

    room.players = room.players || {};
    room.players.guest = { name: guestName, score: 0, correctCount: 0, wrongCount: 0, streak: 0 };
    room.status = 'active';
    room.lastActivityAt = Date.now();

    // Start the clock now — not at room creation, so the host waiting
    // alone for someone to join doesn't silently burn their own time.
    if(room.settings?.timeControlSeconds > 0){
      room.turnDeadline = Date.now() + room.timeRemaining.host * 1000; // turn starts with host
    }

    return room;
  });

  if(!result.committed){
    throw new Error('This room already has two players.');
  }
  if(result.snapshot.val() === null){
    // Committed, but the FINAL, server-verified state is genuinely null —
    // this is now a trustworthy "the room really doesn't exist," not a
    // caching artifact (see the null-handling above).
    throw new Error('Room not found. Check the code and try again.');
  }
}

/* =========================================================
   Lobby "Challenge" flow (accept/decline)

   Unlike joinRoom() above — used for a typed room code, where already
   knowing the code is treated as implicit consent to join instantly —
   a lobby challenge asks the host first. It's a two-step handshake:

     1. sendChallenge() stakes a claim: writes room.pendingChallenge,
        but leaves status/players untouched. The room stays 'waiting'
        and stays visible to (other) lobby browsers.
     2. The host either:
          - acceptChallenge() — does the actual seat-claiming (same
            shape as joinRoom's transaction), keyed to the specific
            pendingChallenge.requestId so a stale/replaced challenge
            can't accidentally get accepted.
          - clearChallenge() — declines it (or the challenger cancels,
            or a client-side timeout fires) — just clears
            pendingChallenge, reopening the room to other challengers.

   Only one pending challenge is allowed on a room at a time (a fresh
   sendChallenge() while one's already outstanding fails with 'busy') —
   simpler for both players to reason about than a queue, at the cost of
   later challengers needing to retry.
   ========================================================= */

// How long a host has to accept/decline before it auto-expires. Enforced
// both client-side (the challenger's own countdown, see main.js) and via
// pruneStaleChallenges() below as a safety net for a challenger whose tab
// closed before their own timer could fire.
export const CHALLENGE_TIMEOUT_MS = 45 * 1000;

function generateRequestId(){
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function sendChallenge(code, challengerName){
  await ensureSignedIn();
  const roomRef = ref(db, 'rooms/' + code);
  await warmRoomCache(roomRef); // cheap latency win — see the room===null handling below for why correctness doesn't depend on this
  const requestId = generateRequestId();

  let failReason = null;
  const result = await runTransaction(roomRef, (room) => {
    // See joinRoom()'s room===null comment above for why this echoes
    // `room` unchanged rather than hard-aborting: it lets Firebase's own
    // conflict detection confirm whether this is real or just a
    // not-yet-cached placeholder, instead of us guessing.
    if(room === null) return room;
    if(room.status !== 'waiting'){ failReason = 'taken'; return; }
    if(room.pendingChallenge && (Date.now() - room.pendingChallenge.requestedAt) < CHALLENGE_TIMEOUT_MS){
      failReason = 'busy';
      return; // someone else's challenge is still live on this room
    }

    room.pendingChallenge = { name: challengerName, requestedAt: Date.now(), requestId };
    room.lastActivityAt = Date.now();
    return room;
  });

  if(!result.committed){
    if(failReason === 'busy') throw new Error('Someone else is already challenging this player \u2014 try again shortly.');
    throw new Error('This room already has two players.');
  }
  if(result.snapshot.val() === null){
    throw new Error('Room not found. Check the code and try again.');
  }
  return requestId;
}

/* Host taps Accept. requestId must match the room's current
   pendingChallenge — guards against acting on a challenge that's
   already expired/been replaced since the Accept button was rendered. */
export async function acceptChallenge(code, requestId){
  await ensureSignedIn();
  const roomRef = ref(db, 'rooms/' + code);
  await warmRoomCache(roomRef); // cheap latency win — see the room===null handling below for why correctness doesn't depend on this

  let failReason = null;
  const result = await runTransaction(roomRef, (room) => {
    // See joinRoom()'s room===null comment above.
    if(room === null) return room;
    if(room.status !== 'waiting' || !room.pendingChallenge || room.pendingChallenge.requestId !== requestId){
      failReason = 'stale';
      return;
    }

    room.players = room.players || {};
    room.players.guest = { name: room.pendingChallenge.name, score: 0, correctCount: 0, wrongCount: 0, streak: 0 };
    room.status = 'active';
    room.pendingChallenge = null;
    room.lastActivityAt = Date.now();
    if(room.settings?.timeControlSeconds > 0){
      room.turnDeadline = Date.now() + room.timeRemaining.host * 1000;
    }
    return room;
  });

  if(!result.committed){
    throw new Error('That challenge is no longer available.');
  }
  if(result.snapshot.val() === null){
    throw new Error('Room not found.');
  }
}

/* Clears a pendingChallenge if it's still THIS request — covers three
   callers uniformly (host declines / challenger cancels / challenger's
   timeout fires), all a safe no-op if it's already gone for any reason.

   Returns the room as it stood the instant this transaction actually
   committed. That matters for the cancel/timeout callers specifically:
   if by the time this lands the room already shows status 'active', it
   means Accept got there first — this call harmlessly did nothing (the
   pendingChallenge was already cleared by acceptChallenge), and the
   caller needs to know that so it can drop the challenger into the game
   they were actually just placed into, rather than stranding them back
   in the lobby while the host sits there alone. */
export async function clearChallenge(code, requestId){
  await ensureSignedIn();
  const roomRef = ref(db, 'rooms/' + code);
  await warmRoomCache(roomRef); // cheap latency win — see the room===null handling below for why correctness doesn't depend on this
  const result = await runTransaction(roomRef, (room) => {
    // See joinRoom()'s room===null comment above — echoing `room`
    // unchanged here matters more than in most of the other functions
    // in this file, since a wrongly-aborted "room's gone" would make
    // the caller (see main.js's handleCancelChallenge) wrongly conclude
    // a real, active game doesn't exist and strand the challenger back
    // in the lobby instead of routing them into it.
    if(room === null) return room;
    if(room.pendingChallenge && room.pendingChallenge.requestId === requestId){
      room.pendingChallenge = null;
      room.lastActivityAt = Date.now();
    }
    return room;
  });
  return result.committed ? result.snapshot.val() : null;
}

/* Safety net, run alongside pruneStaleRooms() wherever the lobby/watch
   list refreshes: catches a challenge left dangling because the
   challenger's own tab closed before its local timeout could call
   clearChallenge() itself. Without this, that one room would stay stuck
   showing "already being challenged" to everyone else indefinitely. */
export async function pruneStaleChallenges(roomsObj){
  const now = Date.now();
  const staleCodes = Object.entries(roomsObj || {})
    .filter(([, room]) => room?.pendingChallenge && (now - room.pendingChallenge.requestedAt) > CHALLENGE_TIMEOUT_MS)
    .map(([code]) => code);

  await Promise.all(
    staleCodes.map(async code => {
      const roomRef = ref(db, 'rooms/' + code);
      await warmRoomCache(roomRef); // cheap latency win — see the room===null handling below for why correctness doesn't depend on this
      return runTransaction(roomRef, (room) => {
        // See joinRoom()'s room===null comment for the general pattern.
        // A transaction commit is a conditioned compare-and-swap: it only
        // actually writes if the server's real current value still
        // matches what this callback started from. Echoing `room`
        // unchanged (even when it's null) is therefore safe, not a
        // data-loss risk — if the room's real data differs from what we
        // saw, Firebase detects that mismatch and retries this callback
        // with the true data automatically, rather than blindly
        // committing our stale guess over it.
        if(room === null) return room;
        if(room.pendingChallenge && (Date.now() - room.pendingChallenge.requestedAt) > CHALLENGE_TIMEOUT_MS){
          room.pendingChallenge = null;
        }
        return room;
      }).catch(() => { /* best-effort; next sweep will retry */ });
    })
  );
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
    'players/host/streak': 0,
    'players/guest/score': 0,
    'players/guest/correctCount': 0,
    'players/guest/wrongCount': 0,
    'players/guest/streak': 0,
    turn: 'host',
    pairIndex: 1,
    problem,
    cellIndex: 0,
    pool,
    timeRemaining: { host: t, guest: t },
    turnDeadline: t > 0 ? Date.now() + t * 1000 : null,
    missLog: [],
    rematch: { host: false, guest: false },
    pendingChallenge: null,
    lastActivityAt: Date.now(),
  };

  await update(ref(db, 'rooms/' + code), updates);
}
