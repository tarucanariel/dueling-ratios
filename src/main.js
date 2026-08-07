import './style.css';
import { generateProblem, buildProblemLayout, buildPool } from './logic.js';
import { createRoom, joinRoom, listenToRoom, listenToAllRooms, submitRoomUpdate, requestRematch, resetRoomForRematch, pruneStaleRooms, isRoomStale, trackPresence, getRoomOnce, REJOIN_WINDOW_MS } from './online.js';
import { TEACHER_PIN } from './teacherConfig.js';
import { ref, remove } from 'firebase/database';
import { db } from './firebase.js';
import { playSound } from './sounds.js';
import creditsPhotoUrl from './assets/credits/ariel-tarucan.png';

/* =========================================================
   AAT's Dueling Ratios — app logic
   ========================================================= */

const state = {
  mode: null,           // 'solo' | 'vs' | 'online'
  players: [],          // [{name, score}] length 1 or 2
  currentPlayer: 0,      // index into players
  totalPairs: 0,
  pairIndex: 0,
  problem: null,        // current fraction pair {a,b,op,c,d}
  cells: [],            // current grid cell definitions
  cellIndex: 0,         // which cell is currently active
  pool: [],             // current tile pool [{id, value}]
  allowedOps: ['+', '-', '\u00D7', '\u00F7'], // operations the player opted into
  allowNegatives: false, // whether generated numerators can be negative
  inputLocked: false,   // prevents a single tap from being processed twice
  timeControlSeconds: 0, // 0 = no timer (local modes only — not yet supported online)
  timerId: null,         // setInterval handle

  // Online play
  onlineChoice: null,    // 'create' | 'join' | 'find'
  isOnline: false,
  roomCode: null,
  myRole: null,          // 'host' | 'guest'
  unsubscribeRoom: null,
  onlineTimerPollId: null, // setInterval handle for the online chess-clock poll
  stopPresence: null, // cleanup function from trackPresence(), for the real player's own connection
  missLog: [], // wrong-attempt records for the current game, for the post-game review
  rematchFinalizing: false, // guards against the host double-triggering resetRoomForRematch

  // "Find Opponent" lobby (browsing waiting rooms instead of typing a code)
  unsubscribeLobby: null,
  lobbyTickId: null,     // setInterval handle — re-renders "waiting Xm ago" even between snapshots
  lastLobbyRooms: null,  // most recent /rooms snapshot, reused by the tick above

  // Teacher spectator view
  spectating: false,         // true while watching someone else's online game, read-only
  spectateRoomCode: null,
  spectateRoom: null,        // last-seen snapshot of the watched room, for prev-vs-new diffing
  unsubscribeSpectateRoom: null,
  unsubscribeRoomsList: null,
  spectateTimerId: null,     // display-only poll; never writes to the room
};

/* ---------- DOM refs ---------- */
const el = {
  setupModal: document.getElementById('setup-modal'),
  player1Name: document.getElementById('player1-name'),
  player2Name: document.getElementById('player2-name'),
  stepName2: document.getElementById('step-name2'),
  modeSolo: document.getElementById('mode-solo'),
  modeVs: document.getElementById('mode-vs'),
  modeOnline: document.getElementById('mode-online'),
  startBtn: document.getElementById('start-game-btn'),
  setupError: document.getElementById('setup-error'),

  opAll: document.getElementById('op-all'),
  opChoices: document.querySelectorAll('.op-choice'),
  pairCountSelect: document.getElementById('pair-count-select'),
  timeControlSelect: document.getElementById('time-control-select'),
  allowNegatives: document.getElementById('allow-negatives'),

  stepOperations: document.getElementById('step-operations'),
  stepNegatives: document.getElementById('step-negatives'),
  stepPairCount: document.getElementById('step-pair-count'),
  stepTimeControl: document.getElementById('step-time-control'),

  stepOnlineChoice: document.getElementById('step-online-choice'),
  onlineCreateBtn: document.getElementById('online-create-btn'),
  onlineJoinBtn: document.getElementById('online-join-btn'),
  onlineFindBtn: document.getElementById('online-find-btn'),
  stepJoinCode: document.getElementById('step-join-code'),
  joinCodeInput: document.getElementById('join-code-input'),
  stepFindOpponent: document.getElementById('step-find-opponent'),
  lobbyList: document.getElementById('lobby-list'),

  waitingModal: document.getElementById('waiting-modal'),
  instructionsModal: document.getElementById('instructions-modal'),
  instructionsBtn: document.getElementById('instructions-btn'),
  closeInstructionsBtn: document.getElementById('close-instructions-btn'),
  creditsPhoto: document.getElementById('credits-photo'),
  roomCodeDisplay: document.getElementById('room-code-display'),
  cancelWaitingBtn: document.getElementById('cancel-waiting-btn'),

  gameScreen: document.getElementById('game-screen'),
  chipP1: document.getElementById('chip-p1'),
  chipP2: document.getElementById('chip-p2'),
  chipP1Name: document.getElementById('chip-p1-name'),
  chipP2Name: document.getElementById('chip-p2-name'),
  chipP1Score: document.getElementById('chip-p1-score'),
  chipP2Score: document.getElementById('chip-p2-score'),
  chipP1Timer: document.getElementById('chip-p1-timer'),
  chipP2Timer: document.getElementById('chip-p2-timer'),
  pairCounter: document.getElementById('pair-counter'),
  turnFlag: document.getElementById('turn-flag'),

  problemStrip: document.getElementById('problem-strip'),
  poolTray: document.getElementById('pool-tray'),
  feedbackLine: document.getElementById('feedback-line'),

  winnerModal: document.getElementById('winner-modal'),
  winnerHeading: document.getElementById('winner-heading'),
  winnerDetail: document.getElementById('winner-detail'),
  rematchBtn: document.getElementById('rematch-btn'),
  newGameBtn: document.getElementById('new-game-btn'),
  rematchStatus: document.getElementById('rematch-status'),
  reviewMissedBtn: document.getElementById('review-missed-btn'),
  reviewModal: document.getElementById('review-modal'),
  closeReviewBtn: document.getElementById('close-review-btn'),
  reviewSummary: document.getElementById('review-summary'),
  reviewList: document.getElementById('review-list'),

  // Teacher spectator view
  watchGamesBtn: document.getElementById('watch-games-btn'),
  teacherPinModal: document.getElementById('teacher-pin-modal'),
  teacherPinInput: document.getElementById('teacher-pin-input'),
  teacherPinError: document.getElementById('teacher-pin-error'),
  teacherPinSubmitBtn: document.getElementById('teacher-pin-submit-btn'),
  teacherPinCancelBtn: document.getElementById('teacher-pin-cancel-btn'),
  watchListModal: document.getElementById('watch-list-modal'),
  watchListBody: document.getElementById('watch-list-body'),
  closeWatchListBtn: document.getElementById('close-watch-list-btn'),
  spectateBar: document.getElementById('spectate-bar'),
  spectateRoomCodeLabel: document.getElementById('spectate-room-code'),
  spectateBackBtn: document.getElementById('spectate-back-btn'),
  spectateExitBtn: document.getElementById('spectate-exit-btn'),
  poolLabel: document.getElementById('pool-label'),
  presenceBanner: document.getElementById('presence-banner'),

  // Reconnection
  rejoinBanner: document.getElementById('rejoin-banner'),
  rejoinBannerText: document.getElementById('rejoin-banner-text'),
  rejoinBtn: document.getElementById('rejoin-btn'),
  rejoinDismissBtn: document.getElementById('rejoin-dismiss-btn'),
};

/* =========================================================
   Reconnection: a browser remembers its own seat in a room across a
   closed tab (not just a refresh — onDisconnect on the Firebase side
   already covers that instantly). savedAt gets refreshed on every room
   update while actively playing, so it tracks "last confirmed
   connected" rather than "first joined" — see onRoomUpdate below.

   This block must come before anything that calls checkForRejoinableSeat()
   runs (see the setup-screen wiring further down) — SEAT_STORAGE_KEY is a
   `const`, and referencing it before its own declaration line has
   executed throws, even though the functions using it are hoisted.
   ========================================================= */
const SEAT_STORAGE_KEY = 'duelingRatiosSeat';

function saveSeat(code, role, name){
  try{
    localStorage.setItem(SEAT_STORAGE_KEY, JSON.stringify({ code, role, name, savedAt: Date.now() }));
  } catch(e) { /* storage unavailable (private browsing etc.) — rejoin just won't be offered */ }
}

