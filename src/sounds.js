/* =========================================================
   Sound effects. Imported (not referenced by string path) so Vite
   resolves each to the correct final URL at build time — this avoids
   the exact class of "works locally, breaks on GitHub Pages" bug we
   hit earlier with absolute paths and the relative `base` config.
   ========================================================= */

import startUrl from './assets/sounds/start.mp3';
import bankaiStartUrl from './assets/sounds/bankai.mp3';
import gear5StartUrl from './assets/sounds/gear5.mp3';
import ultraInstinctStartUrl from './assets/sounds/ultra-instinct.mp3';
import kageBunshinStartUrl from './assets/sounds/kage-bunshin.mp3';
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
import correctBankaiUrl from './assets/sounds/correct-bankai.mp3';
import correctGear5Url from './assets/sounds/correct-gear5.mp3';
import correctUltraInstinctUrl from './assets/sounds/correct-ultra-instinct.mp3';
import correctKageBunshinUrl from './assets/sounds/correct-kage-bunshin.mp3';

const DEFAULT_VOLUME = 0.7;

const sources = {
  start: startUrl,
  bankaiStart: bankaiStartUrl,
  gear5Start: gear5StartUrl,
  ultraInstinctStart: ultraInstinctStartUrl,
  kageBunshinStart: kageBunshinStartUrl,
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
  'bankai': correctBankaiUrl,
  'gear-5': correctGear5Url,
  'ultra-instinct': correctUltraInstinctUrl,
  'kage-bunshin': correctKageBunshinUrl,
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

/* Which base `sources` key holds a given effect's own start cue —
   'classic' and every other unrecognized/locked id fall through to
   the default 'start' below. Was a two-branch if/else chain until
   Ultra Instinct became the third effect with its own start sound; a
   lookup table scales to a fourth/fifth far more cleanly than another
   branch would. */
const startPackKeys = {
  'bankai': 'bankaiStart',
  'gear-5': 'gear5Start',
  'ultra-instinct': 'ultraInstinctStart',
  'kage-bunshin': 'kageBunshinStart',
};

/* Plays the game-start sound, swapping in the effect's own start cue
   (see startPackKeys above) whenever one exists — every other
   equipped/locked/unrecognized id (including 'classic') just plays
   the normal start sound, unchanged. Like playCorrectSound(), this
   only knows about sound files — whether the id is actually unlocked,
   and whether a custom start sound even makes sense for a given call
   site, are main.js's job to resolve before calling this. */
export function playStartSound(effectId){
  playSound(startPackKeys[effectId] || 'start');
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

/* Synthesized "heckle" laugh — built live with the Web Audio API rather
   than loaded from a file, so there's no asset to import. Each "ha" is a
   sawtooth "voice" through two bandpass formant filters (the "ah" vowel)
   plus a short burst of high-passed noise for the breathy "h", with a
   fast vibrato for the mocking wobble; the syllables step down in pitch
   and volume like a real laugh trailing off.

   One AudioContext is created lazily and reused — browsers cap how many
   can exist, and creating it on first use (always after the player's
   Start Game click) keeps it clear of the autoplay restriction. Any
   failure (no Web Audio support, a suspended context that refuses to
   resume) silently no-ops, same as playSound()'s .catch(). */
let laughCtx = null;

export function playHeckleLaugh(){
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if(!AudioCtx) return;
    if(!laughCtx) laughCtx = new AudioCtx();
    if(laughCtx.state === 'suspended') laughCtx.resume().catch(() => {});
    const ctx = laughCtx;

    const out = ctx.createGain();
    out.gain.value = DEFAULT_VOLUME * 0.5;
    out.connect(ctx.destination);

    const noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.1), ctx.sampleRate);
    const noiseData = noiseBuf.getChannelData(0);
    for(let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;

    const syllables = 6;
    let t = ctx.currentTime + 0.05;
    for(let i = 0; i < syllables; i++){
      const dur = 0.11 + Math.random() * 0.03;
      const pitch = 330 - i * 22 + Math.random() * 15;
      const vol = 1 - i * 0.1;

      // voiced "a"
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(pitch * 1.08, t);
      osc.frequency.exponentialRampToValueAtTime(pitch * 0.85, t + dur);

      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 18;
      lfoGain.gain.value = pitch * 0.04;
      lfo.connect(lfoGain).connect(osc.frequency);

      const f1 = ctx.createBiquadFilter();
      f1.type = 'bandpass'; f1.frequency.value = 800; f1.Q.value = 6;
      const f2 = ctx.createBiquadFilter();
      f2.type = 'bandpass'; f2.frequency.value = 1200; f2.Q.value = 8;

      const vEnv = ctx.createGain();
      vEnv.gain.setValueAtTime(0, t);
      vEnv.gain.linearRampToValueAtTime(vol, t + 0.02);
      vEnv.gain.exponentialRampToValueAtTime(0.001, t + dur);

      osc.connect(f1).connect(vEnv);
      osc.connect(f2).connect(vEnv);
      vEnv.connect(out);

      // breathy "h" onset
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuf;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 1500;
      const nEnv = ctx.createGain();
      nEnv.gain.setValueAtTime(vol * 0.5, t);
      nEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      noise.connect(hp).connect(nEnv).connect(out);

      osc.start(t); osc.stop(t + dur + 0.02);
      lfo.start(t); lfo.stop(t + dur + 0.02);
      noise.start(t); noise.stop(t + 0.05);

      t += dur + 0.04 + Math.random() * 0.02;
    }
  } catch {
    /* no Web Audio / blocked — ignore */
  }
}
