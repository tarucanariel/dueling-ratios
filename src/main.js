import './style.css';
import { generateProblem, buildProblemLayout, buildPool } from './logic.js';
import { createRoom, joinRoom, listenToRoom, submitRoomUpdate } from './online.js';
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
  onlineChoice: null,    // 'create' | 'join'
  isOnline: false,
  roomCode: null,
  myRole: null,          // 'host' | 'guest'
  unsubscribeRoom: null,
  onlineTimerPollId: null, // setInterval handle for the online chess-clock poll
  missLog: [], // wrong-attempt records for the current game, for the post-game review
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
  stepJoinCode: document.getElementById('step-join-code'),
  joinCodeInput: document.getElementById('join-code-input'),

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
  playAgainBtn: document.getElementById('play-again-btn'),
  reviewMissedBtn: document.getElementById('review-missed-btn'),
  reviewModal: document.getElementById('review-modal'),
  closeReviewBtn: document.getElementById('close-review-btn'),
  reviewSummary: document.getElementById('review-summary'),
  reviewList: document.getElementById('review-list'),
};

/* =========================================================
   Setup screen wiring
   ========================================================= */

el.modeSolo.addEventListener('click', () => selectMode('solo'));
el.modeVs.addEventListener('click', () => selectMode('vs'));
el.modeOnline.addEventListener('click', () => selectMode('online'));
el.startBtn.addEventListener('click', handlePrimaryButtonClick);
el.playAgainBtn.addEventListener('click', resetToSetup);
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

updateStepVisibility(); // initial state: nothing mode-dependent shown until a mode is picked

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
  el.modeSolo.classList.toggle('selected', mode === 'solo');
  el.modeVs.classList.toggle('selected', mode === 'vs');
  el.modeOnline.classList.toggle('selected', mode === 'online');
  el.onlineCreateBtn.classList.remove('selected');
  el.onlineJoinBtn.classList.remove('selected');
  el.setupError.textContent = '';
  updateStepVisibility();
}

function selectOnlineChoice(choice){
  state.onlineChoice = choice;
  el.onlineCreateBtn.classList.toggle('selected', choice === 'create');
  el.onlineJoinBtn.classList.toggle('selected', choice === 'join');
  el.setupError.textContent = '';
  updateStepVisibility();
}

/* Central place that decides which setup fields are visible, based on
   the chosen mode (and, for online, whether creating or joining). */
function updateStepVisibility(){
  const { mode, onlineChoice } = state;

  el.stepName2.classList.toggle('hidden', mode !== 'vs');
  el.stepOnlineChoice.classList.toggle('hidden', mode !== 'online');
  el.stepJoinCode.classList.toggle('hidden', !(mode === 'online' && onlineChoice === 'join'));

  // Operations/pair-count/negatives/time-control: local modes always show
  // them; online only shows them once "Create Game" is chosen (the guest
  // inherits whatever the host picked, so they don't choose anything).
  const showHostSettings = (mode === 'solo' || mode === 'vs') || (mode === 'online' && onlineChoice === 'create');
  el.stepOperations.classList.toggle('hidden', !showHostSettings);
  el.stepNegatives.classList.toggle('hidden', !showHostSettings);
  el.stepPairCount.classList.toggle('hidden', !showHostSettings);
  el.stepTimeControl.classList.toggle('hidden', !showHostSettings);

  // Start button: only appears once we know what it should do.
  const ready = mode === 'solo' || mode === 'vs' || (mode === 'online' && onlineChoice);
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
  state.missLog = [];
  el.reviewModal.classList.add('hidden');
  el.winnerModal.classList.add('hidden');
  el.waitingModal.classList.add('hidden');
  el.gameScreen.classList.add('hidden');
  el.setupModal.classList.remove('hidden');
  el.setupError.textContent = '';
  state.mode = null;
  state.onlineChoice = null;
  el.modeSolo.classList.remove('selected');
  el.modeVs.classList.remove('selected');
  el.modeOnline.classList.remove('selected');
  el.onlineCreateBtn.classList.remove('selected');
  el.onlineJoinBtn.classList.remove('selected');
  el.joinCodeInput.value = '';
  updateStepVisibility();
}

/* =========================================================
   Online play
   ========================================================= */

