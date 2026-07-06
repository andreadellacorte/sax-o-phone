'use strict';

/* ============================================================
   Sax-o-Phone — a tilt-to-blow virtual saxophone
   ============================================================ */

/* ---------- Web Audio: a reedy monophonic sax voice ---------- */
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let ctx = null;
let voice = null;

class SaxVoice {
  constructor(ctx) {
    this.ctx = ctx;

    // Two detuned saws + a square for body = reedy core
    this.osc1 = ctx.createOscillator(); this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator(); this.osc2.type = 'sawtooth'; this.osc2.detune.value = 7;
    this.osc3 = ctx.createOscillator(); this.osc3.type = 'square';   this.osc3.detune.value = -7;

    this.oscMix = ctx.createGain(); this.oscMix.gain.value = 0.32;
    this.osc1.connect(this.oscMix);
    this.osc2.connect(this.oscMix);
    this.osc3.connect(this.oscMix);

    // Breath noise (adds realism, scaled by breath)
    this.noise = ctx.createBufferSource();
    this.noise.buffer = makeNoiseBuffer(ctx);
    this.noise.loop = true;
    this.noiseBP = ctx.createBiquadFilter();
    this.noiseBP.type = 'bandpass';
    this.noiseBP.frequency.value = 2200;
    this.noiseBP.Q.value = 0.7;
    this.noiseGain = ctx.createGain(); this.noiseGain.gain.value = 0;
    this.noise.connect(this.noiseBP).connect(this.noiseGain);

    // Tone-shaping lowpass (brightness follows breath)
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 5;
    this.filter.frequency.value = 1200;

    // Formant peak for that nasal sax honk
    this.formant = ctx.createBiquadFilter();
    this.formant.type = 'peaking';
    this.formant.frequency.value = 1100;
    this.formant.Q.value = 1.4;
    this.formant.gain.value = 8;

    this.oscMix.connect(this.filter);
    this.noiseGain.connect(this.filter);
    this.filter.connect(this.formant);

    // Amplitude envelope (breath)
    this.amp = ctx.createGain(); this.amp.gain.value = 0;
    this.formant.connect(this.amp);

    // Master + soft saturation
    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = makeSoftClip();
    this.master = ctx.createGain(); this.master.gain.value = 0.85;
    this.amp.connect(this.shaper).connect(this.master).connect(ctx.destination);

    // Vibrato LFO -> pitch
    this.lfo = ctx.createOscillator(); this.lfo.frequency.value = 5.2;
    this.lfoGain = ctx.createGain(); this.lfoGain.gain.value = 0;
    this.lfo.connect(this.lfoGain);
    this.lfoGain.connect(this.osc1.detune);
    this.lfoGain.connect(this.osc2.detune);
    this.lfoGain.connect(this.osc3.detune);

    [this.osc1, this.osc2, this.osc3, this.noise, this.lfo].forEach(n => n.start());

    this.freq = 220;
    this.setFreq(this.freq, 0);
  }

  setFreq(f, glide = 0.03) {
    const t = this.ctx.currentTime;
    this.freq = f;
    this.osc1.frequency.setTargetAtTime(f, t, glide);
    this.osc2.frequency.setTargetAtTime(f, t, glide);
    this.osc3.frequency.setTargetAtTime(f, t, glide);
  }

  // breath: 0..1
  setBreath(b) {
    const t = this.ctx.currentTime;
    const tc = 0.02;
    this.amp.gain.setTargetAtTime(b * 0.9, t, tc);
    // brightness opens up with breath and note pitch
    const cutoff = Math.min(9000, 350 + this.freq * 2.2 + b * 3600);
    this.filter.frequency.setTargetAtTime(cutoff, t, tc);
    // breath noise
    this.noiseGain.gain.setTargetAtTime(b > 0.02 ? 0.05 + b * 0.05 : 0, t, tc);
    // vibrato deepens as you push
    this.lfoGain.gain.setTargetAtTime(b * 14, t, 0.1);
  }
}

function makeNoiseBuffer(ctx) {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function makeSoftClip() {
  const n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 1.6);
  }
  return curve;
}

