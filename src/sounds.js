/* =========================================================
   Sound effects. Imported (not referenced by string path) so Vite
   resolves each to the correct final URL at build time — this avoids
   the exact class of "works locally, breaks on GitHub Pages" bug we
   hit earlier with absolute paths and the relative `base` config.
   ========================================================= */

import startUrl from './assets/sounds/start.mp3';
import correctUrl from './assets/sounds/correct.mp3';
import wrongUrl from './assets/sounds/wrong.mp3';
import nextUrl from './assets/sounds/next.mp3';
import winnerUrl from './assets/sounds/winner.mp3';
import streakUrl from './assets/sounds/streak.wav';
import streak2Url from './assets/sounds/streak2.wav';
import streak3Url from './assets/sounds/streak3.wav';
import streak4Url from './assets/sounds/streak4.wav';

// Correct-answer sound packs — the audio counterpart to the Tile
// Effects visual packs in main.js (TILE_EFFECTS), unlocked by the same
// badges and picked from the same picker. Keyed by the exact same
// effect id used there ('bounce-drop', 'spin-toss', etc.) so main.js
// can pass its already-resolved activeTileEffectId() straight through
// with no separate mapping to keep in sync. 'classic' has no entry
// here on purpose — it just falls through to the default `correct`
// sound above, same as every other unrecognized/locked id.
import correctBounceDropUrl from './assets/sounds/correct-bounce-drop.mp3';
import correctSpinTossUrl from './assets/sounds/correct-spin-toss.mp3';
import correctWarpZoomUrl from './assets/sounds/correct-warp-zoom.mp3';
import correctConfettiBurstUrl from './assets/sounds/correct-confetti-burst.mp3';
import correctSparkleTrailUrl from './assets/sounds/correct-sparkle-trail.mp3';

const DEFAULT_VOLUME = 0.7;

const sources = {
  start: startUrl,
  correct: correctUrl,
  wrong: wrongUrl,
  next: nextUrl,
  winner: winnerUrl,
  streak: streakUrl,
  streak2: streak2Url,
  streak3: streak3Url,
  streak4: streak4Url,
};

const correctPackSources = {
  'bounce-drop': correctBounceDropUrl,
  'spin-toss': correctSpinTossUrl,
  'warp-zoom': correctWarpZoomUrl,
  'confetti-burst': correctConfettiBurstUrl,
  'sparkle-trail': correctSparkleTrailUrl,
};

// One base <audio> element per sound, preloaded.
const base = {};
for(const [name, url] of Object.entries(sources)){
  const audio = new Audio(url);
  audio.preload = 'auto';
  audio.volume = DEFAULT_VOLUME;
  base[name] = audio;
}

const correctPackBase = {};
for(const [effectId, url] of Object.entries(correctPackSources)){
  const audio = new Audio(url);
  audio.preload = 'auto';
  audio.volume = DEFAULT_VOLUME;
  correctPackBase[effectId] = audio;
}

/* Plays a sound by name ('start' | 'correct' | 'wrong' | 'next' | 'winner' | 'streak' | 'streak2' | 'streak3' | 'streak4').
   Clones the underlying <audio> node each time rather than reusing/
   restarting one instance, so two overlapping plays of the same sound
   (e.g. rapid clicking) don't cut each other off.

   Browsers block audio.play() until the page has had at least one user
   gesture (a click, tap, etc.) — every trigger point in this app is
   either directly inside a click handler or happens on a page where the
   player already clicked something (Start Game / Create Room / Join
   Room) before it could possibly fire, so this should work in practice,
   but the .catch() below silently no-ops if a browser blocks it anyway
   rather than throwing. */
export function playSound(name){
  const source = base[name];
  if(!source) return;
  const instance = source.cloneNode();
  instance.volume = DEFAULT_VOLUME;
  instance.play().catch(() => { /* autoplay restriction — ignore */ });
}

/* Plays the correct-answer sound, using the given tile-effect id's
   pack if one exists (e.g. 'bounce-drop'), otherwise falling back to
   the default 'correct' sound — same fallback behavior as
   animateTileThrow()'s Classic Arc default in main.js, so an
   unrecognized, locked, or 'classic' id always resolves to something
   sensible. Whether that id is actually unlocked, and whether it's
   currently this player's own turn, are main.js's job to resolve
   before calling this — this function only knows about sound files,
   not badges or turn order. */
export function playCorrectSound(effectId){
  const source = correctPackBase[effectId] || base.correct;
  const instance = source.cloneNode();
  instance.volume = DEFAULT_VOLUME;
  instance.play().catch(() => { /* autoplay restriction — ignore */ });
}