function loadSeat(){
  try{
    const raw = localStorage.getItem(SEAT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch(e) { return null; }
}

function clearSeat(){
  try{ localStorage.removeItem(SEAT_STORAGE_KEY); } catch(e) { /* ignore */ }
}

/* =========================================================
   Setup screen wiring
   ========================================================= */

el.modeSolo.addEventListener('click', () => selectMode('solo'));
el.modeVs.addEventListener('click', () => selectMode('vs'));
el.modeOnline.addEventListener('click', () => selectMode('online'));
el.startBtn.addEventListener('click', handlePrimaryButtonClick);
el.rematchBtn.addEventListener('click', handleRematchClick);
el.newGameBtn.addEventListener('click', resetToSetup);
el.cancelWaitingBtn.addEventListener('click', cancelWaiting);

el.instructionsBtn.addEventListener('click', () => {
  el.instructionsModal.classList.remove('hidden');
});
el.closeInstructionsBtn.addEventListener('click', () => {
  el.instructionsModal.classList.add('hidden');
});
el.instructionsModal.addEventListener('click', (e) => {
  if(e.target === el.instructionsModal) el.instructionsModal.classList.add('hidden');
});
el.creditsPhoto.src = creditsPhotoUrl;

el.reviewMissedBtn.addEventListener('click', () => {
  renderMissedReview();
  el.reviewModal.classList.remove('hidden');
});
el.closeReviewBtn.addEventListener('click', () => {
  el.reviewModal.classList.add('hidden');
});
el.reviewModal.addEventListener('click', (e) => {
  if(e.target === el.reviewModal) el.reviewModal.classList.add('hidden');
});

el.onlineCreateBtn.addEventListener('click', () => selectOnlineChoice('create'));
el.onlineJoinBtn.addEventListener('click', () => selectOnlineChoice('join'));
el.onlineFindBtn.addEventListener('click', () => selectOnlineChoice('find'));

el.watchGamesBtn.addEventListener('click', () => {
  el.teacherPinInput.value = '';
  el.teacherPinError.textContent = '';
  el.teacherPinModal.classList.remove('hidden');
  el.teacherPinInput.focus();
});
el.teacherPinCancelBtn.addEventListener('click', () => {
  el.teacherPinModal.classList.add('hidden');
});
el.teacherPinModal.addEventListener('click', (e) => {
  if(e.target === el.teacherPinModal) el.teacherPinModal.classList.add('hidden');
});
el.teacherPinSubmitBtn.addEventListener('click', submitTeacherPin);
el.teacherPinInput.addEventListener('keydown', (e) => {
  if(e.key === 'Enter') submitTeacherPin();
});
el.closeWatchListBtn.addEventListener('click', closeWatchList);
el.watchListModal.addEventListener('click', (e) => {
  if(e.target === el.watchListModal) closeWatchList();
});
el.spectateBackBtn.addEventListener('click', () => stopSpectating(true));
el.spectateExitBtn.addEventListener('click', () => stopSpectating(false));
el.rejoinBtn.addEventListener('click', attemptRejoin);
el.rejoinDismissBtn.addEventListener('click', () => {
  clearSeat();
  el.rejoinBanner.classList.add('hidden');
});

updateStepVisibility(); // initial state: nothing mode-dependent shown until a mode is picked
checkForRejoinableSeat(); // offer to reconnect if this browser has an unfinished game saved

el.opAll.addEventListener('change', () => {
  el.opChoices.forEach(cb => { cb.checked = el.opAll.checked; });
});
el.opChoices.forEach(cb => {
  cb.addEventListener('change', () => {
    el.opAll.checked = Array.from(el.opChoices).every(c => c.checked);
  });
});

function selectMode(mode){
  state.mode = mode;
  state.onlineChoice = null;
  closeLobby(); // leaving/changing mode — stop listening if we were browsing the lobby
  el.modeSolo.classList.toggle('selected', mode === 'solo');
  el.modeVs.classList.toggle('selected', mode === 'vs');
  el.modeOnline.classList.toggle('selected', mode === 'online');
  el.onlineCreateBtn.classList.remove('selected');
  el.onlineJoinBtn.classList.remove('selected');
  el.onlineFindBtn.classList.remove('selected');
  el.setupError.textContent = '';
  updateStepVisibility();
}

function selectOnlineChoice(choice){
  state.onlineChoice = choice;
  el.onlineCreateBtn.classList.toggle('selected', choice === 'create');
  el.onlineJoinBtn.classList.toggle('selected', choice === 'join');
  el.onlineFindBtn.classList.toggle('selected', choice === 'find');
  el.setupError.textContent = '';
  updateStepVisibility();
  if(choice === 'find') openLobby(); else closeLobby();
}

/* Central place that decides which setup fields are visible, based on
   the chosen mode (and, for online, whether creating or joining). */
function updateStepVisibility(){
  const { mode, onlineChoice } = state;

  el.stepName2.classList.toggle('hidden', mode !== 'vs');
  el.stepOnlineChoice.classList.toggle('hidden', mode !== 'online');
  el.stepJoinCode.classList.toggle('hidden', !(mode === 'online' && onlineChoice === 'join'));
  el.stepFindOpponent.classList.toggle('hidden', !(mode === 'online' && onlineChoice === 'find'));

  // Operations/pair-count/negatives/time-control: local modes always show
  // them; online only shows them once "Create Game" is chosen (a guest —
  // whether joining by code or by challenging from the lobby — inherits
  // whatever the host picked, so they don't choose anything).
  const showHostSettings = (mode === 'solo' || mode === 'vs') || (mode === 'online' && onlineChoice === 'create');
  el.stepOperations.classList.toggle('hidden', !showHostSettings);
  el.stepNegatives.classList.toggle('hidden', !showHostSettings);
  el.stepPairCount.classList.toggle('hidden', !showHostSettings);
  el.stepTimeControl.classList.toggle('hidden', !showHostSettings);

  // Start button: only appears once we know what it should do. "Find
  // Opponent" has no single submit action — each lobby row has its own
  // Challenge button — so the generic Start button stays hidden for it.
  const ready = mode === 'solo' || mode === 'vs' || (mode === 'online' && onlineChoice && onlineChoice !== 'find');
  el.startBtn.classList.toggle('hidden', !ready);
  if(mode === 'online'){
    el.startBtn.textContent = onlineChoice === 'join' ? 'Join Room' : 'Create Room';
  } else {
    el.startBtn.textContent = 'Start Game';
  }
}

function handlePrimaryButtonClick(){
  if(state.mode === 'online'){
    if(state.onlineChoice === 'create') handleCreateGame();
    else if(state.onlineChoice === 'join') handleJoinGame();
    return;
  }
  tryStartGame();
}

function tryStartGame(){
  state.missLog = [];
  const name1 = el.player1Name.value.trim();
  const name2 = el.player2Name.value.trim();

  if(!name1){
    el.setupError.textContent = 'Please enter your name.';
    return;
  }
  if(!state.mode){
    el.setupError.textContent = 'Please choose a game mode.';
    return;
  }
  if(state.mode === 'vs' && !name2){
    el.setupError.textContent = "Please enter your opponent's name.";
    return;
  }

  const selectedOps = Array.from(el.opChoices).filter(cb => cb.checked).map(cb => cb.dataset.op);
  if(selectedOps.length === 0){
    el.setupError.textContent = 'Please select at least one operation to practice.';
    return;
  }
  state.allowedOps = selectedOps;
  state.allowNegatives = el.allowNegatives.checked;

  state.timeControlSeconds = parseInt(el.timeControlSelect.value, 10);

  state.players = [{ name: name1, score: 0, timeRemaining: state.timeControlSeconds, correctCount: 0, wrongCount: 0 }];
  if(state.mode === 'vs'){
    state.players.push({ name: name2, score: 0, timeRemaining: state.timeControlSeconds, correctCount: 0, wrongCount: 0 });
    el.chipP2.classList.remove('hidden');
  } else {
    el.chipP2.classList.add('hidden');
  }
  state.currentPlayer = 0;

  el.chipP1Name.textContent = state.players[0].name;
  if(state.players[1]) el.chipP2Name.textContent = state.players[1].name;

  const timerOn = state.timeControlSeconds > 0;
  el.chipP1Timer.classList.toggle('hidden', !timerOn);
  el.chipP2Timer.classList.toggle('hidden', !timerOn || state.mode !== 'vs');

  state.totalPairs = parseInt(el.pairCountSelect.value, 10);
  state.pairIndex = 0;

  el.setupModal.classList.add('hidden');
  el.gameScreen.classList.remove('hidden');

  playSound('start');
  startNextPair();
  if(timerOn) startTimer();
}

function resetToSetup(){
  stopTimer();
  leaveOnlineRoom();
  stopSpectating(false);
  closeWatchList();
  closeLobby();
  el.teacherPinModal.classList.add('hidden');
  state.missLog = [];
  state.rematchFinalizing = false;
  el.reviewModal.classList.add('hidden');
  el.winnerModal.classList.add('hidden');
  el.waitingModal.classList.add('hidden');
  el.gameScreen.classList.add('hidden');
  el.setupModal.classList.remove('hidden');
  el.setupError.textContent = '';
  el.rematchBtn.disabled = false;
  el.rematchStatus.classList.add('hidden');
  el.rematchStatus.textContent = '';
  el.feedbackLine.textContent = '';
  el.feedbackLine.className = 'feedback-line';
  el.presenceBanner.classList.add('hidden');
  el.presenceBanner.textContent = '';
  el.rejoinBanner.classList.add('hidden');
  state.mode = null;
  state.onlineChoice = null;
  el.modeSolo.classList.remove('selected');
  el.modeVs.classList.remove('selected');
  el.modeOnline.classList.remove('selected');
  el.onlineCreateBtn.classList.remove('selected');
  el.onlineJoinBtn.classList.remove('selected');
  el.onlineFindBtn.classList.remove('selected');
  el.joinCodeInput.value = '';
  updateStepVisibility();
}

/* =========================================================
   Online play
   ========================================================= */

function leaveOnlineRoom(){
  clearSeat();
  if(state.unsubscribeRoom){
    state.unsubscribeRoom();
    state.unsubscribeRoom = null;
  }
  if(state.stopPresence){
    state.stopPresence();
    state.stopPresence = null;
  }
  stopOnlineTimerPoll();
  state.isOnline = false;
  state.roomCode = null;
  state.myRole = null;
  state.room = null;
  state.rematchFinalizing = false;
}

async function cancelWaiting(){
  // Only the host waits, and only before a guest has joined — safe to
  // delete the room outright rather than leave it lingering in the DB.
  if(state.roomCode){
    try { await remove(ref(db, 'rooms/' + state.roomCode)); } catch (e) { /* best-effort cleanup */ }
  }
  resetToSetup();
}

async function handleCreateGame(){
  const name1 = el.player1Name.value.trim();
  if(!name1){
    el.setupError.textContent = 'Please enter your name.';
    return;
  }
  const selectedOps = Array.from(el.opChoices).filter(cb => cb.checked).map(cb => cb.dataset.op);
  if(selectedOps.length === 0){
    el.setupError.textContent = 'Please select at least one operation to practice.';
    return;
  }

  const settings = {
    allowedOps: selectedOps,
    totalPairs: parseInt(el.pairCountSelect.value, 10),
    allowNegatives: el.allowNegatives.checked,
    timeControlSeconds: parseInt(el.timeControlSelect.value, 10),
  };

  el.startBtn.disabled = true;
  el.setupError.textContent = '';
  try{
    const code = await createRoom(name1, settings);
    state.isOnline = true;
    state.roomCode = code;
    state.myRole = 'host';
    state.mode = 'online';
    state.timeControlSeconds = 0;

    el.roomCodeDisplay.textContent = code;
    el.setupModal.classList.add('hidden');
    el.waitingModal.classList.remove('hidden');

    saveSeat(code, 'host', name1);
    state.stopPresence = trackPresence(code, 'host');
    state.unsubscribeRoom = listenToRoom(code, onRoomUpdate);
  } catch (err){
    el.setupError.textContent = 'Could not create a room. Please try again.';
    console.error(err);
  } finally {
    el.startBtn.disabled = false;
  }
}

async function handleJoinGame(){
  const name1 = el.player1Name.value.trim();
  const code = el.joinCodeInput.value.trim().toUpperCase();
  if(!name1){
    el.setupError.textContent = 'Please enter your name.';
    return;
  }
  if(code.length !== 4){
    el.setupError.textContent = 'Please enter the 4-character room code.';
    return;
  }

  el.startBtn.disabled = true;
  el.setupError.textContent = '';
  try{
    await joinRoom(code, name1);
    state.isOnline = true;
    state.roomCode = code;
    state.myRole = 'guest';
    state.mode = 'online';
    state.timeControlSeconds = 0;

    saveSeat(code, 'guest', name1);
    state.stopPresence = trackPresence(code, 'guest');
    state.unsubscribeRoom = listenToRoom(code, onRoomUpdate);
  } catch (err){
    el.setupError.textContent = err.message || 'Could not join that room.';
  } finally {
    el.startBtn.disabled = false;
  }
}

/* =========================================================
   "Find Opponent" lobby — browse currently-waiting rooms and challenge
   one instead of typing a code. Reuses the same listenToAllRooms() feed
   that powers the teacher's Watch Games list, filtered to just the
   still-open ones, and reuses joinRoom() itself (now transaction-backed —
   see online.js — so two people tapping Challenge on the same row within
   the same instant can't both win the seat).
   ========================================================= */

function openLobby(){
  if(!state.unsubscribeLobby){
    state.unsubscribeLobby = listenToAllRooms(renderLobby);
  }
  // The list only re-renders when a room actually changes in Firebase, so
  // without this a "waiting 1m ago" label would just sit there frozen for
  // as long as nothing else happens anywhere in /rooms. This ticks it
  // forward independent of that.
  if(!state.lobbyTickId){
    state.lobbyTickId = setInterval(() => {
      if(state.lastLobbyRooms) renderLobby(state.lastLobbyRooms);
    }, 30000);
  }
}

function closeLobby(){
  if(state.unsubscribeLobby){
    state.unsubscribeLobby();
    state.unsubscribeLobby = null;
  }
  if(state.lobbyTickId){
    clearInterval(state.lobbyTickId);
    state.lobbyTickId = null;
  }
  state.lastLobbyRooms = null;
}

function formatWaitingSince(createdAt){
  if(!createdAt) return 'just now';
  const mins = Math.round((Date.now() - createdAt) / 60000);
  return mins < 1 ? 'just now' : `waiting ${mins}m`;
}

function renderLobby(roomsObj){
  state.lastLobbyRooms = roomsObj;
  pruneStaleRooms(roomsObj).catch(() => { /* best-effort; next snapshot will retry */ });

  const rooms = Object.entries(roomsObj || {})
    .filter(([, room]) => room && room.status === 'waiting' && !isRoomStale(room))
    .sort(([, a], [, b]) => (a.createdAt || 0) - (b.createdAt || 0)); // longest-waiting first

  if(rooms.length === 0){
    el.lobbyList.innerHTML = '<p class="watch-empty">No one is waiting for an opponent right now.</p>';
    return;
  }

  el.lobbyList.innerHTML = rooms.map(([code, room]) => {
    const host = room.players?.host;
    if(!host) return ''; // malformed/partial room, skip defensively

    const opsLabel = (room.settings?.allowedOps || []).join(' ');
    const negLabel = room.settings?.allowNegatives ? ' \u00B7 negatives' : '';
    const timerLabel = room.settings?.timeControlSeconds > 0
      ? ` \u00B7 ${formatTime(room.settings.timeControlSeconds)}/turn`
      : '';

    return `
      <div class="watch-row">
        <div class="watch-row-info">
          <span class="watch-room-names">${host.name}</span>
          <span class="watch-room-progress">${opsLabel}${negLabel}${timerLabel} \u00B7 ${formatWaitingSince(room.createdAt)}</span>
        </div>
        <button class="secondary-btn watch-row-btn" data-room-code="${code}" type="button">Challenge</button>
      </div>`;
  }).join('');

  el.lobbyList.querySelectorAll('.watch-row-btn').forEach(btn => {
    btn.addEventListener('click', () => handleChallenge(btn.dataset.roomCode));
  });
}

async function handleChallenge(code){
  const name1 = el.player1Name.value.trim();
  if(!name1){
    el.setupError.textContent = 'Please enter your name.';
    return;
  }
  el.setupError.textContent = '';
  try{
    await joinRoom(code, name1);
    closeLobby();
    state.isOnline = true;
    state.roomCode = code;
    state.myRole = 'guest';
    state.mode = 'online';
    state.timeControlSeconds = 0;

    saveSeat(code, 'guest', name1);
    state.stopPresence = trackPresence(code, 'guest');
    state.unsubscribeRoom = listenToRoom(code, onRoomUpdate);
  } catch (err){
    // Someone else likely grabbed that seat first — the live listener
    // will already have dropped the room from the list by now, so just
    // surface why and let them pick someone else.
    el.setupError.textContent = err.message || 'Could not join that room — try another.';
  }
}

/* =========================================================
   Reconnection prompt — checked once at startup. Deliberately NOT
   automatic: silently dropping someone back into a game on page load
   would be surprising if they just wanted a clean start, so this only
   ever offers, never forces.
   ========================================================= */

function checkForRejoinableSeat(){
  const seat = loadSeat();
  if(!seat) return;

  if(Date.now() - seat.savedAt > REJOIN_WINDOW_MS){
    clearSeat(); // past the window — not worth even offering
    return;
  }

  el.rejoinBannerText.textContent = `You have an unfinished game in room ${seat.code} as ${seat.name}. Rejoin where you left off?`;
  el.rejoinBanner.classList.remove('hidden');
}

async function attemptRejoin(){
  const seat = loadSeat();
  if(!seat) return;

  el.rejoinBtn.disabled = true;
  try{
    const room = await getRoomOnce(seat.code);
    if(!room || !room.players?.[seat.role]){
      // Room's gone (finished long ago and got pruned, host cancelled
      // while waiting, etc.) — nothing to rejoin.
      clearSeat();
      el.rejoinBanner.classList.add('hidden');
      el.setupError.textContent = 'That game is no longer available.';
      return;
    }

    state.isOnline = true;
    state.roomCode = seat.code;
    state.myRole = seat.role;
    state.mode = 'online';
    state.timeControlSeconds = 0;

    el.rejoinBanner.classList.add('hidden');
    saveSeat(seat.code, seat.role, seat.name);
    state.stopPresence = trackPresence(seat.code, seat.role);
    state.unsubscribeRoom = listenToRoom(seat.code, onRoomUpdate);
  } catch (err){
    console.error('Rejoin failed:', err);
    el.setupError.textContent = 'Could not rejoin that game. Please try again.';
  } finally {
    el.rejoinBtn.disabled = false;
  }
}

/* Fires on every change to /rooms/{code} — for BOTH players symmetrically.
   Rather than each device mutating its own copy of the game state, Firebase
   is the single source of truth here: every snapshot fully replaces the
   locally-rendered state, and we just repaint from it. */
function onRoomUpdate(room){
  if(!room){
    // Room was deleted (e.g. host cancelled) — bail back to setup.
    if(state.isOnline) resetToSetup();
    return;
  }

  // Every update we actually receive means we're live right now — keep
  // the saved seat's timestamp current so "last confirmed connected"
  // reflects reality, not just the moment we first joined.
  if(state.isOnline) saveSeat(state.roomCode, state.myRole, room.players?.[state.myRole]?.name || '');

  const prevRoom = state.room; // snapshot from before this update, used only for sound diffing below
  state.room = room;
  state.problem = room.problem;
  state.layout = buildProblemLayout(room.problem);
  state.cells = state.layout.cells;
  state.cellIndex = room.cellIndex;
  state.pool = room.pool || [];
  state.pairIndex = room.pairIndex;
  state.missLog = room.missLog || [];
  state.totalPairs = room.settings.totalPairs;
  state.mode = 'vs'; // reuse the existing two-player rendering paths

  const hostP = room.players.host;
  const guestP = room.players.guest;
  state.players = guestP
    ? [
        { name: hostP.name, score: hostP.score, correctCount: hostP.correctCount, wrongCount: hostP.wrongCount },
        { name: guestP.name, score: guestP.score, correctCount: guestP.correctCount, wrongCount: guestP.wrongCount },
      ]
    : [{ name: hostP.name, score: hostP.score, correctCount: hostP.correctCount, wrongCount: hostP.wrongCount }];
  state.currentPlayer = room.turn === 'host' ? 0 : 1;

  // Shared milestone sounds: both devices receive this same update through
  // their own listener, so diffing prev-vs-new here fires them identically
  // for host and guest, regardless of which one triggered the change.
  // (Correct/wrong sounds are handled separately, immediately, at the
  // point of the click itself — see handleOnlineTileClick.)
  const prevGuestPresent = !!prevRoom?.players?.guest;
  if(!prevGuestPresent && guestP) playSound('start');
  if(prevRoom && room.pairIndex > prevRoom.pairIndex) playSound('next');
  if(prevRoom && prevRoom.status !== 'finished' && room.status === 'finished') playSound('winner');

  // A fresh game — either the very first one, or a rematch restarting a
  // finished room — must not carry over the previous game's last "Correct!
  // X +1" / "Not quite. X -1" message into the new board.
  const isFreshGameStart = (!prevGuestPresent && guestP) || (prevRoom && prevRoom.status === 'finished' && room.status !== 'finished');
  if(isFreshGameStart){
    el.feedbackLine.textContent = '';
    el.feedbackLine.className = 'feedback-line';
  }

  if(!guestP){
    el.roomCodeDisplay.textContent = state.roomCode;
    el.setupModal.classList.add('hidden');
    el.gameScreen.classList.add('hidden');
    el.waitingModal.classList.remove('hidden');
    return;
  }

  el.waitingModal.classList.add('hidden');

  const myIdx = state.myRole === 'host' ? 0 : 1;
  const hostConnected = room.presence?.host ? room.presence.host.connected !== false : true;
  const guestConnected = room.presence?.guest ? room.presence.guest.connected !== false : true;
  el.chipP1Name.textContent = hostP.name + (state.myRole === 'host' ? ' (You)' : '') + (hostConnected ? '' : ' \uD83D\uDD0C');
  el.chipP2Name.textContent = guestP.name + (state.myRole === 'guest' ? ' (You)' : '') + (guestConnected ? '' : ' \uD83D\uDD0C');
  el.chipP2.classList.remove('hidden');

  const timerOn = room.settings.timeControlSeconds > 0;
  el.chipP1Timer.classList.toggle('hidden', !timerOn);
  el.chipP2Timer.classList.toggle('hidden', !timerOn);

  // Presence: pause the clock fairly if my opponent's connection just
  // dropped (rather than letting time drain against someone who isn't
  // there), and resume it once they're back. Edge-triggered off the
  // prev-vs-new comparison, so this only fires on the actual transition
  // rather than writing on every unrelated room update. Whichever device
  // is still connected does this — the other one, by definition, can't.
  const opponentRole = state.myRole === 'host' ? 'guest' : 'host';
  const opponentConnected = opponentRole === 'host' ? hostConnected : guestConnected;
  const prevHostConnected = prevRoom?.presence?.host ? prevRoom.presence.host.connected !== false : true;
  const prevGuestConnected = prevRoom?.presence?.guest ? prevRoom.presence.guest.connected !== false : true;
  const prevOpponentConnected = opponentRole === 'host' ? prevHostConnected : prevGuestConnected;

  if(room.status === 'active'){
    if(timerOn && !opponentConnected && prevOpponentConnected && room.turnDeadline){
      const bankedActive = Math.max(0, (room.turnDeadline - Date.now()) / 1000);
      const activeRole = room.turn;
      submitRoomUpdate(state.roomCode, {
        timeRemaining: {
          host: activeRole === 'host' ? bankedActive : room.timeRemaining.host,
          guest: activeRole === 'guest' ? bankedActive : room.timeRemaining.guest,
        },
        turnDeadline: null,
      }).catch(() => { /* the other device's pause write, if any, still lands */ });
    } else if(timerOn && opponentConnected && !prevOpponentConnected && !room.turnDeadline){
      const activeRole = room.turn;
      submitRoomUpdate(state.roomCode, {
        turnDeadline: Date.now() + (room.timeRemaining[activeRole] || 0) * 1000,
      }).catch(() => {});
    }

    if(!opponentConnected){
      const opponentName = opponentRole === 'host' ? hostP.name : guestP.name;
      el.presenceBanner.textContent = `\u26A0\uFE0F ${opponentName} disconnected${timerOn ? ' — clock paused' : ''}`;
      el.presenceBanner.classList.remove('hidden');
    } else {
      el.presenceBanner.classList.add('hidden');
      el.presenceBanner.textContent = '';
    }
  } else {
    el.presenceBanner.classList.add('hidden');
  }

  if(room.status === 'finished'){
    showOnlineWinnerModal(room);
    updateRematchUI(room);

    // Only the host actually restarts the room, so two devices seeing
    // "both accepted" at once can't race each other into resetting it twice.
    const rematch = room.rematch || {};
    if(rematch.host && rematch.guest && state.myRole === 'host' && !state.rematchFinalizing){
      state.rematchFinalizing = true;
      resetRoomForRematch(state.roomCode, room.settings).catch(err => {
        console.error('Failed to start rematch:', err);
        state.rematchFinalizing = false;
      });
    }
    return;
  }

  // Reached once status is 'active' — including the moment a confirmed
  // rematch flips it back from 'finished', so make sure the winner modal
  // and its rematch UI don't linger on top of the fresh game screen.
  if(isFreshGameStart && prevRoom?.status === 'finished'){
    playSound('start');
  }
  el.winnerModal.classList.add('hidden');
  el.rematchStatus.classList.add('hidden');
  el.rematchStatus.textContent = '';
  el.rematchBtn.disabled = false;
  state.rematchFinalizing = false;

  if(timerOn){
    if(!state.onlineTimerPollId) startOnlineTimerPoll();
  } else {
    stopOnlineTimerPoll();
  }

  el.setupModal.classList.add('hidden');
  el.gameScreen.classList.remove('hidden');
  el.pairCounter.textContent = `Pair ${state.pairIndex} of ${state.totalPairs}`;

  renderProblem();
  renderPool();
  updateScoreChips();
  state.inputLocked = false; // safe to accept input now that we're in sync
}

function handleOnlineTileClick(tileId){
  if(state.inputLocked) return;
  const myIdx = state.myRole === 'host' ? 0 : 1;
  if(state.currentPlayer !== myIdx) return; // not your turn

  const tileIdx = state.pool.findIndex(t => t.id === tileId);
  if(tileIdx === -1) return;
  state.inputLocked = true;

  const tile = state.pool[tileIdx];
  const activeCell = state.cells[state.cellIndex];
  const isCorrect = tile.value === activeCell.correct;
  const player = state.players[myIdx];
  const tileEl = el.poolTray.querySelector(`.tile-btn[data-tile-id="${tileId}"]`);
  const myKey = state.myRole;
  const otherKey = myKey === 'host' ? 'guest' : 'host';
  const slotEls = document.querySelectorAll(`.cell-slot[data-cell-index="${state.cellIndex}"]`);

  const updates = {};

  if(isCorrect){
    playSound('correct');
    animateTileThrow(tileEl, slotEls[0], 'correct');
    slotEls.forEach(slotEl => {
      slotEl.textContent = tile.value;
      slotEl.classList.remove('active', 'pending');
      slotEl.classList.add('filled', 'drop-correct');
    });
    el.feedbackLine.textContent = `Correct! ${player.name} +1`;
    el.feedbackLine.className = 'feedback-line good';

    const newPool = state.pool.filter((_, i) => i !== tileIdx);
    const newCellIndex = state.cellIndex + 1;
    updates[`players/${myKey}/score`] = player.score + 1;
    updates[`players/${myKey}/correctCount`] = (state.room.players[myKey].correctCount || 0) + 1;
    updates.pool = newPool;
    updates.cellIndex = newCellIndex;
    updates.turn = otherKey;

    if(newCellIndex >= state.cells.length){
      if(state.pairIndex >= state.totalPairs){
        updates.status = 'finished';
      } else {
        const nextProblem = generateProblem(state.room.settings);
        const nextLayout = buildProblemLayout(nextProblem);
        updates.problem = nextProblem;
        updates.pool = buildPool(nextLayout.cells);
        updates.cellIndex = 0;
        updates.pairIndex = state.pairIndex + 1;
      }
    }
  } else {
    playSound('wrong');
    animateTileThrow(tileEl, slotEls[0], 'wrong');
    slotEls.forEach(slotEl => {
      slotEl.classList.add('drop-wrong');
      setTimeout(() => slotEl.classList.remove('drop-wrong'), 350);
    });
    el.feedbackLine.textContent = `Not quite. ${player.name} -1`;
    el.feedbackLine.className = 'feedback-line bad';

    updates[`players/${myKey}/score`] = player.score - 1;
    updates[`players/${myKey}/wrongCount`] = (state.room.players[myKey].wrongCount || 0) + 1;
    updates.missLog = [
      ...(state.room.missLog || []),
      {
        pairIndex: state.pairIndex,
        problem: { ...state.problem },
        cellLabel: activeCell.label,
        attempted: tile.value,
        correct: activeCell.correct,
        playerName: player.name,
      },
    ];
    updates.turn = otherKey;
  }

  // Rotate the chess clock: bank however much time I (the player who just
  // acted) had left, then start a fresh deadline for whoever's turn is next.
  if(state.room.settings.timeControlSeconds > 0 && state.room.turnDeadline){
    const now = Date.now();
    const myRemaining = Math.max(0, (state.room.turnDeadline - now) / 1000);
    updates[`timeRemaining/${myKey}`] = myRemaining;
    const otherRemaining = state.room.timeRemaining[otherKey];
    updates.turnDeadline = now + otherRemaining * 1000;
  }

  submitRoomUpdate(state.roomCode, updates).catch(err => {
    console.error('Failed to sync move:', err);
    state.inputLocked = false;
  });
  // state.inputLocked is released once the listener's onRoomUpdate fires
  // with the confirmed state (works for both the sender and the opponent).
}

/* =========================================================
   Time control — local (chess-clock style: only the active player's
   time counts down, paused whenever it's not their turn). See the
   "Online time control" section further down for the online version,
   which syncs via an absolute deadline instead of a local tick.
   ========================================================= */

function startTimer(){
  stopTimer(); // safety: never allow two intervals to stack
  updateTimerDisplay();
  state.timerId = setInterval(tickTimer, 1000);
}

function stopTimer(){
  if(state.timerId !== null){
    clearInterval(state.timerId);
    state.timerId = null;
  }
}

function tickTimer(){
  const player = state.players[state.currentPlayer];
  player.timeRemaining -= 1;

  if(player.timeRemaining <= 0){
    player.timeRemaining = 0;
    updateTimerDisplay();
    stopTimer();
    handleTimeOut(state.currentPlayer);
    return;
  }
  updateTimerDisplay();
}

function formatTime(totalSeconds){
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m + ':' + String(s).padStart(2, '0');
}

/* Accuracy = correct drops / total drops, as a whole-number percent.
   Returns 'N/A' if the player never attempted a single drop (e.g. they
   ran out of time before ever getting a turn), rather than a misleading 0%. */
function formatAccuracy(player){
  const correct = player.correctCount || 0;
  const wrong = player.wrongCount || 0;
  const total = correct + wrong;
  if(total === 0) return 'N/A';
  return Math.round((correct / total) * 100) + '%';
}

/* The most a player could have scored: every tap they personally made
   landing correct. Since score is +1/correct, -1/wrong, this is just
   their total tap count (correctCount + wrongCount) — score can never
   exceed it. Reused wherever we show "X pts" at game end so it becomes
   "X out of Y pts". */
function maxPossibleScore(player){
  return (player.correctCount || 0) + (player.wrongCount || 0);
}

function updateTimerDisplay(){
  if(state.timeControlSeconds <= 0) return;

  const p1 = state.players[0];
  el.chipP1Timer.textContent = formatTime(p1.timeRemaining);
  el.chipP1Timer.classList.toggle('time-low', p1.timeRemaining <= 10);

  if(state.players[1]){
    const p2 = state.players[1];
    el.chipP2Timer.textContent = formatTime(p2.timeRemaining);
    el.chipP2Timer.classList.toggle('time-low', p2.timeRemaining <= 10);
  }
}

/* A player hitting zero ends the game immediately. In vs mode the other
   player wins outright, regardless of score. In solo mode there's no
   opponent to award a win to, so it's just presented as time running out. */
function handleTimeOut(playerIndex){
  playSound('winner');
  el.gameScreen.classList.add('hidden');
  el.winnerModal.classList.remove('hidden');
  el.reviewMissedBtn.classList.toggle('hidden', state.missLog.length === 0);
  el.rematchStatus.classList.add('hidden');
  el.rematchStatus.textContent = '';
  el.rematchBtn.disabled = false;

  const timedOutPlayer = state.players[playerIndex];

  if(state.mode === 'solo'){
    el.winnerHeading.textContent = "Time's up!";
    el.winnerDetail.textContent = `${timedOutPlayer.name}, you ran out of time with a score of ${timedOutPlayer.score} out of ${maxPossibleScore(timedOutPlayer)} possible.\nAccuracy: ${formatAccuracy(timedOutPlayer)}`;
  } else {
    const winner = state.players[playerIndex === 0 ? 1 : 0];
    el.winnerHeading.textContent = `${winner.name} wins on time!`;
    el.winnerDetail.textContent = `${timedOutPlayer.name} ran out of time.\n${state.players[0].name}: ${state.players[0].score}/${maxPossibleScore(state.players[0])} pts, ${formatAccuracy(state.players[0])} accuracy\n${state.players[1].name}: ${state.players[1].score}/${maxPossibleScore(state.players[1])} pts, ${formatAccuracy(state.players[1])} accuracy`;
  }
}

/* =========================================================
   Online time control — deadline-based, not a locally-ticking
   counter, so the two devices can't drift apart from each other.
   Both devices poll independently, so a timeout still gets reported
   even if whoever ran out of time has gone quiet (closed tab, lost
   connection, etc.) — by design, their clock keeps running either way.
   ========================================================= */

function startOnlineTimerPoll(){
  stopOnlineTimerPoll(); // safety: never allow two intervals to stack
  tickOnlineTimer();
  state.onlineTimerPollId = setInterval(tickOnlineTimer, 500);
}

function stopOnlineTimerPoll(){
  if(state.onlineTimerPollId !== null){
    clearInterval(state.onlineTimerPollId);
    state.onlineTimerPollId = null;
  }
}

function tickOnlineTimer(){
  const room = state.room;
  if(!room || room.status !== 'active' || !room.turnDeadline) return;

  checkOnlineTimeout();
  if(!state.room || state.room.status !== 'active') return; // may have just finished

  const now = Date.now();
  const activeRole = room.turn;
  const inactiveRole = activeRole === 'host' ? 'guest' : 'host';
  const activeRemaining = Math.max(0, Math.ceil((room.turnDeadline - now) / 1000));
  const inactiveRemaining = Math.round(room.timeRemaining[inactiveRole]);

  const hostRemaining = activeRole === 'host' ? activeRemaining : inactiveRemaining;
  const guestRemaining = activeRole === 'guest' ? activeRemaining : inactiveRemaining;

  el.chipP1Timer.textContent = formatTime(hostRemaining);
  el.chipP1Timer.classList.toggle('time-low', hostRemaining <= 10);
  el.chipP2Timer.textContent = formatTime(guestRemaining);
  el.chipP2Timer.classList.toggle('time-low', guestRemaining <= 10);
}

/* Either device (the one whose turn it is, or the one waiting) can
   report a timeout — whichever notices first. Harmless if both happen
   to fire near-simultaneously: the update content would be identical. */
function checkOnlineTimeout(){
  const room = state.room;
  if(!room || room.status !== 'active' || !room.turnDeadline) return;
  if(Date.now() < room.turnDeadline) return;

  const timedOutRole = room.turn;
  submitRoomUpdate(state.roomCode, {
    status: 'finished',
    endReason: 'timeout',
    timedOutRole,
  }).catch(() => { /* if this device loses the race, the other device's report still lands */ });
}

function showOnlineWinnerModal(room){
  stopOnlineTimerPoll();
  el.gameScreen.classList.add('hidden');
  el.winnerModal.classList.remove('hidden');
  el.reviewMissedBtn.classList.toggle('hidden', state.missLog.length === 0);

  const { heading, detail } = getOnlineResultText(room);
  el.winnerHeading.textContent = heading;
  el.winnerDetail.textContent = detail;
}

/* Pure text-building for a finished online room — shared by the real
   players' winner modal above and the read-only spectator view below,
   so the tie/timeout/win phrasing only has to live in one place. */
function getOnlineResultText(room){
  const hostP = room.players.host;
  const guestP = room.players.guest;

  if(room.endReason === 'timeout'){
    const timedOutRole = room.timedOutRole;
    const timedOutPlayer = timedOutRole === 'host' ? hostP : guestP;
    const winner = timedOutRole === 'host' ? guestP : hostP;
    return {
      heading: `${winner.name} wins on time!`,
      detail: `${timedOutPlayer.name} ran out of time.\n${hostP.name}: ${hostP.score}/${maxPossibleScore(hostP)} pts, ${formatAccuracy(hostP)} accuracy\n${guestP.name}: ${guestP.score}/${maxPossibleScore(guestP)} pts, ${formatAccuracy(guestP)} accuracy`,
    };
  }

  if(hostP.score === guestP.score){
    const timerOn = room.settings.timeControlSeconds > 0;
    const hostTime = room.timeRemaining?.host;
    const guestTime = room.timeRemaining?.guest;
    if(timerOn && hostTime !== guestTime){
      const winner = hostTime > guestTime ? hostP : guestP;
      const loser = hostTime > guestTime ? guestP : hostP;
      const winnerTime = hostTime > guestTime ? hostTime : guestTime;
      const loserTime = hostTime > guestTime ? guestTime : hostTime;
      return {
        heading: `${winner.name} wins the tiebreaker!`,
        detail: `Tied at ${hostP.score} points — ${winner.name} had more time left.\n${winner.name}: ${winner.score}/${maxPossibleScore(winner)} pts, ${formatTime(Math.round(winnerTime))} remaining, ${formatAccuracy(winner)} accuracy\n${loser.name}: ${loser.score}/${maxPossibleScore(loser)} pts, ${formatTime(Math.round(loserTime))} remaining, ${formatAccuracy(loser)} accuracy`,
      };
    }
    return {
      heading: "It's a tie!",
      detail: `${hostP.name} and ${guestP.name} both scored ${hostP.score}.\n${hostP.name}: ${hostP.score}/${maxPossibleScore(hostP)} pts, ${formatAccuracy(hostP)} accuracy\n${guestP.name}: ${guestP.score}/${maxPossibleScore(guestP)} pts, ${formatAccuracy(guestP)} accuracy`,
    };
  }

  const winner = hostP.score > guestP.score ? hostP : guestP;
  const loser = hostP.score > guestP.score ? guestP : hostP;
  return {
    heading: `${winner.name} wins!`,
    detail: `${winner.name}: ${winner.score}/${maxPossibleScore(winner)} pts, ${formatAccuracy(winner)} accuracy\n${loser.name}: ${loser.score}/${maxPossibleScore(loser)} pts, ${formatAccuracy(loser)} accuracy`,
  };
}

/* Renders the accept/waiting/incoming states for the online rematch
   flow. room.rematch is {host: bool, guest: bool}; only present once
   a game has finished at least once, so it may be absent entirely. */
function updateRematchUI(room){
  const rematch = room.rematch || { host: false, guest: false };
  const myFlag = rematch[state.myRole];
  const otherRole = state.myRole === 'host' ? 'guest' : 'host';
  const otherFlag = rematch[otherRole];
  const otherPlayer = otherRole === 'host' ? room.players.host : room.players.guest;

  el.rematchBtn.disabled = myFlag;
  el.rematchStatus.classList.remove('hidden');

  if(myFlag && otherFlag){
    el.rematchStatus.textContent = 'Both ready — starting rematch...';
  } else if(myFlag && !otherFlag){
    el.rematchStatus.textContent = 'Waiting for opponent to accept...';
  } else if(!myFlag && otherFlag){
    el.rematchStatus.textContent = `${otherPlayer.name} wants a rematch!`;
  } else {
    el.rematchStatus.classList.add('hidden');
    el.rematchStatus.textContent = '';
  }
}

/* Play Again, for local modes: same players, names, and settings,
   just a clean scoreboard and a fresh first pair. */
function rematchLocal(){
  el.winnerModal.classList.add('hidden');
  el.reviewModal.classList.add('hidden');
  state.missLog = [];
  state.pairIndex = 0;
  state.currentPlayer = 0;
  state.players.forEach(p => {
    p.score = 0;
    p.correctCount = 0;
    p.wrongCount = 0;
    p.timeRemaining = state.timeControlSeconds;
  });
  updateScoreChips();

  const timerOn = state.timeControlSeconds > 0;
  el.chipP1Timer.classList.toggle('hidden', !timerOn);
  el.chipP2Timer.classList.toggle('hidden', !timerOn || state.mode !== 'vs');

  el.gameScreen.classList.remove('hidden');
  playSound('start');
  startNextPair();
  if(timerOn) startTimer();
}

function handleRematchClick(){
  if(state.isOnline){
    el.rematchBtn.disabled = true;
    requestRematch(state.roomCode, state.myRole).catch(err => {
      console.error('Failed to request rematch:', err);
      el.rematchBtn.disabled = false;
    });
  } else {
    rematchLocal();
  }
}

/* =========================================================
   Teacher spectator view — watch list + PIN gate

   Only Online games are watchable (Solo/Same Device never touch
   Firebase, so there's nothing shared to watch). This whole section
   never calls submitRoomUpdate — a spectator's tab must never be able
   to mutate a room, only read it via listenToRoom/listenToAllRooms.
   ========================================================= */

function submitTeacherPin(){
  if(el.teacherPinInput.value.trim() === TEACHER_PIN){
    el.teacherPinModal.classList.add('hidden');
    openWatchList();
  } else {
    el.teacherPinError.textContent = 'Incorrect PIN.';
  }
}

function openWatchList(){
  el.watchListModal.classList.remove('hidden');
  if(!state.unsubscribeRoomsList){
    state.unsubscribeRoomsList = listenToAllRooms(renderWatchList);
  }
}

function closeWatchList(){
  el.watchListModal.classList.add('hidden');
  if(state.unsubscribeRoomsList){
    state.unsubscribeRoomsList();
    state.unsubscribeRoomsList = null;
  }
}

function renderWatchList(roomsObj){
  pruneStaleRooms(roomsObj).catch(() => { /* best-effort; next snapshot will retry */ });

  const rooms = Object.entries(roomsObj || {})
    .filter(([, room]) => room && !isRoomStale(room) && (room.status === 'active' || room.status === 'waiting'))
    .sort(([, a], [, b]) => (b.createdAt || 0) - (a.createdAt || 0));

  if(rooms.length === 0){
    el.watchListBody.innerHTML = '<p class="watch-empty">No online games are currently being played.</p>';
    return;
  }

  el.watchListBody.innerHTML = rooms.map(([code, room]) => {
    const host = room.players?.host;
    const guest = room.players?.guest;
    if(!host) return ''; // malformed/partial room, skip defensively

    const hostConnected = room.presence?.host ? room.presence.host.connected !== false : true;
    const guestConnected = room.presence?.guest ? room.presence.guest.connected !== false : true;
    const hostLabel = host.name + (hostConnected ? '' : ' \uD83D\uDD0C');
    const guestLabel = guest ? guest.name + (guestConnected ? '' : ' \uD83D\uDD0C') : null;
    const names = guestLabel ? `${hostLabel} vs ${guestLabel}` : `${hostLabel} (waiting for opponent)`;
    const progress = room.status === 'active'
      ? `Pair ${room.pairIndex} of ${room.settings?.totalPairs ?? '?'}`
      : 'Not started yet';
    const scoreText = guest ? `${host.score} : ${guest.score}` : '';
    const watchable = room.status === 'active' && !!guest;

    return `
      <div class="watch-row">
        <div class="watch-row-info">
          <span class="watch-room-code">${code}</span>
          <span class="watch-room-names">${names}</span>
          <span class="watch-room-progress">${progress}${scoreText ? ' · ' + scoreText : ''}</span>
        </div>
        <button class="secondary-btn watch-row-btn" data-room-code="${code}" ${watchable ? '' : 'disabled'} type="button">${watchable ? 'Watch' : 'Waiting…'}</button>
      </div>`;
  }).join('');

  el.watchListBody.querySelectorAll('.watch-row-btn:not(:disabled)').forEach(btn => {
    btn.addEventListener('click', () => startSpectating(btn.dataset.roomCode));
  });
}

function startSpectating(code){
  closeWatchList(); // stop the all-rooms listener while focused on one room
  state.spectating = true;
  state.spectateRoomCode = code;
  state.spectateRoom = null;

  el.spectateBar.classList.remove('hidden');
  el.spectateRoomCodeLabel.textContent = code;
  el.poolLabel.textContent = 'Spectating — read only';
  el.setupModal.classList.add('hidden');
  el.gameScreen.classList.remove('hidden');

  state.unsubscribeSpectateRoom = listenToRoom(code, (room) => {
    if(!room){
      // Room vanished mid-watch (e.g. host cancelled) — bail back to the list.
      stopSpectating(true);
      return;
    }
    renderSpectatorRoom(room);
  });
}

function stopSpectating(backToList){
  if(state.unsubscribeSpectateRoom){
    state.unsubscribeSpectateRoom();
    state.unsubscribeSpectateRoom = null;
  }
  stopSpectatorTimerPoll();
  state.spectating = false;
  state.spectateRoomCode = null;
  state.spectateRoom = null;

  el.spectateBar.classList.add('hidden');
  el.gameScreen.classList.add('hidden');
  el.poolLabel.textContent = 'Tap a number for the glowing slot';
  el.presenceBanner.classList.add('hidden');
  el.presenceBanner.textContent = '';

  if(backToList){
    openWatchList();
  } else {
    el.setupModal.classList.remove('hidden');
  }
}

/* Repaints the shared game-screen from a watched room's snapshot. Reuses
   the same renderProblem()/renderPool()/updateScoreChips() as real play —
   renderPool() itself refuses to attach click handlers while
   state.spectating is true, so this can never accidentally submit a move. */
function renderSpectatorRoom(room){
  const prevRoom = state.spectateRoom;
  state.spectateRoom = room;
  state.problem = room.problem;
  state.layout = buildProblemLayout(room.problem);
  state.cells = state.layout.cells;
  state.cellIndex = room.cellIndex;
  state.pool = room.pool || [];
  state.pairIndex = room.pairIndex;
  state.totalPairs = room.settings.totalPairs;
  state.mode = 'vs'; // reuse the two-player rendering paths
  state.isOnline = false; // a spectator is never "online" in the interactive sense

  const hostP = room.players.host;
  const guestP = room.players.guest;
  state.players = guestP
    ? [
        { name: hostP.name, score: hostP.score, correctCount: hostP.correctCount, wrongCount: hostP.wrongCount },
        { name: guestP.name, score: guestP.score, correctCount: guestP.correctCount, wrongCount: guestP.wrongCount },
      ]
    : [{ name: hostP.name, score: hostP.score, correctCount: hostP.correctCount, wrongCount: hostP.wrongCount }];
  state.currentPlayer = room.turn === 'host' ? 0 : 1;

  const prevGuestPresent = !!prevRoom?.players?.guest;
  if(!prevGuestPresent && guestP) playSound('start');
  if(prevRoom && room.pairIndex > prevRoom.pairIndex) playSound('next');
  if(prevRoom && prevRoom.status !== 'finished' && room.status === 'finished') playSound('winner');

  const hostConnected = room.presence?.host ? room.presence.host.connected !== false : true;
  const guestConnected = room.presence?.guest ? room.presence.guest.connected !== false : true;
  el.chipP1Name.textContent = hostP.name + (hostConnected ? '' : ' \uD83D\uDD0C');
  el.chipP2Name.textContent = guestP ? guestP.name + (guestConnected ? '' : ' \uD83D\uDD0C') : 'Waiting…';
  el.chipP2.classList.toggle('hidden', !guestP);

  const timerOn = room.settings.timeControlSeconds > 0;
  el.chipP1Timer.classList.toggle('hidden', !timerOn);
  el.chipP2Timer.classList.toggle('hidden', !timerOn || !guestP);

  if(!guestP){
    stopSpectatorTimerPoll();
    el.pairCounter.textContent = 'Waiting for a second player…';
    el.problemStrip.innerHTML = '';
    el.poolTray.innerHTML = '';
    el.turnFlag.textContent = '';
    el.feedbackLine.textContent = '';
    el.presenceBanner.classList.add('hidden');
    updateScoreChips();
    return;
  }

  // Read-only mirror of the pause/resume signal in onRoomUpdate — this
  // never writes anything, it just reflects whatever the real players'
  // devices have already decided.
  if(room.status === 'active' && (!hostConnected || !guestConnected)){
    const goneNames = [!hostConnected && hostP.name, !guestConnected && guestP.name].filter(Boolean);
    const verb = goneNames.length > 1 ? 'have disconnected' : 'disconnected';
    el.presenceBanner.textContent = `\u26A0\uFE0F ${goneNames.join(' & ')} ${verb}${timerOn ? ' — clock paused' : ''}`;
    el.presenceBanner.classList.remove('hidden');
  } else {
    el.presenceBanner.classList.add('hidden');
  }

  if(room.status === 'finished'){
    stopSpectatorTimerPoll();
    const { heading, detail } = getOnlineResultText(room);
    el.pairCounter.textContent = 'Game over';
    renderProblem(); // shows the board as it stood at the final move
    el.turnFlag.textContent = heading;
    el.feedbackLine.textContent = detail.split('\n')[0];
    el.feedbackLine.className = 'feedback-line good';
    el.poolTray.innerHTML = '';
    el.presenceBanner.classList.add('hidden');
    updateScoreChips();
    return;
  }

  if(timerOn){
    if(!state.spectateTimerId) startSpectatorTimerPoll();
  } else {
    stopSpectatorTimerPoll();
  }

  el.pairCounter.textContent = `Pair ${state.pairIndex} of ${state.totalPairs}`;
  el.feedbackLine.textContent = '';
  el.feedbackLine.className = 'feedback-line';
  renderProblem();
  renderPool();
  updateScoreChips();
}

/* Display-only chess-clock poll for the spectator view — deliberately a
   separate, smaller function from tickOnlineTimer() rather than reusing
   it, because that one calls checkOnlineTimeout(), which can submit a
   room update. A spectator must never be able to end someone else's game. */
function startSpectatorTimerPoll(){
  stopSpectatorTimerPoll();
  tickSpectatorTimer();
  state.spectateTimerId = setInterval(tickSpectatorTimer, 500);
}

function stopSpectatorTimerPoll(){
  if(state.spectateTimerId !== null){
    clearInterval(state.spectateTimerId);
    state.spectateTimerId = null;
  }
}

function tickSpectatorTimer(){
  const room = state.spectateRoom;
  if(!room || room.status !== 'active' || !room.turnDeadline) return;

  const now = Date.now();
  const activeRole = room.turn;
  const inactiveRole = activeRole === 'host' ? 'guest' : 'host';
  const activeRemaining = Math.max(0, Math.ceil((room.turnDeadline - now) / 1000));
  const inactiveRemaining = Math.round(room.timeRemaining[inactiveRole]);

  const hostRemaining = activeRole === 'host' ? activeRemaining : inactiveRemaining;
  const guestRemaining = activeRole === 'guest' ? activeRemaining : inactiveRemaining;

  el.chipP1Timer.textContent = formatTime(hostRemaining);
  el.chipP1Timer.classList.toggle('time-low', hostRemaining <= 10);
  el.chipP2Timer.textContent = formatTime(guestRemaining);
  el.chipP2Timer.classList.toggle('time-low', guestRemaining <= 10);
}

/* =========================================================
   Round flow (local modes)
   ========================================================= */

function startNextPair(){
  state.pairIndex++;
  if(state.pairIndex > 1) playSound('next'); // the first pair is covered by the start sound instead
  state.problem = generateProblem({ allowedOps: state.allowedOps, allowNegatives: state.allowNegatives });
  state.layout = buildProblemLayout(state.problem);
  state.cells = state.layout.cells;
  state.cellIndex = 0;
  state.pool = buildPool(state.cells);
  state.inputLocked = false;

  el.pairCounter.textContent = `Pair ${state.pairIndex} of ${state.totalPairs}`;
  el.feedbackLine.textContent = '';
  el.feedbackLine.className = 'feedback-line';

  renderProblem();
  renderPool();
  updateScoreChips();
}

const fracHTML = (num, den) => `
  <div class="fraction-block">
    <span class="num">${num}</span>
    <span class="vinculum"></span>
    <span class="den">${den}</span>
  </div>`;

function cellHTML(i){
  const cell = state.cells[i];
  const status = i < state.cellIndex ? 'filled' : (i === state.cellIndex ? 'active' : 'pending');
  const display = i < state.cellIndex ? cell.correct : (i === state.cellIndex ? '?' : '\u2013');
  return `<div class="cell-slot ${status}" data-cell-index="${i}">${display}</div>`;
}

function partHTML(part){
  return part.type === 'cell' ? cellHTML(part.cellIndex) : `<span class="inline-op">${part.symbol}</span>`;
}

function renderProblem(){
  renderStackedLayout(state.layout);
}

function renderStackedLayout(layout){
  const { a, b, op, c, d } = state.problem;

  let html = `<div class="given-row">`;
  html += fracHTML(a, b);
  html += `<span class="operator-symbol">${op}</span>`;
  html += fracHTML(c, d);
  html += `</div>`;

  layout.rows.forEach(row => {
    html += `<div class="cross-row-wrap">`;
    if(row.caption){ html += `<div class="row-caption">${row.caption}</div>`; }
    html += `<div class="cross-row">`;
    html += `<span class="row-equals">=</span>`;

    if(row.kind === 'product'){
      html += `<div class="fraction-product">`;
      row.fractions.forEach((frac, idx) => {
        html += `<div class="cross-fraction">`;
        html += `<div class="row-numerator">${partHTML(frac.numerator)}</div>`;
        html += `<div class="row-line"></div>`;
        html += `<div class="row-denominator">${partHTML(frac.denominator)}</div>`;
        html += `</div>`;
        if(idx < row.fractions.length - 1){
          html += `<span class="inline-op">${row.operator}</span>`;
        }
      });
      html += `</div>`; // fraction-product
    } else if(row.kind === 'whole'){
      html += partHTML(row.value);
    } else {
      html += `<div class="cross-fraction">`;
      html += `<div class="row-numerator">${row.numerator.map(partHTML).join('')}</div>`;
      html += `<div class="row-line"></div>`;
      html += `<div class="row-denominator">${row.denominator.map(partHTML).join('')}</div>`;
      html += `</div>`;
    }

    html += `</div>`; // cross-row
    html += `</div>`; // cross-row-wrap
  });

  el.problemStrip.innerHTML = html;
  updateTurnFlag();
}

function renderPool(){
  el.poolTray.innerHTML = '';
  const myIdx = state.myRole === 'host' ? 0 : 1;
  const myTurn = !state.isOnline || state.currentPlayer === myIdx;

  state.pool.forEach(tile => {
    const btn = document.createElement('button');
    btn.className = 'tile-btn';
    btn.textContent = tile.value;
    btn.dataset.tileId = tile.id;
    if(state.spectating){
      // Read-only: no listener at all, not just a disabled attribute.
      btn.disabled = true;
    } else {
      if(state.isOnline && !myTurn) btn.disabled = true;
      btn.addEventListener('click', () => {
        if(state.isOnline) handleOnlineTileClick(tile.id);
        else handleTileClick(tile.id);
      });
    }
    el.poolTray.appendChild(btn);
  });
}

/* Removes just the one tapped tile from the DOM instead of rebuilding the
   whole tray. Rebuilding all buttons on every click risked a fresh button
   landing under the same finger/cursor position as the one just tapped,
   which some browsers register as a second click — advancing two cells
   for a single tap. (Online mode always does a full renderPool() via the
   Firebase listener instead, since updates there are already async.) */
function removeTileFromDOM(tileId){
  const btn = el.poolTray.querySelector(`.tile-btn[data-tile-id="${tileId}"]`);
  if(btn) btn.remove();
}

/* Purely cosmetic: spawns a floating clone of the tapped tile and arcs it
   toward the target box, then removes itself. Runs independently of the
   score/board update logic — it doesn't delay or gate anything else, so
   it can't reintroduce the double-click timing issue we fixed earlier.
   'correct' arcs in and shrinks into place; 'wrong' arcs partway, then
   bounces back and fades, echoing the box's own reject-shake. */
function animateTileThrow(tileEl, targetEl, variant){
  if(!tileEl || !targetEl) return;
  const startRect = tileEl.getBoundingClientRect();
  const endRect = targetEl.getBoundingClientRect();
  const computed = window.getComputedStyle(tileEl);

  const clone = document.createElement('div');
  clone.className = 'thrown-tile' + (variant === 'wrong' ? ' thrown-tile-wrong' : '');
  clone.textContent = tileEl.textContent;
  clone.style.left = startRect.left + 'px';
  clone.style.top = startRect.top + 'px';
  clone.style.width = startRect.width + 'px';
  clone.style.height = startRect.height + 'px';
  clone.style.fontSize = computed.fontSize;
  document.body.appendChild(clone);

  const dx = (endRect.left + endRect.width / 2) - (startRect.left + startRect.width / 2);
  const dy = (endRect.top + endRect.height / 2) - (startRect.top + startRect.height / 2);

  const keyframes = variant === 'wrong'
    ? [
        { transform: 'translate(0,0) scale(1)', offset: 0 },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 30}px) scale(1.05)`, offset: 0.45 },
        { transform: `translate(${dx * 0.85}px, ${dy * 0.85}px) scale(0.9)`, offset: 0.65 },
        { transform: `translate(${dx * 0.55}px, ${dy * 0.55 - 12}px) scale(0.7)`, opacity: 0, offset: 1 },
      ]
    : [
        { transform: 'translate(0,0) scale(1)', offset: 0 },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 40}px) scale(1.05)`, offset: 0.5 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.35)`, opacity: 0.85, offset: 1 },
      ];

  const anim = clone.animate(keyframes, {
    duration: variant === 'wrong' ? 420 : 380,
    easing: variant === 'wrong' ? 'ease-out' : 'ease-in',
  });
  anim.onfinish = () => clone.remove();
}

function updateScoreChips(){
  el.chipP1Score.textContent = state.players[0].score;
  if(state.players[1]) el.chipP2Score.textContent = state.players[1].score;

  el.chipP1.classList.toggle('active-turn', state.currentPlayer === 0);
  if(state.players[1]){
    el.chipP2.classList.toggle('active-turn', state.currentPlayer === 1);
  }
}

function updateTurnFlag(){
  if(state.isOnline){
    const myIdx = state.myRole === 'host' ? 0 : 1;
    if(state.currentPlayer === myIdx){
      el.turnFlag.textContent = 'Your turn!';
    } else {
      el.turnFlag.textContent = `Waiting for ${state.players[state.currentPlayer].name}...`;
    }
    return;
  }
  if(state.mode === 'vs'){
    el.turnFlag.textContent = `${state.players[state.currentPlayer].name}'s turn`;
  } else {
    el.turnFlag.textContent = '';
  }
}

