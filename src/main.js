import './style.css';
import { generateProblem, buildProblemLayout, buildPool } from './logic.js';
import { createRoom, joinRoom, listenToRoom, listenToAllRooms, submitRoomUpdate, requestRematch, resetRoomForRematch, pruneStaleRooms, isRoomStale, trackPresence, getRoomOnce, REJOIN_WINDOW_MS, sendChallenge, acceptChallenge, clearChallenge, pruneStaleChallenges, CHALLENGE_TIMEOUT_MS } from './online.js';
import { TEACHER_EMAIL_DOMAIN, ADMIN_EMAIL } from './teacherConfig.js';
import { ref, remove } from 'firebase/database';
import { db, signInWithGoogle, signOutUser, recordGameResult, getPlayerStats, STATS_MODES, watchAuthState, isGoogleUser, submitFeedback, getAllFeedback, deleteFeedback, awardBadge } from './firebase.js';
import { BADGE_DEFS_BY_ID, checkGameEndBadges, checkStreakBadge, getNextBadgeProgress } from './badges.js';
import { createClass, getMyClasses, joinClass, leaveClass, renameClass, deleteClass, removeStudent, verifyClassMembership, MAX_CLASSES_PER_TEACHER } from './class.js';
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
  opTally: {}, // { '+': {correct,wrong}, '-': {...}, ... } — THIS game's own per-operation tally for the signed-in local player only (never an opponent or the computer), flushed to Firebase via recordMyStats() at game end for the operation-mastery badges. Reset at the same points missLog is (see trackOpTally() below).
  rematchFinalizing: false, // guards against the host double-triggering resetRoomForRematch
  difficulty: 'medium', // 'easy' | 'medium' | 'hard' — only meaningful when mode === 'computer'

  // Player identity — if set, this player signed in with Google rather
  // than typing a name. Persists across resetToSetup() (new rounds keep
  // the same signed-in identity) until they explicitly click "Not you?".
  googleUser: null, // null | { name, photoURL, email }
  myBadges: new Set(), // badge ids earned by the signed-in account — see badges.js and loadMyBadges()
  myStats: null, // full per-mode stats object for the signed-in account, cached so renderMyStatsBadges() can compute "up next" progress bars without re-threading stats through every call site — see openMyStats()/loadMyBadges()/recordMyStats()

  // "Find Opponent" lobby (browsing waiting rooms instead of typing a code)
  unsubscribeLobby: null,
  lobbyTickId: null,     // setInterval handle — re-renders "waiting Xm ago" even between snapshots
  lastLobbyRooms: null,  // most recent /rooms snapshot, reused by the tick above

  // Challenger's own "waiting for the host to respond" screen — separate
  // from the real unsubscribeRoom/onRoomUpdate pair above, since we're
  // not in the game yet and shouldn't touch game-rendering state while
  // just watching to see if we got accepted.
  challengeCode: null,
  challengeRequestId: null,
  challengeMyName: null,
  unsubscribeChallengeWatch: null,
  challengeTickId: null,    // setInterval handle for the visible countdown
  challengeTimeoutId: null, // setTimeout handle for the client-side auto-expire

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
  player1NameLabel: document.getElementById('player1-name-label'),
  googleDivider: document.getElementById('google-divider'),
  playerGoogleSigninBtn: document.getElementById('player-google-signin-btn'),
  googleSigninNote: document.getElementById('google-signin-note'),
  playerProfileChip: document.getElementById('player-profile-chip'),
  playerProfilePic: document.getElementById('player-profile-pic'),
  playerProfileName: document.getElementById('player-profile-name'),
  playerGoogleSignoutBtn: document.getElementById('player-google-signout-btn'),
  player2Name: document.getElementById('player2-name'),
  stepName2: document.getElementById('step-name2'),
  modeSolo: document.getElementById('mode-solo'),
  modeVs: document.getElementById('mode-vs'),
  modeComputer: document.getElementById('mode-computer'),
  modeOnline: document.getElementById('mode-online'),
  stepDifficulty: document.getElementById('step-difficulty'),
  difficultyChoices: document.querySelectorAll('.choice-btn[data-difficulty]'),
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
  feedbackFab: document.getElementById('feedback-fab'),
  feedbackModal: document.getElementById('feedback-modal'),
  closeFeedbackBtn: document.getElementById('close-feedback-btn'),
  feedbackFormView: document.getElementById('feedback-form-view'),
  feedbackThanksView: document.getElementById('feedback-thanks-view'),
  feedbackMessageInput: document.getElementById('feedback-message-input'),
  feedbackError: document.getElementById('feedback-error'),
  feedbackSubmitBtn: document.getElementById('feedback-submit-btn'),
  adminFeedbackBtn: document.getElementById('admin-feedback-btn'),
  adminFeedbackModal: document.getElementById('admin-feedback-modal'),
  closeAdminFeedbackBtn: document.getElementById('close-admin-feedback-btn'),
  adminFeedbackError: document.getElementById('admin-feedback-error'),
  adminFeedbackEmpty: document.getElementById('admin-feedback-empty'),
  adminFeedbackList: document.getElementById('admin-feedback-list'),
  adminFeedbackPagination: document.getElementById('admin-feedback-pagination'),
  adminFeedbackPrevBtn: document.getElementById('admin-feedback-prev-btn'),
  adminFeedbackNextBtn: document.getElementById('admin-feedback-next-btn'),
  adminFeedbackPageLabel: document.getElementById('admin-feedback-page-label'),  roomCodeDisplay: document.getElementById('room-code-display'),
  cancelWaitingBtn: document.getElementById('cancel-waiting-btn'),

  incomingChallenge: document.getElementById('incoming-challenge'),
  incomingChallengeText: document.getElementById('incoming-challenge-text'),
  acceptChallengeBtn: document.getElementById('accept-challenge-btn'),
  declineChallengeBtn: document.getElementById('decline-challenge-btn'),
  waitingError: document.getElementById('waiting-error'),

  challengePendingModal: document.getElementById('challenge-pending-modal'),
  challengePendingText: document.getElementById('challenge-pending-text'),
  challengePendingCountdown: document.getElementById('challenge-pending-countdown'),
  cancelChallengeBtn: document.getElementById('cancel-challenge-btn'),

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
  streakPopup: document.getElementById('streak-popup'),
  badgePopup: document.getElementById('badge-popup'),
  badgeTooltip: document.getElementById('badge-tooltip'),

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
  teacherPinError: document.getElementById('teacher-pin-error'),
  myStatsBtn: document.getElementById('my-stats-btn'),
  myStatsModal: document.getElementById('my-stats-modal'),
  myStatsSignedOut: document.getElementById('my-stats-signed-out'),
  myStatsSignedIn: document.getElementById('my-stats-signed-in'),
  myStatsError: document.getElementById('my-stats-error'),
  myStatsSigninBtn: document.getElementById('my-stats-signin-btn'),
  myStatsCloseBtn: document.getElementById('my-stats-close-btn'),
  myStatsProfilePic: document.getElementById('my-stats-profile-pic'),
  myStatsProfileName: document.getElementById('my-stats-profile-name'),
  myStatsBadgesGrid: document.getElementById('my-stats-badges-grid'),
  myStatsBadgesEmpty: document.getElementById('my-stats-badges-empty'),
  myStatsBadgeProgressSection: document.getElementById('my-stats-badge-progress-section'),
  myStatsBadgeProgressList: document.getElementById('my-stats-badge-progress-list'),
  myStatsTotalGames: document.getElementById('my-stats-total-games'),
  myStatsTotalAccuracy: document.getElementById('my-stats-total-accuracy'),
  myStatsSoloGames: document.getElementById('my-stats-solo-games'),
  myStatsSoloAccuracy: document.getElementById('my-stats-solo-accuracy'),
  myStatsSameDeviceGames: document.getElementById('my-stats-samedevice-games'),
  myStatsSameDeviceAccuracy: document.getElementById('my-stats-samedevice-accuracy'),
  myStatsVsComputerGames: document.getElementById('my-stats-vscomputer-games'),
  myStatsVsComputerAccuracy: document.getElementById('my-stats-vscomputer-accuracy'),
  myStatsOnlineGames: document.getElementById('my-stats-online-games'),
  myStatsOnlineAccuracy: document.getElementById('my-stats-online-accuracy'),
  myClassesBtn: document.getElementById('my-classes-btn'),
  myClassesModal: document.getElementById('my-classes-modal'),
  myClassesSignedOut: document.getElementById('my-classes-signed-out'),
  myClassesSignedIn: document.getElementById('my-classes-signed-in'),
  myClassesError: document.getElementById('my-classes-error'),
  myClassesSigninBtn: document.getElementById('my-classes-signin-btn'),
  myClassesCloseBtn: document.getElementById('my-classes-close-btn'),
  myClassesProfilePic: document.getElementById('my-classes-profile-pic'),
  myClassesProfileName: document.getElementById('my-classes-profile-name'),
  myClassHeading: document.getElementById('my-class-heading'),
  classTeacherSection: document.getElementById('class-teacher-section'),
  classNameInput: document.getElementById('class-name-input'),
  classCreateFields: document.getElementById('class-create-fields'),
  classCreateBtn: document.getElementById('class-create-btn'),
  classLimitNote: document.getElementById('class-limit-note'),
  classList: document.getElementById('class-list'),
  classStudentJoin: document.getElementById('class-student-join'),
  classRemovedNote: document.getElementById('class-removed-note'),
  classJoinCodeInput: document.getElementById('class-join-code-input'),
  classJoinBtn: document.getElementById('class-join-btn'),
  classStudentView: document.getElementById('class-student-view'),
  classStudentClassName: document.getElementById('class-student-class-name'),
  classStudentTeacherName: document.getElementById('class-student-teacher-name'),
  classLeaveBtn: document.getElementById('class-leave-btn'),
  classError: document.getElementById('class-error'),
  worksheetBtn: document.getElementById('worksheet-btn'),
  worksheetModal: document.getElementById('worksheet-modal'),
  wsOpAll: document.getElementById('ws-op-all'),
  wsOpChoices: document.querySelectorAll('.ws-op-choice'),
  wsAllowNegatives: document.getElementById('ws-allow-negatives'),
  wsProblemCount: document.getElementById('ws-problem-count'),
  wsError: document.getElementById('ws-error'),
  wsGenerateBtn: document.getElementById('ws-generate-btn'),
  wsCloseBtn: document.getElementById('ws-close-btn'),
  worksheetPrintRoot: document.getElementById('worksheet-print-root'),
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
   Player identity — optional Google sign-in as an alternative to typing
   a name. Available for every mode (solo/vs/online), since it's just
   the "Your name" field on step-name1. Anonymous play (typing a name)
   remains the default and always available — this is purely additive.

   Reuses the same signInWithGoogle()/signOutUser() from firebase.js as
   the teacher Watch Games gate. That's intentional: it's the same
   underlying Firebase Auth session either way, and nothing here makes
   any access decision based on the account — a player's Google sign-in
   never grants Watch Games access by itself (see handleTeacherGoogleSignIn,
   which independently checks the email domain regardless of how/why the
   user already happened to be signed in).
   ========================================================= */

function getMyName(){
  if(state.googleUser) return state.googleUser.name;
  return el.player1Name.value.trim();
}

/* Shared shape for state.googleUser, built from whatever Firebase Auth
   User object signInWithGoogle() resolved with — used by both the
   setup-screen sign-in and the My Stats sign-in, since they're the same
   underlying identity. */
function toGoogleUserRecord(user){
  return {
    uid: user.uid,
    name: user.displayName || (user.email ? user.email.split('@')[0] : 'Player'),
    photoURL: user.photoURL || '',
    email: user.email || '',
  };
}

/* Maps state.mode's internal values ('solo' | 'vs' | 'computer' | 'online')
   to the stats storage key — 'vs' displays as "Same Device" and
   'computer' as "vs Computer" in the My Stats table. */
