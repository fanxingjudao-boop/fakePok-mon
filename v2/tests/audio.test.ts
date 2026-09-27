/* ============================================================
 * 音響エンジンの回帰テスト(Node 上で実行)
 *   Node には Web Audio が無いので、呼び出しを記録・検証する厳格な
 *   偽 OfflineAudioContext を差し込み、renderOffline / renderJingleOffline が
 *   本物と同じスケジューリングを行うことを確かめる。
 *   - 全 BGM × 強度 / 全 SFX / 全ジングルが例外なく生成できる
 *   - AudioParam へ渡す値がすべて有限で、指数ランプの目標値が正
 *   - BGM は 8 小節(128 ステップ)ちょうどでループする
 *   - 強度 0 < 1 < 2 で発音数が増える
 *   実際の音量(ピーク/RMS)はヘッドレス Chromium でのレンダリングで確認する。
 * ============================================================ */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AudioEngine, renderOffline, renderJingleOffline, type BgmId, type SfxId, type JingleId } from '../src/audio/engine.ts';

interface Ev { t: number; type: string; f: number }
let log: Ev[] = [];
let errors: string[] = [];

function check(v: number, what: string): void {
  if (!Number.isFinite(v)) errors.push(`${what} = ${v}`);
}

class FakeParam {
  value: number;
  constructor(v = 0) { this.value = v; }
  setValueAtTime(v: number, t: number): this { check(v, 'setValueAtTime.value'); check(t, 'setValueAtTime.time'); this.value = v; return this; }
  linearRampToValueAtTime(v: number, t: number): this { check(v, 'linearRamp.value'); check(t, 'linearRamp.time'); return this; }
  exponentialRampToValueAtTime(v: number, t: number): this {
    check(v, 'expRamp.value'); check(t, 'expRamp.time');
    if (!(v > 0)) errors.push(`expRamp to non-positive ${v}`);
    return this;
  }
  setTargetAtTime(v: number, t: number, tc: number): this {
    check(v, 'setTarget.value'); check(t, 'setTarget.time'); check(tc, 'setTarget.tc');
    if (!(tc >= 0)) errors.push(`negative time constant ${tc}`);
    return this;
  }
  cancelScheduledValues(t: number): this { check(t, 'cancel.time'); return this; }
}

class FakeNode {
  connect<T>(n: T): T { if (!n) errors.push('connect(undefined)'); return n; }
  disconnect(): void { /* noop */ }
}

class FakeBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  private readonly data: Float32Array[];
  constructor(ch: number, len: number, sr: number) {
    this.numberOfChannels = ch; this.length = len; this.sampleRate = sr;
    this.data = Array.from({ length: ch }, () => new Float32Array(len));
  }
  get duration(): number { return this.length / this.sampleRate; }
  getChannelData(c: number): Float32Array { return this.data[c]!; }
}

class FakeScheduled extends FakeNode {
  private started = -1;
  protected onStart(_t: number): void { /* noop */ }
  start(t = 0, offset = 0, dur?: number): void {
    check(t, 'start.time'); check(offset, 'start.offset');
    if (dur !== undefined) { check(dur, 'start.duration'); if (dur < 0) errors.push('negative duration'); }
    if (this.started >= 0) errors.push('started twice');
    this.started = t;
    this.onStart(t);
  }
  stop(t = 0): void {
    check(t, 'stop.time');
    if (this.started < 0) errors.push('stop before start');
    else if (t < this.started) errors.push(`stop ${t} before start ${this.started}`);
  }
}

class FakeOsc extends FakeScheduled {
  type = 'sine';
  frequency = new FakeParam(440);
  detune = new FakeParam(0);
  protected override onStart(t: number): void {
    const f = this.frequency.value;
    if (!(f > 0 && f < 20000)) errors.push(`oscillator frequency ${f}`);
    log.push({ t, type: this.type, f });
  }
}

class FakeSource extends FakeScheduled {
  buffer: FakeBuffer | null = null;
  playbackRate = new FakeParam(1);
  protected override onStart(t: number): void {
    if (!this.buffer) errors.push('buffer source without buffer');
    log.push({ t, type: 'buffer', f: 0 });
  }
}

class FakeOAC {
  readonly sampleRate: number;
  readonly length: number;
  readonly channels: number;
  readonly currentTime = 0;
  readonly state = 'suspended';
  readonly destination = new FakeNode();
  constructor(ch: number, len: number, sr: number) { this.channels = ch; this.length = len; this.sampleRate = sr; }
  createGain() { return Object.assign(new FakeNode(), { gain: new FakeParam(1) }); }
  createOscillator() { return new FakeOsc(); }
  createBufferSource() { return new FakeSource(); }
  createBuffer(ch: number, len: number, sr: number) { return new FakeBuffer(ch, len, sr); }
  createBiquadFilter() { return Object.assign(new FakeNode(), { type: 'lowpass', frequency: new FakeParam(350), Q: new FakeParam(1), gain: new FakeParam(0) }); }
  createStereoPanner() { return Object.assign(new FakeNode(), { pan: new FakeParam(0) }); }
  createWaveShaper() { return Object.assign(new FakeNode(), { curve: null as Float32Array | null, oversample: 'none' }); }
  createConvolver() { return Object.assign(new FakeNode(), { buffer: null as FakeBuffer | null }); }
  createDynamicsCompressor() {
    return Object.assign(new FakeNode(), {
      threshold: new FakeParam(-24), knee: new FakeParam(30), ratio: new FakeParam(12),
      attack: new FakeParam(0.003), release: new FakeParam(0.25),
    });
  }
  startRendering(): Promise<FakeBuffer> { return Promise.resolve(new FakeBuffer(this.channels, this.length, this.sampleRate)); }
}

