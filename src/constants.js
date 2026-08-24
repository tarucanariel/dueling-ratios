/* =========================================================
   Shared constants with zero side effects — safe to import from
   anywhere, including tests, without pulling in Firebase or the DOM.
   Previously lived inline in firebase.js; moved out so badges.js
   (already documented as "no DOM, no Firebase calls here on purpose")
   can actually be imported and tested on its own, without transitively
   running firebase.js's initializeApp()/getAuth() side effects just to
   get two plain string arrays.
   ========================================================= */

export const STATS_MODES = ['solo', 'sameDevice', 'vsComputer', 'online'];

// Fraction operations tracked lifetime (across all modes, same as the
// existing accuracy/lifetime badges) for the operation-mastery badges —
// see badges.js's OPERATION_BADGES. Keyed by the same symbol used on
// problem.op throughout logic.js/main.js, not by an English name, so
// no translation layer is needed between "this pair's operation" and
// "which counter to increment".
export const OPERATIONS = ['+', '-', '×', '÷'];
