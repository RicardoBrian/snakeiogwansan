// 배경음악: assets/bgm.mp3가 있으면 그 파일을, 없으면 아래 행진곡을 브라우저에서 직접 합성해 재생.
// 합성곡은 이 프로젝트를 위해 새로 쓴 오리지널 곡입니다 (모험 행진곡 분위기: 금관 + 부점 리듬 + 행진 드럼).
(function () {
  'use strict';

  const BPM = 116;
  const BEAT = 60 / BPM;

  // 멜로디: [MIDI 음 (null = 쉼표), 박자]  — 마디마다 4박
  const MELODY = [
    // A: 당당한 팡파르
    [67, .75], [67, .25], [72, 1], [71, .75], [69, .25], [67, 1],
    [64, .75], [65, .25], [67, 1], [69, 1.5], [null, .5],
    [69, .75], [69, .25], [74, 1], [72, .75], [71, .25], [69, 1],
    [65, .75], [67, .25], [69, 1], [67, 2],
    [67, .75], [67, .25], [72, 1], [76, 1], [74, .75], [72, .25],
    [71, .75], [72, .25], [74, 1], [67, 2],
    [69, .75], [71, .25], [72, 1], [77, 1], [76, .75], [74, .25],
    [72, 1], [67, .5], [64, .5], [60, 2],
    // B: 수상한 유적 속으로
    [69, .5], [64, .5], [69, .5], [71, .5], [72, 1], [71, .5], [69, .5],
    [68, 1.5], [64, .5], [71, 2],
    [69, .5], [65, .5], [69, .5], [72, .5], [77, 1], [76, .5], [74, .5],
    [74, 1.5], [71, .5], [67, 2],
    [72, .75], [71, .25], [69, 1], [76, 1], [72, 1],
    [74, .75], [76, .25], [77, 1], [69, 2],
    [71, .75], [72, .25], [74, 1], [79, 1], [77, .5], [74, .5],
    [71, 1], [74, 1], [67, 1], [null, .5], [67, .25], [67, .25]
  ];

  // 마디별 화음: [근음 MIDI, 구성음 간격]
  const MAJ = [0, 4, 7], MIN = [0, 3, 7], DOM7 = [0, 4, 7, 10];
  const C = [48, MAJ], Am = [45, MIN], F = [41, MAJ], G = [43, MAJ], E = [40, MAJ], Dm = [38, MIN], G7 = [43, DOM7];
  const CHORDS = [C, Am, F, G, C, G, F, C, Am, E, F, G, Am, Dm, G, G7];
  const LOOP_BEATS = CHORDS.length * 4;

  // 이벤트 목록 (박 단위 시간)
  const EVENTS = [];
  let beat = 0;
  MELODY.forEach(([m, len]) => {
    if (m !== null) EVENTS.push({ beat, kind: 'lead', m, len });
    beat += len;
  });
  CHORDS.forEach(([root, iv], bar) => {
    const b = bar * 4;
    EVENTS.push({ beat: b, kind: 'bass', m: root, len: .9 });
    EVENTS.push({ beat: b + 2, kind: 'bass', m: root + 7, len: .9 });
    [1, 3].forEach(o => EVENTS.push({ beat: b + o, kind: 'stab', notes: iv.map(i => root + 12 + i) }));
    EVENTS.push({ beat: b, kind: 'kick' });
    EVENTS.push({ beat: b + 2, kind: 'kick' });
    EVENTS.push({ beat: b + 1, kind: 'snare', v: 1 });
    EVENTS.push({ beat: b + 3, kind: 'snare', v: 1 });
    if (bar % 4 === 3) [3.5, 3.75].forEach(o => EVENTS.push({ beat: b + o, kind: 'snare', v: .6 }));
  });
  EVENTS.sort((a, b) => a.beat - b.beat);

  let ctx = null, master = null, noise = null, timer = null;
  let loopStart = 0, idx = 0;
  let mode = null;          // 'file' | 'synth'
  let muted = false;
  const audioEl = () => document.getElementById('bgm');
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  function env(g, t, peak, a, hold, rel) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.setValueAtTime(peak, t + a + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + rel);
  }

  function lead(m, len, t) {
    const d = Math.max(.08, len * BEAT * (len < .5 ? .7 : .88));
    const f = mtof(m);
    const g = ctx.createGain();
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.Q.value = 1.5;
    flt.frequency.setValueAtTime(f * 2, t);
    flt.frequency.linearRampToValueAtTime(f * 7, t + .05);
    flt.frequency.exponentialRampToValueAtTime(f * 3.5, t + d);
    env(g, t, .16, .025, d, .09);
    flt.connect(g).connect(master);
    [-7, 7].forEach(cents => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = cents;
      if (len >= 1.5) {   // 긴 음에 비브라토
        const lfo = ctx.createOscillator(), lg = ctx.createGain();
        lfo.frequency.value = 5.5;
        lg.gain.setValueAtTime(0, t);
        lg.gain.linearRampToValueAtTime(12, t + d);
        lfo.connect(lg).connect(o.detune);
        lfo.start(t); lfo.stop(t + d + .15);
      }
      o.connect(flt);
      o.start(t); o.stop(t + d + .15);
    });
  }

  function bass(m, len, t) {
    const d = len * BEAT * .8;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = mtof(m);
    env(g, t, .32, .01, d * .4, d * .6);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + d + .05);
  }

  function stab(notes, t) {
    const g = ctx.createGain();
    env(g, t, .045, .008, .05, .1);
    g.connect(master);
    notes.forEach(m => {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = mtof(m);
      o.connect(g);
      o.start(t); o.stop(t + .2);
    });
  }

  function kick(t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(45, t + .18);
    env(g, t, .5, .005, .02, .2);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + .3);
  }

  function snare(v, t) {
    const s = ctx.createBufferSource(), g = ctx.createGain(), flt = ctx.createBiquadFilter();
    s.buffer = noise;
    flt.type = 'highpass';
    flt.frequency.value = 1800;
    env(g, t, .12 * v, .002, .01, .09);
    s.connect(flt).connect(g).connect(master);
    s.start(t); s.stop(t + .15);
  }

  function tick() {
    const ahead = ctx.currentTime + .3;
    for (;;) {
      const ev = EVENTS[idx];
      const t = loopStart + ev.beat * BEAT;
      if (t > ahead) break;
      if (t >= ctx.currentTime - .05) {
        if (ev.kind === 'lead') lead(ev.m, ev.len, t);
        else if (ev.kind === 'bass') bass(ev.m, ev.len, t);
        else if (ev.kind === 'stab') stab(ev.notes, t);
        else if (ev.kind === 'kick') kick(t);
        else snare(ev.v, t);
      }
      idx++;
      if (idx >= EVENTS.length) { idx = 0; loopStart += LOOP_BEATS * BEAT; }
    }
  }

  function ensureCtx() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : .6;
    master.connect(comp).connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate * .2, ctx.sampleRate);
    const ch = noise.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    // iOS: 사용자 터치 안에서 소리를 한 번 내야 이후 재생이 허용됨
    const s = ctx.createBufferSource();
    s.buffer = ctx.createBuffer(1, 1, 22050);
    s.connect(ctx.destination);
    s.start(0);
    return true;
  }

  function startSynth() {
    if (mode === 'synth' || !ctx) return;
    mode = 'synth';
    ctx.resume();
    loopStart = ctx.currentTime + .1;
    idx = 0;
    timer = setInterval(tick, 40);
  }

  // [탐사 시작] 같은 사용자 클릭 안에서 호출해야 합니다.
  function start() {
    if (mode) return;
    try { ensureCtx(); if (ctx) ctx.resume(); } catch (e) { ctx = null; }
    const el = audioEl();
    if (!el) { startSynth(); return; }
    el.volume = .45;
    el.muted = muted;
    el.addEventListener('error', () => { if (mode !== 'synth') { mode = null; startSynth(); } }, { once: true });
    let p;
    try { p = el.play(); } catch (e) { startSynth(); return; }
    if (p && p.then) p.then(() => { if (!mode) mode = 'file'; }, () => { startSynth(); });
  }

  function setMuted(m) {
    muted = m;
    const el = audioEl();
    if (el) el.muted = m;
    if (master) master.gain.setTargetAtTime(m ? 0 : .6, ctx.currentTime, .05);
    if (!m && mode === 'file' && el && el.paused) el.play().catch(() => {});
  }

  document.addEventListener('visibilitychange', () => {
    if (!ctx || mode !== 'synth') return;
    if (document.hidden) ctx.suspend();
    else ctx.resume();
  });

  window.BGM = { start, setMuted };
})();