function modeToStatsKey(mode){
  if(mode === 'vs') return 'sameDevice';
  if(mode === 'computer') return 'vsComputer';
  return mode;
}

/* Records a finished game against the signed-in player's persistent,
   per-mode stats (see firebase.js's recordGameResult). A no-op for
   anonymous players — by design, stats only exist for Google-signed-in
   accounts. Best-effort: a failed write just means this one game
   doesn't get counted, not a user-facing error, since it happens
   invisibly after the winner modal is already showing. */
/* Records a finished game against the signed-in player's persistent,
   per-mode stats (see firebase.js's recordGameResult), then checks
   whether that pushed any achievement badge over its threshold (see
   badges.js). A no-op for anonymous players — by design, stats (and
   therefore badges) only exist for Google-signed-in accounts.
   Best-effort throughout: a failure here just means this one game
   doesn't get counted / doesn't unlock a badge it otherwise would
   have, not a user-facing error, since it all happens invisibly after
   the winner modal is already showing.

   `hadTimeControl` is passed in explicitly by each caller rather than
   inferred here, since "was a timer on for this game" lives in a
   different place depending on mode: state.timeControlSeconds for
   local play, but state.room.settings.timeControlSeconds for online
   (online has its own fully-synced turn-clock system — see
   online.js's module comment — entirely separate from the local-only
   state.timeControlSeconds, which online forces to 0 and never
   actually uses for its own timer). Guessing from one shared variable
   here previously caused the Beat the Clock badge to silently never
   fire for online games even when a timer really was running. */
/* Increments state.opTally for the given operation symbol — called
   only for the signed-in local player's own answers (see call sites
   in handleTileClick/handleOnlineTileClick), never for a same-device
   opponent or the computer, same scoping as the streak-badge check
   right next to those calls.

   Known edge case: reconnecting mid-game to an online room resets
   opTally back to zero (see onRoomUpdate's `if(!prevRoom)`), so any
   operations answered before the disconnect won't count toward
   operation-mastery for that game. Same spirit as the app's existing
   "no disconnect/presence detection" limitation — acceptable for a
   classroom practice tool, not worth the complexity of persisting a
   mid-game tally to Firebase just to survive a reconnect. */
function trackOpTally(op, isCorrect){
  if(!state.opTally[op]) state.opTally[op] = { correct: 0, wrong: 0 };
  if(isCorrect) state.opTally[op].correct += 1;
  else state.opTally[op].wrong += 1;
}

async function recordMyStats(mode, correctCount, wrongCount, hadTimeControl){
  if(!state.googleUser) return;
  const uid = state.googleUser.uid;
  try{
    await recordGameResult(uid, modeToStatsKey(mode), correctCount || 0, wrongCount || 0, state.opTally);
    const freshStats = await getPlayerStats(uid);
    state.myBadges = new Set(Object.keys(freshStats.badges || {})); // in case another tab/session earned something since our last load
    state.myStats = freshStats;
    const newlyEarned = checkGameEndBadges(freshStats, state.myBadges, correctCount || 0, wrongCount || 0, !!hadTimeControl);
    await awardAndCelebrateBadges(newlyEarned);
  } catch(err){
    console.error('Failed to record game stats:', err);
  }
}

function updatePlayerIdentityUI(){
  const signedIn = !!state.googleUser;
  el.player1NameLabel.classList.toggle('hidden', signedIn);
  el.player1Name.classList.toggle('hidden', signedIn);
  el.googleDivider.classList.toggle('hidden', signedIn);
  el.playerGoogleSigninBtn.classList.toggle('hidden', signedIn);
  el.googleSigninNote.classList.toggle('hidden', signedIn);
  el.playerProfileChip.classList.toggle('hidden', !signedIn);
  updateFeedbackFabVisibility();
  el.adminFeedbackBtn.classList.toggle('hidden', !isAdminAccount());
  if(signedIn){
    el.playerProfileName.textContent = state.googleUser.name;
    if(state.googleUser.photoURL){
      el.playerProfilePic.src = state.googleUser.photoURL;
      el.playerProfilePic.classList.remove('hidden');
    } else {
      el.playerProfilePic.classList.add('hidden');
    }
    loadMyBadges(); // fire-and-forget — see loadMyBadges() below
  } else {
    state.myBadges = new Set();
    state.myStats = null;
    if(!el.myStatsModal.classList.contains('hidden')){
      renderMyStatsBadges(); // clear an already-open My Stats panel too, in the unlikely event someone signs out while it's open
    }
    if(!el.myClassesModal.classList.contains('hidden')){
      renderMyClassesPanel(); // flip an already-open My Classes modal back to its signed-out state too
    }
  }
}

async function handlePlayerGoogleSignIn(){
  el.setupError.textContent = '';
  el.playerGoogleSigninBtn.disabled = true;
  let user;
  try{
    user = await signInWithGoogle();
  } catch(err){
    if(err?.code !== 'auth/popup-closed-by-user' && err?.code !== 'auth/cancelled-popup-request'){
      el.setupError.textContent = 'Google sign-in failed. Please try again.';
    }
    return;
  } finally {
    el.playerGoogleSigninBtn.disabled = false;
  }
  state.googleUser = toGoogleUserRecord(user);
  updatePlayerIdentityUI();
}

async function handlePlayerGoogleSignOut(){
  try{ await signOutUser(); } catch(e) { /* best-effort */ }
  state.googleUser = null;
  updatePlayerIdentityUI();
}

/* Auto-restores a persisted Google session on page load (see
   watchAuthState()'s own comment in firebase.js for the full story).
   Also fires on ordinary sign-in/sign-out, which just harmlessly
   re-confirms state the explicit click handlers above already set —
   not a problem, just a bit redundant in those cases. Anonymous
   sessions (from ensureSignedIn(), used for online play) correctly
   don't trigger this, since isGoogleUser() filters them out. */
watchAuthState((user) => {
  if(isGoogleUser(user)){
    state.googleUser = toGoogleUserRecord(user);
  } else if(state.googleUser){
    state.googleUser = null;
  }
  updatePlayerIdentityUI();
});

/* =========================================================
   My Stats panel — shows persistent, cross-device stats for whichever
   Google account is signed in. Since state.googleUser is the same
   identity used for gameplay (see above), signing in here also fills
   in the player's name on the setup screen, and vice versa — there's
   only ever one "signed in as" state per tab, not a separate one for
   stats.
   ========================================================= */

function renderMyStatsPanel(){
  const signedIn = !!state.googleUser;
  el.myStatsSignedOut.classList.toggle('hidden', signedIn);
  el.myStatsSignedIn.classList.toggle('hidden', !signedIn);
  if(!signedIn) return;

  el.myStatsProfileName.textContent = state.googleUser.name;
  if(state.googleUser.photoURL){
    el.myStatsProfilePic.src = state.googleUser.photoURL;
    el.myStatsProfilePic.classList.remove('hidden');
  } else {
    el.myStatsProfilePic.classList.add('hidden');
  }
  renderMyStatsBadges(); // whatever's already cached — openMyStats() below refreshes this against Firebase right after
}

/* Formats one mode's numbers into a { games, accuracy } pair for the
   table — shared by each mode row and the "All Modes" total row (which
   just gets pre-summed counts passed in instead of a single mode's). */
function formatStatsRow(gamesPlayed, correctCount, wrongCount){
  const total = correctCount + wrongCount;
  return {
    games: gamesPlayed || 0,
    accuracy: total === 0 ? 'N/A' : Math.round((correctCount / total) * 100) + '%',
  };
}

/* Sums a getPlayerStats() result across all 4 modes — used for the "All
   Modes" row here, and reused by the class roster (a teacher's roster
   only needs one overall number per student, not a full per-mode
   breakdown for every row). */
function sumAllModes(stats){
  let games = 0, correct = 0, wrong = 0;
  STATS_MODES.forEach((modeKey) => {
    games += stats[modeKey].gamesPlayed;
    correct += stats[modeKey].correctCount;
    wrong += stats[modeKey].wrongCount;
  });
  return formatStatsRow(games, correct, wrong);
}

/* Re-checks the three cumulative-threshold badge families (persistence,
   accuracy, lifetime) against freshly-loaded stats and awards +
   celebrates any that are already numerically satisfied but not yet
   recorded as earned. Run every time stats are loaded (not just at
   game-end) so a badge that narrowly missed being caught right when
   its threshold was first crossed — e.g. a rare timing gap between a
   Firebase write and the very next read — gets picked up the next
   time the player simply opens My Stats, instead of staying stuck
   until another game happens to re-trigger the check. Passes 0/false
   for the per-game-only args (perfect-game, beat-the-clock) since
   those describe a single just-finished game, not a running total,
   and aren't meaningful here. */
async function checkAndAwardCatchUpBadges(stats){
  const newlyEarned = checkGameEndBadges(stats, state.myBadges, 0, 0, false);
  if(newlyEarned.length > 0) await awardAndCelebrateBadges(newlyEarned);
}

async function openMyStats(){
  el.myStatsError.textContent = '';
  el.myStatsModal.classList.remove('hidden');
  renderMyStatsPanel();
  if(!state.googleUser) return;

  [
    el.myStatsTotalGames, el.myStatsTotalAccuracy,
    el.myStatsSoloGames, el.myStatsSoloAccuracy,
    el.myStatsSameDeviceGames, el.myStatsSameDeviceAccuracy,
    el.myStatsVsComputerGames, el.myStatsVsComputerAccuracy,
    el.myStatsOnlineGames, el.myStatsOnlineAccuracy,
  ].forEach(cell => { cell.textContent = '\u2026'; });

  try{
    const stats = await getPlayerStats(state.googleUser.uid);
    state.myBadges = new Set(Object.keys(stats.badges || {}));
    state.myStats = stats;
    await checkAndAwardCatchUpBadges(stats);
    renderMyStatsBadges();

    const solo = formatStatsRow(stats.solo.gamesPlayed, stats.solo.correctCount, stats.solo.wrongCount);
    const sameDevice = formatStatsRow(stats.sameDevice.gamesPlayed, stats.sameDevice.correctCount, stats.sameDevice.wrongCount);
    const vsComputer = formatStatsRow(stats.vsComputer.gamesPlayed, stats.vsComputer.correctCount, stats.vsComputer.wrongCount);
    const online = formatStatsRow(stats.online.gamesPlayed, stats.online.correctCount, stats.online.wrongCount);
    const total = sumAllModes(stats);

    el.myStatsTotalGames.textContent = total.games;
    el.myStatsTotalAccuracy.textContent = total.accuracy;
    el.myStatsSoloGames.textContent = solo.games;
    el.myStatsSoloAccuracy.textContent = solo.accuracy;
    el.myStatsSameDeviceGames.textContent = sameDevice.games;
    el.myStatsSameDeviceAccuracy.textContent = sameDevice.accuracy;
    el.myStatsVsComputerGames.textContent = vsComputer.games;
    el.myStatsVsComputerAccuracy.textContent = vsComputer.accuracy;
    el.myStatsOnlineGames.textContent = online.games;
    el.myStatsOnlineAccuracy.textContent = online.accuracy;
  } catch(err){
    el.myStatsError.textContent = 'Could not load your stats. Please try again.';
    console.error(err);
  }
}

/* =========================================================
   My Classes — its own modal, opened from the "My Classes" chip on the
   opening screen (previously this content lived inside My Stats). Which
   of the sub-blocks shows depends only on the signed-in account's email
   domain (the same TEACHER_EMAIL_DOMAIN check the Watch Games gate
   already uses) and, for players, whether they're currently in a class
   at all.
   ========================================================= */

async function openMyClasses(){
  el.myClassesError.textContent = '';
  el.myClassesModal.classList.remove('hidden');
  renderMyClassesPanel();
  if(!state.googleUser) return;

  try{
    const stats = await getPlayerStats(state.googleUser.uid);
    await renderClassSection(stats);
  } catch(err){
    el.myClassesError.textContent = 'Could not load your classes. Please try again.';
    console.error(err);
  }
}

