/* games/snake.js — Плавная змейка.
   Правила: стрелки/WASD/свайпы. Ешь конфеты, не врезайся в стены и себя.
   Хвост — градиентный (зелёная голова → синий хвост), движение интерполируется
   между тиками — змейка «течёт», а не прыгает по клеткам. */
(function (global) {
  'use strict';

  const N = 20;
  const HEAD_COLOR = '#7BE495', TAIL_COLOR = '#3E8ED0';
  const FOOD_COLOR = '#FF6B8A', GOLD_COLOR = '#FFC94D';

  function create(mount, api) {
    const cv = UI.canvasIn(mount);
    const ctx = cv.ctx;
    const ac = new AbortController();
    const parts = UI.particles();
    const floats = UI.floaters();

    let snake, prev, dir, queue, food, eaten, score, over, alive = true;
    let acc = 0, tickMs = 150, streak = 0, lastEat = 0;
    let deathT0 = 0;

    let boardS = 340, cell = 17;

    const loop = UI.loop((dt, t) => {
      parts.step(dt); floats.step(dt);
      if (!over) {
        acc += dt * 1000;
        let guard = 0;
        while (acc >= tickMs && !over && guard++ < 4) { acc -= tickMs; step(); }
      }
      draw(t);
    });

    function layout() {
      const W = mount.clientWidth || 340, H = mount.clientHeight || 460;
      boardS = Math.max(240, Math.min(W - 14, H - 10));
      cv.fit(boardS + 10, boardS + 10);
      cell = boardS / N;
    }
    const roDispose = UI.observeResize(mount, layout);

    const px = c => 5 + c * cell;
    const py = r => 5 + r * cell;

    function spawnFood() {
      const empty = [];
      for (let r = 0; r < N; r++)
        for (let c = 0; c < N; c++)
          if (!snake.some(s => s.r === r && s.c === c)) empty.push([r, c]);
      if (!empty.length) return;
      const [r, c] = empty[(Math.random() * empty.length) | 0];
      const golden = Math.random() < 0.15;
      food = { r, c, golden, t0: performance.now(), life: golden ? 6500 : Infinity };
    }

    function step() {
      // применяем направление из очереди (без разворота на 180°)
      while (queue.length) {
        const d = queue.shift();
        if (d.r !== -dir.r || d.c !== -dir.c) { dir = d; break; }
      }
      prev = snake.map(s => ({ r: s.r, c: s.c }));
      const head = { r: snake[0].r + dir.r, c: snake[0].c + dir.c };

      // стены
      if (head.r < 0 || head.r >= N || head.c < 0 || head.c >= N) return die();
      const eats = food && head.r === food.r && head.c === food.c;
      // само-укус: хвост уйдёт, если не растём
      const body = eats ? snake : snake.slice(0, -1);
      if (body.some(s => s.r === head.r && s.c === head.c)) return die();

      snake.unshift(head);
      if (eats) {
        eaten++;
        const now = performance.now();
        streak = (now - lastEat < 4000) ? streak + 1 : 1;
        lastEat = now;
        const base = food.golden ? 30 : 10;
        const pts = base * streak;
        api.addScore(pts);
        api.chip('len', snake.length);
        api.sfx('eat', { streak });
        if (streak > 1) floats.add(px(head.c) + cell / 2, py(head.r), `+${pts} ×${streak}`, { size: 15, color: '#FFE27A' });
        else floats.add(px(head.c) + cell / 2, py(head.r), `+${pts}`, { size: 15, color: '#FFFFFF' });
        if (food.golden) parts.burst(px(head.c) + cell / 2, py(head.r) + cell / 2, { colors: [GOLD_COLOR, '#FFF'], count: 10, size: 6 });
        // скорость растёт с длиной: 150 → 68 мс/тик
        tickMs = UI.clamp(150 - (snake.length - 4) * 2.2, 68, 150);
        spawnFood();
      } else {
        snake.pop();
      }
    }

    function die() {
      over = true;
      deathT0 = performance.now();
      api.sfx('dead');
      UI.shake(cv.el);
      const h = snake[0];
      parts.burst(px(h.c) + cell / 2, py(h.r) + cell / 2, { colors: [HEAD_COLOR, '#FFFFFF'], count: 14, size: 7 });
      setTimeout(() => {
        if (!alive) return;
        api.onEnd({
          win: false, icon: '🐍', title: 'Ой!',
          subtitle: snake.length >= 20 ? 'Достойный забег!' : 'Конфетка того стоила?',
          stats: [
            { k: 'Счёт', v: UI.fmt(api.score()) },
            { k: 'Длина', v: snake.length },
          ],
        });
      }, 850);
    }

    /* ── Ввод ──────────────────────────────────────────────────────────── */
    const DIR_KEYS = {
      ArrowUp: { r: -1, c: 0 }, ArrowDown: { r: 1, c: 0 }, ArrowLeft: { r: 0, c: -1 }, ArrowRight: { r: 0, c: 1 },
      w: { r: -1, c: 0 }, s: { r: 1, c: 0 }, a: { r: 0, c: -1 }, d: { r: 0, c: 1 },
      ц: { r: -1, c: 0 }, ы: { r: 1, c: 0 }, ф: { r: 0, c: -1 }, в: { r: 0, c: 1 },
    };
    window.addEventListener('keydown', e => {
      if (!loop.running || over) return;
      const d = DIR_KEYS[e.key] || DIR_KEYS[e.key.toLowerCase && e.key.toLowerCase()];
      if (!d) return;
      e.preventDefault();
      if (queue.length < 2) queue.push(d);
    }, { signal: ac.signal });

    let swipe = null;
    cv.el.addEventListener('pointerdown', e => {
      if (over) return;
      const r = cv.el.getBoundingClientRect();
      swipe = { x: e.clientX - r.left, y: e.clientY - r.top };
      e.preventDefault();
    });
    window.addEventListener('pointerup', e => {
      if (!swipe || over) { swipe = null; return; }
      const r = cv.el.getBoundingClientRect();
      const dx = e.clientX - r.left - swipe.x, dy = e.clientY - r.top - swipe.y;
      swipe = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
      const d = Math.abs(dx) > Math.abs(dy) ? { r: 0, c: Math.sign(dx) } : { r: Math.sign(dy), c: 0 };
      if (queue.length < 2) queue.push(d);
    }, { signal: ac.signal });

    /* ── Отрисовка: интерполяция между тиками ──────────────────────────── */
    function draw(t) {
      const P = api.palette();
      const now = performance.now();
      ctx.clearRect(0, 0, cv.w, cv.h);

      ctx.save();
      ctx.shadowColor = 'rgba(70,50,110,0.18)';
      ctx.shadowBlur = 22; ctx.shadowOffsetY = 8;
      UI.rr(ctx, 0, 0, boardS + 10, boardS + 10, 18);
      ctx.fillStyle = P.board; ctx.fill();
      ctx.restore();

      // шахматный фон — очень мягкий
      for (let r = 0; r < N; r++)
        for (let c = 0; c < N; c++)
          if ((r + c) % 2 === 0) {
            UI.rr(ctx, px(c), py(r), cell, cell, 3);
            ctx.fillStyle = P.track; ctx.fill();
          }

      // стены
      UI.rr(ctx, 3, 3, boardS + 4, boardS + 4, 16);
      ctx.strokeStyle = 'rgba(120,90,180,0.35)';
      ctx.lineWidth = 3;
      ctx.stroke();

      // конфета (пульсирует; золотая — с таймером-кольцом)
      if (food) {
        const fx = px(food.c) + cell / 2, fy = py(food.r) + cell / 2;
        const pulse = 1 + 0.12 * Math.sin(now / 140);
        const fr = cell * 0.34 * pulse;
        const col = food.golden ? GOLD_COLOR : FOOD_COLOR;
        const g = ctx.createRadialGradient(fx - fr * 0.3, fy - fr * 0.3, fr * 0.15, fx, fy, fr);
        g.addColorStop(0, UI.lighten(col, 0.45)); g.addColorStop(1, col);
        ctx.beginPath(); ctx.arc(fx, fy, fr, 0, Math.PI * 2);
        ctx.fillStyle = g; ctx.fill();
        // листик
        ctx.fillStyle = '#5BBF7A';
        ctx.beginPath(); ctx.ellipse(fx + fr * 0.45, fy - fr * 0.85, fr * 0.32, fr * 0.16, -0.7, 0, Math.PI * 2); ctx.fill();
        if (food.golden) {
          const left = 1 - (now - food.t0) / food.life;
          if (left <= 0) spawnFood();
          else {
            ctx.beginPath();
            ctx.arc(fx, fy, fr + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
            ctx.strokeStyle = GOLD_COLOR; ctx.lineWidth = 2.5; ctx.stroke();
          }
        }
      }

      // змейка: позиции интерполируем между тиками (t = acc/tickMs)
      const tt = over ? 1 : UI.clamp(acc / tickMs, 0, 1);
      const rp = snake.map((s, i) => {
        const f = (prev && prev[i]) || s;
        return { x: px(UI.lerp(f.c, s.c, tt)) + cell / 2, y: py(UI.lerp(f.r, s.r, tt)) + cell / 2 };
      });
      const len = rp.length;

      // градиентный хвост: рисуем от хвоста к голове «червячком» из кружков
      const dead = over;
      for (let i = len - 1; i >= 0; i--) {
        const k = len > 1 ? i / (len - 1) : 0; // 0 — голова, 1 — хвост
        const rad = UI.lerp(cell * 0.44, cell * 0.15, k);
        const color = dead ? '#B9A8D6' : UI.mixColor(HEAD_COLOR, TAIL_COLOR, Math.pow(k, 0.85));
        const from = rp[i];
        const to = rp[Math.max(0, i - 1)];
        // 3 промежуточных кружка на сегмент — гладкая труба
        for (let s = 2; s >= 0; s--) {
          const kk = s / 3;
          const x = UI.lerp(from.x, to.x, kk), y = UI.lerp(from.y, to.y, kk);
          const rr2 = UI.lerp(rad, i > 0 ? UI.lerp(cell * 0.44, cell * 0.15, (i - 1) / Math.max(1, len - 1)) : rad, kk);
          ctx.beginPath();
          ctx.arc(x, y, rr2, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
        }
        // голова: глаза
        if (i === 0) {
          const dx = to.x - from.x, dy = to.y - from.y;
          const L = Math.hypot(dx, dy) || 1;
          const ux = dx / L, uy = dy / L;         // взгляд
          const px2 = -uy, py2 = ux;              // перпендикуляр
          const eye = cell * 0.16, off = cell * 0.2;
          for (const sgn of [1, -1]) {
            const ex = from.x + ux * eye * 0.5 + px2 * off * sgn;
            const ey = from.y + uy * eye * 0.5 + py2 * off * sgn;
            ctx.beginPath(); ctx.arc(ex, ey, eye, 0, Math.PI * 2);
            ctx.fillStyle = '#fff'; ctx.fill();
            ctx.beginPath(); ctx.arc(ex + ux * eye * 0.4, ey + uy * eye * 0.4, eye * 0.5, 0, Math.PI * 2);
            ctx.fillStyle = '#2A2440'; ctx.fill();
          }
          if (!dead) { ctx.shadowColor = HEAD_COLOR; ctx.shadowBlur = 0; }
        }
      }

      // вспышка при смерти
      if (dead && now - deathT0 < 450) {
        ctx.save();
        ctx.globalAlpha = 0.35 * (1 - (now - deathT0) / 450);
        UI.rr(ctx, 0, 0, boardS + 10, boardS + 10, 18);
        ctx.fillStyle = '#FF5470'; ctx.fill();
        ctx.restore();
      }

      parts.draw(ctx);
      floats.draw(ctx);
    }

    /* ── Состояние ─────────────────────────────────────────────────────── */
    function reset() {
      const mid = N >> 1;
      snake = [{ r: mid, c: 8 }, { r: mid, c: 7 }, { r: mid, c: 6 }, { r: mid, c: 5 }];
      prev = snake.map(s => ({ ...s }));
      dir = { r: 0, c: 1 };
      queue = [];
      eaten = 0; score = 0; over = false; acc = 0; tickMs = 150; streak = 0;
      deathT0 = 0;
      parts.clear(); floats.clear();
      api.setScore(0);
      api.chip('len', snake.length, { bump: false });
      spawnFood();
    }

    reset();
    api.chips([
      { id: 'score', label: 'Счёт', value: 0 },
      { id: 'best', label: 'Рекорд', value: 0, gold: true },
      { id: 'len', label: 'Длина', value: 4 },
    ]);
    layout();
    loop.start();
    api.hintOnce('Стрелки, WASD или свайпы. Золотые конфеты дают ×3 очков, но тают!');

    return {
      restart() { reset(); loop.start(); },
      pause() { loop.stop(); },
      resume() { if (!over) loop.start(); },
      destroy() { alive = false; loop.stop(); ac.abort(); roDispose(); },
    };
  }

  /* Превью: змейка кружит по орбите и подбирает точку */
  function preview(ctx, w, h, t, P) {
    const cx = w / 2, cy = h / 2 + h * 0.06;
    const R = Math.min(w, h) * 0.3;
    const segs = 9;
    const headA = t * 2.2;
    const pts = [];
    for (let i = 0; i < segs; i++) pts.push([cx + Math.cos(headA - i * 0.32) * R, cy + Math.sin(headA - i * 0.32) * R * 0.72]);
    for (let i = segs - 1; i >= 0; i--) {
      const k = i / (segs - 1);
      const rad = UI.lerp(w * 0.045, w * 0.016, k);
      ctx.beginPath();
      ctx.arc(pts[i][0], pts[i][1], rad, 0, Math.PI * 2);
      ctx.fillStyle = UI.mixColor(HEAD_COLOR, TAIL_COLOR, k);
      ctx.fill();
    }
    // «конфета» в центре
    const fr = w * 0.035 * (1 + 0.12 * Math.sin(t * 5));
    const fg = ctx.createRadialGradient(cx - fr * 0.3, cy - fr * 0.3, fr * 0.2, cx, cy, fr);
    fg.addColorStop(0, '#FFA9B8'); fg.addColorStop(1, FOOD_COLOR);
    ctx.beginPath(); ctx.arc(cx, cy, fr, 0, Math.PI * 2);
    ctx.fillStyle = fg; ctx.fill();
  }

  global.MiniGames.register({
    id: 'snake', title: 'Змейка', icon: '🐍',
    tagline: 'Плавная змейка с градиентным хвостом. Золотые конфеты — ×3 очков.',
    accent: ['#58D68D', '#2ECC71'],
    preview, create,
  });
})(typeof window !== 'undefined' ? window : globalThis);