function leaveOnlineRoom(){
  if(state.unsubscribeRoom){
    state.unsubscribeRoom();
    state.unsubscribeRoom = null;
  }
  stopOnlineTimerPoll();
  state.isOnline = false;
  state.roomCode = null;
  state.myRole = null;
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

    state.unsubscribeRoom = listenToRoom(code, onRoomUpdate);
  } catch (err){
    el.setupError.textContent = err.message || 'Could not join that room.';
  } finally {
    el.startBtn.disabled = false;
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

  if(!guestP){
    el.roomCodeDisplay.textContent = state.roomCode;
    el.setupModal.classList.add('hidden');
    el.gameScreen.classList.add('hidden');
    el.waitingModal.classList.remove('hidden');
    return;
  }

  el.waitingModal.classList.add('hidden');

  const myIdx = state.myRole === 'host' ? 0 : 1;
  el.chipP1Name.textContent = hostP.name + (state.myRole === 'host' ? ' (You)' : '');
  el.chipP2Name.textContent = guestP.name + (state.myRole === 'guest' ? ' (You)' : '');
  el.chipP2.classList.remove('hidden');

  const timerOn = room.settings.timeControlSeconds > 0;
  el.chipP1Timer.classList.toggle('hidden', !timerOn);
  el.chipP2Timer.classList.toggle('hidden', !timerOn);

  if(room.status === 'finished'){
    showOnlineWinnerModal(room);
    return;
  }

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

  const timedOutPlayer = state.players[playerIndex];

  if(state.mode === 'solo'){
    el.winnerHeading.textContent = "Time's up!";
    el.winnerDetail.textContent = `${timedOutPlayer.name}, you ran out of time with a score of ${timedOutPlayer.score}.\nAccuracy: ${formatAccuracy(timedOutPlayer)}`;
  } else {
    const winner = state.players[playerIndex === 0 ? 1 : 0];
    el.winnerHeading.textContent = `${winner.name} wins on time!`;
    el.winnerDetail.textContent = `${timedOutPlayer.name} ran out of time.\n${state.players[0].name}: ${state.players[0].score} pts, ${formatAccuracy(state.players[0])} accuracy\n${state.players[1].name}: ${state.players[1].score} pts, ${formatAccuracy(state.players[1])} accuracy`;
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

  const hostP = room.players.host;
  const guestP = room.players.guest;

  if(room.endReason === 'timeout'){
    const timedOutRole = room.timedOutRole;
    const timedOutPlayer = timedOutRole === 'host' ? hostP : guestP;
    const winner = timedOutRole === 'host' ? guestP : hostP;
    el.winnerHeading.textContent = `${winner.name} wins on time!`;
    el.winnerDetail.textContent = `${timedOutPlayer.name} ran out of time.\n${hostP.name}: ${hostP.score} pts, ${formatAccuracy(hostP)} accuracy\n${guestP.name}: ${guestP.score} pts, ${formatAccuracy(guestP)} accuracy`;
    return;
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
      el.winnerHeading.textContent = `${winner.name} wins the tiebreaker!`;
      el.winnerDetail.textContent = `Tied at ${hostP.score} points — ${winner.name} had more time left.\n${winner.name}: ${formatTime(Math.round(winnerTime))} remaining, ${formatAccuracy(winner)} accuracy\n${loser.name}: ${formatTime(Math.round(loserTime))} remaining, ${formatAccuracy(loser)} accuracy`;
    } else {
      el.winnerHeading.textContent = "It's a tie!";
      el.winnerDetail.textContent = `${hostP.name} and ${guestP.name} both scored ${hostP.score}.\n${hostP.name}: ${formatAccuracy(hostP)} accuracy\n${guestP.name}: ${formatAccuracy(guestP)} accuracy`;
    }
  } else {
    const winner = hostP.score > guestP.score ? hostP : guestP;
    const loser = hostP.score > guestP.score ? guestP : hostP;
    el.winnerHeading.textContent = `${winner.name} wins!`;
    el.winnerDetail.textContent = `${winner.name}: ${winner.score} pts, ${formatAccuracy(winner)} accuracy\n${loser.name}: ${loser.score} pts, ${formatAccuracy(loser)} accuracy`;
  }
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
    if(state.isOnline && !myTurn) btn.disabled = true;
    btn.addEventListener('click', () => {
      if(state.isOnline) handleOnlineTileClick(tile.id);
      else handleTileClick(tile.id);
    });
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

  if(state.mode === 'solo'){
    const p = state.players[0];
    el.winnerHeading.textContent = 'Nice work!';
    el.winnerDetail.textContent = `${p.name}, you finished with a score of ${p.score}.\nAccuracy: ${formatAccuracy(p)}`;
  } else {
    const [p1, p2] = state.players;
    let heading, detail;
    if(p1.score === p2.score){
      const timerOn = state.timeControlSeconds > 0;
      if(timerOn && p1.timeRemaining !== p2.timeRemaining){
        const winner = p1.timeRemaining > p2.timeRemaining ? p1 : p2;
        const loser = p1.timeRemaining > p2.timeRemaining ? p2 : p1;
        heading = `${winner.name} wins the tiebreaker!`;
        detail = `Tied at ${p1.score} points — ${winner.name} had more time left.\n${winner.name}: ${formatTime(winner.timeRemaining)} remaining, ${formatAccuracy(winner)} accuracy\n${loser.name}: ${formatTime(loser.timeRemaining)} remaining, ${formatAccuracy(loser)} accuracy`;
      } else {
        heading = "It's a tie!";
        detail = `${p1.name} and ${p2.name} both scored ${p1.score}.\n${p1.name}: ${formatAccuracy(p1)} accuracy\n${p2.name}: ${formatAccuracy(p2)} accuracy`;
      }
    } else {
      const winner = p1.score > p2.score ? p1 : p2;
      const loser = p1.score > p2.score ? p2 : p1;
      heading = `${winner.name} wins!`;
      detail = `${winner.name}: ${winner.score} pts, ${formatAccuracy(winner)} accuracy\n${loser.name}: ${loser.score} pts, ${formatAccuracy(loser)} accuracy`;
    }
    el.winnerHeading.textContent = heading;
    el.winnerDetail.textContent = detail;
  }
}
