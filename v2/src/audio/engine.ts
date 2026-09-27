/**
 * Procedural audio engine: adaptive BGM + game-feel SFX, pure Web Audio.
 *
 * - No samples, no fetch, no AudioWorklet, no blob: URLs (CSP / offline safe).
 * - Every public method is a silent no-op before `unlock()` or when Web Audio
 *   is unavailable; nothing here throws into game code.
 * - All music is original (step-sequenced 8-bar loops, 16th-note grid).
 *
 * Signal flow:
 *   voices → layer buses (dry/wet per layer, per track player) → music bus ┐
 *   sfx voices → panner → sfx bus ───────────────────────────────────────── ├→ mix → compressor → soft limiter → master → out
 *   jingle voices → jingle bus ──────────────────────────────────────────── ┘
 *   wet sends → reverbIn → Convolver(procedural IR) → reverb return → mix
 */

export type BgmId =
  | 'title' | 'wild' | 'ashstar' | 'guardian'
  | 'village' | 'forest' | 'road' | 'marsh' | 'shrine';
export type SfxId =
  | 'select' | 'confirm' | 'cancel' | 'turn'
  | 'hit' | 'weak' | 'resist' | 'break'
  | 'perfect' | 'good' | 'miss' | 'guard' | 'parry'
  | 'heal' | 'buff' | 'debuff' | 'ko' | 'pacify'
  | 'resonance' | 'field' | 'charge' | 'reveal'
  | 'step' | 'step_wood' | 'talk' | 'notice' | 'encounter' | 'item_get'
  | 'burn' | 'water' | 'grow' | 'save' | 'door' | 'menu';
export type JingleId = 'victory' | 'defeat' | 'chapter';
type Layer = 0 | 1 | 2;
type Ctx = BaseAudioContext;

// ---------------------------------------------------------------------------
// Constants & small helpers
// ---------------------------------------------------------------------------

const LOOP_STEPS = 128; // 8 bars × 16 sixteenths
const LOOKAHEAD = 0.12; // seconds scheduled ahead of currentTime
const LOOKAHEAD_HIDDEN = 1.5; // background tabs throttle timers to ~1 Hz
const TICK_MS = 25;
const DEFAULT_VOLUME = 0.7;
const INTENSITY_RAMP = 1.5;
const METAL_FREQS = [205.3, 304.4, 369.6, 522.7, 540, 800];
/** Per-intensity gains for [layer0, layer1, layer2]. The base layer also pushes a little harder. */
const LAYER_GAINS: readonly (readonly [number, number, number])[] = [
  [0.8, 0, 0],
  [0.9, 1, 0],
  [1, 1, 1],
];

function mtof(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shared RNG for noise offsets (not musically significant). */
const rng = mulberry32(0x5eed1234);

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function noteToMidi(n: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(n);
  if (!m) return 60;
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + (PC[m[1]] ?? 0) + acc;
}

type MelEv = readonly [midi: number, len: number];

/** "C5:4 E5:2 r:2 ..." per bar (lengths in 16ths) → per-step event table. */
function compileMelody(bars: readonly string[]): (MelEv | undefined)[] {
  const out: (MelEv | undefined)[] = new Array<MelEv | undefined>(LOOP_STEPS).fill(undefined);
  let pos = 0;
  for (const bar of bars) {
    for (const tok of bar.trim().split(/\s+/)) {
      const [name, l] = tok.split(':');
      const len = Number(l) || 1;
      if (name && name !== 'r') out[pos % LOOP_STEPS] = [noteToMidi(name), len];
      pos += len;
    }
  }
  return out;
}

/** 16-step pattern placed on one bar of the 8-bar loop. */
function onBar(bar: number, pat16: string): string {
  return '.'.repeat(16 * bar) + pat16 + '.'.repeat(16 * (7 - bar));
}

/** 16-step pattern that only plays on the first bar of every 4. */
function every4(pat16: string): string {
  return pat16 + '.'.repeat(48);
}

function velOf(ch: string): number {
  return ch === 'x' ? 1 : ch === 'o' ? 0.6 : ch === '-' ? 0.3 : 0;
}

// ---------------------------------------------------------------------------
// Per-context shared resources (noise, reverb IR, shaper curves)
// ---------------------------------------------------------------------------

interface Shared {
  noise: AudioBuffer;
  metal: AudioBuffer; // pre-summed inharmonic square cluster (cheap metallic source)
  impulse: AudioBuffer;
  drive: Float32Array<ArrayBuffer>;
  limit: Float32Array<ArrayBuffer>;
}

const sharedCache = new WeakMap<Ctx, Shared>();

function getShared(ctx: Ctx): Shared {
  const hit = sharedCache.get(ctx);
  if (hit) return hit;
  const sr = ctx.sampleRate;
  const r = mulberry32(0xa11ce);

  const noise = ctx.createBuffer(1, Math.floor(sr * 2), sr);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = r() * 2 - 1;

  const metal = ctx.createBuffer(1, Math.floor(sr * 1.6), sr);
  const md = metal.getChannelData(0);
  for (let i = 0; i < md.length; i++) {
    let v = 0;
    for (const f of METAL_FREQS) v += ((i * f * 1.4) / sr) % 1 < 0.5 ? 1 : -1;
    md[i] = v / METAL_FREQS.length;
  }

  // Small-hall impulse: short pre-delay, exponential decay, gently darkened.
  const irLen = Math.floor(sr * 2.2);
  const impulse = ctx.createBuffer(2, irLen, sr);
  const pre = Math.floor(sr * 0.012);
  for (let c = 0; c < 2; c++) {
    const d = impulse.getChannelData(c);
    let y = 0;
    for (let i = pre; i < irLen; i++) {
      const tt = (i - pre) / sr;
      const x = (r() * 2 - 1) * Math.exp(-tt * 3.1);
      const k = 0.55 - 0.35 * Math.min(1, tt / 2); // darker as it decays
      y += k * (x - y);
      d[i] = y;
    }
  }

  const n = 2048;
  const drive = new Float32Array(n);
  const limit = new Float32Array(n);
  const knee = 0.75;
  const ceiling = 0.98;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    drive[i] = Math.tanh(2.6 * x) / Math.tanh(2.6);
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + (ceiling - knee) * Math.tanh((a - knee) / (ceiling - knee));
    limit[i] = Math.sign(x) * y;
  }
  const s: Shared = { noise, metal, impulse, drive, limit };
  sharedCache.set(ctx, s);
  return s;
}

// ---------------------------------------------------------------------------
// Mixer graph
// ---------------------------------------------------------------------------

interface Graph {
  master: GainNode;
  mix: GainNode;
  music: GainNode;
  sfx: GainNode;
  jingle: GainNode;
  reverbIn: GainNode;
}

function buildGraph(ctx: Ctx, masterLevel: number): Graph {
  const sh = getShared(ctx);
  const master = ctx.createGain();
  master.gain.value = masterLevel;
  master.connect(ctx.destination);

  const limiter = ctx.createWaveShaper();
  limiter.curve = sh.limit;
  limiter.oversample = 'none';
  limiter.connect(master);

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12;
  comp.knee.value = 8;
  comp.ratio.value = 3.5;
  comp.attack.value = 0.004;
  comp.release.value = 0.18;
  // The compressor applies automatic makeup gain (~+4.5 dB with these
  // settings); trim it back so levels stay predictable.
  const trim = ctx.createGain();
  trim.gain.value = 0.8;
  comp.connect(trim);
  trim.connect(limiter);

  const mix = ctx.createGain();
  mix.gain.value = 1;
  mix.connect(comp);

  const conv = ctx.createConvolver();
  conv.buffer = sh.impulse;
  const revReturn = ctx.createGain();
  revReturn.gain.value = 0.32;
  conv.connect(revReturn);
  revReturn.connect(mix);
  const reverbIn = ctx.createGain();
  reverbIn.gain.value = 1;
  reverbIn.connect(conv);

  const music = ctx.createGain();
  music.gain.value = 0.6; // music sits under SFX
  music.connect(mix);
  const sfx = ctx.createGain();
  sfx.gain.value = 1.4; // SFX punch through the music
  sfx.connect(mix);
  const jingle = ctx.createGain();
  jingle.connect(mix);

  return { master, mix, music, sfx, jingle, reverbIn };
}

interface Buses {
  out: GainNode; // player output (crossfade)
  wetOut: GainNode; // player reverb send (crossfade)
  dry: [GainNode, GainNode, GainNode];
  wet: [GainNode, GainNode, GainNode];
}

function makeBuses(ctx: Ctx, g: Graph, level: Layer): Buses {
  const out = ctx.createGain();
  out.connect(g.music);
  const wetOut = ctx.createGain();
  wetOut.connect(g.reverbIn);
  const lv = LAYER_GAINS[level];
  const mk = (dest: AudioNode, v: number): GainNode => {
    const n = ctx.createGain();
    n.gain.value = v;
    n.connect(dest);
    return n;
  };
  return {
    out,
    wetOut,
    dry: [mk(out, lv[0]), mk(out, lv[1]), mk(out, lv[2])],
    wet: [mk(wetOut, lv[0]), mk(wetOut, lv[1]), mk(wetOut, lv[2])],
  };
}

// ---------------------------------------------------------------------------
// Envelope & node primitives
// ---------------------------------------------------------------------------

const FLOOR = 0.0001;

/** ADSR on a gain param. Returns the time the voice is fully silent. */
function adsr(p: AudioParam, t: number, a: number, d: number, s: number, len: number, r: number, peak: number): number {
  const at = Math.max(0.001, a);
  const relStart = t + Math.max(len, at);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + at);
  p.setTargetAtTime(Math.max(FLOOR, peak * s), t + at, Math.max(0.005, d / 3));
  p.setTargetAtTime(0, relStart, Math.max(0.005, r / 4));
  return relStart + r + 0.05;
}

/** Percussive attack/exp-decay envelope. Returns end time. */
function perc(p: AudioParam, t: number, a: number, peak: number, dec: number): number {
  const at = Math.max(0.001, a);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + at);
  p.exponentialRampToValueAtTime(FLOOR, t + at + Math.max(0.01, dec));
  return t + at + dec + 0.02;
}

function mkOsc(ctx: Ctx, type: OscillatorType, f: number, t: number, stop: number, dest: AudioNode, detune = 0): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (detune) o.detune.setValueAtTime(detune, t);
  o.connect(dest);
  o.start(t);
  o.stop(stop);
  return o;
}

function mkNoise(ctx: Ctx, t: number, dur: number, dest: AudioNode): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = getShared(ctx).noise;
  src.connect(dest);
  const d = Math.min(1.9, Math.max(0.01, dur));
  src.start(t, rng() * (1.95 - d), d);
  return src;
}

function mkFilter(ctx: Ctx, type: BiquadFilterType, f: number, q: number, t: number, dest: AudioNode): BiquadFilterNode {
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.frequency.setValueAtTime(f, t);
  b.Q.setValueAtTime(q, t);
  b.connect(dest);
  return b;
}

function mkGain(ctx: Ctx, dest: AudioNode, v = 1): GainNode {
  const g = ctx.createGain();
  g.gain.value = v;
  g.connect(dest);
  return g;
}

// ---------------------------------------------------------------------------
// Instruments
// ---------------------------------------------------------------------------

function vPad(ctx: Ctx, dry: AudioNode, wet: AudioNode | null, t: number, notes: readonly number[], len: number, level: number, cutoff: number, attack: number): void {
  const g = ctx.createGain();
  g.connect(dry);
  if (wet) g.connect(wet);
  const end = adsr(g.gain, t, attack, len * 0.5, 0.7, len, 0.6, level);
  const lp = mkFilter(ctx, 'lowpass', cutoff * 0.55, 0.6, t, g);
  lp.frequency.linearRampToValueAtTime(cutoff, t + len * 0.45);
  lp.frequency.linearRampToValueAtTime(cutoff * 0.7, t + len);
  const sum = mkGain(ctx, lp, 1 / (notes.length * 2.2));
  for (const n of notes) {
    const f = mtof(n);
    mkOsc(ctx, 'sawtooth', f, t, end, sum, -8);
    mkOsc(ctx, 'sawtooth', f, t, end, sum, 8);
  }
}