function renderMyClassesPanel(){
  const signedIn = !!state.googleUser;
  el.myClassesSignedOut.classList.toggle('hidden', signedIn);
  el.myClassesSignedIn.classList.toggle('hidden', !signedIn);
  if(!signedIn) return;

  el.myClassesProfileName.textContent = state.googleUser.name;
  if(state.googleUser.photoURL){
    el.myClassesProfilePic.src = state.googleUser.photoURL;
    el.myClassesProfilePic.classList.remove('hidden');
  } else {
    el.myClassesProfilePic.classList.add('hidden');
  }
}

async function handleMyClassesSignIn(){
  el.myClassesError.textContent = '';
  el.myClassesSigninBtn.disabled = true;
  let user;
  try{
    user = await signInWithGoogle();
  } catch(err){
    if(err?.code !== 'auth/popup-closed-by-user' && err?.code !== 'auth/cancelled-popup-request'){
      el.myClassesError.textContent = 'Google sign-in failed. Please try again.';
    }
    return;
  } finally {
    el.myClassesSigninBtn.disabled = false;
  }
  state.googleUser = toGoogleUserRecord(user);
  updatePlayerIdentityUI(); // this sign-in doubles as the setup screen's identity too
  openMyClasses(); // re-render now signed in, and fetch the actual classes
}

function isTeacherAccount(){
  const email = (state.googleUser?.email || '').toLowerCase();
  return email.endsWith('@' + TEACHER_EMAIL_DOMAIN);
}

function isAdminAccount(){
  const email = (state.googleUser?.email || '').toLowerCase();
  return email === ADMIN_EMAIL.toLowerCase();
}

async function renderClassSection(myStats){
  el.classError.textContent = '';
  el.classTeacherSection.classList.add('hidden');
  el.classStudentJoin.classList.add('hidden');
  el.classStudentView.classList.add('hidden');
  el.classRemovedNote.classList.add('hidden');
  el.myClassHeading.textContent = isTeacherAccount() ? 'My Classes' : 'My Class';

  if(isTeacherAccount()){
    el.classTeacherSection.classList.remove('hidden');
    let classes;
    try{
      classes = await getMyClasses(state.googleUser.uid);
    } catch(err){
      el.classError.textContent = 'Could not load your classes.';
      console.error(err);
      return;
    }
    el.classNameInput.value = '';
    const atLimit = classes.length >= MAX_CLASSES_PER_TEACHER;
    el.classCreateFields.classList.toggle('hidden', atLimit);
    el.classCreateBtn.disabled = atLimit;
    el.classNameInput.disabled = atLimit;
    el.classLimitNote.classList.toggle('hidden', !atLimit);
    await renderClassList(classes);
  } else if(myStats.classTeacherUid){
    // A class the student's playerStats points at may have been deleted,
    // or the teacher may have removed just this student from its roster,
    // since the last time this loaded — check before trusting the cached
    // className/classTeacherName on myStats.
    let stillMember;
    try{
      stillMember = await verifyClassMembership(state.googleUser.uid, myStats.classTeacherUid, myStats.classId);
    } catch(err){
      // Can't verify (e.g. offline) — fail open and show the cached view
      // rather than bouncing the student to the join screen incorrectly.
      console.error('Could not verify class membership:', err);
      stillMember = true;
    }
    if(!stillMember){
      el.classStudentJoin.classList.remove('hidden');
      el.classRemovedNote.classList.remove('hidden');
      return;
    }
    el.classStudentView.classList.remove('hidden');
    el.classStudentClassName.textContent = myStats.className || 'a class';
    el.classStudentTeacherName.textContent = myStats.classTeacherName || 'your teacher';
  } else {
    el.classStudentJoin.classList.remove('hidden');
  }
}

// Which class's roster is currently showing in the nav — module-level so
// it survives across renders (e.g. after a student's stats change) and so
// switching tabs doesn't need a fresh Firebase fetch. Reset to null
// whenever the signed-in account changes (see renderClassSection).
let selectedClassId = null;

async function renderClassList(classes){
  el.classList.innerHTML = '';
  if(classes.length === 0){
    selectedClassId = null;
    return;
  }

  // Fall back to the first class if nothing's selected yet, or the
  // previously-selected class no longer exists (e.g. this teacher's list
  // just changed).
  if(!selectedClassId || !classes.some((c) => c.classId === selectedClassId)){
    selectedClassId = classes[0].classId;
  }

  const nav = document.createElement('div');
  nav.className = 'class-nav';
  nav.setAttribute('role', 'tablist');
  classes.forEach((cls) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'class-nav-tab';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(cls.classId === selectedClassId));
    tab.classList.toggle('active', cls.classId === selectedClassId);
    tab.textContent = cls.name || 'Untitled Class';
    tab.addEventListener('click', () => {
      if(selectedClassId === cls.classId) return;
      selectedClassId = cls.classId;
      renderClassList(classes); // reuses the already-fetched roster data
    });
    nav.appendChild(tab);
  });
  el.classList.appendChild(nav);

  const selectedClass = classes.find((c) => c.classId === selectedClassId);
  await renderClassCard(selectedClass);
}

/* Small stroke-style icons for the class-card action buttons (rename,
   delete, remove student) — icon-only with a title/aria-label carrying
   the meaning, rather than visible text labels. currentColor so they
   inherit the button's own color/hover states from CSS. */
const ICON_PENCIL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>`;
const ICON_TRASH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`;
const ICON_USER_MINUS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="23" y1="11" x2="17" y2="11"></line></svg>`;
const ICON_CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

async function renderClassCard(cls){
  const card = document.createElement('div');
  card.className = 'class-card';

  const header = document.createElement('div');
  header.className = 'class-card-header';

  const nameWrap = document.createElement('span');
  nameWrap.className = 'class-card-name-wrap';
  const nameSpan = document.createElement('span');
  nameSpan.className = 'class-card-name';
  nameSpan.textContent = cls.name || 'Untitled Class';
  const renameBtn = document.createElement('button');
  renameBtn.type = 'button';
  renameBtn.className = 'class-icon-btn class-rename-btn';
  renameBtn.innerHTML = ICON_PENCIL;
  renameBtn.title = 'Rename';
  renameBtn.setAttribute('aria-label', `Rename ${cls.name || 'Untitled Class'}`);
  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'class-icon-btn class-rename-btn class-delete-btn';
  deleteBtn.innerHTML = ICON_TRASH;
  deleteBtn.title = 'Delete';
  deleteBtn.setAttribute('aria-label', `Delete ${cls.name || 'Untitled Class'}`);
  nameWrap.append(nameSpan, renameBtn, deleteBtn);

  const codeWrap = document.createElement('span');
  codeWrap.className = 'class-card-code';
  codeWrap.append('Code: ');
  const codeValue = document.createElement('span');
  codeValue.className = 'class-code-value';
  codeValue.textContent = cls.joinCode;
  codeWrap.appendChild(codeValue);
  header.append(nameWrap, codeWrap);
  card.appendChild(header);

  const renameRow = document.createElement('div');
  renameRow.className = 'class-rename-row hidden';
  const renameInput = document.createElement('input');
  renameInput.type = 'text';
  renameInput.maxLength = 40;
  renameInput.className = 'class-rename-input';
  renameInput.placeholder = 'e.g. Grade 7 - Section A';
  const renameSaveBtn = document.createElement('button');
  renameSaveBtn.type = 'button';
  renameSaveBtn.className = 'secondary-btn class-rename-save';
  renameSaveBtn.textContent = 'Save';
  const renameCancelBtn = document.createElement('button');
  renameCancelBtn.type = 'button';
  renameCancelBtn.className = 'text-link-btn class-rename-cancel';
  renameCancelBtn.textContent = 'Cancel';
  const renameError = document.createElement('p');
  renameError.className = 'setup-error class-rename-error';
  renameRow.append(renameInput, renameSaveBtn, renameCancelBtn, renameError);
  card.appendChild(renameRow);

  const deleteRow = document.createElement('div');
  deleteRow.className = 'class-rename-row hidden';
  const deleteWarning = document.createElement('p');
  deleteWarning.className = 'class-delete-warning';
  deleteWarning.textContent = `Delete "${cls.name || 'Untitled Class'}"? This can't be undone.`;
  const deleteConfirmBtn = document.createElement('button');
  deleteConfirmBtn.type = 'button';
  deleteConfirmBtn.className = 'secondary-btn class-delete-confirm';
  deleteConfirmBtn.textContent = 'Delete Class';
  const deleteCancelBtn = document.createElement('button');
  deleteCancelBtn.type = 'button';
  deleteCancelBtn.className = 'text-link-btn class-rename-cancel';
  deleteCancelBtn.textContent = 'Cancel';
  const deleteError = document.createElement('p');
  deleteError.className = 'setup-error class-rename-error';
  deleteRow.append(deleteWarning, deleteConfirmBtn, deleteCancelBtn, deleteError);
  card.appendChild(deleteRow);

  function openRenameRow(){
    deleteRow.classList.add('hidden');
    deleteError.textContent = '';
    renameError.textContent = '';
    renameInput.value = cls.name || '';
    renameRow.classList.remove('hidden');
    renameInput.focus();
    renameInput.select();
  }
  function closeRenameRow(){
    renameRow.classList.add('hidden');
    renameError.textContent = '';
  }
  async function saveRename(){
    const newName = renameInput.value.trim();
    if(!newName){
      renameError.textContent = 'Please enter a class name.';
      return;
    }
    if(newName === cls.name){
      closeRenameRow();
      return;
    }
    renameSaveBtn.disabled = true;
    try{
      await renameClass(state.googleUser.uid, cls.classId, cls.joinCode, newName);
      const stats = await getPlayerStats(state.googleUser.uid);
      await renderClassSection(stats); // refetches + re-renders nav & card with the new name
    } catch(err){
      renameError.textContent = 'Could not rename the class. Please try again.';
      console.error(err);
      renameSaveBtn.disabled = false;
    }
  }

  function openDeleteRow(){
    renameRow.classList.add('hidden');
    renameError.textContent = '';
    deleteError.textContent = '';
    deleteRow.classList.remove('hidden');
  }
  function closeDeleteRow(){
    deleteRow.classList.add('hidden');
    deleteError.textContent = '';
  }
  async function confirmDelete(){
    deleteConfirmBtn.disabled = true;
    try{
      await deleteClass(state.googleUser.uid, cls.classId, cls.joinCode);
      selectedClassId = null; // this class is gone — renderClassList falls back to the next one
      const stats = await getPlayerStats(state.googleUser.uid);
      await renderClassSection(stats);
    } catch(err){
      deleteError.textContent = 'Could not delete the class. Please try again.';
      console.error(err);
      deleteConfirmBtn.disabled = false;
    }
  }

  renameBtn.addEventListener('click', openRenameRow);
  renameCancelBtn.addEventListener('click', closeRenameRow);
  renameSaveBtn.addEventListener('click', saveRename);
  renameInput.addEventListener('keydown', (e) => {
    if(e.key === 'Enter') saveRename();
    if(e.key === 'Escape') closeRenameRow();
  });

  deleteBtn.addEventListener('click', openDeleteRow);
  deleteCancelBtn.addEventListener('click', closeDeleteRow);
  deleteConfirmBtn.addEventListener('click', confirmDelete);

  const table = document.createElement('table');
  table.className = 'stats-table';
  table.innerHTML = '<thead><tr><th>Student</th><th>Games</th><th>Accuracy</th><th></th></tr></thead><tbody></tbody>';
  const tbody = table.querySelector('tbody');
  card.appendChild(table);

  const emptyNote = document.createElement('p');
  emptyNote.className = 'field-note';
  emptyNote.textContent = 'No students have joined yet — share the code above.';
  emptyNote.classList.toggle('hidden', cls.students.length > 0);
  card.appendChild(emptyNote);

  el.classList.appendChild(card);

  if(cls.students.length > 0){
    const rows = await Promise.all(cls.students.map(async (student) => {
      try{
        const stats = await getPlayerStats(student.uid);
        const total = sumAllModes(stats);
        return { uid: student.uid, name: student.name, games: total.games, accuracy: total.accuracy };
      } catch(err){
        console.error(`Failed to load stats for roster student ${student.uid}:`, err);
        return { uid: student.uid, name: student.name, games: '\u2014', accuracy: '\u2014' };
      }
    }));
    rows.forEach((row) => {
      const tr = document.createElement('tr');
      const nameTd = document.createElement('td');
      nameTd.textContent = row.name;
      const gamesTd = document.createElement('td');
      gamesTd.textContent = row.games;
      const accTd = document.createElement('td');
      accTd.textContent = row.accuracy;

      const removeTd = document.createElement('td');
      removeTd.className = 'class-roster-remove-cell';
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'class-icon-btn class-roster-remove-btn';
      removeBtn.innerHTML = ICON_USER_MINUS;
      removeBtn.title = 'Remove';
      removeBtn.setAttribute('aria-label', `Remove ${row.name} from ${cls.name || 'this class'}`);
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'text-link-btn class-rename-cancel hidden';
      cancelBtn.textContent = 'Cancel';
      let confirming = false;
      function resetRemoveBtn(){
        confirming = false;
        removeBtn.innerHTML = ICON_USER_MINUS;
        removeBtn.title = 'Remove';
        removeBtn.setAttribute('aria-label', `Remove ${row.name} from ${cls.name || 'this class'}`);
        removeBtn.classList.remove('class-delete-btn');
        removeBtn.disabled = false;
        cancelBtn.classList.add('hidden');
      }
      removeBtn.addEventListener('click', async () => {
        if(!confirming){
          confirming = true;
          removeBtn.innerHTML = ICON_CHECK;
          removeBtn.title = 'Confirm removal';
          removeBtn.setAttribute('aria-label', `Confirm removing ${row.name} from ${cls.name || 'this class'}`);
          removeBtn.classList.add('class-delete-btn');
          cancelBtn.classList.remove('hidden');
          return;
        }
        removeBtn.disabled = true;
        try{
          await removeStudent(state.googleUser.uid, cls.classId, row.uid);
          const stats = await getPlayerStats(state.googleUser.uid);
          await renderClassSection(stats);
        } catch(err){
          console.error(`Failed to remove student ${row.uid} from class ${cls.classId}:`, err);
          resetRemoveBtn();
        }
      });
      cancelBtn.addEventListener('click', resetRemoveBtn);
      removeTd.append(removeBtn, cancelBtn);

      tr.append(nameTd, gamesTd, accTd, removeTd);
      tbody.appendChild(tr);
    });
  }
}