/* ---------- Fingering -> written MIDI note ---------- */
// Canonical patterns for the main six holes, "L1L2L3R1R2R3" (1 = closed).
const MAIN_TABLE = {
  '111111': 62, // D
  '111110': 64, // E
  '111100': 65, // F
  '111101': 66, // F# (fork: R1 + R3)
  '111000': 67, // G
  '110000': 69, // A
  '100000': 71, // B
  '010000': 72, // C
  '000000': 73, // C#  (all open)
};

const NOTE_NAMES = ['C','C♯','D','E♭','E','F','F♯','G','G♯','A','B♭','B'];

function computeWrittenMidi(keys) {
  const L1 = keys.has('L1'), L2 = keys.has('L2'), L3 = keys.has('L3');
  const R1 = keys.has('R1'), R2 = keys.has('R2'), R3 = keys.has('R3');
  const all6 = L1 && L2 && L3 && R1 && R2 && R3;

  let midi;

  // Low notes: all six closed + a pinky/side key
  if (all6 && keys.has('lowBb'))       midi = 58; // Bb3
  else if (all6 && keys.has('lowB'))   midi = 59; // B3
  else if (all6 && keys.has('lowC'))   midi = 60; // C4
  else if (all6 && keys.has('lowCsharp')) midi = 61; // C#4
  else if (all6 && keys.has('lowEb'))  midi = 63; // Eb4
  else {
    const p = (L1?'1':'0')+(L2?'1':'0')+(L3?'1':'0')+(R1?'1':'0')+(R2?'1':'0')+(R3?'1':'0');
    if (p in MAIN_TABLE) {
      midi = MAIN_TABLE[p];
    } else {
      // Forgiving fallback: map by how many holes are closed (top -> bottom scale)
      const closed = (p.match(/1/g) || []).length;
      midi = [73, 71, 69, 67, 65, 64, 62][closed]; // C# B A G F E D
    }
    // F# side key on any G-ish fingering
    if (keys.has('fsharp') && midi === 67) midi = 66;
    // G# raises G by a semitone
    if (keys.has('gsharp') && midi === 67) midi = 68;
  }

  if (keys.has('oct')) midi += 12; // octave key
  return midi;
}

function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }
function midiName(m) { return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); }

/* ---------- State ---------- */
const keysDown = new Set();          // active fingering keys
const pointerMap = new Map();        // pointerId -> key
let transpose = -9;                  // alto by default (written -> sounding)
let padBreath = 0;                   // from BLOW pad (0..1)
let motionBreath = 0;                // from tilt (0..1)
let tiltEnabled = true;              // whether tilt contributes
let currentMidi = null;

/* ---------- DOM ---------- */
const $ = sel => document.querySelector(sel);
const startScreen = $('#startScreen');
const app = $('#app');
const meterFill = $('#meterFill');
const noteName = $('#noteName');
const motionStatus = $('#motionStatus');