function vBass(ctx: Ctx, dest: AudioNode, t: number, midi: number, len: number, level: number, drive: boolean): void {
  const f = mtof(midi);
  const g = mkGain(ctx, dest, 0);
  const end = adsr(g.gain, t, 0.004, 0.14, drive ? 0.55 : 0.7, len, 0.05, level);
  if (!drive) {
    const lp = mkFilter(ctx, 'lowpass', 900, 0.7, t, g);
    mkOsc(ctx, 'triangle', f, t, end, lp);
    mkOsc(ctx, 'sine', f / 2, t, end, mkGain(ctx, lp, 0.55));
    mkOsc(ctx, 'sine', f * 2, t, end, mkGain(ctx, lp, 0.08));
  } else {
    const sh = ctx.createWaveShaper();
    sh.curve = getShared(ctx).drive;
    sh.connect(g);
    const lp = mkFilter(ctx, 'lowpass', 2200, 4, t, sh);
    lp.frequency.exponentialRampToValueAtTime(380, t + 0.16);
    const pre = mkGain(ctx, lp, 0.6);
    mkOsc(ctx, 'sawtooth', f, t, end, pre);
    mkOsc(ctx, 'square', f / 2, t, end, mkGain(ctx, pre, 0.5));
  }
}

function vPluck(ctx: Ctx, dest: AudioNode, t: number, midi: number, len: number, level: number, cutoff: number, pan: number): void {
  const f = mtof(midi);
  let target: AudioNode = dest;
  if (pan !== 0) {
    const p = ctx.createStereoPanner();
    p.pan.setValueAtTime(pan, t);
    p.connect(dest);
    target = p;
  }
  const g = mkGain(ctx, target, 0);
  const end = perc(g.gain, t, 0.002, level, Math.max(0.08, len));
  const lp = mkFilter(ctx, 'lowpass', cutoff, 5, t, g);
  lp.frequency.exponentialRampToValueAtTime(Math.max(200, cutoff * 0.15), t + 0.16);
  mkOsc(ctx, 'square', f, t, end, lp);
}

/**
 * Lead timbres. `saw`/`bell` are the battle/title voices; the rest are the
 * softer field-music voices:
 *   flute  — breathy triangle, slow vibrato (village)
 *   reed   — clarinet-ish filtered square, woody and a little mysterious (forest)
 *   bowed  — slow-attack detuned saw, viola-like (road)
 *   chime  — inharmonic temple bell with a long ring (shrine)
 *   vibes  — soft mallet bar with motor tremolo, hazy (marsh)
 */
type LeadWave = 'saw' | 'bell' | 'flute' | 'reed' | 'bowed' | 'chime' | 'vibes';

/** Delayed vibrato (in cents) on a set of oscillators. */
function vibrato(ctx: Ctx, oscs: readonly OscillatorNode[], t: number, end: number, rate: number, cents: number, onset: number, full: number): void {
  const lfo = ctx.createOscillator();
  lfo.frequency.value = rate;
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(0, t);
  depth.gain.linearRampToValueAtTime(0, t + onset);
  depth.gain.linearRampToValueAtTime(cents, t + full);
  lfo.connect(depth);
  for (const o of oscs) depth.connect(o.detune);
  lfo.start(t);
  lfo.stop(end);
}

function vLead(ctx: Ctx, dry: AudioNode, wet: AudioNode | null, t: number, midi: number, len: number, level: number, bright: number, wave: LeadWave): void {
  const f = mtof(midi);
  const g = ctx.createGain();
  g.connect(dry);
  if (wet) g.connect(wet);
  switch (wave) {
    case 'bell': {
      const end = perc(g.gain, t, 0.004, level, Math.max(0.5, len * 1.2));
      mkOsc(ctx, 'sine', f, t, end, g);
      const h = mkGain(ctx, g, 0);
      perc(h.gain, t, 0.002, 0.3, 0.25);
      mkOsc(ctx, 'sine', f * 3, t, end, h);
      mkOsc(ctx, 'triangle', f * 2, t, end, mkGain(ctx, g, 0.12));
      return;
    }
    case 'chime': {
      // Struck bell: fundamental + hum (f/2) ring long, inharmonic partials die fast,
      // a slightly detuned twin gives the slow beating of a real bell.
      const ring = Math.max(1.6, len * 1.5);
      const end = perc(g.gain, t, 0.003, level, ring);
      mkOsc(ctx, 'sine', f, t, end, g);
      mkOsc(ctx, 'sine', f * 1.0035, t, end, mkGain(ctx, g, 0.3));
      mkOsc(ctx, 'sine', f / 2, t, end, mkGain(ctx, g, 0.28));
      const h = mkGain(ctx, g, 0);
      perc(h.gain, t, 0.002, 0.32, ring * 0.3);
      mkOsc(ctx, 'sine', f * 2.76, t, end, h);
      const k = mkGain(ctx, g, 0);
      perc(k.gain, t, 0.001, 0.14, 0.09);
      mkOsc(ctx, 'sine', f * 5.4, t, end, k);
      return;
    }
    case 'vibes': {
      const end = perc(g.gain, t, 0.004, level, Math.max(0.9, len * 1.3));
      const trem = mkGain(ctx, g, 0.7);
      const lfo = ctx.createOscillator();
      lfo.frequency.setValueAtTime(4.6, t);
      const lg = ctx.createGain();
      lg.gain.value = 0.3;
      lfo.connect(lg);
      lg.connect(trem.gain);
      lfo.start(t);
      lfo.stop(end);
      mkOsc(ctx, 'sine', f, t, end, trem);
      const k = mkGain(ctx, trem, 0);
      perc(k.gain, t, 0.001, 0.22, 0.12);
      mkOsc(ctx, 'sine', f * 4, t, end, k);
      return;
    }
    case 'flute': {
      const end = adsr(g.gain, t, 0.06, 0.3, 0.8, len, 0.16, level);
      const lp = mkFilter(ctx, 'lowpass', bright || 2600, 0.7, t, g);
      const a = mkOsc(ctx, 'triangle', f, t, end, lp);
      const b = mkOsc(ctx, 'sine', f * 2, t, end, mkGain(ctx, lp, 0.1));
      vibrato(ctx, [a, b], t, end, 4.8, 11, 0.22, 0.6);
      // Breath chiff on the attack.
      const n = mkGain(ctx, g, 0);
      perc(n.gain, t, 0.008, 0.16, 0.08);
      mkNoise(ctx, t, 0.12, mkFilter(ctx, 'bandpass', Math.min(8000, f * 3), 1.5, t, n));
      return;
    }
    case 'reed': {
      const end = adsr(g.gain, t, 0.03, 0.3, 0.75, len, 0.1, level);
      const lp = mkFilter(ctx, 'lowpass', bright || 1800, 1.1, t, g);
      const a = mkOsc(ctx, 'square', f, t, end, mkGain(ctx, lp, 0.55));
      const b = mkOsc(ctx, 'sine', f, t, end, lp);
      vibrato(ctx, [a, b], t, end, 5, 9, 0.2, 0.5);
      return;
    }
    case 'bowed': {
      const at = Math.min(0.16, len * 0.3);
      const end = adsr(g.gain, t, at, 0.4, 0.85, len, 0.28, level);
      const lp = mkFilter(ctx, 'lowpass', (bright || 1500) * 0.6, 0.8, t, g);
      lp.frequency.linearRampToValueAtTime(bright || 1500, t + at + 0.1);
      const a = mkOsc(ctx, 'sawtooth', f, t, end, mkGain(ctx, lp, 0.6), -4);
      const b = mkOsc(ctx, 'sawtooth', f, t, end, mkGain(ctx, lp, 0.4), 6);
      vibrato(ctx, [a, b], t, end, 5.2, 14, 0.25, 0.7);
      return;
    }
    case 'saw': {
      const end = adsr(g.gain, t, 0.025, 0.25, 0.72, len, 0.14, level);
      const lp = mkFilter(ctx, 'lowpass', bright, 1.2, t, g);
      const a = mkOsc(ctx, 'sawtooth', f, t, end, lp, -5);
      const b = mkOsc(ctx, 'square', f, t, end, mkGain(ctx, lp, 0.45), 5);
      vibrato(ctx, [a, b], t, end, 5.4, 16, 0.18, 0.45);
      return;
    }
  }
}

type ArpVoice = 'pluck' | 'kalimba' | 'marimba' | 'glass';

/** Thumb-piano tine: sine body, inharmonic "tink" partial, soft thumb thump. */
function vKalimba(ctx: Ctx, dest: AudioNode, t: number, midi: number, len: number, level: number): void {
  const f = mtof(midi);
  const g = mkGain(ctx, dest, 0);
  const end = perc(g.gain, t, 0.002, level, Math.max(0.3, len));
  mkOsc(ctx, 'sine', f, t, end, g);
  const k = mkGain(ctx, dest, 0);
  perc(k.gain, t, 0.001, level * 0.3, 0.045);
  mkOsc(ctx, 'sine', f * 5.93, t, t + 0.08, k);
  const th = mkGain(ctx, dest, 0);
  perc(th.gain, t, 0.002, level * 0.35, 0.07);
  mkOsc(ctx, 'triangle', f, t, t + 0.1, th);
}

/** Woody mallet bar: short sine with a tuned 4th partial. */
function vMarimba(ctx: Ctx, dest: AudioNode, t: number, midi: number, len: number, level: number): void {
  const f = mtof(midi);
  const g = mkGain(ctx, dest, 0);
  const end = perc(g.gain, t, 0.002, level, Math.max(0.12, len));
  mkOsc(ctx, 'sine', f, t, end, g);
  const k = mkGain(ctx, dest, 0);
  perc(k.gain, t, 0.001, level * 0.22, 0.035);
  mkOsc(ctx, 'sine', f * 3.98, t, t + 0.07, k);
  const th = mkGain(ctx, dest, 0);
  perc(th.gain, t, 0.001, level * 0.25, 0.02);
  mkOsc(ctx, 'triangle', f * 2, t, t + 0.05, th);
}

/** Soft glassy shimmer: gentle attack, octave overtone, no click. */
function vGlass(ctx: Ctx, dest: AudioNode, t: number, midi: number, len: number, level: number): void {
  const f = mtof(midi);
  const g = mkGain(ctx, dest, 0);
  const end = perc(g.gain, t, 0.025, level, Math.max(0.3, len));
  mkOsc(ctx, 'sine', f, t, end, g);
  mkOsc(ctx, 'sine', f * 2.001, t, end, mkGain(ctx, g, 0.18));
}

/** Sustained low drone (sine + detuned triangle) with a slowly breathing filter. */
function vDrone(ctx: Ctx, dry: AudioNode, wet: AudioNode | null, t: number, notes: readonly number[], len: number, level: number, cutoff: number, seed: number): void {
  const g = ctx.createGain();
  g.connect(dry);
  if (wet) g.connect(wet);
  const at = Math.min(2.5, len * 0.25);
  const end = adsr(g.gain, t, at, 0.5, 1, len, at, level);
  const lp = mkFilter(ctx, 'lowpass', cutoff, 0.5, t, g);
  const lfo = ctx.createOscillator();
  lfo.frequency.setValueAtTime(0.09, t);
  const lg = ctx.createGain();
  lg.gain.value = cutoff * 0.35;
  lfo.connect(lg);
  lg.connect(lp.frequency);
  lfo.start(t);
  lfo.stop(end);
  const sum = mkGain(ctx, lp, 1 / notes.length);
  // A per-trigger micro-detune keeps overlapping retriggers from phase-cancelling.
  const dt = ((seed * 7) % 5) - 2;
  notes.forEach((n, i) => {
    const f = mtof(n);
    mkOsc(ctx, 'sine', f, t, end, sum, dt);
    mkOsc(ctx, 'triangle', f, t, end, mkGain(ctx, sum, 0.45), 5 + i * 2 - dt);
  });
}

type DrumInst = 'kick' | 'snare' | 'clap' | 'hat' | 'ohat' | 'metal' | 'clang' | 'tom' | 'crash' | 'shaker' | 'wood' | 'hand' | 'drop';

function mkMetal(ctx: Ctx, t: number, dur: number, rate: number, dest: AudioNode): void {
  const src = ctx.createBufferSource();
  src.buffer = getShared(ctx).metal;
  src.playbackRate.value = rate;
  src.connect(dest);
  const d = Math.min(1.5, Math.max(0.01, dur));
  src.start(t, rng() * 0.05, d);
}