const G = globalThis as unknown as { OfflineAudioContext?: unknown };
let saved: unknown;
beforeAll(() => { saved = G.OfflineAudioContext; G.OfflineAudioContext = FakeOAC; });
afterAll(() => { G.OfflineAudioContext = saved; });

const SR = 8000; // scheduling doesn't depend on the rate; keep the fake buffers small

async function record(fn: () => Promise<unknown>): Promise<Ev[]> {
  log = [];
  errors = [];
  await fn();
  expect(errors).toEqual([]);
  return log;
}

const BPM: Record<BgmId, number> = {
  title: 90, wild: 116, ashstar: 132, guardian: 124,
  village: 96, forest: 104, road: 92, marsh: 72, shrine: 60,
};
const BGM = Object.keys(BPM) as BgmId[];
const FIELD: BgmId[] = ['village', 'forest', 'road', 'marsh', 'shrine'];
const SFX: SfxId[] = [
  'select', 'confirm', 'cancel', 'turn', 'hit', 'weak', 'resist', 'break',
  'perfect', 'good', 'miss', 'guard', 'parry', 'heal', 'buff', 'debuff', 'ko', 'pacify',
  'resonance', 'field', 'charge', 'reveal',
  'step', 'step_wood', 'talk', 'notice', 'encounter', 'item_get',
  'burn', 'water', 'grow', 'save', 'door', 'menu',
];
const JINGLES: JingleId[] = ['victory', 'defeat', 'chapter'];

/** Voices started within [from, from + len), relative to `from`, sorted by (type, freq, time). */
function voicesIn(evs: Ev[], from: number, len: number): Ev[] {
  return evs
    .filter((e) => e.type !== 'buffer' && e.t >= from + 0.001 && e.t < from + len - 0.001)
    .map((e) => ({ t: e.t - from, type: e.type, f: e.f }))
    .sort((x, y) => (x.type < y.type ? -1 : x.type > y.type ? 1 : x.f - y.f || x.t - y.t));
}

function sameVoices(a: Ev[], b: Ev[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((e, i) => {
    const o = b[i]!;
    return e.type === o.type && Math.abs(e.f - o.f) < 1e-6 && Math.abs(e.t - o.t) < 1e-6;
  });
}

describe('音響エンジン: BGM', () => {
  for (const id of BGM) {
    it(`${id}: 8 小節ループが周期的で、強度で層が増える`, async () => {
      const loop = (128 * 15) / BPM[id];
      const counts: number[] = [];
      for (const intensity of [0, 1, 2] as const) {
        const evs = await record(() => renderOffline({ bgm: id, intensity, seconds: loop * 3 }, SR));
        const a = voicesIn(evs, 0.02 + loop, loop);
        const b = voicesIn(evs, 0.02 + 2 * loop, loop);
        expect(a.length).toBeGreaterThan(0);
        expect(sameVoices(a, b)).toBe(true);
        counts.push(evs.filter((e) => e.t >= 0.02 + loop && e.t < 0.02 + 2 * loop).length);
      }
      expect(counts[1]!).toBeGreaterThan(counts[0]!);
      expect(counts[2]!).toBeGreaterThan(counts[1]!);
    });
  }

  it('フィールド曲どうしで旋律・伴奏の発音内容が異なる', async () => {
    const sigs: string[] = [];
    for (const id of FIELD) {
      const loop = (128 * 15) / BPM[id];
      const evs = await record(() => renderOffline({ bgm: id, intensity: 2, seconds: loop }, SR));
      // pitch content of the first loop, in semitone classes relative to A440
      const pcs = new Set(evs.filter((e) => e.f > 0).map((e) => Math.round(12 * Math.log2(e.f / 440)) % 12));
      sigs.push(`${Math.round(evs.length / loop)}:${[...pcs].sort((x, y) => x - y).join(',')}`);
    }
    expect(new Set(sigs).size).toBe(FIELD.length);
  });
});

describe('音響エンジン: SFX / ジングル', () => {
  for (const id of SFX) {
    it(`sfx ${id} が例外なく生成できる`, async () => {
      const evs = await record(() => renderOffline({ sfx: id }, SR));
      expect(evs.length).toBeGreaterThan(0);
      expect(Math.max(...evs.map((e) => e.t))).toBeLessThan(2.1);
    });
  }
  for (const id of JINGLES) {
    it(`jingle ${id} が例外なく生成できる`, async () => {
      const evs = await record(() => renderJingleOffline(id, SR));
      expect(evs.length).toBeGreaterThan(0);
    });
  }
});

describe('音響エンジン: 例外を投げない', () => {
  it('Web Audio が無い環境では全メソッドが無音の no-op', async () => {
    const a = new AudioEngine();
    await a.unlock();
    for (const id of BGM) a.playBgm(id);
    a.setIntensity(2);
    for (const id of SFX) a.sfx(id, { pan: 0.5, pitch: 1.2 });
    for (const id of JINGLES) a.jingle(id);
    a.stopBgm();
    a.setVolume(Number.NaN);
    a.setMuted(true);
    expect(a.isMuted()).toBe(true);
  });
});