/* =========================================================
   Tile interaction (local modes)
   ========================================================= */

function handleTileClick(tileId){
  if(state.inputLocked) return; // ignore any click while a previous one is still resolving
  const tileIdx = state.pool.findIndex(t => t.id === tileId);
  if(tileIdx === -1) return;
  state.inputLocked = true;

  const tile = state.pool[tileIdx];
  const activeCell = state.cells[state.cellIndex];
  const isCorrect = tile.value === activeCell.correct;
  const player = state.players[state.currentPlayer];
  const tileEl = el.poolTray.querySelector(`.tile-btn[data-tile-id="${tileId}"]`);
  // A cell index can appear in more than one box (e.g. the shared denominator),
  // so update every matching box, not just the first.
  const slotEls = document.querySelectorAll(`.cell-slot[data-cell-index="${state.cellIndex}"]`);

  if(isCorrect){
    playSound('correct');
    animateTileThrow(tileEl, slotEls[0], 'correct');
    player.score += 1;
    player.correctCount += 1;
    state.pool.splice(tileIdx, 1); // consume the tile
    removeTileFromDOM(tile.id);
    slotEls.forEach(slotEl => {
      slotEl.textContent = tile.value;
      slotEl.classList.remove('active', 'pending');
      slotEl.classList.add('filled', 'drop-correct');
    });

    el.feedbackLine.textContent = `Correct! ${player.name} +1`;
    el.feedbackLine.className = 'feedback-line good';

    state.cellIndex++;
    if(state.mode === 'vs') advanceTurn();

    if(state.cellIndex >= state.cells.length){
      setTimeout(finishPair, 700); // startNextPair()/showWinner() will unlock
      return;
    }
    setTimeout(() => { renderProblem(); state.inputLocked = false; }, 250);

  } else {
    playSound('wrong');
    animateTileThrow(tileEl, slotEls[0], 'wrong');
    player.score -= 1;
    player.wrongCount += 1;
    state.missLog.push({
      pairIndex: state.pairIndex,
      problem: { ...state.problem },
      cellLabel: activeCell.label,
      attempted: tile.value,
      correct: activeCell.correct,
      playerName: player.name,
    });
    // NOTE: wrong tiles stay in the pool. The same numeric value can be the
    // correct answer for more than one cell (e.g. denominators/cross terms
    // that repeat), so removing a tile just because it was wrong here could
    // strand a later cell with no matching tile left at all.

    slotEls.forEach(slotEl => {
      slotEl.classList.add('drop-wrong');
      setTimeout(() => slotEl.classList.remove('drop-wrong'), 350);
    });

    el.feedbackLine.textContent = `Not quite. ${player.name} -1`;
    el.feedbackLine.className = 'feedback-line bad';

    if(state.mode === 'vs') advanceTurn();
    state.inputLocked = false;
  }

  updateScoreChips();
  updateTurnFlag();
}

