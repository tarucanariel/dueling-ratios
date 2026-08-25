/* =========================================================
   Tile Effects — the cosmetic correct-answer roster (flight animation
   + board theme + sound pack, all keyed off the same effect id in
   main.js/sounds.js/style.css) and which badge(s) unlock each one.

   No DOM, no Firebase calls here on purpose — same reasoning as
   badges.js: main.js owns rendering the picker, playing sounds, and
   persisting the equipped choice; this file just answers "given this
   set of earned badge ids, is this effect unlocked?".
   ========================================================= */

// unlockBadgeIds is a list rather than a single id so an effect can
// require more than one badge at once (see 'gear-5' below, the first
// effect gated on two badges together rather than one) — an empty
// list means "always available" (Classic Arc), a single entry behaves
// exactly like a plain single-badge unlock, and isTileEffectUnlocked()
// below requires every listed badge, not just any one of them.
export const TILE_EFFECTS = [
  { id: 'classic',        name: 'Classic Arc',     icon: '\uD83C\uDFF9', unlockBadgeIds: [] },
  { id: 'bounce-drop',    name: 'Bounce Drop',     icon: '\uD83C\uDFC0', unlockBadgeIds: ['persistence-5'] },
  { id: 'spin-toss',      name: 'Spin Toss',       icon: '\uD83C\uDF00', unlockBadgeIds: ['streak-10'] },
  { id: 'warp-zoom',      name: 'Warp Zoom',       icon: '\u26A1', unlockBadgeIds: ['sharpshooter'] },
  { id: 'confetti-burst', name: 'Confetti Burst',  icon: '\uD83C\uDF89', unlockBadgeIds: ['streak-20'] },
  { id: 'sparkle-trail',  name: 'Sparkle Trail',   icon: '\u2728', unlockBadgeIds: ['operations-mastered'] },
  { id: 'bankai',         name: 'Bankai',          icon: '\uD83D\uDDE1\uFE0F', unlockBadgeIds: ['speed-master'] },
  // The only two-badge unlock in the roster on purpose — Gear 5 is
  // meant to read as the roster's capstone alongside Bankai, so it
  // asks for both a streak badge AND the operation-mastery capstone
  // rather than just one more single badge like everything else.
  { id: 'gear-5',         name: 'Gear 5',          icon: '\uD83C\uDF1E', unlockBadgeIds: ['streak-40', 'operations-mastered'] },
];

export const TILE_EFFECTS_BY_ID = Object.fromEntries(TILE_EFFECTS.map((e) => [e.id, e]));

/* earnedBadgeIds is anything with a `.has(id)` method (a Set, in every
   real call site) — an unrecognized effectId is always "locked" (the
   caller should fall back to 'classic'), and an effect with zero
   required badges is always unlocked regardless of what's been
   earned. */
export function isTileEffectUnlocked(effectId, earnedBadgeIds){
  const effect = TILE_EFFECTS_BY_ID[effectId];
  if(!effect) return false;
  return effect.unlockBadgeIds.every((badgeId) => earnedBadgeIds.has(badgeId));
}