el.classCreateBtn.addEventListener('click', async () => {
  el.classError.textContent = '';
  const className = el.classNameInput.value.trim();
  if(!className){
    el.classError.textContent = 'Please enter a class name.';
    return;
  }
  el.classCreateBtn.disabled = true;
  try{
    const { classId } = await createClass(state.googleUser.uid, state.googleUser.name, className);
    selectedClassId = classId; // show the newly created class right away
    const stats = await getPlayerStats(state.googleUser.uid);
    await renderClassSection(stats);
  } catch(err){
    el.classError.textContent = err.message === 'limit-reached'
      ? `You've reached the limit of ${MAX_CLASSES_PER_TEACHER} classes.`
      : 'Could not create your class. Please try again.';
    console.error(err);
  } finally {
    el.classCreateBtn.disabled = false;
  }
});

el.classJoinBtn.addEventListener('click', async () => {
  el.classError.textContent = '';
  const code = el.classJoinCodeInput.value.trim().toUpperCase();
  if(!code){
    el.classError.textContent = 'Please enter a class code.';
    return;
  }
  el.classJoinBtn.disabled = true;
  try{
    await joinClass(code, state.googleUser.uid, state.googleUser.name);
    el.classJoinCodeInput.value = '';
    const stats = await getPlayerStats(state.googleUser.uid);
    await renderClassSection(stats);
  } catch(err){
    el.classError.textContent = err.message === 'not-found'
      ? 'That class code was not found. Double-check it with your teacher.'
      : 'Could not join that class. Please try again.';
    console.error(err);
  } finally {
    el.classJoinBtn.disabled = false;
  }
});

el.classLeaveBtn.addEventListener('click', async () => {
  el.classError.textContent = '';
  el.classLeaveBtn.disabled = true;
  try{
    await leaveClass(state.googleUser.uid);
    const stats = await getPlayerStats(state.googleUser.uid);
    await renderClassSection(stats);
  } catch(err){
    el.classError.textContent = 'Could not leave the class. Please try again.';
    console.error(err);
  } finally {
    el.classLeaveBtn.disabled = false;
  }
});

async function handleMyStatsSignIn(){
  el.myStatsError.textContent = '';
  el.myStatsSigninBtn.disabled = true;
  let user;
  try{
    user = await signInWithGoogle();
  } catch(err){
    if(err?.code !== 'auth/popup-closed-by-user' && err?.code !== 'auth/cancelled-popup-request'){
      el.myStatsError.textContent = 'Google sign-in failed. Please try again.';
    }
    return;
  } finally {
    el.myStatsSigninBtn.disabled = false;
  }
  state.googleUser = toGoogleUserRecord(user);
  updatePlayerIdentityUI(); // this sign-in doubles as the setup screen's identity too
  openMyStats(); // re-render now signed in, and fetch the actual numbers
}

/* =========================================================
   Worksheet generator — same generateProblem()/buildProblemLayout() pure
   functions gameplay itself uses, rendered into a screen-hidden root
   that only becomes visible via @media print (see style.css). No
   Firebase involved at all: no sign-in, no database, nothing billed —
   this is pure client-side computation, thrown away once printed.
   ========================================================= */

el.wsOpAll.addEventListener('change', () => {
  el.wsOpChoices.forEach(cb => { cb.checked = el.wsOpAll.checked; });
});
el.wsOpChoices.forEach(cb => {
  cb.addEventListener('change', () => {
    el.wsOpAll.checked = Array.from(el.wsOpChoices).every(c => c.checked);
  });
});

/* A blank cell — unlike cellHTML() in the live game, there's no notion of
   "already answered" here. Every cell is just an empty box for the
   student to fill in by hand. */
function wsCellHTML(){
  return `<div class="cell-slot"></div>`;
}

function wsPartHTML(part){
  return part.type === 'cell' ? wsCellHTML() : `<span class="inline-op">${part.symbol}</span>`;
}

/* Mirrors renderStackedLayout()'s structure exactly (same row types:
   plain fraction / "product" / "whole"), just building a static string
   instead of touching state or the live #problem-strip — so the printed
   problem is structurally identical to what the game itself renders,
   not a separate lookalike. */
function wsProblemHTML(problem, layout, index){
  const { a, b, op, c, d } = problem;
  let html = `<div class="ws-problem">`;
  html += `<div class="ws-problem-number">${index + 1}.</div>`;
  html += `<div class="given-row">`;
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
        html += `<div class="row-numerator">${wsPartHTML(frac.numerator)}</div>`;
        html += `<div class="row-line"></div>`;
        html += `<div class="row-denominator">${wsPartHTML(frac.denominator)}</div>`;
        html += `</div>`;
        if(idx < row.fractions.length - 1){
          html += `<span class="inline-op">${row.operator}</span>`;
        }
      });
      html += `</div>`;
    } else if(row.kind === 'whole'){
      html += wsPartHTML(row.value);
    } else {
      html += `<div class="cross-fraction">`;
      html += `<div class="row-numerator">${row.numerator.map(wsPartHTML).join('')}</div>`;
      html += `<div class="row-line"></div>`;
      html += `<div class="row-denominator">${row.denominator.map(wsPartHTML).join('')}</div>`;
      html += `</div>`;
    }

    html += `</div></div>`;
  });

  html += `</div>`; // .ws-problem
  return html;
}

function wsAnswerKeyHTML(entries){
  let html = `<div class="ws-answer-key">`;
  html += `<h2>Answer Key</h2>`;
  entries.forEach((entry, i) => {
    const parts = entry.layout.cells.map(c => `${c.label}: ${c.correct}`).join(' \u00B7 ');
    html += `<div class="ws-answer-item"><strong>${i + 1}.</strong> ${parts}</div>`;
  });
  html += `</div>`;
  return html;
}

function handleGenerateWorksheet(){
  el.wsError.textContent = '';
  const selectedOps = Array.from(el.wsOpChoices).filter(cb => cb.checked).map(cb => cb.dataset.op);
  if(selectedOps.length === 0){
    el.wsError.textContent = 'Please select at least one operation.';
    return;
  }
  const allowNegatives = el.wsAllowNegatives.checked;
  const count = parseInt(el.wsProblemCount.value, 10);

  const entries = [];
  for(let i = 0; i < count; i++){
    const problem = generateProblem({ allowedOps: selectedOps, allowNegatives });
    const layout = buildProblemLayout(problem);
    entries.push({ problem, layout });
  }

  let html = `<div class="ws-header">
    <h1>AAT's Dueling Ratios &mdash; Practice Worksheet</h1>
    <div class="ws-header-fields"><span>Name: ________________________</span><span>Date: ____________</span></div>
  </div>`;
  html += `<div class="ws-problems">`;
  entries.forEach((entry, i) => { html += wsProblemHTML(entry.problem, entry.layout, i); });
  html += `</div>`;
  html += wsAnswerKeyHTML(entries);

  el.worksheetPrintRoot.innerHTML = html;
  el.worksheetModal.classList.add('hidden');
  // Brief delay so the modal-hide reflow settles before the print dialog
  // (which freezes the page) opens.
  setTimeout(() => window.print(), 50);
}

window.addEventListener('afterprint', () => {
  el.worksheetPrintRoot.innerHTML = ''; // don't keep a stale worksheet's DOM around
});

el.worksheetBtn.addEventListener('click', () => {
  el.wsError.textContent = '';
  el.worksheetModal.classList.remove('hidden');
});
el.wsCloseBtn.addEventListener('click', () => {
  el.worksheetModal.classList.add('hidden');
});
el.worksheetModal.addEventListener('click', (e) => {
  if(e.target === el.worksheetModal) el.worksheetModal.classList.add('hidden');
});
el.wsGenerateBtn.addEventListener('click', handleGenerateWorksheet);

/* =========================================================
   Setup screen wiring
   ========================================================= */

el.playerGoogleSigninBtn.addEventListener('click', handlePlayerGoogleSignIn);
el.playerGoogleSignoutBtn.addEventListener('click', handlePlayerGoogleSignOut);

el.modeSolo.addEventListener('click', () => selectMode('solo'));
el.modeVs.addEventListener('click', () => selectMode('vs'));
el.modeComputer.addEventListener('click', () => selectMode('computer'));
el.modeOnline.addEventListener('click', () => selectMode('online'));
el.startBtn.addEventListener('click', handlePrimaryButtonClick);
el.rematchBtn.addEventListener('click', handleRematchClick);
el.newGameBtn.addEventListener('click', resetToSetup);
el.cancelWaitingBtn.addEventListener('click', cancelWaiting);
el.acceptChallengeBtn.addEventListener('click', handleAcceptChallenge);
el.declineChallengeBtn.addEventListener('click', handleDeclineChallenge);
el.cancelChallengeBtn.addEventListener('click', handleCancelChallenge);

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

/* =========================================================
   Feedback FAB — only visible when BOTH:
     (a) signed in with a Google account, AND
     (b) the opening/setup screen (#setup-modal) is the thing currently
         showing — not mid-game, not while some other modal is open.

   Rather than patch every one of the ~15 places elsewhere in this file
   that show/hide #setup-modal, a MutationObserver watches its class
   attribute directly and re-evaluates from there. That keeps this
   correct automatically regardless of which code path changes the
   setup screen's visibility, now or in the future — no risk of a
   missed call site leaving the FAB visible somewhere it shouldn't be.
   ========================================================= */