function advanceTurn(){
  state.currentPlayer = state.currentPlayer === 0 ? 1 : 0;
}

function finishPair(){
  if(state.pairIndex >= state.totalPairs){
    playSound('winner');
    showWinner();
  } else {
    startNextPair();
  }
}

/* =========================================================
   Winner modal
   ========================================================= */

/* Groups state.missLog (one entry per wrong drop) by which fraction pair
   it happened in, and renders one card per problem that had at least one
   mistake — reusing fracHTML so the problem itself renders exactly like
   it did on the real board. */
function renderMissedReview(){
  if(state.missLog.length === 0){
    el.reviewSummary.textContent = 'No missed steps — perfect game!';
    el.reviewList.innerHTML = '';
    return;
  }

  const groups = new Map();
  state.missLog.forEach(entry => {
    if(!groups.has(entry.pairIndex)) groups.set(entry.pairIndex, []);
    groups.get(entry.pairIndex).push(entry);
  });

  const problemCount = groups.size;
  const stepWord = state.missLog.length === 1 ? 'step' : 'steps';
  const problemWord = problemCount === 1 ? 'problem' : 'problems';
  el.reviewSummary.textContent = `${state.missLog.length} missed ${stepWord} across ${problemCount} ${problemWord}.`;

  const showPlayerTags = state.players.length > 1;

  let html = '';
  groups.forEach((entries) => {
    const { a, b, op, c, d } = entries[0].problem;
    html += `<div class="miss-card">`;
    html += `<div class="miss-problem">${fracHTML(a, b)}<span class="operator-symbol">${op}</span>${fracHTML(c, d)}</div>`;
    entries.forEach(entry => {
      html += `<div class="miss-step-line">`;
      html += `<span class="miss-label">${entry.cellLabel}</span>`;
      html += `<div class="miss-values">`;
      html += `<span class="miss-wrong">You answered ${entry.attempted}</span>`;
      html += `<span class="miss-correct">Correct: ${entry.correct}</span>`;
      if(showPlayerTags) html += `<span class="miss-player-tag">${entry.playerName}</span>`;
      html += `</div></div>`;
    });
    html += `</div>`;
  });
  el.reviewList.innerHTML = html;
}

