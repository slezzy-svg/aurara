/* audio.js — звуковой движок на чистом Web Audio API.
   ───────────────────────────────────────────────────────────────────────────
   • НИКАКИХ внешних mp3: каждый звук синтезируется осцилляторами + ADSR-огибающая.
   • Шины: master (≤0.3 — «приятно ушам») → [sfxBus (слайдер SFX), musBus (слайдер музыки)].
   • Реверберация: ConvolverNode с самодельным импульсом (затухающий шум ≈ 2.4 c).
   • AudioContext создаётся лениво — только после первого жеста пользователя
     (политика автоплея браузеров): unlock() вешается на pointerdown/keydown в main.js.
   ─────────────────────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  const A = { ctx: null, master: null, sfxBus: null, musBus: null, rev: null, started: false, _timer: null, _next: 0, _chord: 0 };

  const S = () => global.Store.data.settings;

  /* Импульс для реверберации: стереошум с экспоненциальным затуханием.
     Получается мягкое «послезвучие комнаты» без единого внешнего файла. */
  function makeImpulse(ctx, dur = 2.4, decay = 2.6) {
    const rate = ctx.sampleRate, len = Math.floor(rate * dur);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  function ensure() {
    if (A.ctx) return true;
    const AC = global.window && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return false;
    try { A.ctx = new AC(); } catch (e) { return false; }
    const ctx = A.ctx;
    A.master = ctx.createGain(); A.master.gain.value = S().sound ? 0.3 : 0.0001; A.master.connect(ctx.destination);
    A.sfxBus = ctx.createGain(); A.sfxBus.gain.value = S().sfx; A.sfxBus.connect(A.master);
    A.musBus = ctx.createGain(); A.musBus.gain.value = S().music * 0.5; A.musBus.connect(A.master);
    A.rev = ctx.createConvolver(); A.rev.buffer = makeImpulse(ctx);
    const wet = ctx.createGain(); wet.gain.value = 0.55; A.rev.connect(wet); wet.connect(A.master);
    return true;
  }

  /* ── Базовый кирпичик синтеза: осциллятор + ADSR ──────────────────────────
     a — атака (с), d — спад до плато, hold — удержание, r — релиз,
     f2 — glide до частоты f2 (для «падающих» звуков), wet — доля в реверб. */
  function tone(o) {
    if (!A.ctx || !S().sound) return;
    const ctx = A.ctx;
    const { f = 440, f2 = 0, type = 'sine', t = 0, a = 0.005, d = 0.08, hold = 0, r = 0.05, vol = 0.2, bus = A.sfxBus, wet = 0 } = o;
    const t0 = ctx.currentTime + Math.max(0, t);
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(30, f), t0);
    if (f2 > 0) osc.frequency.exponentialRampToValueAtTime(Math.max(30, f2), t0 + a + d + hold + r);
    const g = ctx.createGain();
    const peak = Math.max(0.0001, vol), sus = Math.max(0.0001, vol * 0.35);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + a);                 // Attack
    g.gain.exponentialRampToValueAtTime(sus, t0 + a + d);         // Decay → Sustain-плато
    g.gain.setValueAtTime(sus, t0 + a + d + hold);                // Hold
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d + hold + r); // Release
    osc.connect(g); g.connect(bus);
    if (wet > 0) { const w = ctx.createGain(); w.gain.value = wet; g.connect(w); w.connect(A.rev); }
    osc.start(t0); osc.stop(t0 + a + d + hold + r + 0.05);
  }

  /* Короткий шум через bandpass со сдвигом частоты — «вжух/шипение». */
  let _nb = null;
  function noiseBuf(ctx) {
    if (_nb) return _nb;
    _nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = _nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return _nb;
  }
  function noise(o) {
    if (!A.ctx || !S().sound) return;
    const ctx = A.ctx;
    const { f = 1000, f2 = 0, q = 0.8, dur = 0.15, vol = 0.1, t = 0 } = o;
    const t0 = ctx.currentTime + Math.max(0, t);
    const src = ctx.createBufferSource(); src.buffer = noiseBuf(ctx); src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q;
    bp.frequency.setValueAtTime(Math.max(40, f), t0);
    bp.frequency.exponentialRampToValueAtTime(Math.max(40, f2 || f), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp); bp.connect(g); g.connect(A.sfxBus);
    src.start(t0); src.stop(t0 + dur + 0.05);
  }

  /* ── Каталог звуков ─────────────────────────────────────────────────────── */
  function play(name, o = {}) {
    if (!A.ctx) return; // до первого жеста — тишина (контекст ещё не создан)
    switch (name) {
      case 'click': tone({ f: 600, type: 'triangle', d: 0.05, r: 0.02, vol: 0.12 }); break;
      case 'pick':  tone({ f: 660, type: 'triangle', a: 0.004, d: 0.06, vol: 0.16 }); break;
      case 'back':  tone({ f: 440, f2: 330, type: 'triangle', d: 0.08, vol: 0.12 }); break;

      /* pop: sine, атака 5 мс, спад 80 мс, случайный питч ±15% — «пузырь» */
      case 'pop':   tone({ f: 420 * (0.85 + Math.random() * 0.3), a: 0.005, d: 0.08, vol: 0.26 }); break;

      case 'place': // «стук» при постановке фигуры: глухой тон + короткое шипение
        tone({ f: 220, f2: 150, d: 0.1, r: 0.03, vol: 0.22 });
        noise({ f: 900, f2: 300, dur: 0.07, vol: 0.06 });
        break;
      case 'drop':  tone({ f: 180, f2: 120, d: 0.12, r: 0.05, vol: 0.2 }); break;
      case 'swap':  noise({ f: 700, f2: 1400, dur: 0.07, vol: 0.07 }); break;
      case 'slide': noise({ f: 500, f2: 1100, dur: 0.09, vol: 0.06 }); break;
      case 'merge': tone({ f: 480, f2: 640, a: 0.005, d: 0.12, r: 0.05, vol: 0.2, wet: 0.12 }); break;
      case 'fall':  tone({ f: 300, f2: 210, d: 0.06, vol: 0.08 }); break;
      case 'eat':   tone({ f: 480 + Math.min(o.streak || 0, 8) * 45, a: 0.005, d: 0.07, vol: 0.2 }); break;

      /* match: два тона одновременно — мажорная терция (интервал 2^(4/12)≈1.26) */
      case 'match': {
        const base = 523.25 * Math.pow(2, (o.step || 0) / 12);
        tone({ f: base, d: 0.16, r: 0.1, vol: 0.14, wet: 0.15 });
        tone({ f: base * 1.2599, d: 0.16, r: 0.1, vol: 0.12, wet: 0.15 });
        break;
      }

      /* combo: восходящее арпеджио до-ми-соль-до; чем выше серия, тем выше база */
      case 'combo': {
        const base = 440 * Math.pow(2, Math.min(o.level || 1, 10) / 12);
        [0, 4, 7, 12].forEach((s, i) => tone({ f: base * Math.pow(2, s / 12), t: i * 0.055, d: 0.12, r: 0.06, vol: 0.15 }));
        break;
      }

      case 'lineclear': // сдвиг шума вниз + восходящий тон — «свип линии»
        noise({ f: 2200, f2: 350, dur: 0.22, vol: 0.1 });
        tone({ f: 392, f2: 784, d: 0.18, r: 0.08, vol: 0.14, wet: 0.2 });
        break;

      case 'hint': tone({ f: 880, d: 0.14, r: 0.12, vol: 0.1, wet: 0.4 }); tone({ f: 1174, t: 0.09, d: 0.14, r: 0.12, vol: 0.08, wet: 0.4 }); break;
      case 'shuffle':
        for (let i = 0; i < 5; i++) tone({ f: 300 + Math.random() * 500, t: i * 0.05, d: 0.07, vol: 0.12 });
        noise({ f: 400, f2: 1600, dur: 0.3, vol: 0.05 });
        break;
      case 'invalid': // «злой» бас-бзык
        tone({ f: 140, type: 'square', d: 0.05, vol: 0.08 });
        tone({ f: 120, type: 'square', t: 0.07, d: 0.07, vol: 0.08 });
        break;
      case 'dead':
        noise({ f: 300, f2: 80, dur: 0.4, vol: 0.12 });
        tone({ f: 220, f2: 80, type: 'sawtooth', d: 0.35, r: 0.15, vol: 0.1 });
        break;

      /* lose: нисходящая минорная пара (E♭ → B♭) с ревербом */
      case 'lose':
        tone({ f: 311.13, type: 'triangle', d: 0.22, r: 0.25, vol: 0.14, wet: 0.25 });
        tone({ f: 233.08, type: 'triangle', t: 0.18, d: 0.3, r: 0.35, vol: 0.14, wet: 0.25 });
        break;

      /* win: мягкий аккорд C-E-G-C, каждый тон капает в общий реверб */
      case 'win':
        [261.63, 329.63, 392.0, 523.25].forEach((f, i) => tone({ f, t: i * 0.03, a: 0.015, d: 0.3, r: 1.3, vol: 0.11, wet: 0.5 }));
        tone({ f: 130.81, type: 'triangle', a: 0.02, d: 0.35, r: 1.4, vol: 0.08, wet: 0.35 });
        break;

      /* record: фанфары — гамма вверх + финальный аккорд через реверб */
      case 'record':
        [0, 4, 7, 12, 16].forEach((s, i) => tone({ f: 523.25 * Math.pow(2, s / 12), t: i * 0.07, d: 0.12, r: 0.06, vol: 0.13 }));
        [0, 4, 7, 12].forEach((s, i) => tone({ f: 523.25 * Math.pow(2, s / 12), t: 0.42 + i * 0.02, a: 0.01, d: 0.35, r: 1.2, vol: 0.11, wet: 0.5 }));
        break;
    }
  }

  /* ── Эмбиент-луп: медленные перекрещивающиеся трезвучия (C → Am → F → G)
        с длинными атаками/релизами + редкие «капли» сверху. Громкость ~0.05. ── */
  const CHORDS = [
    [130.81, 196.00, 329.63], // C  (C3-G3-E4)
    [110.00, 164.81, 261.63], // Am (A2-E3-C4)
    [87.31, 174.61, 261.63],  // F  (F2-F3-C4)
    [98.00, 146.83, 246.94],  // G  (G2-D3-B3)
  ];
  function ambientChord(when) {
    const ch = CHORDS[A._chord++ % CHORDS.length];
    const delay = Math.max(0, when - A.ctx.currentTime);
    ch.forEach(f => tone({ f, type: 'triangle', t: delay, a: 2.6, d: 0.4, hold: 2.2, r: 3.2, vol: 0.05, bus: A.musBus, wet: 0.3 }));
    if (Math.random() < 0.6) { // редкая высокая «капелька»
      tone({ f: ch[2] * 2, type: 'sine', t: delay + 2 + Math.random() * 3, a: 0.3, d: 0.8, r: 1.6, vol: 0.025, bus: A.musBus, wet: 0.6 });
    }
  }
  function startAmbient() {
    if (!A.ctx || A._timer) return;
    A._next = A.ctx.currentTime + 0.05;
    // планировщик с lookahead: каждые 8 секунд аккорд, с перекрытием релизов
    A._timer = setInterval(() => {
      if (!A.ctx) return;
      while (A._next < A.ctx.currentTime + 4) { ambientChord(A._next); A._next += 8; }
    }, 1000);
  }

  /* Публичный API */
  const AudioEngine = {
    /** Вызвать при первом жесте пользователя (см. main.js) */
    unlock() {
      if (!ensure()) return;
      if (A.ctx.state === 'suspended') A.ctx.resume();
      if (!A.started) { A.started = true; if (S().sound) startAmbient(); }
    },
    play,
    setEnabled(on) {
      if (!A.ctx) return;
      const t = A.ctx.currentTime;
      A.master.gain.cancelScheduledValues(t);
      A.master.gain.linearRampToValueAtTime(on ? 0.3 : 0.0001, t + 0.15);
      if (on && !A.started) { A.started = true; startAmbient(); }
    },
    setMusicVol(v) { if (A.musBus) A.musBus.gain.linearRampToValueAtTime(Math.max(0.0001, v * 0.5), A.ctx.currentTime + 0.1); },
    setSfxVol(v) { if (A.sfxBus) A.sfxBus.gain.linearRampToValueAtTime(Math.max(0.0001, v), A.ctx.currentTime + 0.1); },
    get ctx() { return A.ctx; },
  };

  global.AudioEngine = AudioEngine;
})(typeof window !== 'undefined' ? window : globalThis);
