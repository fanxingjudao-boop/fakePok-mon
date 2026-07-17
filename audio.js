/* ============================================================
 * audio.js — チップチューン音楽エンジン (Web Audio API)
 * 矩形波2ch + 三角波ベース + ノイズで、GB風のオリジナル楽曲を演奏する。
 * 楽曲はすべてオリジナル作曲。
 * ============================================================ */
(() => {
  const NOTE_OFF = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
  const noteFreq = (name) => {
    const m = /^([A-G]#?)(\d)$/.exec(name);
    if (!m) return 0;
    const midi = 12 * (Number(m[2]) + 1) + NOTE_OFF[m[1]];
    return 440 * Math.pow(2, (midi - 69) / 12);
  };

  // "C5:4 -:2 E5:2" → [{f, start, dur}] (単位: 16分音符)
  const parseSeq = (str) => {
    const ev = [];
    let pos = 0;
    for (const tok of str.trim().split(/\s+/)) {
      const [n, d] = tok.split(':');
      const dur = Number(d || 1);
      if (n !== '-') ev.push({ f: noteFreq(n), start: pos, dur });
      pos += dur;
    }
    return { events: ev, len: pos };
  };

  /* ---------------- 楽曲データ ----------------
   * lead: 矩形波(50%) / sub: 矩形波(25%) / bass: 三角波 / drum: ノイズ
   */
  const SONGS = {
    title: {
      bpm: 116,
      tracks: [
        { wave: 'square', vol: 0.16, seq:
          'C5:4 G4:4 E4:4 G4:4 C5:4 D5:4 E5:8 F5:4 E5:2 D5:2 E5:4 C5:4 D5:8 G4:8 ' +
          'E5:4 F5:4 G5:8 A5:4 G5:2 F5:2 E5:4 C5:4 D5:4 E5:2 D5:2 C5:4 A4:4 G4:12 -:4' },
        { wave: 'square', vol: 0.07, seq:
          'E4:4 E4:4 C4:4 E4:4 G4:4 G4:4 G4:8 A4:4 A4:4 G4:8 B4:8 B4:8 ' +
          'C5:4 C5:4 E5:8 F5:4 F5:4 C5:8 A4:8 F4:8 B4:16' },
        { wave: 'triangle', vol: 0.22, seq:
          'C3:4 G3:4 C3:4 G3:4 C3:4 G3:4 C3:8 F2:4 C3:4 F2:4 C3:4 G2:4 D3:4 G2:8 ' +
          'C3:4 G3:4 C3:8 F2:4 C3:4 F2:8 G2:4 D3:4 G2:4 D3:4 C3:16' }
      ]
    },
    town: {
      bpm: 100,
      tracks: [
        { wave: 'square', vol: 0.14, seq:
          'C5:4 A4:4 F4:4 A4:4 G4:4 A4:2 G4:2 F4:8 C5:4 D5:4 E5:4 C5:4 D5:4 C5:4 A4:8 ' +
          'F5:4 E5:4 D5:4 C5:4 A#4:4 C5:2 A#4:2 A4:8 G4:4 A4:4 A#4:4 G4:4 F4:12 -:4' },
        { wave: 'triangle', vol: 0.2, seq:
          'F2:8 C3:8 A#2:8 C3:8 F2:8 A2:8 A#2:8 C3:8 ' +
          'A#2:8 A2:8 G2:8 A2:8 A#2:8 C3:8 F2:16' }
      ]
    },
    route: {
      bpm: 132,
      tracks: [
        { wave: 'square', vol: 0.15, seq:
          'B4:2 D5:2 G5:4 D5:2 B4:2 G4:4 A4:2 B4:2 C5:4 B4:2 A4:2 D5:4 ' +
          'B4:2 D5:2 G5:4 D5:2 B4:2 G4:4 A4:2 C5:2 B4:2 A4:2 G4:8 ' +
          'G5:2 F#5:2 E5:2 D5:2 E5:4 C5:4 D5:2 E5:2 F#5:2 G5:2 A5:4 F#5:4 ' +
          'G5:4 E5:4 D5:4 B4:4 A4:2 B4:2 A4:2 F#4:2 G4:8' },
        { wave: 'triangle', vol: 0.22, seq:
          'G2:4 D3:4 G2:4 D3:4 C3:4 G3:4 C3:4 D3:4 G2:4 D3:4 G2:4 D3:4 C3:4 D3:4 G2:8 ' +
          'C3:4 G3:4 C3:4 G3:4 D3:4 A3:4 D3:4 A3:4 G2:4 D3:4 C3:4 D3:4 G2:4 D3:4 G2:8' },
        { wave: 'noise', vol: 0.04, seq:
          ('X:2 -:2 X:2 -:2 '.repeat(16)).trim().replace(/X/g, 'C5') }
      ]
    },
    cave: {
      bpm: 92,
      tracks: [
        { wave: 'square', vol: 0.11, seq:
          'E4:6 -:2 G4:6 -:2 A#4:6 -:2 A4:8 -:8 E4:6 -:2 D4:6 -:2 F4:6 -:2 E4:8 -:8' },
        { wave: 'triangle', vol: 0.2, seq:
          'E2:8 E2:8 A2:8 A2:8 D2:8 D2:8 E2:16 E2:8 E2:8 G2:8 G2:8 A2:8 A2:8 E2:16' }
      ]
    },
    battleWild: {
      bpm: 152,
      tracks: [
        { wave: 'square', vol: 0.15, seq:
          'E5:2 D#5:2 E5:2 D#5:2 E5:2 B4:2 D5:2 C5:2 A4:8 -:4 E4:2 A4:2 ' +
          'E5:2 D#5:2 E5:2 D#5:2 E5:2 B4:2 D5:2 C5:2 A4:4 B4:4 C5:4 B4:4 ' +
          'E5:4 G5:4 A5:4 G5:4 F5:2 E5:2 D5:2 C5:2 B4:4 E5:4 ' +
          'F5:4 D5:4 B4:4 G#4:4 A4:12 -:4' },
        { wave: 'triangle', vol: 0.24, seq:
          'A2:2 A2:2 A2:2 G2:2 A2:2 A2:2 C3:2 D3:2 A2:2 A2:2 A2:2 G2:2 A2:2 A2:2 E2:2 G2:2 ' +
          'A2:2 A2:2 A2:2 G2:2 A2:2 A2:2 C3:2 D3:2 F2:2 F2:2 G2:2 G2:2 A2:2 A2:2 E2:2 E2:2 ' +
          'A2:2 A2:2 C3:2 C3:2 D3:2 D3:2 F3:2 F3:2 E3:2 E3:2 D3:2 D3:2 C3:2 C3:2 B2:2 B2:2 ' +
          'D3:2 D3:2 B2:2 B2:2 E3:2 E3:2 E2:2 E2:2 A2:2 E3:2 A2:2 E3:2 A2:2 E3:2 A2:2 A2:2' },
        { wave: 'noise', vol: 0.05, seq:
          ('C5:2 C4:2 C5:1 C5:1 C4:2 '.repeat(16)).trim() }
      ]
    },
    battleTrainer: {
      bpm: 160,
      tracks: [
        { wave: 'square', vol: 0.15, seq:
          'D5:2 D5:2 -:2 D5:2 F5:2 E5:2 D5:2 C#5:2 D5:4 A4:4 F5:4 E5:4 ' +
          'D5:2 D5:2 -:2 D5:2 F5:2 G5:2 A5:2 G5:2 F5:4 E5:4 D5:8 ' +
          'A5:4 A#5:4 A5:2 G5:2 F5:2 E5:2 F5:4 D5:4 E5:4 C#5:4 ' +
          'D5:2 E5:2 F5:2 G5:2 A5:4 F5:4 E5:2 D5:2 C#5:2 E5:2 D5:8' },
        { wave: 'triangle', vol: 0.24, seq:
          'D3:2 D3:2 D3:2 C3:2 D3:2 D3:2 F3:2 G3:2 D3:2 D3:2 D3:2 C3:2 D3:2 D3:2 A2:2 C3:2 ' +
          'D3:2 D3:2 D3:2 C3:2 D3:2 D3:2 F3:2 G3:2 A#2:2 A#2:2 C3:2 C3:2 D3:2 D3:2 D3:2 D3:2 ' +
          'F3:2 F3:2 G3:2 G3:2 A3:2 A3:2 F3:2 F3:2 G3:2 G3:2 E3:2 E3:2 A2:2 A2:2 A2:2 A2:2 ' +
          'D3:2 D3:2 F3:2 F3:2 G3:2 G3:2 A3:2 A3:2 D3:2 A3:2 D3:2 A3:2 D3:2 A2:2 D3:2 D3:2' },
        { wave: 'noise', vol: 0.05, seq:
          ('C5:2 C4:2 C5:1 C5:1 C4:2 '.repeat(16)).trim() }
      ]
    },
    battleChampion: {
      bpm: 172,
      tracks: [
        { wave: 'square', vol: 0.16, seq:
          'G5:2 F#5:2 G5:2 F#5:2 G5:2 D5:2 F5:2 D#5:2 C5:8 G4:4 C5:4 ' +
          'D#5:2 D5:2 D#5:2 D5:2 D#5:2 C5:2 D5:2 A#4:2 G4:8 C5:8 ' +
          'G5:4 G#5:4 G5:2 F5:2 D#5:2 D5:2 D#5:4 C5:4 D5:4 B4:4 ' +
          'C5:2 D5:2 D#5:2 F5:2 G5:4 D#5:4 D5:2 C5:2 B4:2 D5:2 C5:8' },
        { wave: 'triangle', vol: 0.26, seq:
          'C3:2 C3:2 C3:2 A#2:2 C3:2 C3:2 D#3:2 F3:2 C3:2 C3:2 C3:2 A#2:2 C3:2 C3:2 G2:2 A#2:2 ' +
          'C3:2 C3:2 C3:2 A#2:2 C3:2 C3:2 D#3:2 F3:2 G#2:2 G#2:2 A#2:2 A#2:2 C3:2 C3:2 C3:2 C3:2 ' +
          'D#3:2 D#3:2 F3:2 F3:2 G3:2 G3:2 D#3:2 D#3:2 F3:2 F3:2 D3:2 D3:2 G2:2 G2:2 G2:2 G2:2 ' +
          'C3:2 C3:2 D#3:2 D#3:2 F3:2 F3:2 G3:2 G3:2 C3:2 G3:2 C3:2 G3:2 C3:2 G2:2 C3:2 C3:2' },
        { wave: 'noise', vol: 0.06, seq:
          ('C5:1 C5:1 C4:2 C5:2 C4:2 '.repeat(16)).trim() }
      ]
    },
    victory: {
      bpm: 140,
      tracks: [
        { wave: 'square', vol: 0.16, seq:
          'G4:2 C5:2 E5:2 G5:6 E5:2 G5:8 -:2 E5:2 F5:2 G5:2 A5:4 G5:2 F5:2 E5:4 D5:4 C5:8 ' +
          'G4:2 C5:2 E5:2 G5:6 E5:2 A5:8 F5:4 A5:4 G5:2 F5:2 E5:2 D5:2 C5:8 -:8' },
        { wave: 'triangle', vol: 0.22, seq:
          'C3:4 C3:4 C3:4 C3:4 F2:4 F2:4 G2:4 G2:4 F2:4 G2:4 C3:8 ' +
          'C3:4 C3:4 C3:4 C3:4 F2:4 F2:4 G2:4 G2:4 C3:8 G2:4 C3:4' }
      ]
    },
    gym: {
      bpm: 120,
      tracks: [
        { wave: 'square', vol: 0.13, seq:
          'C4:2 E4:2 G4:2 C5:2 B4:2 G4:2 E4:2 G4:2 A3:2 C4:2 F4:2 A4:2 G4:2 F4:2 C4:2 E4:2 ' +
          'D4:2 F4:2 A4:2 D5:2 C5:2 A4:2 F4:2 A4:2 G4:4 B4:4 C5:8' },
        { wave: 'triangle', vol: 0.22, seq:
          'C3:8 C3:8 F2:8 C3:8 D3:8 D3:8 G2:8 C3:8' }
      ]
    },
    evolution: {
      bpm: 140,
      tracks: [
        { wave: 'square', vol: 0.14, seq:
          'C5:2 D5:2 E5:2 F#5:2 G#5:4 F#5:4 E5:2 F#5:2 G#5:2 A#5:2 C6:8 ' +
          'A#5:2 G#5:2 F#5:2 E5:2 D5:4 E5:4 F#5:8 -:8' },
        { wave: 'triangle', vol: 0.2, seq:
          'C3:8 D3:8 E3:8 F#3:8 G#3:8 F#3:8 E3:8 D3:8' }
      ]
    },
    ending: {
      bpm: 96,
      tracks: [
        { wave: 'square', vol: 0.14, seq:
          'E5:6 D5:2 C5:4 D5:4 E5:4 G5:4 A5:8 G5:6 E5:2 D5:4 C5:4 D5:12 -:4 ' +
          'E5:6 D5:2 C5:4 D5:4 E5:4 G5:4 A5:8 C6:4 B5:4 A5:4 G5:4 C6:12 -:4' },
        { wave: 'square', vol: 0.06, seq:
          'C5:8 E4:8 F4:8 C5:8 F4:8 C5:8 G4:8 G4:8 C5:8 E4:8 F4:8 C5:8 A4:8 E5:8 E5:8 E5:8' },
        { wave: 'triangle', vol: 0.2, seq:
          'C3:8 G2:8 F2:8 G2:8 F2:8 E2:8 G2:8 G2:8 C3:8 G2:8 F2:8 G2:8 F2:8 G2:8 C3:16' }
      ]
    },
    heal: { bpm: 150, once: true, tracks: [
      { wave: 'square', vol: 0.16, seq: 'C5:2 E5:2 G5:2 C6:6' },
      { wave: 'triangle', vol: 0.2, seq: 'C3:4 G3:4 C4:4' }
    ] },
    levelup: { bpm: 150, once: true, tracks: [
      { wave: 'square', vol: 0.16, seq: 'C5:1 E5:1 G5:1 C6:5' }
    ] },
    caught: { bpm: 140, once: true, tracks: [
      { wave: 'square', vol: 0.16, seq: 'G5:2 E5:2 C5:2 G5:2 C6:8' },
      { wave: 'triangle', vol: 0.2, seq: 'C3:4 G2:4 C3:8' }
    ] },
    badge: { bpm: 132, once: true, tracks: [
      { wave: 'square', vol: 0.16, seq: 'C5:2 F5:2 A5:2 C6:4 A5:2 C6:8' },
      { wave: 'triangle', vol: 0.2, seq: 'F2:4 C3:4 F3:8' }
    ] }
  };

  let ctx = null, master = null, musicGain = null, sfxGain = null;
  let muted = false;
  let cur = null; // { name, timer, startTime, stepDur, events, songLen, resumeTo }
  let noiseBuf = null;

  function ensureCtx() {
    if (ctx) return true;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = 1; master.connect(ctx.destination);
      musicGain = ctx.createGain(); musicGain.gain.value = 1; musicGain.connect(master);
      sfxGain = ctx.createGain(); sfxGain.gain.value = 0.6; sfxGain.connect(master);
      const len = ctx.sampleRate * 0.5;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return true;
    } catch (e) { console.warn('AudioContext unavailable', e); return false; }
  }

  function compileSong(song) {
    const tracks = song.tracks.map((t) => ({ ...t, ...parseSeq(t.seq) }));
    const songLen = Math.max(...tracks.map((t) => t.len));
    return { tracks, songLen };
  }

  function scheduleNote(track, ev, when, stepDur) {
    const dur = ev.dur * stepDur * 0.92;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(track.vol, when + 0.005);
    g.gain.setValueAtTime(track.vol, when + Math.max(0.01, dur - 0.03));
    g.gain.linearRampToValueAtTime(0, when + dur);
    g.connect(musicGain);
    if (track.wave === 'noise') {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.playbackRate.value = ev.f > 400 ? 2 : 0.7;
      src.connect(g);
      src.start(when); src.stop(when + Math.min(dur, 0.08));
    } else {
      const o = ctx.createOscillator();
      o.type = track.wave;
      o.frequency.value = ev.f;
      o.connect(g);
      o.start(when); o.stop(when + dur);
    }
  }

  function stopMusic() {
    if (cur) { clearInterval(cur.timer); cur = null; }
  }

  function play(name) {
    if (!ensureCtx()) return;
    if (ctx.state === 'suspended') ctx.resume();
    if (cur && cur.name === name && !cur.once) return;
    const song = SONGS[name];
    if (!song) return;
    stopMusic();
    const { tracks, songLen } = compileSong(song);
    const stepDur = 60 / song.bpm / 4;
    const state = {
      name, once: !!song.once, tracks, songLen, stepDur,
      t0: ctx.currentTime + 0.05, nextStep: 0, timer: null, resumeTo: null
    };
    state.timer = setInterval(() => {
      if (!ctx) return;
      const horizon = ctx.currentTime + 0.15;
      while (state.t0 + state.nextStep * stepDur < horizon) {
        const step = state.nextStep;
        const local = step % songLen;
        if (state.once && step >= songLen) {
          clearInterval(state.timer);
          if (cur === state) { cur = null; if (state.resumeTo) play(state.resumeTo); }
          return;
        }
        for (const tr of tracks) for (const ev of tr.events) {
          if (ev.start === local) scheduleNote(tr, ev, state.t0 + step * stepDur, stepDur);
        }
        state.nextStep++;
      }
    }, 40);
    cur = state;
  }

  // ジングル再生後に元の曲へ戻す
  function jingle(name, resumeTo) {
    if (!ensureCtx()) return;
    const back = resumeTo !== undefined ? resumeTo : (cur && !cur.once ? cur.name : null);
    play(name);
    if (cur) cur.resumeTo = back;
  }

  /* ---------------- 効果音 ---------------- */
  function tone(freq, dur, { type = 'square', vol = 0.18, slide = 0, delay = 0 } = {}) {
    if (!ensureCtx()) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(sfxGain);
    o.start(t); o.stop(t + dur);
  }
  function noiseSfx(dur, { vol = 0.2, rate = 1, delay = 0 } = {}) {
    if (!ensureCtx()) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(g); g.connect(sfxGain);
    src.start(t); src.stop(t + dur);
  }

  const SFX = {
    select: () => tone(880, 0.06, { vol: 0.12 }),
    confirm: () => { tone(660, 0.05, { vol: 0.12 }); tone(990, 0.08, { vol: 0.12, delay: 0.05 }); },
    cancel: () => tone(330, 0.08, { vol: 0.12 }),
    bump: () => tone(90, 0.07, { vol: 0.15 }),
    door: () => { tone(520, 0.05, { vol: 0.1 }); tone(760, 0.08, { vol: 0.1, delay: 0.06 }); },
    hit: () => noiseSfx(0.12, { vol: 0.25, rate: 0.8 }),
    hitSuper: () => { noiseSfx(0.16, { vol: 0.3, rate: 1.4 }); tone(200, 0.15, { type: 'sawtooth', vol: 0.12, slide: -120 }); },
    hitWeak: () => noiseSfx(0.08, { vol: 0.15, rate: 0.5 }),
    faint: () => tone(420, 0.45, { vol: 0.16, slide: -350 }),
    ballThrow: () => tone(300, 0.18, { vol: 0.14, slide: 500 }),
    ballShake: () => tone(140, 0.06, { vol: 0.16 }),
    ballBreak: () => { noiseSfx(0.1, { vol: 0.2, rate: 1.6 }); tone(500, 0.15, { vol: 0.1, slide: -300, delay: 0.02 }); },
    statUp: () => { tone(500, 0.06, { vol: 0.1 }); tone(700, 0.06, { vol: 0.1, delay: 0.06 }); tone(900, 0.1, { vol: 0.1, delay: 0.12 }); },
    statDn: () => { tone(900, 0.06, { vol: 0.1 }); tone(700, 0.06, { vol: 0.1, delay: 0.06 }); tone(500, 0.1, { vol: 0.1, delay: 0.12 }); },
    exclaim: () => { tone(700, 0.08, { vol: 0.18 }); tone(1050, 0.14, { vol: 0.18, delay: 0.08 }); },
    money: () => { tone(1200, 0.05, { vol: 0.1 }); tone(1600, 0.1, { vol: 0.1, delay: 0.05 }); },
    save: () => { tone(700, 0.08, { vol: 0.1 }); tone(900, 0.08, { vol: 0.1, delay: 0.08 }); tone(1200, 0.16, { vol: 0.1, delay: 0.16 }); },
    cry: (seedFreq) => {
      const f = 300 + (seedFreq % 500);
      tone(f, 0.18, { type: 'square', vol: 0.16, slide: -f * 0.4 });
      tone(f * 1.5, 0.14, { type: 'sawtooth', vol: 0.08, slide: -f * 0.7, delay: 0.05 });
    }
  };

  function setMuted(m) {
    muted = m;
    if (master) master.gain.value = m ? 0 : 1;
  }

  window.AudioSys = {
    play, jingle, stopMusic, sfx: (n, a) => { try { SFX[n] && SFX[n](a); } catch (e) {} },
    setMuted, isMuted: () => muted, unlock: () => { ensureCtx(); if (ctx && ctx.state === 'suspended') ctx.resume(); },
    currentSong: () => (cur ? cur.name : null)
  };
})();
