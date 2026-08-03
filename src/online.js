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

   Only `problem` (the {a,b,op,c,d} numbers) is synced, not the full
   derived board — buildProblemLayout() is a pure function, so both
   devices independently compute identical cells/rows from it. This
   keeps payloads small and reuses all the existing pure logic as-is.
   ========================================================= */

import { ref, set, get, update, onValue, off } from "firebase/database";
import { db, ensureSignedIn } from "./firebase.js";
import { generateProblem, buildProblemLayout, buildPool } from "./logic.js";

// No 0/O or 1/I — easy to read aloud/type on a shared classroom code.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

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
  };

  // Start the clock now — not at room creation, so the host waiting
  // alone for someone to join doesn't silently burn their own time.
  if(room.settings.timeControlSeconds > 0){
    updates.turnDeadline = Date.now() + room.timeRemaining.host * 1000; // turn starts with host
  }

  await update(roomRef, updates);
}

/* Returns an unsubscribe function. */
export function listenToRoom(code, callback){
  const roomRef = ref(db, 'rooms/' + code);
  const handler = (snap) => callback(snap.val());
  onValue(roomRef, handler);
  return () => off(roomRef, 'value', handler);
}

export function submitRoomUpdate(code, updates){
  return update(ref(db, 'rooms/' + code), updates);
}