function updateFeedbackFabVisibility(){
  const onSetupScreen = !el.setupModal.classList.contains('hidden');
  const signedIn = !!state.googleUser;
  el.feedbackFab.classList.toggle('hidden', !(signedIn && onSetupScreen));
}

new MutationObserver(updateFeedbackFabVisibility)
  .observe(el.setupModal, { attributes: true, attributeFilter: ['class'] });

function openFeedbackModal(){
  el.feedbackFormView.classList.remove('hidden');
  el.feedbackThanksView.classList.add('hidden');
  el.feedbackMessageInput.value = '';
  el.feedbackError.textContent = '';
  el.feedbackSubmitBtn.disabled = false;
  el.feedbackModal.classList.remove('hidden');
  el.feedbackMessageInput.focus();
}

function closeFeedbackModal(){
  el.feedbackModal.classList.add('hidden');
}

async function handleFeedbackSubmit(){
  if(!state.googleUser) return; // FAB shouldn't be reachable otherwise, but guard anyway
  el.feedbackError.textContent = '';
  const message = el.feedbackMessageInput.value.trim();
  if(!message){
    el.feedbackError.textContent = 'Please enter your feedback before sending.';
    return;
  }
  el.feedbackSubmitBtn.disabled = true;
  try{
    await submitFeedback(state.googleUser.uid, state.googleUser.name, message);
    el.feedbackFormView.classList.add('hidden');
    el.feedbackThanksView.classList.remove('hidden');
    setTimeout(closeFeedbackModal, 1600);
  } catch(err){
    el.feedbackError.textContent = 'Could not send your feedback. Please try again.';
    console.error('Failed to submit feedback:', err);
    el.feedbackSubmitBtn.disabled = false;
  }
}

el.feedbackFab.addEventListener('click', openFeedbackModal);
el.closeFeedbackBtn.addEventListener('click', closeFeedbackModal);
el.feedbackModal.addEventListener('click', (e) => {
  if(e.target === el.feedbackModal) closeFeedbackModal();
});
el.feedbackSubmitBtn.addEventListener('click', handleFeedbackSubmit);
el.feedbackMessageInput.addEventListener('keydown', (e) => {
  if(e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleFeedbackSubmit();
});

/* =========================================================
   Admin feedback viewer — chip only visible to ADMIN_EMAIL (toggled
   above in updatePlayerIdentityUI). Fetches every entry in one read
   (see getAllFeedback in firebase.js) and paginates client-side, 5 per
   page, since expected volume is small enough that this is simpler
   than Firebase's cursor-based paging.
   ========================================================= */

const ADMIN_FEEDBACK_PAGE_SIZE = 5;
let adminFeedbackEntries = [];
let adminFeedbackPage = 0;

function renderAdminFeedbackPage(){
  el.adminFeedbackList.innerHTML = '';
  const totalPages = Math.max(1, Math.ceil(adminFeedbackEntries.length / ADMIN_FEEDBACK_PAGE_SIZE));
  adminFeedbackPage = Math.min(adminFeedbackPage, totalPages - 1);
  const start = adminFeedbackPage * ADMIN_FEEDBACK_PAGE_SIZE;
  const pageEntries = adminFeedbackEntries.slice(start, start + ADMIN_FEEDBACK_PAGE_SIZE);

  el.adminFeedbackEmpty.classList.toggle('hidden', adminFeedbackEntries.length > 0);
  el.adminFeedbackPagination.classList.toggle('hidden', adminFeedbackEntries.length <= ADMIN_FEEDBACK_PAGE_SIZE);
  el.adminFeedbackPrevBtn.disabled = adminFeedbackPage === 0;
  el.adminFeedbackNextBtn.disabled = adminFeedbackPage >= totalPages - 1;
  el.adminFeedbackPageLabel.textContent = `Page ${adminFeedbackPage + 1} of ${totalPages}`;

  pageEntries.forEach((entry) => {
    const card = document.createElement('div');
    card.className = 'admin-feedback-entry';

    const meta = document.createElement('div');
    meta.className = 'admin-feedback-meta';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'admin-feedback-name';
    nameSpan.textContent = entry.name || 'Anonymous';
    const dateSpan = document.createElement('span');
    dateSpan.className = 'admin-feedback-date';
    dateSpan.textContent = entry.createdAt ? new Date(entry.createdAt).toLocaleString() : '';
    meta.append(nameSpan, dateSpan);

    const message = document.createElement('p');
    message.className = 'admin-feedback-message';
    message.textContent = entry.message || '';

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'text-link-btn class-rename-btn admin-feedback-delete-btn';
    deleteBtn.textContent = 'Delete';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'text-link-btn class-rename-cancel hidden';
    cancelBtn.textContent = 'Cancel';
    let confirming = false;
    function resetDeleteBtn(){
      confirming = false;
      deleteBtn.textContent = 'Delete';
      deleteBtn.classList.remove('class-delete-btn');
      deleteBtn.disabled = false;
      cancelBtn.classList.add('hidden');
    }
    deleteBtn.addEventListener('click', async () => {
      if(!confirming){
        confirming = true;
        deleteBtn.textContent = 'Confirm?';
        deleteBtn.classList.add('class-delete-btn');
        cancelBtn.classList.remove('hidden');
        return;
      }
      deleteBtn.disabled = true;
      try{
        await deleteFeedback(entry.id);
        adminFeedbackEntries = adminFeedbackEntries.filter((e) => e.id !== entry.id);
        renderAdminFeedbackPage();
      } catch(err){
        console.error(`Failed to delete feedback ${entry.id}:`, err);
        resetDeleteBtn();
      }
    });
    cancelBtn.addEventListener('click', resetDeleteBtn);

    const actionsRow = document.createElement('div');
    actionsRow.className = 'admin-feedback-actions';
    actionsRow.append(deleteBtn, cancelBtn);

    card.append(meta, message, actionsRow);
    el.adminFeedbackList.appendChild(card);
  });
}

async function openAdminFeedbackModal(){
  el.adminFeedbackError.textContent = '';
  el.adminFeedbackList.innerHTML = '';
  el.adminFeedbackEmpty.classList.add('hidden');
  el.adminFeedbackPagination.classList.add('hidden');
  el.adminFeedbackModal.classList.remove('hidden');
  try{
    adminFeedbackEntries = await getAllFeedback();
    adminFeedbackPage = 0;
    renderAdminFeedbackPage();
  } catch(err){
    el.adminFeedbackError.textContent = 'Could not load feedback. Please try again.';
    console.error('Failed to load admin feedback:', err);
  }
}

function closeAdminFeedbackModal(){
  el.adminFeedbackModal.classList.add('hidden');
}

el.adminFeedbackBtn.addEventListener('click', openAdminFeedbackModal);
el.closeAdminFeedbackBtn.addEventListener('click', closeAdminFeedbackModal);
el.adminFeedbackModal.addEventListener('click', (e) => {
  if(e.target === el.adminFeedbackModal) closeAdminFeedbackModal();
});
el.adminFeedbackPrevBtn.addEventListener('click', () => {
  if(adminFeedbackPage > 0){
    adminFeedbackPage--;
    renderAdminFeedbackPage();
  }
});
el.adminFeedbackNextBtn.addEventListener('click', () => {
  const totalPages = Math.max(1, Math.ceil(adminFeedbackEntries.length / ADMIN_FEEDBACK_PAGE_SIZE));
  if(adminFeedbackPage < totalPages - 1){
    adminFeedbackPage++;
    renderAdminFeedbackPage();
  }
});

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
  // Already signed in with an allowed teacher account (whether that
  // sign-in happened here, via My Stats, or via My Classes — it's all
  // the same Firebase session) — skip the prompt and go straight in.
  if(state.googleUser && isTeacherAccount()){
    openWatchList();
    return;
  }
  el.teacherPinError.textContent = '';
  el.teacherPinSubmitBtn.disabled = false;
  el.teacherPinSubmitBtn.textContent = 'Sign in with Google';
  el.teacherPinModal.classList.remove('hidden');
});
el.teacherPinCancelBtn.addEventListener('click', () => {
  el.teacherPinModal.classList.add('hidden');
});
el.teacherPinModal.addEventListener('click', (e) => {
  if(e.target === el.teacherPinModal) el.teacherPinModal.classList.add('hidden');
});
el.teacherPinSubmitBtn.addEventListener('click', handleTeacherGoogleSignIn);

el.myStatsBtn.addEventListener('click', openMyStats);
el.myStatsCloseBtn.addEventListener('click', () => {
  el.myStatsModal.classList.add('hidden');
});
el.myStatsModal.addEventListener('click', (e) => {
  if(e.target === el.myStatsModal) el.myStatsModal.classList.add('hidden');
});
el.myStatsSigninBtn.addEventListener('click', handleMyStatsSignIn);

el.myClassesBtn.addEventListener('click', openMyClasses);
el.myClassesCloseBtn.addEventListener('click', () => {
  el.myClassesModal.classList.add('hidden');
});
el.myClassesModal.addEventListener('click', (e) => {
  if(e.target === el.myClassesModal) el.myClassesModal.classList.add('hidden');
});
el.myClassesSigninBtn.addEventListener('click', handleMyClassesSignIn);

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
updatePlayerIdentityUI(); // initial state: plain name input, not signed in
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
  stopWatchingChallenge(); // ...and stop watching a pending challenge, if one was in flight
  el.modeSolo.classList.toggle('selected', mode === 'solo');
  el.modeVs.classList.toggle('selected', mode === 'vs');
  el.modeComputer.classList.toggle('selected', mode === 'computer');
  el.modeOnline.classList.toggle('selected', mode === 'online');
  el.onlineCreateBtn.classList.remove('selected');
  el.onlineJoinBtn.classList.remove('selected');
  el.onlineFindBtn.classList.remove('selected');
  el.setupError.textContent = '';
  updateStepVisibility();
}

