/* =========================================================
   Online play — Firebase Realtime Database room management.
   Data model:
     /rooms/{code}/
       status: "waiting" | "active" | "finished"
       settings: { allowedOps, totalPairs, allowNegatives }
       players: { host: {name,score}, guest?: {name,score} }
       turn: "host" | "guest"
       pairIndex, problem, cellIndex, pool

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

/* settings: { allowedOps, totalPairs, allowNegatives } */
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

  const roomData = {
    createdAt: Date.now(),
    status: 'waiting',
    settings,
    players: {
      host: { name: hostName, score: 0 },
    },
    turn: 'host',
    pairIndex: 1,
    problem,
    cellIndex: 0,
    pool,
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

  await update(roomRef, {
    'players/guest': { name: guestName, score: 0 },
    status: 'active',
  });
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