function vDrum(ctx: Ctx, dest: AudioNode, inst: DrumInst, t: number, v: number): void {
  switch (inst) {
    case 'kick': {
      const g = mkGain(ctx, dest, 0);
      g.gain.setValueAtTime(v, t);
      g.gain.exponentialRampToValueAtTime(FLOOR, t + 0.38);
      const o = mkOsc(ctx, 'sine', 155, t, t + 0.4, g);
      o.frequency.exponentialRampToValueAtTime(44, t + 0.13);
      const c = mkGain(ctx, dest, 0);
      perc(c.gain, t, 0.001, 0.18 * v, 0.012);
      mkNoise(ctx, t, 0.02, mkFilter(ctx, 'highpass', 1800, 0.7, t, c));
      return;
    }
    case 'snare': {
      const n = mkGain(ctx, dest, 0);
      perc(n.gain, t, 0.001, 0.55 * v, 0.17);
      mkNoise(ctx, t, 0.2, mkFilter(ctx, 'bandpass', 1900, 0.75, t, n));
      const b = mkGain(ctx, dest, 0);
      const end = perc(b.gain, t, 0.001, 0.4 * v, 0.09);
      const o = mkOsc(ctx, 'triangle', 205, t, end, b);
      o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
      return;
    }
    case 'clap': {
      const n = mkGain(ctx, dest, 0);
      n.gain.setValueAtTime(0, t);
      for (let i = 0; i < 3; i++) {
        const s = t + i * 0.011;
        n.gain.setValueAtTime(0.5 * v, s);
        n.gain.exponentialRampToValueAtTime(0.05 * v, s + 0.009);
      }
      n.gain.setValueAtTime(0.45 * v, t + 0.034);
      n.gain.exponentialRampToValueAtTime(FLOOR, t + 0.2);
      mkNoise(ctx, t, 0.22, mkFilter(ctx, 'bandpass', 1300, 1.4, t, n));
      return;
    }
    case 'hat':
    case 'ohat': {
      const n = mkGain(ctx, dest, 0);
      perc(n.gain, t, 0.001, 0.32 * v, inst === 'hat' ? 0.045 : 0.24);
      mkNoise(ctx, t, inst === 'hat' ? 0.07 : 0.27, mkFilter(ctx, 'highpass', 7200, 0.8, t, n));
      return;
    }
    case 'metal': {
      const g = mkGain(ctx, dest, 0);
      const end = perc(g.gain, t, 0.001, 0.9 * v, 0.06);
      const hp = mkFilter(ctx, 'highpass', 6800, 0.9, t, g);
      const bp = mkFilter(ctx, 'bandpass', 9500, 0.8, t, hp);
      mkMetal(ctx, t, end - t, 1, bp);
      return;
    }
    case 'clang': {
      const ratios = [1, 1.47, 2.09, 2.56, 3.21];
      ratios.forEach((r, i) => {
        const g = mkGain(ctx, dest, 0);
        const end = perc(g.gain, t, 0.001, (0.16 * v) / (i * 0.6 + 1), 0.35 / (i * 0.4 + 1));
        mkOsc(ctx, 'sine', 360 * r, t, end, g);
      });
      const n = mkGain(ctx, dest, 0);
      perc(n.gain, t, 0.001, 0.2 * v, 0.03);
      mkNoise(ctx, t, 0.05, mkFilter(ctx, 'bandpass', 3000, 1, t, n));
      return;
    }
    case 'tom': {
      const g = mkGain(ctx, dest, 0);
      const end = perc(g.gain, t, 0.002, 0.7 * v, 0.3);
      const o = mkOsc(ctx, 'sine', 140, t, end, g);
      o.frequency.exponentialRampToValueAtTime(78, t + 0.25);
      mkOsc(ctx, 'triangle', 210, t, end, mkGain(ctx, g, 0.2)).frequency.exponentialRampToValueAtTime(110, t + 0.2);
      return;
    }
    case 'crash': {
      const n = mkGain(ctx, dest, 0);
      perc(n.gain, t, 0.002, 0.28 * v, 1.4);
      mkNoise(ctx, t, 1.5, mkFilter(ctx, 'highpass', 4200, 0.6, t, n));
      const m = mkGain(ctx, dest, 0);
      const end = perc(m.gain, t, 0.002, 0.25 * v, 0.9);
      mkMetal(ctx, t, end - t, 1.5, mkFilter(ctx, 'highpass', 5000, 0.7, t, m));
      return;
    }
    case 'shaker': {
      const n = mkGain(ctx, dest, 0);
      perc(n.gain, t, 0.012, 0.3 * v, 0.05);
      mkNoise(ctx, t, 0.08, mkFilter(ctx, 'bandpass', 5800, 1.8, t, n));
      return;
    }
    case 'wood': {
      // Hollow woodblock / clave.
      const g = mkGain(ctx, dest, 0);
      const end = perc(g.gain, t, 0.001, 0.38 * v, 0.05);
      mkOsc(ctx, 'triangle', 1180, t, end, g);
      const h = mkGain(ctx, dest, 0);
      perc(h.gain, t, 0.001, 0.14 * v, 0.022);
      mkOsc(ctx, 'sine', 1870, t, t + 0.05, h);
      return;
    }
    case 'hand': {
      // Soft hand drum: pitched skin tone + a little palm slap.
      const g = mkGain(ctx, dest, 0);
      const end = perc(g.gain, t, 0.002, 0.6 * v, 0.2);
      const o = mkOsc(ctx, 'sine', 215, t, end, g);
      o.frequency.exponentialRampToValueAtTime(160, t + 0.12);
      const n = mkGain(ctx, dest, 0);
      perc(n.gain, t, 0.001, 0.16 * v, 0.035);
      mkNoise(ctx, t, 0.05, mkFilter(ctx, 'bandpass', 950, 1.3, t, n));
      return;
    }
    case 'drop': {
      // Water droplet: a tiny upward sine chirp.
      const g = mkGain(ctx, dest, 0);
      const end = perc(g.gain, t, 0.002, 0.3 * v, 0.07);
      const o = mkOsc(ctx, 'sine', 620, t, end, g);
      o.frequency.exponentialRampToValueAtTime(1500, t + 0.05);
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

interface PadPart { kind: 'pad'; layer: Layer; level: number; oct: number; cutoff: number; attack: number }
interface BassPart { kind: 'bass'; layer: Layer; level: number; pattern: string; drive: boolean }
interface ArpPart { kind: 'arp'; layer: Layer; level: number; pattern: string; oct: number; cutoff: number; len: number; pan: number; voice?: ArpVoice; wet?: boolean }
interface LeadPart { kind: 'lead'; layer: Layer; level: number; mel: (MelEv | undefined)[]; oct: number; bright: number; wave: LeadWave; wet: boolean }
interface DrumPart { kind: 'drum'; layer: Layer; level: number; inst: DrumInst; p: string }
/** Held pedal (absolute midi notes), retriggered every `bars` bars with overlapping swells. */
interface DronePart { kind: 'drone'; layer: Layer; level: number; notes: readonly number[]; bars: number; cutoff: number }
type Part = PadPart | BassPart | ArpPart | LeadPart | DrumPart | DronePart;

interface Track {
  bpm: number;
  swing: number; // fraction of a 16th that odd steps are delayed
  chords: readonly (readonly number[])[]; // 8 bars, midi voicings
  roots: readonly number[]; // 8 bars, bass root midi
  parts: readonly Part[];
}

const d = (inst: DrumInst, layer: Layer, level: number, p: string): DrumPart => ({ kind: 'drum', inst, layer, level, p });

/** 苔むす獣道 hook (shared by the reed lead and its layer-2 glockenspiel double). */
const FOREST_HOOK = compileMelody([
  'C#5:3 F#5:3 E5:2 C#5:2 B4:2 C#5:4',
  'A4:3 B4:3 C#5:2 G#4:6 r:2',
  'C#5:3 F#5:3 E5:2 G#5:2 F#5:2 E5:4',
  'C#5:8 r:4 B4:2 C#5:2',
  'F#5:3 A5:3 G#5:2 F#5:2 E5:2 F#5:4',
  'D5:3 C#5:3 A4:2 F#4:8',
  'B4:2 C#5:2 D5:2 F#5:2 E5:4 D5:2 B4:2',
  'C#5:6 F5:2 G#5:4 r:4',
]);

/** 倒木の旧街道 bowed melody (lead, and a low octave double at layer 2). */
const ROAD_MEL = compileMelody([
  'B4:6 C5:2 B4:4 G4:4',
  'A4:6 G4:2 F4:8',
  'E4:4 G4:4 B4:4 E5:4',
  'D5:8 C5:4 B4:4',
  'C5:6 B4:2 A4:4 E5:4',
  'F5:8 D5:4 Bb4:4',
  'E5:6 D5:2 C5:4 B4:4',
  'D#5:8 r:2 F#4:2 B4:4',
]);

const TRACKS: Record<BgmId, Track> = {
  // Calm, hopeful F-lydian, sparse. Intensity only adds a soft shaker/pulse.
  title: {
    bpm: 90,
    swing: 0,
    chords: [
      [53, 57, 60, 64], // Fmaj7
      [53, 59, 62, 67], // G/F (lydian II)
      [55, 59, 62, 64], // Em7
      [57, 60, 64, 67], // Am7
      [57, 60, 62, 65], // Dm9-ish
      [55, 60, 62, 67], // Gsus
      [55, 59, 60, 64], // Cmaj7
      [55, 59, 62, 64], // G6
    ],
    roots: [41, 41, 40, 45, 38, 43, 36, 35],
    parts: [
      { kind: 'pad', layer: 0, level: 0.26, oct: 0, cutoff: 1500, attack: 0.7 },
      { kind: 'bass', layer: 0, level: 0.34, pattern: 'R_______5_______', drive: false },
      { kind: 'arp', layer: 0, level: 0.06, pattern: '0.1.2.3.4.3.2.1.', oct: 12, cutoff: 2200, len: 0.28, pan: 0.25 },
      {
        kind: 'lead', layer: 0, level: 0.13, oct: 0, bright: 0, wave: 'bell', wet: true,
        mel: compileMelody([
          'C5:4 E5:4 A5:6 G5:2',
          'B5:8 A5:4 G5:4',
          'E5:12 D5:4',
          'C5:4 E5:4 A5:8',
          'A5:4 C6:4 D6:4 C6:4',
          'B5:6 A5:2 G5:8',
          'E5:4 G5:4 C6:8',
          'D5:8 B4:4 r:4',
        ]),
      },
      d('shaker', 1, 0.5, '..-...-...-...-.'),
      d('kick', 1, 0.35, 'x...............................'),
      d('shaker', 2, 0.35, '.-.-.-.-.-.-.-.-'),
    ],
  },

  // Adventurous forest battle: D dorian, 116 BPM, swung & bouncy.
  wild: {
    bpm: 116,
    swing: 0.14,
    chords: [
      [50, 53, 57, 60], // Dm7
      [50, 55, 59, 62], // G/D (dorian IV)
      [52, 55, 60, 64], // C
      [52, 55, 57, 60], // Am7
      [50, 53, 57, 60], // Dm7
      [50, 55, 59, 62], // G
      [53, 57, 60, 64], // Fmaj7
      [50, 52, 57, 62], // Asus
    ],
    roots: [38, 43, 36, 45, 38, 43, 41, 33],
    parts: [
      { kind: 'pad', layer: 0, level: 0.17, oct: 0, cutoff: 1700, attack: 0.12 },
      { kind: 'bass', layer: 0, level: 0.46, pattern: 'R_.OR_.5R_.O5_7.', drive: false },
      d('kick', 0, 0.62, 'x.......x.......'),
      d('hat', 0, 0.45, '..o...o...o...o.'),
      { kind: 'arp', layer: 1, level: 0.085, pattern: '0213421302134231', oct: 12, cutoff: 3200, len: 0.14, pan: 0.3 },
      d('kick', 1, 0.55, '......x...x..x..'),
      d('snare', 1, 0.75, '....x.......x...'),
      d('hat', 1, 0.3, '.-.-.-.-.-.-.-.-'),
      {
        kind: 'lead', layer: 2, level: 0.13, oct: 0, bright: 2700, wave: 'saw', wet: true,
        mel: compileMelody([
          'D5:2 E5:2 F5:2 A5:4 G5:2 F5:2 E5:2',
          'D5:6 B4:2 D5:4 G5:4',
          'E5:2 G5:2 C6:4 B5:2 A5:2 G5:4',
          'A5:8 r:4 E5:2 G5:2',
          'F5:2 A5:2 D6:4 C6:2 A5:2 F5:4',
          'G5:4 B5:4 D6:2 C6:2 B5:4',
          'A5:6 G5:2 F5:4 E5:2 F5:2',
          'E5:8 D5:4 r:4',
        ]),
      },
      d('snare', 2, 0.28, '.......o.o....o.'),
      d('ohat', 2, 0.5, '..............x.'),
      d('crash', 2, 0.6, every4('x...............')),
      d('tom', 2, 0.7, onBar(7, '........x.o.x.oo')),
      d('kick', 2, 0.4, '...o.........o..'),
    ],
  },

  // Industrial tension: C minor, 132 BPM, syncopated driven bass, metal hats.
  ashstar: {
    bpm: 132,
    swing: 0,
    chords: [
      [55, 60, 63], // Cm
      [55, 62, 63], // Cm(add9)
      [56, 60, 63], // Ab
      [58, 62, 65], // Bb
      [55, 60, 63], // Cm
      [56, 60, 65], // Fm
      [55, 56, 60, 63], // Abmaj7
      [55, 59, 62, 65], // G7
    ],
    roots: [36, 36, 32, 34, 36, 41, 32, 31],
    parts: [
      { kind: 'pad', layer: 0, level: 0.14, oct: 0, cutoff: 1100, attack: 0.35 },
      { kind: 'bass', layer: 0, level: 0.36, pattern: 'R.RR.R.OR.R5.R7.', drive: true },
      d('kick', 0, 0.62, 'x.....x...x.....'),
      d('metal', 0, 0.5, '..o...o...o...o.'),
      { kind: 'arp', layer: 1, level: 0.075, pattern: '0.10.20.10.30.20', oct: 12, cutoff: 2600, len: 0.12, pan: -0.3 },
      d('kick', 1, 0.5, '.......x.....x..'),
      d('clap', 1, 0.75, '....x.......x...'),
      d('metal', 1, 0.3, '-o.-.o.--o.-.o.-'),
      {
        kind: 'lead', layer: 2, level: 0.11, oct: 0, bright: 2100, wave: 'saw', wet: true,
        mel: compileMelody([
          'C5:3 Eb5:3 G5:2 F5:3 Eb5:3 D5:2',
          'Eb5:6 D5:2 C5:4 r:4',
          'Ab5:3 G5:3 Eb5:2 C5:4 Eb5:4',
          'D5:3 F5:3 Bb5:2 Ab5:4 G5:4',
          'G5:3 C6:3 Bb5:2 G5:3 Eb5:3 F5:2',
          'Ab5:6 G5:2 F5:4 C5:4',
          'Eb5:3 F5:3 G5:2 Ab5:3 Bb5:3 C6:2',
          'B5:8 D6:4 G5:4',
        ]),
      },
      { kind: 'bass', layer: 2, level: 0.16, pattern: '..O...O...O..O.O', drive: true },
      d('clang', 2, 0.6, '...x......x.....'),
      d('snare', 2, 0.6, onBar(7, '........o.o.xoxx')),
      d('crash', 2, 0.5, every4('x...............')),
    ],
  },

  // Epic boss: E minor → heroic lift (C–D–E major–B), 124 BPM.
  guardian: {
    bpm: 124,
    swing: 0,
    chords: [
      [52, 59, 64, 67], // Em
      [48, 55, 64, 67], // C
      [45, 57, 60, 64], // Am
      [47, 54, 59, 63], // B
      [48, 55, 60, 64], // C
      [50, 57, 62, 66], // D
      [52, 59, 64, 68], // E (major lift)
      [47, 54, 59, 63], // B
    ],
    roots: [40, 36, 33, 35, 36, 38, 40, 35],
    parts: [
      { kind: 'pad', layer: 0, level: 0.22, oct: 0, cutoff: 1500, attack: 0.45 },
      { kind: 'bass', layer: 0, level: 0.46, pattern: 'R_.R_.R_R_.R_.O_', drive: false },
      d('kick', 0, 0.66, 'x.........x.....'),
      d('shaker', 0, 0.4, '-.-.-.-.-.-.-.-.'),
      { kind: 'pad', layer: 1, level: 0.09, oct: 12, cutoff: 2800, attack: 0.5 },
      { kind: 'arp', layer: 1, level: 0.08, pattern: '0123012301230123', oct: 12, cutoff: 3000, len: 0.13, pan: 0.25 },
      d('snare', 1, 0.75, '....x.......x...'),
      d('hat', 1, 0.45, '..o...o...o...o.'),
      d('tom', 1, 0.55, '.............o.o'),
      d('kick', 1, 0.5, '......x.........'),
      {
        kind: 'lead', layer: 2, level: 0.13, oct: 0, bright: 3200, wave: 'saw', wet: true,
        mel: compileMelody([
          'B4:4 E5:4 G5:4 F#5:2 E5:2',
          'G5:6 A5:2 B5:8',
          'C6:6 B5:2 A5:4 E5:4',
          'F#5:8 D#5:4 B4:4',
          'E5:4 G5:4 C6:6 B5:2',
          'A5:4 D6:4 F#6:6 E6:2',
          'E6:4 B5:4 G#5:4 B5:4',
          'F#6:4 D#6:4 B5:8',
        ]),
      },
      {
        kind: 'lead', layer: 2, level: 0.05, oct: -12, bright: 1600, wave: 'saw', wet: false,
        mel: compileMelody([
          'B4:4 E5:4 G5:4 F#5:2 E5:2',
          'G5:6 A5:2 B5:8',
          'C6:6 B5:2 A5:4 E5:4',
          'F#5:8 D#5:4 B4:4',
          'E5:4 G5:4 C6:6 B5:2',
          'A5:4 D6:4 F#6:6 E6:2',
          'E6:4 B5:4 G#5:4 B5:4',
          'F#6:4 D#6:4 B5:8',
        ]),
      },
      d('kick', 2, 0.45, '.....x.....x..x.'),
      d('ohat', 2, 0.45, '..............x.'),
      d('crash', 2, 0.6, every4('x...............')),
      d('snare', 2, 0.6, onBar(7, '........oooxxxxx')),
    ],
  },

  // ---- Field music (碧樹圏). Layer 0 is a complete, melodic piece on its own;
  // layer 1 adds the walking groove; layer 2 adds colour/counter-lines.

  // 樹上集落ハナゾノ: G major, lilting 96 BPM. Kalimba tresillo, breathy flute.
  // Descending bass G–F#–E–D–C–C–B–D; bar 6 turns C major to C minor (the
  // withering great tree) before settling home.
  village: {
    bpm: 96,
    swing: 0.16,
    chords: [
      [55, 59, 62, 66], // Gmaj7
      [54, 57, 62, 64], // D(add9)/F#
      [52, 55, 59, 62], // Em7
      [54, 57, 59, 62], // Bm7/D
      [52, 55, 59, 64], // Cmaj7
      [51, 55, 57, 60], // Cm6
      [55, 59, 62, 67], // G/B
      [55, 57, 60, 62], // D7sus4
    ],
    roots: [43, 42, 40, 38, 36, 36, 35, 38],
    parts: [
      { kind: 'pad', layer: 0, level: 0.17, oct: 0, cutoff: 1250, attack: 0.6 },
      { kind: 'bass', layer: 0, level: 0.34, pattern: 'R_______5___R___', drive: false },
      { kind: 'arp', layer: 0, level: 0.1, pattern: '0..2..1.3..2..1.', oct: 12, cutoff: 0, len: 0.55, pan: 0.2, voice: 'kalimba', wet: true },
      {
        kind: 'lead', layer: 0, level: 0.12, oct: 0, bright: 2600, wave: 'flute', wet: true,
        mel: compileMelody([
          'r:2 D5:2 G5:3 F#5:1 E5:2 D5:2 B4:4',
          'D5:3 C5:1 B4:2 A4:2 F#4:4 A4:4',
          'G4:3 A4:1 B4:4 E5:6 D5:2',
          'D5:12 r:4',
          'r:2 E5:2 G5:3 F#5:1 E5:2 D5:2 E5:4',
          'Eb5:6 D5:2 C5:4 A4:4',
          'B4:4 D5:3 B4:1 A4:4 G4:4',
          'A4:10 r:6',
        ]),
      },
      d('hand', 1, 0.42, 'x.......-...o...'),
      d('shaker', 1, 0.3, '..-...-...-...-.'),
      { kind: 'arp', layer: 1, level: 0.05, pattern: '......3.......2.', oct: 24, cutoff: 0, len: 0.6, pan: -0.35, voice: 'kalimba', wet: true },
      {
        kind: 'lead', layer: 2, level: 0.045, oct: 0, bright: 0, wave: 'bell', wet: true,
        mel: compileMelody([
          'r:8 B5:8',
          'r:8 A5:8',
          'r:8 G5:8',
          'r:4 F#5:4 A5:4 B5:4',
          'r:8 G5:8',
          'r:8 G5:8',
          'r:8 D6:8',
          'r:4 C6:4 B5:4 A5:4',
        ]),
      },
      { kind: 'pad', layer: 2, level: 0.06, oct: 12, cutoff: 2200, attack: 0.9 },
      d('wood', 2, 0.22, '...-.......-..-.'),
    ],
  },

  // 苔むす獣道 (main field theme): F# minor with a lydian D and a harmonic-minor
  // C#7, straight 104 BPM walk. Clarinet-like reed hook on a 3+3+2 rhythm over
  // a marimba ostinato.
  forest: {
    bpm: 104,
    swing: 0,
    chords: [
      [54, 56, 57, 61], // F#m(add9)
      [50, 54, 56, 61], // Dmaj7#11
      [52, 56, 59, 61], // E6
      [49, 52, 56, 59], // C#m7
      [52, 54, 57, 61], // F#m7
      [50, 54, 57, 61], // Dmaj7
      [50, 54, 57, 59], // Bm7
      [49, 53, 56, 59], // C#7
    ],
    roots: [42, 38, 40, 37, 42, 38, 35, 37],
    parts: [
      { kind: 'pad', layer: 0, level: 0.14, oct: 0, cutoff: 1400, attack: 0.3 },
      { kind: 'bass', layer: 0, level: 0.4, pattern: 'R__.R.5.R__.O.5.', drive: false },
      { kind: 'arp', layer: 0, level: 0.13, pattern: '0.3.1.3.2.3.1.3.', oct: 0, cutoff: 0, len: 0.2, pan: 0.25, voice: 'marimba' },
      { kind: 'lead', layer: 0, level: 0.095, oct: 0, bright: 1900, wave: 'reed', wet: true, mel: FOREST_HOOK },
      d('hand', 0, 0.38, 'x.......x..-....'),
      d('shaker', 1, 0.32, '-.o.-.o.-.o.-.o.'),
      d('wood', 1, 0.26, '......x.......x.'),
      d('hand', 1, 0.3, '....-......o.o..'),
      { kind: 'lead', layer: 2, level: 0.04, oct: 12, bright: 0, wave: 'bell', wet: true, mel: FOREST_HOOK },
      { kind: 'bass', layer: 2, level: 0.12, pattern: '..O...O...O...O.', drive: false },
      d('tom', 2, 0.42, onBar(7, '........o...o.o.')),
      d('kick', 2, 0.3, 'x.........x.....'),
    ],
  },

  // 倒木の旧街道 / 灰星局 camp: E phrygian unease (F over an E pedal, a Bb
  // tritone, B7 back home), 92 BPM. A bowed, human melody over the camp's
  // machinery: gated driven-bass pulse, steam-valve ticks, distant clangs.
  road: {
    bpm: 92,
    swing: 0,
    chords: [
      [52, 55, 59, 66], // Em(add9)
      [53, 57, 60, 64], // F/E
      [52, 55, 59, 64], // Em
      [52, 55, 60, 66], // Cmaj9#11 (no root)
      [55, 57, 60, 64], // Am7
      [53, 58, 62, 65], // Bb
      [55, 59, 60, 64], // Cmaj7
      [51, 54, 57, 59], // B7
    ],
    roots: [40, 40, 40, 36, 33, 34, 36, 35],
    parts: [
      { kind: 'pad', layer: 0, level: 0.2, oct: 0, cutoff: 1100, attack: 0.5 },
      { kind: 'bass', layer: 0, level: 0.28, pattern: 'R_______R___5___', drive: false },
      { kind: 'bass', layer: 0, level: 0.15, pattern: 'R.R.R.R.R.R.R.R.', drive: true },
      d('metal', 0, 0.4, '..-...-...-...-.'),
      { kind: 'lead', layer: 0, level: 0.15, oct: 0, bright: 1500, wave: 'bowed', wet: true, mel: ROAD_MEL },
      d('kick', 1, 0.36, 'x.......x.......'),
      d('clang', 1, 0.28, '............x...' + '.'.repeat(16)),
      { kind: 'arp', layer: 1, level: 0.045, pattern: '0.40.40.0.40.40.', oct: 12, cutoff: 1800, len: 0.07, pan: -0.25 },
      { kind: 'bass', layer: 2, level: 0.12, pattern: '...O..O....O..O.', drive: true },
      d('metal', 2, 0.24, '-o.-.o.--o.-.o.-'),
      d('snare', 2, 0.3, '....o.......o...'),
      { kind: 'lead', layer: 2, level: 0.05, oct: -12, bright: 1100, wave: 'bowed', wet: false, mel: ROAD_MEL },
    ],
  },

  // 花粉の湿地: Db lydian ↔ whole-tone haze, slow 72 BPM. Glassy shimmer arp,
  // a tremolo vibraphone melody floating on a 6+6+4 hemiola that drifts up
  // and down whole-tone scales, water drops.
  marsh: {
    bpm: 72,
    swing: 0,
    chords: [
      [53, 56, 60, 67], // Dbmaj7#11
      [55, 58, 63, 67], // Eb/Db (lydian II)
      [54, 58, 62, 64], // whole-tone cluster over C
      [55, 56, 60, 63], // Fm9
      [53, 56, 60, 67], // Dbmaj7#11
      [53, 56, 60, 61], // Bbm9
      [55, 59, 61, 63], // whole-tone cluster over Eb
      [54, 56, 61, 63], // Ab7sus4
    ],
    roots: [37, 37, 36, 41, 37, 34, 39, 44],
    parts: [
      { kind: 'pad', layer: 0, level: 0.21, oct: 0, cutoff: 1100, attack: 1.4 },
      { kind: 'bass', layer: 0, level: 0.33, pattern: 'R_______________', drive: false },
      { kind: 'arp', layer: 0, level: 0.055, pattern: '0.2.1.3.2.0.3.1.', oct: 12, cutoff: 0, len: 0.6, pan: 0.35, voice: 'glass', wet: true },
      {
        kind: 'lead', layer: 0, level: 0.11, oct: 0, bright: 0, wave: 'vibes', wet: true,
        mel: compileMelody([
          'C5:6 F5:6 G5:4',
          'Bb5:6 G5:6 Eb5:4',
          'D5:3 E5:3 F#5:3 G#5:3 Bb5:4',
          'r:2 G5:14',
          'Ab5:6 G5:6 F5:4',
          'C5:6 Db5:6 Ab4:4',
          'A5:3 G5:3 F5:3 Eb5:3 Db5:4',
          'r:2 Eb5:14',
        ]),
      },
      { kind: 'pad', layer: 1, level: 0.07, oct: 12, cutoff: 2400, attack: 1.6 },
      d('drop', 1, 0.5, '......x.........' + '...........o....' + '..o.............' + '.........x..o...'),
      {
        kind: 'lead', layer: 2, level: 0.06, oct: 0, bright: 1800, wave: 'flute', wet: true,
        mel: compileMelody([
          'r:8 Ab4:8',
          'Bb4:16',
          'r:4 Bb4:4 G#4:8',
          'C5:16',
          'r:8 F4:8',
          'Ab4:8 F4:8',
          'r:4 B4:4 A4:8',
          'Ab4:16',
        ]),
      },
      d('shaker', 2, 0.18, '....-.......-...'),
    ],
  },

  // 守護獣の森殿: D with an open-fifth pedal and a miyako-bushi Eb, 60 BPM.
  // Sparse temple bells over a breathing drone; distant taiko at full intensity.
  shrine: {
    bpm: 60,
    swing: 0,
    chords: [
      [50, 57, 62, 64], // D5(add9)
      [50, 57, 62, 64],
      [50, 53, 58, 62], // Bb/D
      [50, 53, 58, 62],
      [50, 55, 60, 64], // C/D
      [48, 55, 60, 64], // C
      [50, 55, 58, 62], // Gm/D
      [50, 55, 57, 64], // A7sus4/D
    ],
    roots: [38, 38, 34, 34, 36, 36, 43, 33],
    parts: [
      { kind: 'drone', layer: 0, level: 0.34, notes: [38, 45, 50], bars: 2, cutoff: 650 },
      { kind: 'pad', layer: 0, level: 0.13, oct: 0, cutoff: 800, attack: 1.6 },
      {
        kind: 'lead', layer: 0, level: 0.15, oct: 0, bright: 0, wave: 'chime', wet: true,
        mel: compileMelody([
          'A4:4 D5:4 E5:8',
          'r:4 A5:8 G5:4',
          'F5:12 D5:4',
          'Eb5:8 D5:8',
          'r:4 G5:4 C6:8',
          'Bb5:8 A5:8',
          'G5:6 F5:2 D5:8',
          'E5:12 r:4',
        ]),
      },
      {
        kind: 'lead', layer: 1, level: 0.1, oct: -12, bright: 0, wave: 'chime', wet: true,
        mel: compileMelody(['D5:16', 'r:16', 'r:16', 'r:16', 'A4:16', 'r:16', 'r:16', 'r:16']),
      },
      { kind: 'bass', layer: 1, level: 0.2, pattern: 'R_______________', drive: false },
      { kind: 'pad', layer: 2, level: 0.05, oct: 12, cutoff: 1800, attack: 2 },
      { kind: 'arp', layer: 2, level: 0.035, pattern: '0.......2.......', oct: 24, cutoff: 0, len: 1.2, pan: 0.4, voice: 'glass', wet: true },
      d('tom', 2, 0.4, 'x.....o.........' + '.'.repeat(16)),
    ],
  },
};

function stepDur(track: Track): number {
  return 60 / track.bpm / 4;
}

function bassOffset(ch: string): number | null {
  switch (ch) {
    case 'R': return 0;
    case 'O': return 12;
    case '5': return 7;
    case '7': return 10;
    default: return null;
  }
}

/**
 * Schedule everything that starts on `step` (mod loop) at base time `t0`
 * into the given buses. Shared by real-time playback and offline rendering.
 */
function scheduleStep(ctx: Ctx, track: Track, step: number, t0: number, b: Buses, active: readonly boolean[]): void {
  const sd = stepDur(track);
  const s = ((step % LOOP_STEPS) + LOOP_STEPS) % LOOP_STEPS;
  const t = t0 + (s % 2 === 1 ? track.swing * sd : 0);
  const bar = Math.floor(s / 16);
  const sb = s % 16;
  const chord = track.chords[bar] ?? [60, 64, 67];
  const root = track.roots[bar] ?? 36;

  for (const part of track.parts) {
    if (!active[part.layer]) continue; // silent layer: don't spend CPU on it
    const dry = b.dry[part.layer];
    switch (part.kind) {
      case 'pad':
        if (sb === 0) vPad(ctx, dry, b.wet[part.layer], t, chord.map((n) => n + part.oct), 16 * sd, part.level, part.cutoff, part.attack);
        break;
      case 'bass': {
        const off = bassOffset(part.pattern[sb] ?? '.');
        if (off === null) break;
        let len = 1;
        while (sb + len < 16 && part.pattern[sb + len] === '_') len++;
        vBass(ctx, dry, t, root + off, len * sd * 0.92, part.level, part.drive);
        break;
      }
      case 'arp': {
        const ch = part.pattern[sb % part.pattern.length] ?? '.';
        const idx = ch >= '0' && ch <= '9' ? Number(ch) : -1;
        if (idx < 0) break;
        const midi = (chord[idx % chord.length] ?? 60) + 12 * Math.floor(idx / chord.length) + part.oct;
        const pan = s % 2 === 0 ? part.pan : -part.pan;
        const voice = part.voice ?? 'pluck';
        if (voice === 'pluck') {
          vPluck(ctx, dry, t, midi, part.len, part.level, part.cutoff, pan);
          break;
        }
        let dest: AudioNode = dry;
        if (pan !== 0 || part.wet) {
          const pn = ctx.createStereoPanner();
          pn.pan.setValueAtTime(pan, t);
          pn.connect(dry);
          if (part.wet) pn.connect(b.wet[part.layer]);
          dest = pn;
        }
        if (voice === 'kalimba') vKalimba(ctx, dest, t, midi, part.len, part.level);
        else if (voice === 'marimba') vMarimba(ctx, dest, t, midi, part.len, part.level);
        else vGlass(ctx, dest, t, midi, part.len, part.level);
        break;
      }
      case 'drone':
        if (sb === 0 && bar % Math.max(1, part.bars) === 0) {
          vDrone(ctx, dry, b.wet[part.layer], t, part.notes, Math.max(1, part.bars) * 16 * sd, part.level, part.cutoff, bar);
        }
        break;
      case 'lead': {
        const ev = part.mel[s];
        if (ev) vLead(ctx, dry, part.wet ? b.wet[part.layer] : null, t, ev[0] + part.oct, ev[1] * sd * 0.95, part.level, part.bright, part.wave);
        break;
      }
      case 'drum': {
        const v = velOf(part.p[s % part.p.length] ?? '.');
        if (v > 0) vDrum(ctx, dry, part.inst, t, v * part.level);
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// SFX
// ---------------------------------------------------------------------------

interface ToneOpts {
  type?: OscillatorType;
  f: number;
  f1?: number; // exponential glide target
  glide?: number; // glide time (defaults to decay)
  a?: number;
  dec: number;
  g: number;
  lp?: number; // optional lowpass cutoff
}

function tone(ctx: Ctx, out: AudioNode, t: number, o: ToneOpts): void {
  const g = mkGain(ctx, out, 0);
  const end = perc(g.gain, t, o.a ?? 0.002, o.g, o.dec);
  const dest = o.lp ? mkFilter(ctx, 'lowpass', o.lp, 0.8, t, g) : g;
  const osc = mkOsc(ctx, o.type ?? 'sine', o.f, t, end, dest);
  if (o.f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + (o.glide ?? o.dec));
}

interface NoiseOpts {
  type: BiquadFilterType;
  f: number;
  f1?: number;
  glide?: number;
  q?: number;
  a?: number;
  dec: number;
  g: number;
}

function noise(ctx: Ctx, out: AudioNode, t: number, o: NoiseOpts): void {
  const g = mkGain(ctx, out, 0);
  const a = o.a ?? 0.001;
  perc(g.gain, t, a, o.g, o.dec);
  const flt = mkFilter(ctx, o.type, o.f, o.q ?? 0.8, t, g);
  if (o.f1 !== undefined) flt.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + (o.glide ?? a + o.dec));
  mkNoise(ctx, t, a + o.dec + 0.03, flt);
}

/** Filtered oscillator sweep with its own envelope. */
function sweep(ctx: Ctx, out: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, lp0: number, lp1: number, dur: number, g: number, a = 0.01): void {
  const gn = mkGain(ctx, out, 0);
  const end = adsr(gn.gain, t, a, dur, 0.8, dur, 0.08, g);
  const lp = mkFilter(ctx, 'lowpass', lp0, 2, t, gn);
  lp.frequency.exponentialRampToValueAtTime(lp1, t + dur);
  const o = mkOsc(ctx, type, f0, t, end, lp);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
}

/** Slow-blooming chord (triangle + detuned saw), optional tremolo shimmer. */
function bloom(ctx: Ctx, out: AudioNode, wet: AudioNode, t: number, notes: readonly number[], p: number, a: number, hold: number, r: number, level: number, lp0: number, lp1: number, trem = 0): void {
  const g = ctx.createGain();
  g.connect(out);
  g.connect(wet);
  const end = adsr(g.gain, t, a, hold, 0.85, a + hold, r, level);
  let head: AudioNode = g;
  if (trem > 0) {
    const tg = mkGain(ctx, g, 1 - trem * 0.5);
    const lfo = ctx.createOscillator();
    lfo.frequency.setValueAtTime(trem * 9, t);
    const lg = ctx.createGain();
    lg.gain.value = trem * 0.5;
    lfo.connect(lg);
    lg.connect(tg.gain);
    lfo.start(t);
    lfo.stop(end);
    head = tg;
  }
  const lp = mkFilter(ctx, 'lowpass', lp0, 0.7, t, head);
  lp.frequency.exponentialRampToValueAtTime(lp1, t + a + hold * 0.5);
  const sum = mkGain(ctx, lp, 1 / notes.length);
  for (const n of notes) {
    const f = mtof(n) * p;
    mkOsc(ctx, 'triangle', f, t, end, sum, -4);
    mkOsc(ctx, 'sawtooth', f, t, end, mkGain(ctx, sum, 0.35), 7);
  }
}

type SfxFn = (ctx: Ctx, o: AudioNode, w: AudioNode, t: number, p: number) => void;

const SFX: Record<SfxId, { dur: number; fn: SfxFn }> = {
  select: {
    dur: 0.08,
    fn: (c, o, _w, t, p) => {
      tone(c, o, t, { f: 1320 * p, dec: 0.05, g: 0.3 });
      tone(c, o, t, { type: 'triangle', f: 2640 * p, dec: 0.02, g: 0.08 });
      noise(c, o, t, { type: 'bandpass', f: 4200, q: 2, dec: 0.012, g: 0.15 });
    },
  },
  confirm: {
    dur: 0.22,
    fn: (c, o, _w, t, p) => {
      tone(c, o, t, { type: 'triangle', f: 880 * p, dec: 0.07, g: 0.2 });
      tone(c, o, t + 0.06, { type: 'triangle', f: 1320 * p, dec: 0.13, g: 0.2 });
      noise(c, o, t, { type: 'highpass', f: 6000, dec: 0.02, g: 0.06 });
    },
  },
  cancel: {
    dur: 0.16,
    fn: (c, o, _w, t, p) => {
      tone(c, o, t, { type: 'triangle', f: 700 * p, f1: 430 * p, glide: 0.1, dec: 0.13, g: 0.34 });
      tone(c, o, t, { f: 350 * p, f1: 215 * p, glide: 0.1, dec: 0.1, g: 0.12 });
    },
  },
  turn: {
    dur: 0.2,
    fn: (c, o, _w, t, p) => {
      tone(c, o, t, { f: 520 * p, dec: 0.08, g: 0.2 });
      tone(c, o, t + 0.07, { f: 780 * p, dec: 0.11, g: 0.15 });
      noise(c, o, t, { type: 'bandpass', f: 3000, q: 1.5, dec: 0.015, g: 0.1 });
    },
  },
  hit: {
    dur: 0.25,
    fn: (c, o, _w, t, p) => {
      noise(c, o, t, { type: 'bandpass', f: 1800 * p, f1: 800 * p, q: 1, dec: 0.14, g: 0.9 });
      noise(c, o, t, { type: 'highpass', f: 4500, dec: 0.025, g: 0.3 });
      tone(c, o, t, { f: 180 * p, f1: 48 * p, glide: 0.12, dec: 0.2, g: 0.9 });
    },
  },
  weak: {
    dur: 0.32,
    fn: (c, o, _w, t, p) => {
      noise(c, o, t, { type: 'bandpass', f: 3200 * p, f1: 1400 * p, q: 0.9, dec: 0.18, g: 1.0 });
      noise(c, o, t, { type: 'highpass', f: 6000, dec: 0.05, g: 0.45 });
      tone(c, o, t, { f: 230 * p, f1: 52 * p, glide: 0.14, dec: 0.25, g: 1.0 });
      tone(c, o, t + 0.02, { type: 'square', f: 520 * p, f1: 1900 * p, glide: 0.11, dec: 0.14, g: 0.11, lp: 5000 });
    },
  },
  resist: {
    dur: 0.25,
    fn: (c, o, _w, t, p) => {
      tone(c, o, t, { f: 120 * p, f1: 55 * p, dec: 0.2, g: 0.8 });
      noise(c, o, t, { type: 'lowpass', f: 480 * p, dec: 0.11, g: 0.55 });
    },
  },
  break: {
    dur: 0.9,
    fn: (c, o, w, t, p) => {
      const r = mulberry32(0xb4ea4);
      noise(c, o, t, { type: 'bandpass', f: 2600 * p, q: 0.7, dec: 0.1, g: 0.8 });
      for (let i = 0; i < 7; i++) {
        noise(c, o, t + r() * 0.32, { type: 'highpass', f: (5000 + r() * 4000) * p, dec: 0.03 + r() * 0.06, g: 0.35 + r() * 0.25 });
      }
      for (let i = 0; i < 6; i++) {
        tone(c, w, t + 0.02 + r() * 0.4, { f: (2600 + r() * 3200) * p, dec: 0.06 + r() * 0.1, g: 0.07 });
        tone(c, o, t + 0.02 + r() * 0.4, { type: 'triangle', f: (3000 + r() * 3000) * p, dec: 0.05 + r() * 0.08, g: 0.06 });
      }
      sweep(c, o, t, 'sawtooth', 2200 * p, 170 * p, 6000, 500, 0.62, 0.12);
      tone(c, o, t, { f: 95 * p, f1: 32 * p, glide: 0.55, dec: 0.8, g: 0.9 });
    },
  },
  perfect: {
    dur: 0.8,
    fn: (c, o, w, t, p) => {
      const f = 1568 * p;
      tone(c, o, t, { f, dec: 0.7, g: 0.32 });
      tone(c, w, t, { f, dec: 0.7, g: 0.12 });
      tone(c, o, t, { f: f * 2.76, dec: 0.32, g: 0.11 });
      for (let i = 0; i < 5; i++) tone(c, w, t + 0.03 + i * 0.035, { f: (4000 + i * 700) * p, dec: 0.12, g: 0.05 });
      noise(c, w, t, { type: 'highpass', f: 9000, a: 0.02, dec: 0.25, g: 0.07 });
      noise(c, o, t, { type: 'highpass', f: 7000, dec: 0.02, g: 0.12 });
    },
  },
  good: {
    dur: 0.5,
    fn: (c, o, w, t, p) => {
      const f = 1175 * p;
      tone(c, o, t, { f, dec: 0.45, g: 0.3 });
      tone(c, w, t, { f, dec: 0.45, g: 0.08 });
      tone(c, o, t, { f: f * 2, dec: 0.22, g: 0.08 });
    },
  },
  miss: {
    dur: 0.14,
    fn: (c, o, _w, t, p) => {
      tone(c, o, t, { type: 'triangle', f: 260 * p, f1: 180 * p, dec: 0.1, g: 0.4, lp: 900 });
      noise(c, o, t, { type: 'lowpass', f: 700, dec: 0.05, g: 0.12 });
    },
  },
  guard: {
    dur: 0.4,
    fn: (c, o, _w, t, p) => {
      const ratios = [1, 1.47, 2.09, 2.93];
      ratios.forEach((r, i) => tone(c, o, t, { type: i === 0 ? 'triangle' : 'sine', f: 310 * r * p, dec: 0.3 / (i + 1) + 0.08, g: 0.3 / (i + 1) }));
      tone(c, o, t, { f: 95 * p, f1: 50 * p, dec: 0.15, g: 0.65 });
      noise(c, o, t, { type: 'bandpass', f: 1300 * p, q: 1.2, dec: 0.05, g: 0.45 });
    },
  },
  parry: {
    dur: 0.6,
    fn: (c, o, w, t, p) => {
      noise(c, o, t, { type: 'bandpass', f: 600 * p, f1: 3600 * p, glide: 0.16, q: 1.5, a: 0.07, dec: 0.14, g: 0.5 });
      const t1 = t + 0.06;
      tone(c, o, t1, { f: 2700 * p, dec: 0.5, g: 0.3 });
      tone(c, w, t1, { f: 2700 * p, dec: 0.5, g: 0.08 });
      tone(c, o, t1, { f: 2700 * 2.41 * p, dec: 0.22, g: 0.1 });
      noise(c, o, t1, { type: 'highpass', f: 8000, dec: 0.03, g: 0.35 });
    },
  },
  heal: {
    dur: 0.8,
    fn: (c, o, w, t, p) => {
      [72, 76, 79, 84, 88].forEach((n, i) => {
        const tt = t + i * 0.07;
        tone(c, o, tt, { type: 'triangle', f: mtof(n) * p, a: 0.012, dec: 0.4, g: 0.12 });
        tone(c, w, tt, { f: mtof(n + 12) * p, a: 0.02, dec: 0.35, g: 0.04 });
      });
    },
  },
  buff: {
    dur: 0.55,
    fn: (c, o, w, t, p) => {
      sweep(c, o, t, 'sawtooth', 300 * p, 1200 * p, 800, 5200, 0.38, 0.14);
      tone(c, o, t, { f: 600 * p, f1: 1800 * p, glide: 0.38, a: 0.02, dec: 0.4, g: 0.1 });
      tone(c, w, t + 0.34, { f: 2400 * p, dec: 0.18, g: 0.06 });
    },
  },
  debuff: {
    dur: 0.6,
    fn: (c, o, _w, t, p) => {
      sweep(c, o, t, 'sawtooth', 900 * p, 180 * p, 3000, 380, 0.45, 0.13);
      sweep(c, o, t, 'sawtooth', 873 * p, 172 * p, 3000, 380, 0.45, 0.1);
      tone(c, o, t, { f: 450 * p, f1: 110 * p, glide: 0.45, a: 0.01, dec: 0.45, g: 0.08 });
    },
  },
  ko: {
    dur: 0.85,
    fn: (c, o, _w, t, p) => {
      sweep(c, o, t, 'square', 620 * p, 70 * p, 2200, 280, 0.7, 0.13);
      noise(c, o, t, { type: 'lowpass', f: 1400, f1: 180, q: 0.8, a: 0.01, dec: 0.6, g: 0.4 });
      tone(c, o, t, { f: 110 * p, f1: 38 * p, dec: 0.45, g: 0.55 });
    },
  },
  pacify: {
    dur: 2.0,
    fn: (c, o, w, t, p) => {
      // Warm F add9 bloom — the emotional signature.
      bloom(c, o, w, t, [53, 57, 60, 65, 67, 69], p, 0.35, 0.55, 0.95, 0.3, 500, 2200);
      tone(c, o, t, { f: 87.3 * p, a: 0.2, dec: 1.4, g: 0.18 });
      tone(c, w, t + 0.3, { f: mtof(81) * p, a: 0.02, dec: 0.9, g: 0.06 });
      tone(c, w, t + 0.42, { f: mtof(84) * p, a: 0.02, dec: 0.9, g: 0.05 });
      tone(c, w, t + 0.54, { f: mtof(88) * p, a: 0.02, dec: 0.8, g: 0.04 });
    },
  },
  resonance: {
    dur: 1.3,
    fn: (c, o, w, t, p) => {
      // D lydian maj7#11 stack, shimmering tremolo swell.
      bloom(c, o, w, t, [62, 69, 73, 76, 80, 85], p, 0.45, 0.3, 0.5, 0.26, 1800, 7000, 1);
      noise(c, w, t, { type: 'highpass', f: 3000, f1: 9000, q: 0.7, a: 0.4, dec: 0.4, g: 0.1 });
      const r = mulberry32(0x7e57);
      for (let i = 0; i < 8; i++) {
        const n = [85, 88, 92, 97][i % 4] ?? 88;
        tone(c, w, t + 0.15 + i * 0.09 + r() * 0.03, { f: mtof(n) * p, dec: 0.25, g: 0.045 });
      }
    },
  },
  field: {
    dur: 1.0,
    fn: (c, o, w, t, p) => {
      noise(c, o, t, { type: 'bandpass', f: 300 * p, f1: 2800 * p, glide: 0.5, q: 0.8, a: 0.2, dec: 0.5, g: 0.45 });
      bloom(c, o, w, t + 0.05, [55, 62, 67, 71, 74], p, 0.22, 0.2, 0.45, 0.14, 700, 2000);
    },
  },
  charge: {
    dur: 1.1,
    fn: (c, o, _w, t, p) => {
      const g = mkGain(c, o, 0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.35, t + 0.9);
      g.gain.exponentialRampToValueAtTime(FLOOR, t + 1.05);
      const trem = mkGain(c, g, 0.75);
      const lfo = c.createOscillator();
      lfo.frequency.setValueAtTime(6, t);
      lfo.frequency.linearRampToValueAtTime(18, t + 1);
      const lg = c.createGain();
      lg.gain.value = 0.25;
      lg.connect(trem.gain);
      lfo.connect(lg);
      lfo.start(t);
      lfo.stop(t + 1.1);
      const lp = mkFilter(c, 'lowpass', 150, 3, t, trem);
      lp.frequency.exponentialRampToValueAtTime(950, t + 1);
      mkOsc(c, 'sawtooth', 45 * p, t, t + 1.1, lp).frequency.exponentialRampToValueAtTime(115 * p, t + 1);
      mkOsc(c, 'sawtooth', 45.6 * p, t, t + 1.1, lp).frequency.exponentialRampToValueAtTime(116.5 * p, t + 1);
      noise(c, o, t, { type: 'lowpass', f: 200, f1: 1300, glide: 1, a: 0.9, dec: 0.12, g: 0.3 });
    },
  },
  reveal: {
    dur: 0.4,
    fn: (c, o, w, t, p) => {
      [2093, 2637, 3136, 4186].forEach((f, i) => {
        tone(c, o, t + i * 0.04, { f: f * p, dec: 0.18, g: 0.08 });
        tone(c, w, t + i * 0.04, { f: f * p, dec: 0.18, g: 0.04 });
      });
      noise(c, w, t, { type: 'highpass', f: 8000, a: 0.02, dec: 0.2, g: 0.06 });
    },
  },

  // ---- Field / exploration ------------------------------------------------
  // `step`, `step_wood` and `talk` fire several times a second: they are kept
  // very quiet, dry and short, and vary slightly per call so repeats don't
  // sound machine-gunned.
  step: {
    dur: 0.1,
    fn: (c, o, _w, t, p) => {
      const v = 0.85 + rng() * 0.3;
      noise(c, o, t, { type: 'lowpass', f: 900 * v * p, f1: 280, q: 0.7, a: 0.004, dec: 0.06, g: 0.19 });
      noise(c, o, t + 0.008, { type: 'bandpass', f: 3400 * v, q: 1.1, a: 0.006, dec: 0.035, g: 0.04 });
    },
  },
  step_wood: {
    dur: 0.12,
    fn: (c, o, _w, t, p) => {
      const v = 0.94 + rng() * 0.12;
      tone(c, o, t, { type: 'triangle', f: 190 * v * p, f1: 140 * v * p, glide: 0.06, dec: 0.08, g: 0.1, lp: 1200 });
      tone(c, o, t, { f: 430 * v * p, dec: 0.035, g: 0.025 });
      noise(c, o, t, { type: 'bandpass', f: 1300 * v, q: 1.8, dec: 0.022, g: 0.055 });
    },
  },
  talk: {
    dur: 0.05,
    fn: (c, o, _w, t, p) => {
      tone(c, o, t, { type: 'triangle', f: 760 * p, dec: 0.032, g: 0.085, lp: 2400 });
    },
  },
  notice: {
    dur: 0.35,
    fn: (c, o, w, t, p) => {
      tone(c, o, t, { type: 'triangle', f: 700 * p, f1: 1760 * p, glide: 0.05, dec: 0.07, g: 0.2 });
      tone(c, o, t + 0.06, { f: 1760 * p, dec: 0.22, g: 0.22 });
      tone(c, w, t + 0.06, { f: 1760 * p, dec: 0.22, g: 0.05 });
      tone(c, o, t + 0.06, { type: 'triangle', f: 3520 * p, dec: 0.06, g: 0.05 });
      noise(c, o, t, { type: 'bandpass', f: 2500, q: 1.5, dec: 0.015, g: 0.12 });
    },
  },
  encounter: {
    dur: 0.95,
    fn: (c, o, w, t, p) => {
      // Rising rush into a dissonant (tritone + minor 2nd) stab with a low hit.
      noise(c, o, t, { type: 'bandpass', f: 500 * p, f1: 4200 * p, glide: 0.22, q: 1.1, a: 0.18, dec: 0.08, g: 0.3 });
      const t1 = t + 0.2;
      for (const n of [62, 68, 73]) {
        tone(c, o, t1, { type: 'sawtooth', f: mtof(n) * p, dec: 0.45, g: 0.07, lp: 3200 });
        tone(c, w, t1, { type: 'triangle', f: mtof(n + 12) * p, dec: 0.5, g: 0.05 });
      }
      tone(c, o, t1, { f: 130 * p, f1: 46 * p, glide: 0.2, dec: 0.4, g: 0.6 });
      noise(c, o, t1, { type: 'highpass', f: 5000, dec: 0.05, g: 0.2 });
      vDrum(c, o, 'tom', t1 + 0.18, 0.45);
    },
  },
  item_get: {
    dur: 0.75,
    fn: (c, o, w, t, p) => {
      // "da-da-DING": two quick square notes, then a ringing bell dyad.
      tone(c, o, t, { type: 'square', f: mtof(79) * p, dec: 0.07, g: 0.06, lp: 3500 });
      tone(c, o, t + 0.08, { type: 'square', f: mtof(84) * p, dec: 0.07, g: 0.06, lp: 3500 });
      const t1 = t + 0.16;
      for (const n of [88, 91]) {
        tone(c, o, t1, { f: mtof(n) * p, dec: 0.55, g: 0.12 });
        tone(c, w, t1, { f: mtof(n) * p, dec: 0.55, g: 0.05 });
        tone(c, o, t1, { f: mtof(n) * 2.76 * p, dec: 0.12, g: 0.03 });
      }
      noise(c, w, t1, { type: 'highpass', f: 8000, a: 0.01, dec: 0.18, g: 0.05 });
    },
  },
  burn: {
    dur: 1.3,
    fn: (c, o, w, t, p) => {
      // Whoosh + roar body + random crackles.
      noise(c, o, t, { type: 'bandpass', f: 350 * p, f1: 1800 * p, glide: 0.35, q: 0.9, a: 0.1, dec: 0.5, g: 0.34 });
      noise(c, o, t + 0.05, { type: 'lowpass', f: 700 * p, f1: 250, glide: 1, q: 0.6, a: 0.12, dec: 0.9, g: 0.28 });
      noise(c, w, t, { type: 'bandpass', f: 900 * p, q: 0.7, a: 0.15, dec: 0.5, g: 0.1 });
      tone(c, o, t, { f: 80 * p, f1: 48 * p, glide: 0.4, a: 0.03, dec: 0.45, g: 0.25 });
      const r = mulberry32(0xf14e);
      for (let i = 0; i < 14; i++) {
        noise(c, o, t + 0.08 + r() * 0.95, { type: 'bandpass', f: (1800 + r() * 3500) * p, q: 2.5, dec: 0.008 + r() * 0.014, g: 0.18 + r() * 0.2 });
      }
    },
  },
  water: {
    dur: 1.2,
    fn: (c, o, w, t, p) => {
      // Splash, then a flowing wash and a few bubbles.
      noise(c, o, t, { type: 'bandpass', f: 2600 * p, f1: 900 * p, glide: 0.2, q: 0.8, a: 0.005, dec: 0.22, g: 0.36 });
      noise(c, o, t + 0.06, { type: 'lowpass', f: 1600 * p, f1: 450, glide: 0.9, q: 0.7, a: 0.12, dec: 0.8, g: 0.22 });
      noise(c, w, t + 0.06, { type: 'bandpass', f: 1200 * p, q: 0.6, a: 0.15, dec: 0.6, g: 0.08 });
      const r = mulberry32(0x3a7e2);
      for (let i = 0; i < 6; i++) {
        const f0 = (450 + r() * 700) * p;
        tone(c, o, t + 0.15 + r() * 0.7, { f: f0, f1: f0 * 2.1, glide: 0.04, dec: 0.06, g: 0.06 + r() * 0.04 });
      }
    },
  },
  grow: {
    dur: 1.1,
    fn: (c, o, w, t, p) => {
      // Rising G-pentatonic tine run over a swelling low tone and a leafy rustle.
      tone(c, o, t, { f: 98 * p, f1: 196 * p, glide: 0.8, a: 0.35, dec: 0.55, g: 0.12 });
      noise(c, o, t, { type: 'bandpass', f: 400 * p, f1: 2400 * p, glide: 0.8, q: 1.4, a: 0.35, dec: 0.4, g: 0.1 });
      [67, 69, 74, 76, 79, 81, 86].forEach((n, i) => {
        const tt = t + 0.05 + i * 0.085;
        tone(c, o, tt, { f: mtof(n) * p, dec: 0.3, g: 0.09 });
        tone(c, o, tt, { f: mtof(n) * 5.93 * p, dec: 0.03, g: 0.025 });
        tone(c, w, tt, { f: mtof(n) * p, dec: 0.3, g: 0.04 });
      });
    },
  },
  save: {
    dur: 1.4,
    fn: (c, o, w, t, p) => {
      // Two soft bell strokes (G5, D6) over a warm G4 hum.
      tone(c, o, t, { f: mtof(67) * p, a: 0.06, dec: 1.1, g: 0.06 });
      for (const [n, dt] of [[79, 0], [86, 0.16]] as const) {
        const f = mtof(n) * p;
        tone(c, o, t + dt, { f, dec: 1.0, g: 0.13 });
        tone(c, w, t + dt, { f, dec: 1.0, g: 0.07 });
        tone(c, o, t + dt, { f: f * 2.76, dec: 0.2, g: 0.025 });
      }
    },
  },
  door: {
    dur: 0.45,
    fn: (c, o, w, t, p) => {
      noise(c, o, t, { type: 'bandpass', f: 380 * p, f1: 1500 * p, glide: 0.3, q: 0.9, a: 0.14, dec: 0.24, g: 0.24 });
      noise(c, w, t, { type: 'bandpass', f: 800 * p, q: 0.8, a: 0.14, dec: 0.2, g: 0.06 });
      tone(c, o, t + 0.1, { f: 90 * p, f1: 60 * p, dec: 0.12, g: 0.1 });
    },
  },
  menu: {
    dur: 0.15,
    fn: (c, o, _w, t, p) => {
      noise(c, o, t, { type: 'bandpass', f: 1800 * p, f1: 3600 * p, glide: 0.05, q: 1.2, a: 0.015, dec: 0.05, g: 0.16 });
      tone(c, o, t, { f: 587 * p, f1: 880 * p, glide: 0.04, dec: 0.09, g: 0.3 });
    },
  },
};

function fireSfx(ctx: Ctx, g: Graph, id: SfxId, t: number, pan: number, pitch: number): void {
  const def = SFX[id];
  if (!def) return;
  let out: AudioNode = g.sfx;
  if (pan !== 0) {
    const p = ctx.createStereoPanner();
    p.pan.setValueAtTime(clamp(pan, -1, 1), t);
    p.connect(g.sfx);
    out = p;
  }
  def.fn(ctx, out, g.reverbIn, t, clamp(pitch, 0.25, 4));
}

// ---------------------------------------------------------------------------
// Jingles
// ---------------------------------------------------------------------------

type JEv = readonly [time: number, midi: number, dur: number];
interface JingleDef {
  dur: number;
  lead: readonly JEv[];
  leadWave: LeadWave;
  leadBright: number;
  pads: readonly (readonly [time: number, notes: readonly number[], dur: number])[];
  bass: readonly JEv[];
  hits: readonly (readonly [time: number, inst: DrumInst, vel: number])[];
  bells?: readonly JEv[]; // optional glockenspiel sparkle
}

const JINGLES: Record<JingleId, JingleDef> = {
  victory: {
    dur: 3.9,
    leadWave: 'saw',
    leadBright: 3400,
    lead: [
      [0.0, 67, 0.11], [0.12, 72, 0.11], [0.24, 76, 0.11], [0.36, 79, 0.48],
      [0.9, 77, 0.13], [1.05, 81, 0.13], [1.2, 84, 0.58],
      [1.85, 83, 0.13], [2.0, 86, 0.13], [2.15, 84, 1.3],
    ],
    pads: [
      [0.36, [60, 64, 67], 0.54],
      [0.9, [60, 65, 69], 0.9],
      [1.85, [62, 67, 71], 0.3],
      [2.15, [48, 60, 64, 67, 72], 1.35],
    ],
    bass: [[0.36, 36, 0.5], [0.9, 41, 0.9], [1.85, 43, 0.28], [2.15, 36, 1.3]],
    hits: [
      [0.36, 'kick', 0.8], [0.36, 'crash', 0.5], [0.9, 'kick', 0.7], [1.2, 'tom', 0.6],
      [1.85, 'snare', 0.4], [1.92, 'snare', 0.5], [2.0, 'snare', 0.6], [2.07, 'snare', 0.7],
      [2.15, 'kick', 0.9], [2.15, 'crash', 0.8],
    ],
  },
  defeat: {
    dur: 3.9,
    leadWave: 'saw',
    leadBright: 1300,
    lead: [[0.0, 76, 0.45], [0.5, 74, 0.45], [1.0, 72, 0.5], [1.55, 71, 0.8], [2.4, 69, 1.3]],
    pads: [
      [0.0, [57, 60, 64], 1.0],
      [1.0, [53, 57, 60, 65], 0.55],
      [1.55, [52, 56, 59, 64], 0.85],
      [2.4, [45, 57, 60, 64], 1.4],
    ],
    bass: [[0.0, 45, 1.0], [1.0, 41, 0.55], [1.55, 40, 0.85], [2.4, 33, 1.4]],
    hits: [[0.0, 'tom', 0.4], [2.4, 'tom', 0.5]],
  },
  // Chapter clear: the village's dotted "Hanazono" motif, a C→Cm (iv minor)
  // sigh, then D7sus opening onto a wide Gmaj9 with a rising sparkle.
  chapter: {
    dur: 5.4,
    leadWave: 'flute',
    leadBright: 2800,
    lead: [
      [0.0, 74, 0.26], [0.28, 79, 0.4], [0.7, 78, 0.12], [0.84, 76, 0.26], [1.12, 74, 0.52],
      [1.7, 75, 0.26], [1.98, 74, 0.26], [2.26, 72, 0.5],
      [2.8, 74, 0.26], [3.08, 81, 0.26], [3.36, 79, 1.8],
    ],
    pads: [
      [0.0, [52, 55, 59, 64], 1.68],
      [1.7, [51, 55, 57, 60], 1.08],
      [2.8, [50, 55, 57, 60], 0.54],
      [3.36, [55, 59, 62, 66, 69], 1.9],
    ],
    bass: [[0.0, 36, 1.68], [1.7, 36, 1.08], [2.8, 38, 0.54], [3.36, 43, 1.9]],
    hits: [[0.0, 'hand', 0.35], [1.7, 'hand', 0.3], [3.36, 'tom', 0.3], [3.36, 'crash', 0.18]],
    bells: [[3.36, 83, 0.4], [3.48, 86, 0.4], [3.6, 90, 0.4], [3.72, 93, 0.5], [4.1, 91, 1.0]],
  },
};

function scheduleJingle(ctx: Ctx, g: Graph, id: JingleId, t: number): void {
  const j = JINGLES[id];
  const out = g.jingle;
  const wet = g.reverbIn;
  for (const [tt, m, dur] of j.lead) vLead(ctx, out, wet, t + tt, m, dur, 0.16, j.leadBright, j.leadWave);
  if (id === 'victory') {
    // Harmony a sixth below for brass-like weight.
    for (const [tt, m, dur] of j.lead) vLead(ctx, out, null, t + tt, m - 9 + (m % 12 === 7 ? 1 : 0), dur, 0.06, 2200, 'saw');
  }
  for (const [tt, notes, dur] of j.pads) vPad(ctx, out, wet, t + tt, notes, dur, 0.2, 1800, 0.04);
  for (const [tt, m, dur] of j.bass) vBass(ctx, out, t + tt, m, dur, 0.42, false);
  for (const [tt, inst, v] of j.hits) vDrum(ctx, out, inst, t + tt, v);
  for (const [tt, m, dur] of j.bells ?? []) vLead(ctx, out, wet, t + tt, m, dur, 0.05, 0, 'bell');
}

// ---------------------------------------------------------------------------
// Real-time engine
// ---------------------------------------------------------------------------

interface Player {
  track: Track;
  buses: Buses;
  step: number;
  next: number; // unswung time of `step`
  endAt: number; // stop scheduling after this (Infinity while active)
  layerUntil: [number, number, number]; // schedule layer i while `next` < this
}

function layerUntilFor(level: Layer): [number, number, number] {
  const g = LAYER_GAINS[level];
  return [g[0] > 0 ? Infinity : -Infinity, g[1] > 0 ? Infinity : -Infinity, g[2] > 0 ? Infinity : -Infinity];
}

type ACCtor = new (opts?: AudioContextOptions) => AudioContext;

function getAudioContextCtor(): ACCtor | null {
  const g = globalThis as unknown as { AudioContext?: ACCtor; webkitAudioContext?: ACCtor };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

function rampParam(p: AudioParam, v: number, now: number, sec: number): void {
  p.cancelScheduledValues(now);
  p.setValueAtTime(p.value, now);
  p.linearRampToValueAtTime(v, now + Math.max(0.005, sec));
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private graph: Graph | null = null;
  private cur: Player | null = null;
  private fading: Player[] = [];
  private curId: BgmId | null = null;
  private intensity: Layer = 0;
  private muted = false;
  private volume = DEFAULT_VOLUME;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSfx = new Map<SfxId, number>();

  /** Create/resume the AudioContext. Call from a user gesture. Never rejects. */
  async unlock(): Promise<void> {
    try {
      if (!this.ctx) {
        const AC = getAudioContextCtor();
        if (!AC) return;
        const ctx = new AC({ latencyHint: 'interactive' });
        this.ctx = ctx;
        this.graph = buildGraph(ctx, this.muted ? 0 : this.volume);
        if (this.curId) this.startPlayer(this.curId, 0.8);
      }
      const ctx = this.ctx;
      if (ctx.state !== 'running') {
        await Promise.race([
          ctx.resume().catch(() => undefined),
          new Promise<void>((r) => setTimeout(r, 400)),
        ]);
      }
    } catch {
      /* audio unavailable — stay silent */
    }
  }

  playBgm(id: BgmId): void {
    try {
      if (id === this.curId && (this.cur || !this.ctx)) return;
      this.curId = id;
      if (!this.ctx || !this.graph) return; // remembered; starts on unlock()
      this.startPlayer(id, 0.8);
    } catch {
      /* ignore */
    }
  }

  stopBgm(fadeSec = 0.8): void {
    try {
      this.curId = null;
      const ctx = this.ctx;
      if (!ctx || !this.cur) return;
      this.fadeOut(this.cur, ctx.currentTime, Math.max(0.01, fadeSec));
      this.cur = null;
    } catch {
      /* ignore */
    }
  }

  setIntensity(level: 0 | 1 | 2): void {
    try {
      const lv: Layer = level === 2 ? 2 : level === 1 ? 1 : 0;
      if (lv === this.intensity) return;
      this.intensity = lv;
      const ctx = this.ctx;
      const p = this.cur;
      if (!ctx || !p) return;
      const now = ctx.currentTime;
      const gains = LAYER_GAINS[lv];
      for (let i = 0; i < 3; i++) {
        const v = gains[i]!;
        rampParam(p.buses.dry[i]!.gain, v, now, INTENSITY_RAMP);
        rampParam(p.buses.wet[i]!.gain, v, now, INTENSITY_RAMP);
        // Keep scheduling a layer while it fades out; stop once it is silent.
        if (v > 0) p.layerUntil[i] = Infinity;
        else if (p.layerUntil[i] === Infinity) p.layerUntil[i] = now + INTENSITY_RAMP + 0.05;
      }
    } catch {
      /* ignore */
    }
  }

  sfx(id: SfxId, opts?: { pan?: number; pitch?: number }): void {
    try {
      const ctx = this.ctx;
      const g = this.graph;
      if (!ctx || !g) return;
      this.kick();
      const now = ctx.currentTime;
      const last = this.lastSfx.get(id);
      if (last !== undefined && now - last < 0.03 && now - last >= 0) return; // anti-stacking
      this.lastSfx.set(id, now);
      fireSfx(ctx, g, id, now + 0.005, opts?.pan ?? 0, opts?.pitch ?? 1);
    } catch {
      /* ignore */
    }
  }

  jingle(id: JingleId): void {
    try {
      const ctx = this.ctx;
      const g = this.graph;
      if (!ctx || !g) return;
      this.kick();
      this.stopBgm(0.35);
      scheduleJingle(ctx, g, id, ctx.currentTime + 0.08);
    } catch {
      /* ignore */
    }
  }

  setMuted(m: boolean): void {
    this.muted = !!m;
    this.applyMaster();
  }

  isMuted(): boolean {
    return this.muted;
  }

  setVolume(v: number): void {
    this.volume = clamp(Number.isFinite(v) ? v : DEFAULT_VOLUME, 0, 1);
    this.applyMaster();
  }

  // --- internals ----------------------------------------------------------

  private applyMaster(): void {
    try {
      const ctx = this.ctx;
      const g = this.graph;
      if (!ctx || !g) return;
      const now = ctx.currentTime;
      g.master.gain.cancelScheduledValues(now);
      g.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, now, 0.03);
    } catch {
      /* ignore */
    }
  }

  /** Opportunistically resume a context the browser suspended. */
  private kick(): void {
    const ctx = this.ctx;
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => undefined);
  }

  private startPlayer(id: BgmId, fade: number): void {
    const ctx = this.ctx;
    const g = this.graph;
    if (!ctx || !g) return;
    const now = ctx.currentTime;
    if (this.cur) this.fadeOut(this.cur, now, fade);
    const buses = makeBuses(ctx, g, this.intensity);
    for (const n of [buses.out, buses.wetOut]) {
      n.gain.setValueAtTime(0, now);
      n.gain.linearRampToValueAtTime(1, now + fade);
    }
    this.cur = { track: TRACKS[id], buses, step: 0, next: now + 0.06, endAt: Infinity, layerUntil: layerUntilFor(this.intensity) };
    this.ensureTimer();
    this.tick();
  }

  private fadeOut(p: Player, now: number, fade: number): void {
    rampParam(p.buses.out.gain, 0, now, fade);
    rampParam(p.buses.wetOut.gain, 0, now, fade);
    p.endAt = now + fade;
    this.fading.push(p);
  }

  private ensureTimer(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private tick(): void {
    try {
      const ctx = this.ctx;
      if (!ctx) return;
      const now = ctx.currentTime;
      const hidden = typeof document !== 'undefined' && document.hidden;
      const horizon = now + (hidden ? LOOKAHEAD_HIDDEN : LOOKAHEAD);
      const players = this.cur ? [this.cur, ...this.fading] : this.fading;
      for (const p of players) this.pump(ctx, p, now, horizon);

      // Retire faded players once their tails have had time to ring out.
      const keep: Player[] = [];
      for (const p of this.fading) {
        if (now > p.endAt + 2) {
          p.buses.out.disconnect();
          p.buses.wetOut.disconnect();
        } else keep.push(p);
      }
      this.fading = keep;
      if (!this.cur && this.fading.length === 0 && this.timer !== null) {
        clearInterval(this.timer);
        this.timer = null;
      }
    } catch {
      /* ignore */
    }
  }

  private pump(ctx: AudioContext, p: Player, now: number, horizon: number): void {
    const sd = stepDur(p.track);
    // Resync after a stall (e.g. throttled timer): skip missed steps instead of bursting them.
    if (p.next < now - 0.05) {
      const skip = Math.ceil((now - p.next) / sd);
      p.step = (p.step + skip) % LOOP_STEPS;
      p.next += skip * sd;
    }
    let guard = 0;
    while (p.next < horizon && p.next < p.endAt && guard++ < 256) {
      const u = p.layerUntil;
      scheduleStep(ctx, p.track, p.step, p.next, p.buses, [p.next < u[0], p.next < u[1], p.next < u[2]]);
      p.step = (p.step + 1) % LOOP_STEPS;
      p.next += sd;
    }
  }
}

// ---------------------------------------------------------------------------
// Offline rendering (tests / tooling)
// ---------------------------------------------------------------------------

type OACCtor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

function getOfflineCtor(): OACCtor {
  const g = globalThis as unknown as { OfflineAudioContext?: OACCtor; webkitOfflineAudioContext?: OACCtor };
  const C = g.OfflineAudioContext ?? g.webkitOfflineAudioContext;
  if (!C) throw new Error('OfflineAudioContext unavailable');
  return C;
}

/**
 * Test helper: render `seconds` of a BGM at a given intensity (or one sfx)
 * into an OfflineAudioContext and return the rendered AudioBuffer. Uses the
 * same voice/scheduling code as real-time playback.
 */
export async function renderOffline(
  what: { bgm: BgmId; intensity: 0 | 1 | 2; seconds: number } | { sfx: SfxId },
  sampleRate = 44100,
): Promise<AudioBuffer> {
  const OAC = getOfflineCtor();
  if ('bgm' in what) {
    const seconds = Math.max(0.1, what.seconds);
    const ctx = new OAC(2, Math.ceil(seconds * sampleRate), sampleRate);
    const g = buildGraph(ctx, DEFAULT_VOLUME);
    const track = TRACKS[what.bgm];
    const buses = makeBuses(ctx, g, what.intensity);
    const sd = stepDur(track);
    let t = 0.02;
    const active = LAYER_GAINS[what.intensity].map((v) => v > 0);
    for (let step = 0; t < seconds; step++, t += sd) scheduleStep(ctx, track, step, t, buses, active);
    return ctx.startRendering();
  }
  const def = SFX[what.sfx];
  const ctx = new OAC(2, Math.ceil((def.dur + 0.8) * sampleRate), sampleRate);
  const g = buildGraph(ctx, DEFAULT_VOLUME);
  fireSfx(ctx, g, what.sfx, 0.01, 0, 1);
  return ctx.startRendering();
}

/** Test helper: render a jingle offline (same code path as `AudioEngine.jingle`). */
export async function renderJingleOffline(id: JingleId, sampleRate = 44100): Promise<AudioBuffer> {
  const OAC = getOfflineCtor();
  const ctx = new OAC(2, Math.ceil((JINGLES[id].dur + 0.6) * sampleRate), sampleRate);
  const g = buildGraph(ctx, DEFAULT_VOLUME);
  scheduleJingle(ctx, g, id, 0.02);
  return ctx.startRendering();
}