function selectDifficulty(level){
  state.difficulty = level;
  el.difficultyChoices.forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.difficulty === level);
  });
}
el.difficultyChoices.forEach(btn => {
  btn.addEventListener('click', () => selectDifficulty(btn.dataset.difficulty));
});

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
  el.stepDifficulty.classList.toggle('hidden', mode !== 'computer');
  el.stepOnlineChoice.classList.toggle('hidden', mode !== 'online');
  el.stepJoinCode.classList.toggle('hidden', !(mode === 'online' && onlineChoice === 'join'));
  el.stepFindOpponent.classList.toggle('hidden', !(mode === 'online' && onlineChoice === 'find'));

  // Operations/pair-count/negatives/time-control: local modes always show
  // them; online only shows them once "Create Game" is chosen (a guest —
  // whether joining by code or by challenging from the lobby — inherits
  // whatever the host picked, so they don't choose anything).
  const showHostSettings = (mode === 'solo' || mode === 'vs' || mode === 'computer') || (mode === 'online' && onlineChoice === 'create');
  el.stepOperations.classList.toggle('hidden', !showHostSettings);
  el.stepNegatives.classList.toggle('hidden', !showHostSettings);
  el.stepPairCount.classList.toggle('hidden', !showHostSettings);
  el.stepTimeControl.classList.toggle('hidden', !showHostSettings);

  // Start button: only appears once we know what it should do. "Find
  // Opponent" has no single submit action — each lobby row has its own
  // Challenge button — so the generic Start button stays hidden for it.
  const ready = mode === 'solo' || mode === 'vs' || mode === 'computer' || (mode === 'online' && onlineChoice && onlineChoice !== 'find');
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
  state.opTally = {};
  const name1 = getMyName();
  const name2 = el.player2Name.value.trim();

  if(!name1){
    el.setupError.textContent = 'Please enter your name, or sign in with Google.';
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

  state.players = [{ name: name1, score: 0, timeRemaining: state.timeControlSeconds, correctCount: 0, wrongCount: 0, streak: 0 }];
  if(state.mode === 'vs' || state.mode === 'computer'){
    const name2Final = state.mode === 'computer' ? 'Computer' : name2;
    state.players.push({ name: name2Final, score: 0, timeRemaining: state.timeControlSeconds, correctCount: 0, wrongCount: 0, streak: 0 });
    el.chipP2.classList.remove('hidden');
  } else {
    el.chipP2.classList.add('hidden');
  }
  state.currentPlayer = 0;

  el.chipP1Name.textContent = state.players[0].name;
  if(state.players[1]) el.chipP2Name.textContent = state.players[1].name;

  const timerOn = state.timeControlSeconds > 0;
  el.chipP1Timer.classList.toggle('hidden', !timerOn);
  el.chipP2Timer.classList.toggle('hidden', !timerOn || !(state.mode === 'vs' || state.mode === 'computer'));

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
  stopWatchingChallenge();
  el.teacherPinModal.classList.add('hidden');
  el.myStatsModal.classList.add('hidden');
  el.myClassesModal.classList.add('hidden');
  el.worksheetModal.classList.add('hidden');
  state.missLog = [];
  state.opTally = {};
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
  const name1 = getMyName();
  if(!name1){
    el.setupError.textContent = 'Please enter your name, or sign in with Google.';
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
    el.waitingError.textContent = '';

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
  const name1 = getMyName();
  const code = el.joinCodeInput.value.trim().toUpperCase();
  if(!name1){
    el.setupError.textContent = 'Please enter your name, or sign in with Google.';
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
  pruneStaleChallenges(roomsObj).catch(() => { /* best-effort; next snapshot will retry */ });

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
    const busy = room.pendingChallenge && (Date.now() - room.pendingChallenge.requestedAt) < CHALLENGE_TIMEOUT_MS;

    return `
      <div class="watch-row">
        <div class="watch-row-info">
          <span class="watch-room-names">${host.name}</span>
          <span class="watch-room-progress">${opsLabel}${negLabel}${timerLabel} \u00B7 ${formatWaitingSince(room.createdAt)}</span>
        </div>
        <button class="secondary-btn watch-row-btn" data-room-code="${code}" data-host-name="${host.name}" type="button" ${busy ? 'disabled' : ''}>${busy ? 'Being challenged\u2026' : 'Challenge'}</button>
      </div>`;
  }).join('');

  el.lobbyList.querySelectorAll('.watch-row-btn:not(:disabled)').forEach(btn => {
    btn.addEventListener('click', () => handleChallenge(btn.dataset.roomCode, btn.dataset.hostName));
  });
}

async function handleChallenge(code, hostName){
  const name1 = getMyName();
  if(!name1){
    el.setupError.textContent = 'Please enter your name, or sign in with Google.';
    return;
  }
  el.setupError.textContent = '';
  try{
    const requestId = await sendChallenge(code, name1);
    closeLobby();
    openChallengePending(code, requestId, hostName, name1);
  } catch (err){
    // Someone else likely grabbed that seat/challenge slot first — the
    // live lobby listener will already reflect it by now (either gone
    // entirely, or shown as "Being challenged…"), so just surface why.
    el.setupError.textContent = err.message || 'Could not challenge that player \u2014 try another.';
  }
}

/* The screen a challenger sits on after tapping Challenge, waiting for
   the host to Accept/Decline. Watches the room live rather than polling,
   and runs its own client-side countdown that auto-cancels the challenge
   if the host never responds — see CHALLENGE_TIMEOUT_MS in online.js. */
function openChallengePending(code, requestId, hostName, myName){
  state.challengeCode = code;
  state.challengeRequestId = requestId;
  state.challengeMyName = myName;

  el.setupModal.classList.add('hidden');
  el.challengePendingModal.classList.remove('hidden');
  el.challengePendingText.textContent = `Waiting for ${hostName} to respond\u2026`;

  const deadline = Date.now() + CHALLENGE_TIMEOUT_MS;
  updateChallengeCountdown(deadline);
  state.challengeTickId = setInterval(() => updateChallengeCountdown(deadline), 1000);
  state.challengeTimeoutId = setTimeout(handleChallengeTimedOut, CHALLENGE_TIMEOUT_MS);
  state.unsubscribeChallengeWatch = listenToRoom(code, onChallengeRoomUpdate);
}

function updateChallengeCountdown(deadline){
  const secs = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  el.challengePendingCountdown.textContent = `${secs}s`;
}

/* Live updates while on the pending-response screen. Three outcomes to
   watch for: accepted (status flips to 'active'), room vanished outright
   (host cancelled while we waited), or our specific challenge is simply
   gone while the room's still 'waiting' (declined, or beaten to expiry
   by pruneStaleChallenges' safety net elsewhere). */
function onChallengeRoomUpdate(room){
  if(!room){
    stopWatchingChallenge();
    el.setupError.textContent = 'That room is no longer available.';
    backToLobbyFromChallenge();
    return;
  }

  if(room.status === 'active'){
    const code = state.challengeCode;
    const myName = state.challengeMyName;
    stopWatchingChallenge();
    enterAcceptedGame(code, myName);
    return;
  }

  if(room.status === 'waiting' && (!room.pendingChallenge || room.pendingChallenge.requestId !== state.challengeRequestId)){
    stopWatchingChallenge();
    el.setupError.textContent = 'Your challenge was declined.';
    backToLobbyFromChallenge();
  }
}

async function handleChallengeTimedOut(){
  const code = state.challengeCode;
  const requestId = state.challengeRequestId;
  const myName = state.challengeMyName;
  if(!code || !requestId) return; // nothing actually in flight (defensive)

  stopWatchingChallenge(); // stop reacting to further room updates — clearChallenge()'s own result is now the source of truth for what happened

  let finalRoom = null;
  try{ finalRoom = await clearChallenge(code, requestId); }
  catch (err){ /* best-effort — falls through to "back to lobby" below */ }

  if(finalRoom && finalRoom.status === 'active'){
    enterAcceptedGame(code, myName); // lost the race — Accept landed a moment before our timeout did; honor it rather than strand them
    return;
  }

  el.setupError.textContent = 'No response \u2014 you can try again.';
  backToLobbyFromChallenge();
}

async function handleCancelChallenge(){
  const code = state.challengeCode;
  const requestId = state.challengeRequestId;
  const myName = state.challengeMyName;
  if(!code || !requestId) return; // nothing actually in flight (defensive)

  // Disable immediately so a second click can't fire a second transaction
  // while the first is still in flight, and so the player gets visible
  // feedback that Cancel is actually doing something rather than nothing
  // appearing to happen for the length of one network round-trip.
  el.cancelChallengeBtn.disabled = true;
  stopWatchingChallenge(); // stop reacting to further room updates — clearChallenge()'s own result is now the source of truth for what happened

  let finalRoom = null;
  try{ finalRoom = await clearChallenge(code, requestId); }
  catch (err){ /* best-effort — falls through to "back to lobby" below */ }
  el.cancelChallengeBtn.disabled = false;

  if(finalRoom && finalRoom.status === 'active'){
    // We lost the race: the host's Accept reached the server a moment
    // before our Cancel did, so clearChallenge() above was a harmless
    // no-op (there was nothing left to clear — acceptChallenge() had
    // already cleared it). We WERE actually just placed into a real
    // game with a real opponent waiting; sending this player back to
    // the lobby instead would be a lie about what the database says
    // actually happened, and would leave the host sitting there alone.
    enterAcceptedGame(code, myName);
    return;
  }

  backToLobbyFromChallenge();
}

/* Shared by both "lost the cancel/timeout race" paths above and the
   normal accept-detected case in onChallengeRoomUpdate — all three are
   the exact same transition into a just-accepted game. */
function enterAcceptedGame(code, myName){
  state.isOnline = true;
  state.roomCode = code;
  state.myRole = 'guest';
  state.mode = 'online';
  state.timeControlSeconds = 0;

  saveSeat(code, 'guest', myName);
  state.stopPresence = trackPresence(code, 'guest');
  state.unsubscribeRoom = listenToRoom(code, onRoomUpdate);
}

function stopWatchingChallenge(){
  if(state.unsubscribeChallengeWatch){ state.unsubscribeChallengeWatch(); state.unsubscribeChallengeWatch = null; }
  if(state.challengeTickId){ clearInterval(state.challengeTickId); state.challengeTickId = null; }
  if(state.challengeTimeoutId){ clearTimeout(state.challengeTimeoutId); state.challengeTimeoutId = null; }
  el.challengePendingModal.classList.add('hidden');
  state.challengeCode = null;
  state.challengeRequestId = null;
  state.challengeMyName = null;
}

function backToLobbyFromChallenge(){
  el.setupModal.classList.remove('hidden');
  if(state.mode === 'online' && state.onlineChoice === 'find') openLobby();
}

/* Host's side of the handshake — rendered inside the waiting-modal (see
   onRoomUpdate's !guestP branch) whenever room.pendingChallenge is
   present and not yet stale. Accept/Decline read the requestId off the
   button's own dataset at click time, so this stays correct even if a
   fresh challenge replaces an expired one between renders. */
function renderIncomingChallenge(room){
  const challenge = room.pendingChallenge;
  const stillFresh = challenge && (Date.now() - challenge.requestedAt) < CHALLENGE_TIMEOUT_MS;
  el.incomingChallenge.classList.toggle('hidden', !stillFresh);
  el.waitingError.textContent = ''; // clear any earlier accept/decline error once the state actually moves on
  if(stillFresh){
    el.incomingChallengeText.textContent = `${challenge.name} wants to challenge you!`;
    el.acceptChallengeBtn.dataset.requestId = challenge.requestId;
    el.declineChallengeBtn.dataset.requestId = challenge.requestId;
  }
}

function handleAcceptChallenge(){
  const requestId = el.acceptChallengeBtn.dataset.requestId;
  if(!requestId || !state.roomCode) return;
  el.acceptChallengeBtn.disabled = true;
  el.declineChallengeBtn.disabled = true;
  el.waitingError.textContent = '';
  acceptChallenge(state.roomCode, requestId)
    // el.setupError lives inside the (hidden, at this point) setup-modal —
    // it's invisible while the host is looking at the waiting-modal, so
    // this needs its own visible error slot right here instead.
    .catch(err => { el.waitingError.textContent = err.message || 'Could not accept \u2014 try again.'; })
    .finally(() => {
      el.acceptChallengeBtn.disabled = false;
      el.declineChallengeBtn.disabled = false;
    });
}

