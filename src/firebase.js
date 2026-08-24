/* =========================================================
   Firebase setup — Realtime Database + Anonymous Auth only.
   (analytics is intentionally omitted: it's unrelated to gameplay
   and adds bundle weight / setup requirements we don't need.)
   ========================================================= */

import { initializeApp } from "firebase/app";
import { getDatabase, ref, update, get, increment, push } from "firebase/database";
import {
  getAuth, signInAnonymously, onAuthStateChanged,
  GoogleAuthProvider, signInWithPopup, signOut,
  setPersistence, browserLocalPersistence,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCjyMidGnpDzArLBRPU0Gy1fW3lC_cn80M",
  authDomain: "dueling-ratios.firebaseapp.com",
  databaseURL: "https://dueling-ratios-default-rtdb.firebaseio.com",
  projectId: "dueling-ratios",
  storageBucket: "dueling-ratios.firebasestorage.app",
  messagingSenderId: "788955705989",
  appId: "1:788955705989:web:8c896a363134c21b5aefec",
};

export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);

/* Persistence: browserLocalPersistence (Firebase's own default) keeps a
   signed-in session across page reloads AND full browser restarts — this
   is what makes "stay signed in" actually work, which matters for real
   classroom use where re-signing-in every visit is real friction.

   Trade-off, worth knowing: this also means every tab of the SAME
   browser shares one signed-in identity. If two different people sign
   in with two different Google accounts in two tabs of the same
   browser (e.g. testing host + guest locally), the second sign-in
   silently becomes the active identity in BOTH tabs — the earlier tab's
   in-memory state.googleUser can go stale until that tab is reloaded.
   This was previously worked around with browserSessionPersistence
   (session-only, per-tab), but that traded away "stay logged in" to
   guard against what turned out to be a narrow, mostly testing-only
   edge case — real students each on their own device never hit it.
   The bug that persistence change was actually chasing (a Google
   session getting silently clobbered by ensureSignedIn()) is fixed
   below regardless of persistence type, so this is safe to relax. */
const authReady = setPersistence(auth, browserLocalPersistence);

/* Resolves once we have SOME signed-in user — anonymous if nothing else,
   but critically: if this tab already signed in with Google (e.g. the
   player used "Sign in with Google" before ever creating/joining a
   room), this must NOT clobber that with a fresh anonymous sign-in.
   That was a real bug — createRoom()/joinRoom() both call this, and it
   used to call signInAnonymously() unconditionally on first use, which
   silently signed a Google-authenticated player back out the moment
   they created/joined their first room, breaking their uid-scoped
   stats without any visible error at the time. */
let signInPromise = null;
export function ensureSignedIn(){
  if(signInPromise) return signInPromise;
  signInPromise = authReady.then(() => new Promise((resolve, reject) => {
    if(auth.currentUser){
      resolve(auth.currentUser);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if(user){
        unsubscribe();
        resolve(user);
      }
    }, reject);
    signInAnonymously(auth).catch((err) => {
      unsubscribe();
      reject(err);
    });
  }));
  return signInPromise;
}

/* =========================================================
   Google sign-in — used for the teacher "Watch Games" gate and for
   optional player login (see teacherConfig.js / main.js's getMyName()).
   This REPLACES whatever auth session was active before (anonymous or
   otherwise) — Firebase Auth only ever holds one signed-in identity per
   browser tab at a time. That's safe for rooms/presence, which are
   keyed by room code and player name, not auth.uid. Player stats
   (below) are the one thing that DOES key off auth.uid, deliberately —
   that's what makes them persistent and tied to a real account rather
   than a typed name someone else could also type.

   signInWithGoogle() itself makes no allow/deny decision — that's the
   caller's job (see teacherConfig.js's TEACHER_EMAIL_DOMAIN for the
   teacher gate; player stats and player login have no such gate, any
   Google account works). */
const googleProvider = new GoogleAuthProvider();