function showWinner(){
  stopTimer();
  el.gameScreen.classList.add('hidden');
  el.winnerModal.classList.remove('hidden');
  el.reviewMissedBtn.classList.toggle('hidden', state.missLog.length === 0);
  el.rematchStatus.classList.add('hidden');
  el.rematchStatus.textContent = '';
  el.rematchBtn.disabled = false;

  if(state.mode === 'solo'){
    const p = state.players[0];
    el.winnerHeading.textContent = 'Nice work!';
    el.winnerDetail.textContent = `${p.name}, you finished with a score of ${p.score} out of ${maxPossibleScore(p)} possible.\nAccuracy: ${formatAccuracy(p)}`;
  } else {
    const [p1, p2] = state.players;
    let heading, detail;
    if(p1.score === p2.score){
      const timerOn = state.timeControlSeconds > 0;
      if(timerOn && p1.timeRemaining !== p2.timeRemaining){
        const winner = p1.timeRemaining > p2.timeRemaining ? p1 : p2;
        const loser = p1.timeRemaining > p2.timeRemaining ? p2 : p1;
        heading = `${winner.name} wins the tiebreaker!`;
        detail = `Tied at ${p1.score} points — ${winner.name} had more time left.\n${winner.name}: ${winner.score}/${maxPossibleScore(winner)} pts, ${formatTime(winner.timeRemaining)} remaining, ${formatAccuracy(winner)} accuracy\n${loser.name}: ${loser.score}/${maxPossibleScore(loser)} pts, ${formatTime(loser.timeRemaining)} remaining, ${formatAccuracy(loser)} accuracy`;
      } else {
        heading = "It's a tie!";
        detail = `${p1.name} and ${p2.name} both scored ${p1.score}.\n${p1.name}: ${p1.score}/${maxPossibleScore(p1)} pts, ${formatAccuracy(p1)} accuracy\n${p2.name}: ${p2.score}/${maxPossibleScore(p2)} pts, ${formatAccuracy(p2)} accuracy`;
      }
    } else {
      const winner = p1.score > p2.score ? p1 : p2;
      const loser = p1.score > p2.score ? p2 : p1;
      heading = `${winner.name} wins!`;
      detail = `${winner.name}: ${winner.score}/${maxPossibleScore(winner)} pts, ${formatAccuracy(winner)} accuracy\n${loser.name}: ${loser.score}/${maxPossibleScore(loser)} pts, ${formatAccuracy(loser)} accuracy`;
    }
    el.winnerHeading.textContent = heading;
    el.winnerDetail.textContent = detail;
  }
}
