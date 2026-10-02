// ===== RATIO DASH SYNTHESISED AUDIO =====
//
// Small Web Audio helpers for the race: a light looping background bed plus
// short "correct" / "wrong" cues. Everything is generated on the fly (no
// audio files to ship) and kept quiet so it sits under the start/winner
// mp3s. The AudioContext is created lazily and resumed on demand -- by the
// time a race starts the player has already clicked several times, so
// browser autoplay rules are satisfied (see sounds.js for the same idea).

let ctx = null;
let masterGain = null;

function getContext() {
    if (!ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return null;
        ctx = new AudioCtx();
        masterGain = ctx.createGain();
        masterGain.gain.value = 1;
        masterGain.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
}

/* One enveloped note. `dest` defaults to the master bus. */
function tone({ freq, start, duration, type = "sine", volume = 0.1, dest, slideTo }) {
    const c = ctx;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(dest || masterGain);
    osc.start(start);
    osc.stop(start + duration + 0.05);
}

/* Bright two-note rising chime. `volume` (0-1) scales it so other players'
   answers can be heard more softly than your own. */
function playDashCorrect(volume = 1) {
    if (!getContext()) return;
    const t = ctx.currentTime;
    tone({ freq: 659.25, start: t, duration: 0.16, type: "triangle", volume: 0.16 * volume });
    tone({ freq: 987.77, start: t + 0.09, duration: 0.28, type: "triangle", volume: 0.16 * volume });
}

/* Soft, short, falling "bonk" -- clearly different from the chime but not
   harsh. */
function playDashWrong(volume = 1) {
    if (!getContext()) return;
    const t = ctx.currentTime;
    tone({ freq: 220, slideTo: 130, start: t, duration: 0.3, type: "sawtooth", volume: 0.07 * volume });
    tone({ freq: 110, slideTo: 80, start: t, duration: 0.3, type: "sine", volume: 0.12 * volume });
}

// ----- background music -----
// A gentle 8-step pentatonic arpeggio over a slow two-chord bass, scheduled
// a little ahead of time so it never stutters when the tab is busy.

const STEP_SEC = 0.25;
const ARP = [523.25, 659.25, 783.99, 659.25, 880.0, 783.99, 659.25, 587.33]; // C5 E5 G5 E5 A5 G5 E5 D5
const BASS = [130.81, 110.0]; // C3, A2
const SCHEDULE_AHEAD_SEC = 0.6;

let musicTimer = null;
let musicBus = null;
let nextStepTime = 0;
let stepIndex = 0;

function scheduleMusic() {
    while (nextStepTime < ctx.currentTime + SCHEDULE_AHEAD_SEC) {
        const i = stepIndex % ARP.length;
        tone({ freq: ARP[i], start: nextStepTime, duration: 0.22, type: "triangle", volume: 0.05, dest: musicBus });
        if (i === 0 || i === 4) {
            const bass = BASS[Math.floor(stepIndex / 4) % BASS.length];
            tone({ freq: bass, start: nextStepTime, duration: 0.9, type: "sine", volume: 0.07, dest: musicBus });
        }
        nextStepTime += STEP_SEC;
        stepIndex++;
    }
}

function startDashMusic() {
    if (musicTimer || !getContext()) return;
    musicBus = ctx.createGain();
    musicBus.gain.setValueAtTime(0.0001, ctx.currentTime);
    musicBus.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 1.5); // fade in
    musicBus.connect(masterGain);

    nextStepTime = ctx.currentTime + 0.1;
    stepIndex = 0;
    scheduleMusic();
    musicTimer = setInterval(scheduleMusic, 150);
}

function stopDashMusic() {
    if (!musicTimer) return;
    clearInterval(musicTimer);
    musicTimer = null;

    const bus = musicBus;
    musicBus = null;
    if (bus && ctx) {
        const t = ctx.currentTime;
        bus.gain.cancelScheduledValues(t);
        bus.gain.setValueAtTime(Math.max(bus.gain.value, 0.0001), t);
        bus.gain.exponentialRampToValueAtTime(0.0001, t + 0.6); // fade out
        setTimeout(() => bus.disconnect(), 800);
    }
}

export { playDashCorrect, playDashWrong, startDashMusic, stopDashMusic };

/* Countdown beeps: a short tick for 3-2-1 and a higher, longer one on Go. */
function playDashCountdownTick(isGo = false) {
    if (!getContext()) return;
    const t = ctx.currentTime;
    tone({ freq: isGo ? 1046.5 : 660, start: t, duration: isGo ? 0.45 : 0.14, type: "square", volume: isGo ? 0.09 : 0.06 });
}

export { playDashCountdownTick };