function handleDeclineChallenge(){
  const requestId = el.declineChallengeBtn.dataset.requestId;
  if(!requestId || !state.roomCode) return;
  clearChallenge(state.roomCode, requestId).catch(() => { /* best-effort */ });
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
  if(!prevRoom) state.opTally = {}; // first update for this room subscription — a fresh game (or a rejoin, which restarts the tally; see trackOpTally()'s doc comment for that trade-off)
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
        { name: hostP.name, score: hostP.score, correctCount: hostP.correctCount, wrongCount: hostP.wrongCount, streak: hostP.streak || 0 },
        { name: guestP.name, score: guestP.score, correctCount: guestP.correctCount, wrongCount: guestP.wrongCount, streak: guestP.streak || 0 },
      ]
    : [{ name: hostP.name, score: hostP.score, correctCount: hostP.correctCount, wrongCount: hostP.wrongCount, streak: hostP.streak || 0 }];
  state.currentPlayer = room.turn === 'host' ? 0 : 1;

  // Shared milestone sounds: both devices receive this same update through
  // their own listener, so diffing prev-vs-new here fires them identically
  // for host and guest, regardless of which one triggered the change.
  // (Correct/wrong sounds are handled separately, immediately, at the
  // point of the click itself — see handleOnlineTileClick.)
  const prevGuestPresent = !!prevRoom?.players?.guest;
  if(!prevGuestPresent && guestP) playSound('start');
  if(prevRoom && room.pairIndex > prevRoom.pairIndex) playSound('next');
  if(prevRoom && prevRoom.status !== 'finished' && room.status === 'finished'){
    playSound('winner');
    const myFinishedP = state.myRole === 'host' ? hostP : guestP;
    recordMyStats('online', myFinishedP.correctCount, myFinishedP.wrongCount, room.settings?.timeControlSeconds > 0);
  }
  // Streak popups: same idea as the sounds above — diff prev-vs-new so
  // both devices fire the identical popup for whichever player actually
  // crossed a milestone, regardless of which client is looking. Guarded
  // on prevRoom so a fresh subscribe (e.g. reconnect mid-game) doesn't
  // replay a popup for a streak that was already reached earlier.
  if(prevRoom && guestP){
    ['host', 'guest'].forEach((roleKey) => {
      const prevStreak = prevRoom.players?.[roleKey]?.streak || 0;
      const newStreak = room.players?.[roleKey]?.streak || 0;
      if(newStreak > prevStreak && isStreakMilestone(newStreak)){
        const roleName = roleKey === 'host' ? hostP.name : guestP.name;
        const tier = streakTierFor(newStreak);
        playSound(tier.sound);
        showStreakPopup(streakPopupText(roleName, newStreak, true), tier.cssClass);
      }
      // Streak badges are MY OWN achievement only — never awarded based
      // on the opponent's streak, both because it wouldn't make sense
      // and because playerStats writes are uid-restricted anyway (see
      // database.rules.json), so this client could never write a badge
      // to someone else's account even if it tried.
      if(roleKey === state.myRole && state.googleUser){
        const badgeId = checkStreakBadge(newStreak, state.myBadges);
        if(badgeId) awardAndCelebrateBadges([badgeId]);
      }
    });
  }

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
    renderIncomingChallenge(room);
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
    if(state.googleUser) trackOpTally(state.problem.op, true);

    const newPool = state.pool.filter((_, i) => i !== tileIdx);
    const newCellIndex = state.cellIndex + 1;
    updates[`players/${myKey}/score`] = player.score + 1;
    updates[`players/${myKey}/correctCount`] = (state.room.players[myKey].correctCount || 0) + 1;
    updates[`players/${myKey}/streak`] = (state.room.players[myKey].streak || 0) + 1;
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
    if(state.googleUser) trackOpTally(state.problem.op, false);

    updates[`players/${myKey}/score`] = player.score - 1;
    updates[`players/${myKey}/wrongCount`] = (state.room.players[myKey].wrongCount || 0) + 1;
    updates[`players/${myKey}/streak`] = 0;
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
  recordMyStats(state.mode, state.players[0].correctCount, state.players[0].wrongCount, state.timeControlSeconds > 0);

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
  state.opTally = {};
  state.pairIndex = 0;
  state.currentPlayer = 0;
  state.players.forEach(p => {
    p.score = 0;
    p.correctCount = 0;
    p.wrongCount = 0;
    p.streak = 0;
    p.timeRemaining = state.timeControlSeconds;
  });
  updateScoreChips();

  const timerOn = state.timeControlSeconds > 0;
  el.chipP1Timer.classList.toggle('hidden', !timerOn);
  el.chipP2Timer.classList.toggle('hidden', !timerOn || !(state.mode === 'vs' || state.mode === 'computer'));

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
   Teacher spectator view — watch list + Google sign-in gate

   Only Online games are watchable (Solo/Same Device never touch
   Firebase, so there's nothing shared to watch). This whole section
   never calls submitRoomUpdate — a spectator's tab must never be able
   to mutate a room, only read it via listenToRoom/listenToAllRooms.

   Access check: after Google sign-in, we only look at the email
   domain (see teacherConfig.js) — same client-side-only posture as
   the PIN this replaced (see that file's comment for why). A denied
   account gets signed straight back out, so a rejected Google session
   never lingers as this tab's active identity. */

async function handleTeacherGoogleSignIn(){
  el.teacherPinError.textContent = '';
  el.teacherPinSubmitBtn.disabled = true;
  el.teacherPinSubmitBtn.textContent = 'Signing in\u2026';

  let user;
  try{
    user = await signInWithGoogle();
  } catch(err){
    el.teacherPinSubmitBtn.disabled = false;
    el.teacherPinSubmitBtn.textContent = 'Sign in with Google';
    if(err?.code !== 'auth/popup-closed-by-user' && err?.code !== 'auth/cancelled-popup-request'){
      el.teacherPinError.textContent = 'Sign-in failed. Please try again.';
    }
    return;
  }

  const email = (user.email || '').toLowerCase();
  const allowed = email.endsWith('@' + TEACHER_EMAIL_DOMAIN);

  if(allowed){
    el.teacherPinModal.classList.add('hidden');
    openWatchList();
  } else {
    signOutUser().catch(() => { /* best-effort */ });
    el.teacherPinError.textContent = `Only @${TEACHER_EMAIL_DOMAIN} accounts can access Watch Games.`;
    el.teacherPinSubmitBtn.disabled = false;
    el.teacherPinSubmitBtn.textContent = 'Sign in with Google';
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
        { name: hostP.name, score: hostP.score, correctCount: hostP.correctCount, wrongCount: hostP.wrongCount, streak: hostP.streak || 0 },
        { name: guestP.name, score: guestP.score, correctCount: guestP.correctCount, wrongCount: guestP.wrongCount, streak: guestP.streak || 0 },
      ]
    : [{ name: hostP.name, score: hostP.score, correctCount: hostP.correctCount, wrongCount: hostP.wrongCount, streak: hostP.streak || 0 }];
  state.currentPlayer = room.turn === 'host' ? 0 : 1;

  const prevGuestPresent = !!prevRoom?.players?.guest;
  if(!prevGuestPresent && guestP) playSound('start');
  if(prevRoom && room.pairIndex > prevRoom.pairIndex) playSound('next');
  if(prevRoom && prevRoom.status !== 'finished' && room.status === 'finished') playSound('winner');
  if(prevRoom && guestP){
    ['host', 'guest'].forEach((roleKey) => {
      const prevStreak = prevRoom.players?.[roleKey]?.streak || 0;
      const newStreak = room.players?.[roleKey]?.streak || 0;
      if(newStreak > prevStreak && isStreakMilestone(newStreak)){
        const roleName = roleKey === 'host' ? hostP.name : guestP.name;
        const tier = streakTierFor(newStreak);
        playSound(tier.sound);
        showStreakPopup(streakPopupText(roleName, newStreak, true), tier.cssClass);
      }
    });
  }

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
  // Turn order carries over between pairs (it isn't reset to player 0 for
  // each new pair) — so if the computer's turn carried into this new
  // pair, it needs its move scheduled here too. handleTileClick() covers
  // every OTHER turn transition, but the one that completes a pair
  // returns early (see the isCorrect branch below) before reaching the
  // scheduling call at its own end, so this is the one transition it
  // can't cover by itself.
  maybeScheduleComputerTurn();
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
  // Local modes don't normally enforce turn order in the UI (Same Device
  // trusts the two humans sharing one device to take turns themselves) —
  // but "vs Computer" has no second human to self-police that, so the
  // human's tiles must actually be disabled while it's the computer's turn,
  // or they could just answer every cell before the computer ever gets a turn.
  const isComputersTurn = state.mode === 'computer' && state.currentPlayer !== 0;

  state.pool.forEach(tile => {
    const btn = document.createElement('button');
    btn.className = 'tile-btn';
    btn.textContent = tile.value;
    btn.dataset.tileId = tile.id;
    if(state.spectating){
      // Read-only: no listener at all, not just a disabled attribute.
      btn.disabled = true;
    } else {
      if((state.isOnline && !myTurn) || isComputersTurn) btn.disabled = true;
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

/* Individual clicks update the pool tray incrementally (remove just the
   one used tile, or leave it in place for a wrong answer) rather than
   calling renderPool() again — that's deliberate, to avoid a freshly
   rebuilt button landing under the same finger/cursor and registering a
   second accidental click. But that means the per-turn tile-locking
   "vs Computer" needs (see renderPool()'s isComputersTurn) has to be
   kept in sync separately, by toggling .disabled on the buttons that are
   already there, whenever the turn changes without a full re-render. */
function syncPoolLockState(){
  const isComputersTurn = state.mode === 'computer' && state.currentPlayer !== 0;
  el.poolTray.querySelectorAll('.tile-btn').forEach(btn => {
    btn.disabled = isComputersTurn;
  });
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

/* =========================================================
   Streaks — a popup + chime whenever a player lands several correct
   answers in a row, every 5 (5, 10, 15, 20…). Resets to 0 the moment
   that player misses. Tracked per-player so it stays meaningful across
   Solo, Same Device, vs Computer, and Online alike — in the turn-based
   modes a "streak" is about that player's own run across their turns,
   not back-to-back taps.

   Each milestone escalates through 4 color/chime tiers (5→bronze,
   10→silver, 15→gold, 20→prism), then cycles back through the same 4
   tiers for longer streaks — the popup text still shows the real
   count, so a 25-streak reads as "25 Streak!" even though it reuses
   tier 1's color/chime.
   ========================================================= */

const STREAK_TIERS = [
  { sound: 'streak', cssClass: 'streak-tier-1' },   // 5, 25, 45…
  { sound: 'streak2', cssClass: 'streak-tier-2' },  // 10, 30, 50…
  { sound: 'streak3', cssClass: 'streak-tier-3' },  // 15, 35, 55…
  { sound: 'streak4', cssClass: 'streak-tier-4' },  // 20, 40, 60…
];

function isStreakMilestone(count){
  return count > 0 && count % 5 === 0;
}

function streakTierFor(count){
  const tierIndex = (Math.floor(count / 5) - 1) % STREAK_TIERS.length;
  return STREAK_TIERS[tierIndex];
}

function streakPopupText(playerName, count, showName){
  return showName ? `\u{1F525} ${playerName} \u2014 ${count} Streak!` : `\u{1F525} ${count} Streak!`;
}

function showStreakPopup(text, cssClass){
  el.streakPopup.textContent = text;
  el.streakPopup.classList.remove('hidden', 'streak-pop-in', ...STREAK_TIERS.map(t => t.cssClass));
  el.streakPopup.classList.add(cssClass);
  void el.streakPopup.offsetWidth; // force reflow so re-adding the class restarts the CSS animation
  el.streakPopup.classList.add('streak-pop-in');
}

el.streakPopup.addEventListener('animationend', () => {
  el.streakPopup.classList.add('hidden');
  el.streakPopup.classList.remove('streak-pop-in');
});

/* =========================================================
   Achievement badges — see badges.js for the definitions and pure
   eligibility logic. This section owns: loading the signed-in
   player's earned set, rendering the small icon row on both profile
   chips, the celebration popup (queued — see below), and actually
   persisting a newly-earned badge via awardBadge().
   ========================================================= */

/* Fetches the signed-in player's earned badges into state.myBadges and
   refreshes the My Badges section if it's currently visible.
   Fire-and-forget from callers (not awaited) — badges are a nice-to-
   have overlay on top of stats that already loaded some other way; a
   failed/slow fetch here shouldn't block anything else. */
async function loadMyBadges(){
  if(!state.googleUser) return;
  try{
    const stats = await getPlayerStats(state.googleUser.uid);
    state.myBadges = new Set(Object.keys(stats.badges || {}));
    state.myStats = stats;
    await checkAndAwardCatchUpBadges(stats);
  } catch(err){
    console.error('Failed to load badges:', err);
    state.myBadges = new Set();
    state.myStats = null;
  }
  if(!el.myStatsModal.classList.contains('hidden')){
    renderMyStatsBadges();
  }
}

/* Renders the "My Badges" section inside My Stats: the icon grid plus
   the "no badges yet" empty-state message, kept in sync with each
   other in one place rather than at every call site. */
function renderMyStatsBadges(){
  renderBadgeIcons(el.myStatsBadgesGrid, state.myBadges);
  el.myStatsBadgesEmpty.classList.toggle('hidden', state.myBadges.size > 0);
  renderNextBadgeProgress();
}

/* Renders the "Up Next" progress bars — one per not-yet-earned badge
   family, from getNextBadgeProgress() in badges.js. Hidden entirely
   once every family is fully earned (or if we don't have stats to
   compute progress from yet, e.g. right after signing out). */
function renderNextBadgeProgress(){
  el.myStatsBadgeProgressList.innerHTML = '';
  if(!state.myStats){
    el.myStatsBadgeProgressSection.classList.add('hidden');
    return;
  }
  const items = getNextBadgeProgress(state.myStats, state.myBadges);
  el.myStatsBadgeProgressSection.classList.toggle('hidden', items.length === 0);
  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'badge-progress-row';

    const label = document.createElement('div');
    label.className = 'badge-progress-label';
    const emojiSpan = document.createElement('span');
    emojiSpan.className = 'badge-progress-emoji';
    emojiSpan.textContent = item.emoji;
    label.append(emojiSpan, document.createTextNode(` ${item.name}`));

    const track = document.createElement('div');
    track.className = 'badge-progress-track';
    const fill = document.createElement('div');
    fill.className = 'badge-progress-fill';
    fill.style.width = `${item.percent}%`;
    track.appendChild(fill);

    const caption = document.createElement('p');
    caption.className = 'badge-progress-caption';
    caption.textContent = item.caption;

    row.append(label, track, caption);
    el.myStatsBadgeProgressList.appendChild(row);
  });
}

/* Renders one small emoji per earned badge into `container`. Each
   icon is a real <button>, not a plain <span>, for two reasons: it
   keeps the native title="" tooltip for mouse/desktop hover (still
   works fine there), AND it's tappable — see showBadgeTooltip() below
   for the mobile-friendly equivalent, since hover tooltips are simply
   invisible on touch devices. badgeIds can be a Set or a plain array. */
function renderBadgeIcons(container, badgeIds){
  if(!container) return;
  container.innerHTML = '';
  Array.from(badgeIds).forEach((id) => {
    const def = BADGE_DEFS_BY_ID[id];
    if(!def) return; // unknown id (e.g. an older/renamed badge) — skip rather than show a blank icon
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'badge-icon';
    btn.textContent = def.emoji;
    btn.title = `${def.name} \u2014 ${def.description}`;
    btn.setAttribute('aria-label', `${def.name}: ${def.description}`);
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // don't let the document-level dismiss listener below immediately close what we're about to open
      showBadgeTooltip(def, btn);
    });
    container.appendChild(btn);
  });
}

/* Tap-to-reveal badge tooltip — the touch-friendly counterpart to the
   title="" attribute above. Positioned dynamically under (or, if
   there's no room, above) whichever badge icon was tapped, clamped to
   stay on-screen horizontally. Auto-dismisses after a few seconds, or
   immediately on tapping anywhere else. */
let badgeTooltipTimer = null;

function showBadgeTooltip(def, anchorEl){
  clearTimeout(badgeTooltipTimer);
  el.badgeTooltip.textContent = `${def.emoji} ${def.name} \u2014 ${def.description}`;
  el.badgeTooltip.classList.remove('hidden');

  const anchorRect = anchorEl.getBoundingClientRect();
  const tipRect = el.badgeTooltip.getBoundingClientRect(); // measurable now that it's unhidden (still opacity:0 until next paint)
  let left = anchorRect.left + anchorRect.width / 2 - tipRect.width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));
  let top = anchorRect.bottom + 8;
  if(top + tipRect.height > window.innerHeight - 8){
    top = anchorRect.top - tipRect.height - 8; // flip above the icon if there's no room below (e.g. a badge near the bottom of the screen)
  }
  el.badgeTooltip.style.left = `${left}px`;
  el.badgeTooltip.style.top = `${top}px`;

  requestAnimationFrame(() => el.badgeTooltip.classList.add('visible'));
  badgeTooltipTimer = setTimeout(hideBadgeTooltip, 3500);
}

function hideBadgeTooltip(){
  clearTimeout(badgeTooltipTimer);
  el.badgeTooltip.classList.remove('visible');
  setTimeout(() => el.badgeTooltip.classList.add('hidden'), 200); // let the fade-out transition finish before actually removing it from layout
}

document.addEventListener('click', (e) => {
  if(!el.badgeTooltip.classList.contains('hidden') && !el.badgeTooltip.contains(e.target)){
    hideBadgeTooltip();
  }
});

/* Celebration popup — same visual mechanism as the streak popup
   (force-reflow to restart a CSS animation, animationend to clean up),
   kept as a separate element/class so a badge unlock reads as a
   different, rarer kind of moment than a mid-game streak. Popups are
   queued: awarding several badges at once (e.g. finishing a game that
   crosses both a persistence and an accuracy milestone) shows them one
   at a time rather than clobbering each other. */
let badgePopupQueue = [];
let badgePopupShowing = false;

function showBadgePopup(badgeDef){
  badgePopupQueue.push(badgeDef);
  if(!badgePopupShowing) advanceBadgePopupQueue();
}

function advanceBadgePopupQueue(){
  const next = badgePopupQueue.shift();
  if(!next){
    badgePopupShowing = false;
    return;
  }
  badgePopupShowing = true;
  el.badgePopup.textContent = `${next.emoji} Badge earned: ${next.name}!`;
  el.badgePopup.classList.remove('hidden', 'badge-pop-in');
  void el.badgePopup.offsetWidth; // force reflow so re-adding the class restarts the CSS animation
  el.badgePopup.classList.add('badge-pop-in');
}

el.badgePopup.addEventListener('animationend', () => {
  el.badgePopup.classList.add('hidden');
  el.badgePopup.classList.remove('badge-pop-in');
  advanceBadgePopupQueue(); // show the next queued badge, if any
});

/* Awards each newly-earned badge (persists it, updates state.myBadges
   and both profile chips) and queues its celebration popup + sound.
   Callers pass ids already filtered through badges.js's checkers, so
   everything here is assumed genuinely new. */
async function awardAndCelebrateBadges(newBadgeIds){
  if(!state.googleUser || newBadgeIds.length === 0) return;
  for(const id of newBadgeIds){
    state.myBadges.add(id); // update locally right away so a rapid double-check (e.g. two games finishing close together) can't re-award the same id
    try{
      await awardBadge(state.googleUser.uid, id);
    } catch(err){
      console.error(`Failed to award badge ${id}:`, err);
    }
    const def = BADGE_DEFS_BY_ID[id];
    if(def){
      playSound('winner'); // reuse the existing triumphant sound rather than add a dedicated asset
      showBadgePopup(def);
    }
  }
  if(!el.myStatsModal.classList.contains('hidden')){
    renderMyStatsBadges(); // keep an already-open My Badges section in sync too — most badges are earned mid-game though, with My Stats closed, so this mainly matters if someone has it open in another tab
  }
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
  if(state.mode === 'vs' || state.mode === 'computer'){
    if(state.mode === 'computer' && state.currentPlayer === 1){
      el.turnFlag.textContent = 'Computer is thinking\u2026';
    } else {
      el.turnFlag.textContent = `${state.players[state.currentPlayer].name}'s turn`;
    }
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
    player.streak = (player.streak || 0) + 1;
    state.pool.splice(tileIdx, 1); // consume the tile
    removeTileFromDOM(tile.id);
    slotEls.forEach(slotEl => {
      slotEl.textContent = tile.value;
      slotEl.classList.remove('active', 'pending');
      slotEl.classList.add('filled', 'drop-correct');
    });

    el.feedbackLine.textContent = `Correct! ${player.name} +1`;
    el.feedbackLine.className = 'feedback-line good';

    if(isStreakMilestone(player.streak)){
      const tier = streakTierFor(player.streak);
      playSound(tier.sound);
      showStreakPopup(streakPopupText(player.name, player.streak, state.mode !== 'solo'), tier.cssClass);
    }
    // Streak badges only ever apply to the signed-in local player, who
    // is always players[0] by this app's convention (matches
    // recordMyStats's own assumption) — never the Same-Device human
    // opponent or the computer, neither of which has an account to
    // attach a badge to.
    if(state.currentPlayer === 0 && state.googleUser){
      const badgeId = checkStreakBadge(player.streak, state.myBadges);
      if(badgeId) awardAndCelebrateBadges([badgeId]);
      trackOpTally(state.problem.op, true);
    }

    state.cellIndex++;
    if(state.mode === 'vs' || state.mode === 'computer') advanceTurn();

    if(state.cellIndex >= state.cells.length){
      setTimeout(finishPair, 700); // startNextPair()/showWinner() will unlock
      return;
    }
    setTimeout(() => { renderProblem(); state.inputLocked = false; syncPoolLockState(); }, 250);

  } else {
    playSound('wrong');
    animateTileThrow(tileEl, slotEls[0], 'wrong');
    player.score -= 1;
    player.wrongCount += 1;
    player.streak = 0;
    if(state.currentPlayer === 0 && state.googleUser){
      trackOpTally(state.problem.op, false);
    }
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

    if(state.mode === 'vs' || state.mode === 'computer') advanceTurn();
    state.inputLocked = false;
    syncPoolLockState();
  }

  updateScoreChips();
  updateTurnFlag();
  maybeScheduleComputerTurn();
}

function advanceTurn(){
  state.currentPlayer = state.currentPlayer === 0 ? 1 : 0;
}

/* =========================================================
   Computer opponent ("vs Computer" mode) — the human is always player
   index 0, the computer always index 1. Rather than a separate game
   engine, the computer just takes its turn through the EXACT same
   handleTileClick() a human click would use — same scoring, same
   missLog, same advanceTurn(), same everything. All that's new here is
   deciding WHICH tile to click and WHEN.

   Scheduled from the end of handleTileClick() every time (not just when
   the turn flips to the computer) — takeComputerTurn() re-checks the
   live state.mode/state.currentPlayer/state.inputLocked itself, so a
   stale timer from three moves ago just silently no-ops instead of
   causing a double-move; nothing here assumes the game state hasn't
   moved on by the time the delay elapses. */

const COMPUTER_DIFFICULTY = {
  easy:   { errorChance: 0.35, minDelayMs: 2200, maxDelayMs: 4200 },
  medium: { errorChance: 0.18, minDelayMs: 1400, maxDelayMs: 2800 },
  hard:   { errorChance: 0.05, minDelayMs: 700,  maxDelayMs: 1600 },
};

function maybeScheduleComputerTurn(){
  if(state.mode !== 'computer' || state.currentPlayer !== 1) return;
  const { minDelayMs, maxDelayMs } = COMPUTER_DIFFICULTY[state.difficulty];
  const delay = minDelayMs + Math.random() * (maxDelayMs - minDelayMs);
  setTimeout(takeComputerTurn, delay);
}

function takeComputerTurn(){
  // Re-validate everything at execution time — a lot can happen during
  // the "thinking" delay (the game could have ended, a pair could have
  // turned over, or — in principle — the turn could already be back to
  // the human via some other path).
  if(state.mode !== 'computer' || state.currentPlayer !== 1) return;
  if(state.inputLocked) return;
  if(el.gameScreen.classList.contains('hidden')) return;
  if(state.pool.length === 0) return;

  const activeCell = state.cells[state.cellIndex];
  const correctTile = state.pool.find(t => t.value === activeCell.correct);
  const wrongTiles = state.pool.filter(t => t.value !== activeCell.correct);

  const { errorChance } = COMPUTER_DIFFICULTY[state.difficulty];
  let chosenTile = correctTile;
  if(wrongTiles.length > 0 && Math.random() < errorChance){
    chosenTile = wrongTiles[Math.floor(Math.random() * wrongTiles.length)];
  }
  if(!chosenTile) chosenTile = state.pool[0]; // defensive fallback, shouldn't happen

  handleTileClick(chosenTile.id);
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
  recordMyStats(state.mode, state.players[0].correctCount, state.players[0].wrongCount, state.timeControlSeconds > 0);
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
