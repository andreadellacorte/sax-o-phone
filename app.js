'use strict';

/* ============================================================
   Sax-o-Phone — a tilt-to-blow virtual saxophone
   ============================================================ */

/* ---------- Web Audio: a reedy monophonic sax voice ---------- */
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let ctx = null;
let voice = null;

// Sax character comes from FORMANTS: a buzzy reed source pushed through a bank
// of fixed resonant peaks (the bore/body resonances). Plus breath noise and a
// touch of convolution reverb for air. This is much closer to a real sax than a
// plain filtered sawtooth.
const SAX_FORMANTS = [
  // freq, Q,  gain (relative)
  [ 600,  9,  1.00],
  [ 1000, 11, 0.80],
  [ 1700, 12, 0.55],
  [ 2600, 10, 0.28],
];

class SaxVoice {
  constructor(ctx) {
    this.ctx = ctx;

    // --- Reed source: detuned saws through a reed-buzz waveshaper ---
    this.osc1 = ctx.createOscillator(); this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator(); this.osc2.type = 'sawtooth'; this.osc2.detune.value = 8;
    this.osc3 = ctx.createOscillator(); this.osc3.type = 'sawtooth'; this.osc3.detune.value = -8;

    this.src = ctx.createGain(); this.src.gain.value = 0.25;
    this.osc1.connect(this.src); this.osc2.connect(this.src); this.osc3.connect(this.src);

    // Gentle drive gives the reed some odd-harmonic bite
    this.drive = ctx.createWaveShaper();
    this.drive.curve = makeDriveCurve(1.8);
    this.src.connect(this.drive);

    // Pre-emphasis highpass so low notes don't get muddy
    this.hp = ctx.createBiquadFilter();
    this.hp.type = 'highpass'; this.hp.frequency.value = 180;
    this.drive.connect(this.hp);

    // --- Formant bank (parallel bandpass resonators) ---
    this.toneSum = ctx.createGain(); this.toneSum.gain.value = 1;
    this.formants = SAX_FORMANTS.map(([f, q, g]) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
      const fg = ctx.createGain(); fg.gain.value = g;
      this.hp.connect(bp).connect(fg).connect(this.toneSum);
      return bp;
    });
    // A little direct signal keeps the body/fundamental present
    this.direct = ctx.createGain(); this.direct.gain.value = 0.4;
    this.hp.connect(this.direct).connect(this.toneSum);

    // --- Breath noise (chiff), scaled by breath ---
    this.noise = ctx.createBufferSource();
    this.noise.buffer = makeNoiseBuffer(ctx);
    this.noise.loop = true;
    this.noiseBP = ctx.createBiquadFilter();
    this.noiseBP.type = 'bandpass'; this.noiseBP.frequency.value = 2400; this.noiseBP.Q.value = 0.6;
    this.noiseGain = ctx.createGain(); this.noiseGain.gain.value = 0;
    this.noise.connect(this.noiseBP).connect(this.noiseGain).connect(this.toneSum);

    // --- Brightness lowpass (opens with breath) ---
    this.bright = ctx.createBiquadFilter();
    this.bright.type = 'lowpass'; this.bright.Q.value = 0.7; this.bright.frequency.value = 1400;
    this.toneSum.connect(this.bright);

    // --- Amplitude envelope (breath) ---
    this.amp = ctx.createGain(); this.amp.gain.value = 0;
    this.bright.connect(this.amp);

    // --- Soft clip -> dry + reverb -> master ---
    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = makeDriveCurve(1.4);
    this.amp.connect(this.shaper);

    this.dry = ctx.createGain(); this.dry.gain.value = 0.82;
    this.wet = ctx.createGain(); this.wet.gain.value = 0.30;
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeImpulse(ctx, 1.5, 3.2);

    this.shaper.connect(this.dry);
    this.shaper.connect(this.reverb).connect(this.wet);