export async function signInWithGoogle(){
  await authReady;
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export function signOutUser(){
  return signOut(auth);
}

/* Distinguishes a real Google identity from an anonymous one — both are
   just "a signed-in user" as far as auth.currentUser is concerned, but
   only one of them should ever populate state.googleUser in main.js.
   An anonymous user's providerData is always empty. */
export function isGoogleUser(user){
  return !!user && user.providerData.some((p) => p.providerId === 'google.com');
}

/* Fires on every auth state change — sign-in, sign-out, AND critically,
   the very first check on page load when a persisted session (see
   browserLocalPersistence above) gets silently restored. Without this,
   Firebase itself was persisting the session correctly the whole time,
   but nothing in the app ever noticed on page load — state.googleUser
   only ever got set inside the "Sign in with Google" button's own click
   handler, so a returning, already-signed-in visitor still saw the
   signed-out UI until they clicked it again. This is what actually
   makes "stay signed in" work end-to-end, not just at the Firebase
   SDK level. */
export function watchAuthState(callback){
  return onAuthStateChanged(auth, callback);
}

/* =========================================================
   Player stats — persistent, keyed by Google uid, broken out per mode
   (solo / sameDevice / online) rather than one combined total. This is
   a schema change from the original flat playerStats/{uid}/gamesPlayed
   etc. — by design, this does NOT read or migrate that old flat data;
   it only reads/writes playerStats/{uid}/{mode}/*. Anyone with old
   combined numbers just starts fresh at zero per mode going forward
   (a deliberate choice, discussed and agreed — there was no reliable
   way to retroactively attribute old combined counts to a mode, since
   mode was never recorded alongside them).

   correctCount/wrongCount/gamesPlayed use increment() so concurrent
   writes (e.g. finishing games in two tabs) merge correctly server-side
   instead of racing on a read-then-write. ========================= */

// STATS_MODES/OPERATIONS now live in constants.js (a plain, side-effect-
// free module) so badges.js can import them without pulling in the
// Firebase SDK — re-exported here so every existing `import { STATS_MODES }
// from './firebase.js'` elsewhere keeps working unchanged.
export { STATS_MODES, OPERATIONS } from './constants.js';
import { OPERATIONS } from './constants.js';

// Firebase Realtime Database paths can't contain '.', '#', '$', '[', ']',
// or '/' — none of our operation symbols hit that, but '÷' and '×' are
// still ordinary Unicode characters, not ASCII, so a small explicit map
// (rather than using the symbol directly as a path segment) keeps the
// on-disk schema readable and insulates it from ever silently breaking
// if a symbol choice changes again upstream in logic.js.
const OP_PATH_KEYS = { '+': 'add', '-': 'subtract', '×': 'multiply', '÷': 'divide' };

export async function recordGameResult(uid, modeKey, correctCount, wrongCount, opTally){
  const updates = {
    [`playerStats/${uid}/${modeKey}/gamesPlayed`]: increment(1),
    [`playerStats/${uid}/${modeKey}/correctCount`]: increment(correctCount),
    [`playerStats/${uid}/${modeKey}/wrongCount`]: increment(wrongCount),
  };
  // opTally: { '+': {correct, wrong}, '-': {...}, ... } — only the
  // operations actually played this game need an entry; see
  // state.opTally in main.js for how it's built during play.
  if(opTally){
    OPERATIONS.forEach((op) => {
      const t = opTally[op];
      if(!t || (!t.correct && !t.wrong)) return;
      const pathKey = OP_PATH_KEYS[op];
      if(t.correct) updates[`playerStats/${uid}/opStats/${pathKey}/correctCount`] = increment(t.correct);
      if(t.wrong) updates[`playerStats/${uid}/opStats/${pathKey}/wrongCount`] = increment(t.wrong);
    });
  }
  return update(ref(db), updates);
}

export async function getPlayerStats(uid){
  const snap = await get(ref(db, `playerStats/${uid}`));
  const data = snap.exists() ? snap.val() : {};
  const stats = {};
  STATS_MODES.forEach((modeKey) => {
    const d = data[modeKey] || {};
    stats[modeKey] = {
      gamesPlayed: d.gamesPlayed || 0,
      correctCount: d.correctCount || 0,
      wrongCount: d.wrongCount || 0,
    };
  });
  // Per-operation lifetime totals, for the operation-mastery badges —
  // same read, just a different sub-node of playerStats/{uid}. Always
  // returns an entry for every op (defaulting to zero), same defensive
  // shape as the per-mode stats above, so callers never need an extra
  // null-check.
  const opData = data.opStats || {};
  stats.opStats = {};
  OPERATIONS.forEach((op) => {
    const d = opData[OP_PATH_KEYS[op]] || {};
    stats.opStats[op] = { correctCount: d.correctCount || 0, wrongCount: d.wrongCount || 0 };
  });
  // Class membership — not a stats mode, just piggybacking on this same
  // read since it's the same playerStats/{uid} node either way. See
  // class.js for how these fields get set.
  stats.classTeacherUid = data.classTeacherUid || null;
  stats.classId = data.classId || null;
  stats.classTeacherName = data.classTeacherName || null;
  stats.className = data.className || null;
  // Badges — same piggyback logic as class membership above: same
  // playerStats/{uid} node, one read. Value is earnedAt (ms timestamp);
  // see badges.js for the id list, and awardBadge() below for how they
  // get set.
  stats.badges = data.badges || {};
  // Equipped tile-flight effect — purely cosmetic, see TILE_EFFECTS in
  // main.js. Defaults to 'classic' (always unlocked) so callers never
  // need to handle "no effect chosen yet" as a separate case.
  stats.equippedEffect = data.equippedEffect || 'classic';
  return stats;
}

/* Records a newly-earned badge. Idempotent by design — an update() to
   an already-set key just overwrites its earnedAt timestamp, which is
   harmless (checkers in badges.js are only ever called with an
   already-earned id excluded from consideration in the first place),
   but callers should still avoid re-awarding needlessly. No dedicated
   rule needed: playerStats/{uid} already grants its owner a blanket
   write to every path underneath it. */
export async function awardBadge(uid, badgeId){
  await update(ref(db), { [`playerStats/${uid}/badges/${badgeId}`]: Date.now() });
}

/* Sets which tile-flight effect is currently equipped. Whether
   effectId is actually unlocked (i.e. its badge has been earned) is
   main.js's job to check before calling this — same trust model as
   everything else client-side here, per the README's existing
   "no anti-cheat" note. */
export async function setEquippedEffect(uid, effectId){
  await update(ref(db), { [`playerStats/${uid}/equippedEffect`]: effectId });
}

const FEEDBACK_MAX_LENGTH = 2000;

/* Submits one piece of player feedback (comment/suggestion) to
   feedback/{pushId}. Any signed-in Google account can create a new
   entry; the database rules only allow *creating* a brand-new push
   key, not editing or deleting an existing one, so a submitted note
   can't later be tampered with. Reading it back is restricted to the
   ADMIN_EMAIL account (see getAllFeedback below and the matching rule
   in database.rules.json) — everyone else, including the person who
   submitted it, has no way to read feedback back through the app. */
export async function submitFeedback(uid, name, message){
  const trimmed = (message || '').trim();
  if(!trimmed) throw new Error('empty-message');
  if(trimmed.length > FEEDBACK_MAX_LENGTH) throw new Error('too-long');
  const feedbackRef = push(ref(db, 'feedback'));
  await update(feedbackRef, {
    uid,
    name: name || 'Anonymous',
    message: trimmed,
    createdAt: Date.now(),
  });
}

/* Fetches every feedback entry, newest first, for the admin-only
   in-app viewer. Only actually returns data for ADMIN_EMAIL — the
   database rule denies everyone else, so this throws a permission
   error for any other signed-in account. Pagination (5 per page) is
   handled client-side in main.js by slicing this already-sorted array
   rather than using Firebase's cursor-based paging, since expected
   feedback volume is small enough that fetching it all in one read is
   simpler and cheap. */
export async function getAllFeedback(){
  const snap = await get(ref(db, 'feedback'));
  if(!snap.exists()) return [];
  const data = snap.val();
  return Object.keys(data)
    .map((id) => ({ id, ...data[id] }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/* Deletes one feedback entry. Admin-only per the database rule (see
   database.rules.json) — this is a delete, not an edit; the rules
   explicitly don't allow overwriting an existing entry's content, only
   removing it entirely. */
export async function deleteFeedback(feedbackId){
  await update(ref(db), { [`feedback/${feedbackId}`]: null });
}
