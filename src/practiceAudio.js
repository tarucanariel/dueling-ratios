/* =========================================================
   Practice Test sound cues, synthesised with the Web Audio API (no audio
   files to ship — same approach as dashAudio.js):

     playPracticeStart()        a paper-flip tick, then two rising bell
                                notes: "pencils up, begin".
     playPracticeResults(tier)  a short bell phrase on the results screen.
                                Its mood follows resultTier() — the same
                                bands as the verdict line — but every tier
                                ends on a hopeful note; a low score never
                                gets a "sad" sound.

   The note-scheduling functions take the AudioContext and an output node
   as arguments, so the same code that plays live can also be rendered
   offline and measured. The AudioContext is created lazily on the first
   cue and resumed on demand; both cues fire straight from a click
   (Start Test / Submit), so browser autoplay rules are satisfied. If audio
   is unavailable the cues quietly do nothing.
   ========================================================= */

let ctx = null;
let master = null;

function getContext(){
  if(!ctx){
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if(!AudioCtx) return null;
    ctx = new AudioCtx();
    master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);
  }
  if(ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/* ---------- building blocks ---------- */

// A struck-bell note: a sine fundamental plus a quieter, shorter overtone
// just above the 2nd harmonic, which is what makes it sound like a bell
// rather than a plain beep.
function bell(c, dest, { freq, start, duration = 0.6, volume = 0.1 }){
  [[1, 1, duration], [2.01, 0.3, duration * 0.55]].forEach(([ratio, level, length]) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * ratio, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume * level, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
    osc.connect(gain).connect(dest);
    osc.start(start);
    osc.stop(start + length + 0.05);
  });
}

// A short band-passed burst of noise — the sound of a page being turned.
function paperFlip(c, dest, start, volume = 0.05){
  const length = 0.09;
  const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * length), c.sampleRate);
  const data = buffer.getChannelData(0);
  for(let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 3000;
  filter.Q.value = 0.8;
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  src.connect(filter).connect(gain).connect(dest);
  src.start(start);
}

/* ---------- the cues ---------- */

const C5 = 523.25, E5 = 659.25, G4 = 392.0, G5 = 783.99, C6 = 1046.5, D6 = 1174.66, E7 = 2637.02;

export function scheduleStartCue(c, dest, t){
  paperFlip(c, dest, t);
  bell(c, dest, { freq: G5, start: t + 0.1, duration: 0.5, volume: 0.11 });
  bell(c, dest, { freq: D6, start: t + 0.24, duration: 0.75, volume: 0.1 });
}

export function scheduleResultsCue(c, dest, t, tier){
  switch(tier){
    case 'perfect':
      [C5, E5, G5, C6].forEach((freq, i) => bell(c, dest, { freq, start: t + i * 0.11, duration: 0.5, volume: 0.1 }));
      // a held chord, with a sparkle on top
      [C5, E5, G5, C6].forEach((freq) => bell(c, dest, { freq, start: t + 0.5, duration: 1.4, volume: 0.06 }));
      bell(c, dest, { freq: E7, start: t + 0.62, duration: 0.8, volume: 0.04 });
      break;
    case 'great':
      [C5, E5, G5].forEach((freq, i) => bell(c, dest, { freq, start: t + i * 0.12, duration: 0.5, volume: 0.1 }));
      bell(c, dest, { freq: C6, start: t + 0.4, duration: 1.1, volume: 0.1 });
      break;
    case 'good':
      bell(c, dest, { freq: E5, start: t, duration: 0.5, volume: 0.1 });
      bell(c, dest, { freq: G5, start: t + 0.16, duration: 0.9, volume: 0.1 });
      bell(c, dest, { freq: C5, start: t + 0.16, duration: 0.9, volume: 0.06 });
      break;
    default: // 'keepgoing' — a gentle rise, like "next time"
      bell(c, dest, { freq: G4, start: t, duration: 0.5, volume: 0.09 });
      bell(c, dest, { freq: C5, start: t + 0.2, duration: 0.9, volume: 0.09 });
  }
}

/* ---------- public ---------- */

export function playPracticeStart(){
  const c = getContext();
  if(c) scheduleStartCue(c, master, c.currentTime + 0.02);
}

export function playPracticeResults(tier){
  const c = getContext();
  if(c) scheduleResultsCue(c, master, c.currentTime + 0.02, tier);
}
