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

const DEFAULT_VOLUME = 0.7;

const sources = {
  start: startUrl,
  correct: correctUrl,
  wrong: wrongUrl,
  next: nextUrl,
  winner: winnerUrl,
};

// One base <audio> element per sound, preloaded.
const base = {};
for(const [name, url] of Object.entries(sources)){
  const audio = new Audio(url);
  audio.preload = 'auto';
  audio.volume = DEFAULT_VOLUME;
  base[name] = audio;
}

/* Plays a sound by name ('start' | 'correct' | 'wrong' | 'next' | 'winner').
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
