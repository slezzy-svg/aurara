/* ui.js — общие утилиты для всех игр и оболочки.
   ───────────────────────────────────────────────────────────────────────────
   • UI.animsOn()  — учитывать ли анимации (настройка + prefers-reduced-motion).
   • UI.Tweens     — лёгкие твины для canvas-игр (мгновенно завершаются, если анимации выключены).
   • UI.particles()/UI.floaters() — частицы уничтожения и всплывающие «+очки».
   • UI.modal()/UI.toast()/UI.confetti()/UI.shake() — элементы «сочности».
   • UI.canvasIn()/UI.loop()/UI.observeResize() — обвязка canvas и rAF.
   • UI.palette()  — цвета темы для canvas (читает CSS-переменные --cv-*).
   ─────────────────────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const animsOn = () => global.Store.data.settings.anim && !REDUCED;

  /* ── Матчасть: easing-функции ─────────────────────────────────────────── */
  const E = {
    linear: k => k,
    outQuad: k => 1 - (1 - k) * (1 - k),
    outCubic: k => 1 - Math.pow(1 - k, 3),
    inOutQuad: k => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2),
    outBack: (k, c = 1.70158) => 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2),
    outBackSoft: k => E.outBack(k, 0.9), // мягкий «отскок» для падений фишек
  };

  /* Squash & stretch появления фишки: 0.6 → 1.1 → 1.0 (спека «ease-out-back»).
     Реализован двумя фазами: быстрый рост с перелётом и мягкая усадка. */
  function popScale(k) {
    if (k >= 1) return 1;
    if (k < 0.62) return 0.6 + 0.5 * E.outCubic(k / 0.62);   // 0.6 → 1.1
    return 1.1 - 0.1 * E.inOutQuad((k - 0.62) / 0.38);       // 1.1 → 1.0
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const fmt = n => Math.round(n).toLocaleString('ru-RU');

  /* Смешение hex-цветов (для градиентного хвоста змейки и бликов) */
  function hexToRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function mixColor(c1, c2, k) {
    const a = hexToRgb(c1), b = hexToRgb(c2);
    return `rgb(${Math.round(lerp(a[0], b[0], k))},${Math.round(lerp(a[1], b[1], k))},${Math.round(lerp(a[2], b[2], k))})`;
  }
  function lighten(hex, k = 0.3) { return mixColor(hex, '#FFFFFF', k); }

  /* Скруглённый прямоугольник своими руками (без опоры на ctx.roundRect) */
  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ── Твины: список {t, dur, ease, update(k), done()} ────────────────────
     Если анимации выключены — твин отрабатывает мгновенно (update(1)+done),
     чтобы логика игры никогда не «зависала» на анимации. */
  class Tweens {
    constructor() { this.list = []; }
    to({ dur = 200, ease = E.outCubic, update, done, delay = 0 }) {
      if (!animsOn()) { if (update) update(1); if (done) done(); return; }
      this.list.push({ t: -delay, dur: Math.max(1, dur), ease, update, done });
    }
    step(dtMs) {
      const done = [];
      for (const tw of this.list) {
        tw.t += dtMs;
        if (tw.t < 0) continue;
        const k = clamp(tw.t / tw.dur, 0, 1);
        if (tw.update) tw.update(tw.ease(k), k);
        if (k >= 1) done.push(tw);
      }
      if (done.length) this.list = this.list.filter(t => !done.includes(t));
    }
    get busy() { return this.list.length > 0; }
    clear() { this.list.length = 0; }
  }

  /* ── Частицы уничтожения: 8–12 штук на блок (спека) ──────────────────── */
  function particles() {
    let parts = [];
    return {
      burst(x, y, { colors = ['#fff'], count = 10, speed = 200, size = 6, gravity = 620, life = 0.7 } = {}) {
        if (!animsOn()) return; // reduced-motion: без частиц
        for (let i = 0; i < count; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = speed * (0.35 + Math.random() * 0.75);
          parts.push({
            x, y,
            vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - speed * 0.35,
            g: gravity,
            rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 12,
            size: size * (0.55 + Math.random() * 0.8),
            color: colors[(Math.random() * colors.length) | 0],
            life: life * (0.65 + Math.random() * 0.55), t: 0,
            circle: Math.random() < 0.4,
          });
        }
      },
      step(dt) {
        parts = parts.filter(p => (p.t += dt) < p.life);
        for (const p of parts) {
          p.vy += (p.g || 620) * dt;
          p.x += p.vx * dt; p.y += p.vy * dt;
          p.rot += p.vr * dt;
        }
      },
      draw(ctx) {
        for (const p of parts) {
          const a = 1 - p.t / p.life;
          ctx.save();
          ctx.globalAlpha = Math.max(0, a);
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          if (p.circle) {
            ctx.beginPath(); ctx.arc(0, 0, p.size * a, 0, Math.PI * 2); ctx.fill();
          } else {
            ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.8);
          }
          ctx.restore();
        }
      },
      clear() { parts = []; },
    };
  }

  /* ── Всплывающие «+120», «Каскад ×3» ─────────────────────────────────── */
  function floaters() {
    let items = [];
    return {
      add(x, y, text, { color = '#fff', size = 18, dy = -46 } = {}) {
        items.push({ x, y, text, color, size, dy, t: 0, life: 0.95 });
      },
      step(dt) { items = items.filter(f => (f.t += dt) < f.life); },
      draw(ctx) {
        if (!animsOn()) return;
        for (const f of items) {
          const k = f.t / f.life;
          ctx.save();
          ctx.globalAlpha = k < 0.15 ? k / 0.15 : 1 - Math.max(0, (k - 0.55) / 0.45);
          const pop = k < 0.25 ? E.outBack(k / 0.25) : 1;
          ctx.translate(f.x, f.y + f.dy * E.outCubic(k));
          ctx.scale(pop, pop);
          ctx.font = `800 ${f.size}px "Nunito","Segoe UI",system-ui,sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(40,30,60,0.35)';
          ctx.strokeText(f.text, 0, 0);
          ctx.fillStyle = f.color;
          ctx.fillText(f.text, 0, 0);
          ctx.restore();
        }
      },
      clear() { items = []; },
    };
  }

  /* ── Canvas + rAF обвязка ─────────────────────────────────────────────── */
  function canvasIn(mount) {
    const el = document.createElement('canvas');
    el.className = 'game-canvas';
    mount.appendChild(el);
    const ctx = el.getContext('2d');
    const o = {
      el, ctx, w: 0, h: 0,
      fit(w, h) {
        o.w = Math.max(1, w); o.h = Math.max(1, h);
        const dpr = Math.min(2, (global.window && window.devicePixelRatio) || 1);
        el.style.width = `${o.w}px`; el.style.height = `${o.h}px`;
        el.width = Math.round(o.w * dpr); el.height = Math.round(o.h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      },
    };
    return o;
  }

  function loop(fn) {
    let raf = 0, on = false, last = 0;
    const t0 = performance.now();
    function frame(now) {
      if (!on) return;
      const dt = clamp((now - last) / 1000, 0, 0.05) || 0.016;
      last = now;
      fn(dt, (now - t0) / 1000);
      raf = requestAnimationFrame(frame);
    }
    return {
      start() { if (on) return; on = true; last = performance.now(); raf = requestAnimationFrame(frame); },
      stop() { on = false; cancelAnimationFrame(raf); },
      get running() { return on; },
    };
  }

  function observeResize(el, cb) {
    if (typeof ResizeObserver === 'undefined') { cb(); return () => {}; }
    const ro = new ResizeObserver(() => cb());
    ro.observe(el);
    return () => ro.disconnect();
  }

  /* ── Палитра для canvas из CSS-переменных темы ────────────────────────── */
  let PAL = {
    board: '#FFFCF5', track: '#F0E8DC', ink: '#4A4458', line: 'rgba(74,68,88,.1)',
    dim: 'rgba(56,44,80,.32)', faceA: '#FFFDF6', faceB: '#EFE4CE', slab: '#DACBAA', glow: '#39C48F',
  };
  function refreshPalette() {
    try {
      const cs = getComputedStyle(document.documentElement);
      const g = (n, f) => (cs.getPropertyValue(n) + '').trim() || f;
      PAL = {
        board: g('--cv-board', PAL.board), track: g('--cv-track', PAL.track),
        ink: g('--cv-ink', PAL.ink), line: g('--cv-line', PAL.line),
        dim: g('--cv-dim', PAL.dim), faceA: g('--cv-face-a', PAL.faceA),
        faceB: g('--cv-face-b', PAL.faceB), slab: g('--cv-slab', PAL.slab),
        glow: g('--cv-glow', PAL.glow),
      };
    } catch (e) { /* jsdom/старые браузеры — остаются дефолты */ }
  }
  refreshPalette();
  document.addEventListener('pb:theme', refreshPalette);

  /* ── wait, который сжимается до ~24 мс при выключенных анимациях ─────── */
  const wait = ms => new Promise(res => setTimeout(res, animsOn() ? ms : Math.min(ms, 24)));

  /* ── Модалка: появляется scale 0.86 → 1 + fade, 300 мс cubic-bezier ──── */
  function modal({ icon = '🎈', title = '', sub = '', stats = [], record = false, buttons = [{ label: 'Ок', value: true }], dismiss = false } = {}) {
    return new Promise(resolve => {
      const root = document.getElementById('modal-root');
      const ov = document.createElement('div');
      ov.className = 'modal-overlay';
      const box = document.createElement('div');
      box.className = 'modal';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');

      const iconEl = document.createElement('div');
      iconEl.className = 'modal-icon'; iconEl.textContent = icon;
      const titleEl = document.createElement('h3');
      titleEl.className = 'modal-title'; titleEl.textContent = title;
      box.append(iconEl, titleEl);
      if (sub) { const s = document.createElement('p'); s.className = 'modal-sub'; s.textContent = sub; box.append(s); }
      if (record) { const r = document.createElement('div'); r.className = 'record-badge'; r.textContent = '🏆 Новый рекорд!'; box.append(r); }
      if (stats.length) {
        const st = document.createElement('div');
        st.className = 'modal-stats';
        stats.forEach(s => {
          const row = document.createElement('div');
          row.className = 'stat-row';
          const k = document.createElement('span'); k.textContent = s.k;
          const v = document.createElement('b'); v.textContent = s.v;
          row.append(k, v); st.append(row);
        });
        box.append(st);
      }
      const actions = document.createElement('div');
      actions.className = 'modal-actions';
      box.append(actions);

      let closed = false;
      const close = val => {
        if (closed) return; closed = true;
        ov.classList.remove('open'); ov.classList.add('closing');
        setTimeout(() => ov.remove(), 320);
        document.removeEventListener('keydown', onKey);
        resolve(val);
      };
      buttons.forEach((b, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn ' + (b.kind === 'ghost' ? 'btn-ghost' : 'btn-primary');
        btn.textContent = b.label;
        btn.addEventListener('click', () => { global.AudioEngine.play('click'); close(b.value !== undefined ? b.value : i); });
        actions.append(btn);
      });
      const onKey = e => { if (e.key === 'Escape' && dismiss) close(null); };
      document.addEventListener('keydown', onKey);
      if (dismiss) ov.addEventListener('pointerdown', e => { if (e.target === ov) close(null); });

      ov.append(box);
      root.append(ov);
      requestAnimationFrame(() => requestAnimationFrame(() => ov.classList.add('open')));
      const first = actions.querySelector('button');
      if (first) setTimeout(() => first.focus(), 60);
    });
  }

  /* ── Тост ─────────────────────────────────────────────────────────────── */
  function toast(msg, ms = 2400) {
    const root = document.getElementById('toast-root');
    while (root.children.length >= 3) root.firstChild.remove();
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    root.append(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 320); }, ms);
  }

  /* ── Тряска элемента (CSS keyframes, см. .shake) ─────────────────────── */
  function shake(el) {
    if (!el || !animsOn()) return;
    el.classList.remove('shake');
    void el.offsetWidth; // рестарт анимации
    el.classList.add('shake');
    setTimeout(() => el.classList.remove('shake'), 450);
  }

  /* ── Конфетти на весь экран (свой canvas поверх модалок) ─────────────── */
  const FX = { canvas: null, ctx: null, parts: [], raf: 0, running: false };
  function confetti() {
    if (!animsOn()) return; // reduced-motion — без конфетти
    if (!FX.canvas) {
      FX.canvas = document.getElementById('fx-canvas');
      FX.ctx = FX.canvas.getContext('2d');
      const resize = () => {
        FX.canvas.width = innerWidth; FX.canvas.height = innerHeight;
      };
      addEventListener('resize', resize); resize();
    }
    const colors = ['#FF8FA3', '#FFC46B', '#8CE99A', '#7CC6FF', '#C8B6FF', '#FF9ED2', '#5CE1E6', '#F6C247'];
    const W = FX.canvas.width, H = FX.canvas.height;
    for (let i = 0; i < 150; i++) {
      FX.parts.push({
        x: Math.random() * W, y: -20 - Math.random() * H * 0.4,
        vx: (Math.random() - 0.5) * 90, vy: 130 + Math.random() * 190,
        w: 7 + Math.random() * 7, h: 10 + Math.random() * 8,
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 9,
        sway: 1.6 + Math.random() * 2.2, phase: Math.random() * Math.PI * 2,
        color: colors[(Math.random() * colors.length) | 0],
        t: 0, life: 2.6 + Math.random() * 1.2,
      });
    }
    if (!FX.running) {
      FX.running = true;
      let last = performance.now();
      const frame = now => {
        const dt = clamp((now - last) / 1000, 0, 0.05); last = now;
        const ctx = FX.ctx;
        ctx.clearRect(0, 0, FX.canvas.width, FX.canvas.height);
        FX.parts = FX.parts.filter(p => (p.t += dt) < p.life && p.y < FX.canvas.height + 30);
        for (const p of FX.parts) {
          p.vy += 60 * dt;
          p.x += (p.vx + Math.sin(p.t * p.sway * 3 + p.phase) * 45) * dt;
          p.y += p.vy * dt;
          p.rot += p.vr * dt;
          ctx.save();
          ctx.globalAlpha = clamp(1 - Math.max(0, p.t - p.life + 0.5), 0, 1);
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.scale(1, Math.sin(p.t * p.sway * 4 + p.phase)); // «бабочки»
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.restore();
        }
        if (FX.parts.length) { FX.raf = requestAnimationFrame(frame); }
        else { FX.running = false; ctx.clearRect(0, 0, FX.canvas.width, FX.canvas.height); }
      };
      FX.raf = requestAnimationFrame(frame);
    }
  }

  global.UI = {
    REDUCED, animsOn, E, popScale, clamp, lerp, fmt, mixColor, lighten, rr,
    Tweens, particles, floaters, canvasIn, loop, observeResize,
    palette: () => PAL, refreshPalette, wait, modal, toast, shake, confetti,
  };
})(typeof window !== 'undefined' ? window : globalThis);