    this.master = ctx.createGain(); this.master.gain.value = 0.9;
    this.dry.connect(this.master);
    this.wet.connect(this.master);
    this.master.connect(ctx.destination);

    // --- Vibrato ---
    this.lfo = ctx.createOscillator(); this.lfo.frequency.value = 5.0;
    this.lfoGain = ctx.createGain(); this.lfoGain.gain.value = 0;
    this.lfo.connect(this.lfoGain);
    this.lfoGain.connect(this.osc1.detune);
    this.lfoGain.connect(this.osc2.detune);
    this.lfoGain.connect(this.osc3.detune);

    [this.osc1, this.osc2, this.osc3, this.noise, this.lfo].forEach(n => n.start());

    this.freq = 220;
    this.setFreq(this.freq, 0);
  }

  setFreq(f, glide = 0.025) {
    const t = this.ctx.currentTime;
    this.freq = f;
    this.osc1.frequency.setTargetAtTime(f, t, glide);
    this.osc2.frequency.setTargetAtTime(f, t, glide);
    this.osc3.frequency.setTargetAtTime(f, t, glide);
  }

  // breath: 0..1
  setBreath(b) {
    const t = this.ctx.currentTime;
    // slightly slower attack than release feels more like air building
    const tc = b > 0.01 ? 0.04 : 0.08;
    this.amp.gain.setTargetAtTime(b * 0.9, t, tc);
    // brightness opens up with breath and note pitch
    const cutoff = Math.min(9000, 500 + this.freq * 1.8 + b * 4200);
    this.bright.frequency.setTargetAtTime(cutoff, t, 0.05);
    // breath noise: a chiff on onset, easing off as the tone settles
    this.noiseGain.gain.setTargetAtTime(b > 0.02 ? 0.03 + b * 0.05 : 0, t, 0.05);
    // vibrato deepens as you push
    this.lfoGain.gain.setTargetAtTime(b * 12, t, 0.12);
  }
}

function makeNoiseBuffer(ctx) {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

// Convolution reverb impulse: exponentially-decaying noise.
function makeImpulse(ctx, seconds, decay) {
  const rate = ctx.sampleRate, len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

function makeDriveCurve(amount) {
  const n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
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
// Breath = how far the phone has tilted AWAY from its calibrated rest pose, in
// any direction. We compare the current gravity direction to the rest gravity
// direction and use the angle between them. This is direction-agnostic, so
// whichever way you tilt from "reading" position (e.g. pushing the top up), it
// blows — there's no signed axis to get backwards.
let restVec = null;                 // normalized gravity vector at rest
const grav = { x: 0, y: 0, z: 0 };  // smoothed gravity
let haveGravity = false;
const DEAD_DEG = 5;                 // degrees of slop before any sound
const SPAN_DEG = 30;                // degrees from silent -> full blow

function normalize(v) {
  const m = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}

function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null) return;
  grav.x = grav.x * 0.82 + a.x * 0.18;
  grav.y = grav.y * 0.82 + a.y * 0.18;
  grav.z = grav.z * 0.82 + a.z * 0.18;
  haveGravity = true;

  if (!restVec) {
    motionStatus.textContent = 'tilt: ready — Calibrate';
    return;
  }
  const cur = normalize(grav);
  const dot = clamp(cur.x * restVec.x + cur.y * restVec.y + cur.z * restVec.z, -1, 1);
  const angle = Math.acos(dot) * 180 / Math.PI;
  motionBreath = clamp((angle - DEAD_DEG) / (SPAN_DEG - DEAD_DEG), 0, 1);
  motionStatus.textContent = `tilt: ${(motionBreath * 100).toFixed(0)}%`;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function calibrate() {
  if (!haveGravity) {           // no sensor data yet — don't lock a bogus rest
    motionStatus.textContent = 'tilt: waiting for sensor…';
    return;
  }
  restVec = normalize(grav);
  motionBreath = 0;
  motionStatus.textContent = 'tilt: calibrated ✓ — push up to blow';
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