function ensureAudio() {
  if (!ctx) {
    ctx = new AudioCtx();
    voice = new SaxVoice(ctx);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

function updateNote() {
  // With no keys pressed this yields open C#, which is correct — a sax always
  // sounds a note while blowing.
  const written = computeWrittenMidi(keysDown);
  currentMidi = written + transpose;
  if (voice) voice.setFreq(midiToFreq(currentMidi));
  noteName.textContent = Number.isFinite(written) ? midiName(written) : '—';
}

/* ---------- Breath loop ---------- */
function breathLoop() {
  const breath = Math.max(padBreath, tiltEnabled ? motionBreath : 0);
  if (voice) voice.setBreath(breath);
  meterFill.style.width = (breath * 100).toFixed(0) + '%';
  requestAnimationFrame(breathLoop);
}

/* ---------- Key (button) handling with multi-touch ---------- */
function bindKeys() {
  document.querySelectorAll('.key').forEach(btn => {
    btn.addEventListener('pointerdown', e => {
      e.preventDefault();
      ensureAudio();
      const key = btn.dataset.key;
      pointerMap.set(e.pointerId, key);
      keysDown.add(key);
      btn.classList.add('down');
      updateNote();
    });
  });

  // BLOW pad
  const pad = $('#blowPad');
  pad.addEventListener('pointerdown', e => {
    e.preventDefault();
    ensureAudio();
    pointerMap.set(e.pointerId, '__blow__');
    padBreath = 1;
    pad.classList.add('down');
  });

  const release = e => {
    const key = pointerMap.get(e.pointerId);
    if (key === undefined) return;
    pointerMap.delete(e.pointerId);

    if (key === '__blow__') {
      // release only if no other pointer holds the pad
      if (![...pointerMap.values()].includes('__blow__')) {
        padBreath = 0;
        pad.classList.remove('down');
      }
      return;
    }

    const stillHeld = [...pointerMap.values()].includes(key);
    if (!stillHeld) {
      keysDown.delete(key);
      // remove .down from the matching button (only if none held it)
      document.querySelectorAll(`.key[data-key="${key}"]`).forEach(b => b.classList.remove('down'));
      updateNote();
    }
  };
  document.addEventListener('pointerup', release);
  document.addEventListener('pointercancel', release);
}

/* ---------- Motion: tilt-to-blow ---------- */
// We measure gravity along the screen normal (z). Reclining the phone's top
// backwards (screen toward ceiling) increases az -> more breath.
let restAz = null;
let smoothAz = 0;
const DEADZONE = 1.0;   // m/s^2 of tilt before any sound
const SPAN = 5.0;       // m/s^2 range from silent -> full blow

function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a || a.z == null) return;
  smoothAz = smoothAz * 0.8 + a.z * 0.2;
  if (restAz == null) {
    motionStatus.textContent = 'tilt: ready — Calibrate';
    return;
  }
  const delta = smoothAz - restAz;
  motionBreath = clamp((delta - DEADZONE) / SPAN, 0, 1);
  motionStatus.textContent = `tilt: ${(motionBreath * 100).toFixed(0)}%`;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function calibrate() {
  restAz = smoothAz;
  motionBreath = 0;
  motionStatus.textContent = 'tilt: calibrated ✓';
}

async function enableMotion() {
  // iOS 13+ requires explicit permission from a user gesture.
  try {
    if (typeof DeviceMotionEvent !== 'undefined' &&
        typeof DeviceMotionEvent.requestPermission === 'function') {
      const res = await DeviceMotionEvent.requestPermission();
      if (res !== 'granted') {
        motionStatus.textContent = 'tilt: denied — use BLOW pad';
        tiltEnabled = false;
        return;
      }
    }
    if ('DeviceMotionEvent' in window) {
      window.addEventListener('devicemotion', onMotion);
      motionStatus.textContent = 'tilt: on — Calibrate';
    } else {
      motionStatus.textContent = 'no sensor — use BLOW pad';
      tiltEnabled = false;
    }
  } catch (err) {
    motionStatus.textContent = 'tilt unavailable — use BLOW pad';
    tiltEnabled = false;
  }
}

/* ---------- Wire up UI ---------- */
$('#startBtn').addEventListener('click', async () => {
  ensureAudio();
  await enableMotion();
  startScreen.classList.add('hidden');
  app.classList.remove('hidden');
  // calibrate shortly after so the phone is settled
  setTimeout(calibrate, 400);
});

$('#calibrateBtn').addEventListener('click', calibrate);

$('#instrument').addEventListener('change', e => {
  transpose = parseInt(e.target.value, 10);
  updateNote();
});

$('#blowMode').addEventListener('click', e => {
  tiltEnabled = !tiltEnabled;
  e.target.textContent = tiltEnabled ? 'Tilt: on' : 'Tilt: off';
  if (!tiltEnabled) motionBreath = 0;
});

$('#showChart').addEventListener('click', e => { e.preventDefault(); $('#chartModal').classList.remove('hidden'); });
$('#closeChart').addEventListener('click', () => $('#chartModal').classList.add('hidden'));

// Prevent long-press context menu / scroll on the instrument
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('gesturestart', e => e.preventDefault());

bindKeys();
requestAnimationFrame(breathLoop);
