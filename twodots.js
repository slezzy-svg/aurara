/* games/twodots.js — Two Dots (lite).
   Правила: веди пальцем/мышью по соседним точкам одного цвета — отпусти,
   и они исчезнут. Замкни круг — сгорят ВСЕ точки этого цвета!
   Цель: собрать по 18 точек каждого цвета за 24 хода. */
(function (global) {
  'use strict';

  const N = 6;
  const COLORS = ['#FF7E8A', '#57B9FF', '#3ED598', '#FFC94D'];
  const NEED = 18, MOVES = 24;

  const logic = {
    /** Есть ли хотя бы две соседние точки одного цвета (иначе поле мертво) */
    hasMove(b) {
      for (let r = 0; r < N; r++)
        for (let c = 0; c < N; c++) {
          if (b[r][c] < 0) continue;
          if (c + 1 < N && b[r][c + 1] === b[r][c]) return true;
          if (r + 1 < N && b[r + 1][c] === b[r][c]) return true;
        }
      return false;
    },
    createBoard() {
      let b, guard = 0;
      do {
        b = Array.from({ length: N }, () => Array(N).fill(0).map(() => (Math.random() * COLORS.length) | 0));
      } while (!logic.hasMove(b) && ++guard < 40);
      return b;
    },
  };

  function create(mount, api) {
    const cv = UI.canvasIn(mount);
    const ctx = cv.ctx;
    const ac = new AbortController();
    const parts = UI.particles();
    const floats = UI.floaters();

    let board, moves, over, busy, alive = true;
    let got = [0, 0, 0, 0];         // собрано по цветам
    let path = [], pathColor = -1, loopMade = false, resolving = false;
    const fx = new Map();           // "r,c" → {type:'clear'|'fall'|'spawn', ...}
    let objEls = [];

    let boardS = 320, cell = 50;

    const loop = UI.loop((dt, t) => { parts.step(dt); floats.step(dt); draw(t); });

    function layout() {
      const W = mount.clientWidth || 320, H = mount.clientHeight || 460;
      boardS = Math.max(220, Math.min(W - 16, H - 10));
      cv.fit(boardS + 16, boardS + 16);
      cell = boardS / N;
    }
    const roDispose = UI.observeResize(mount, layout);

    const key = (r, c) => r + ',' + c;
    const center = (r, c) => [8 + c * cell + cell / 2, 8 + r * cell + cell / 2];
    const cellAt = p => ({
      r: UI.clamp(Math.floor((p.y - 8) / cell), 0, N - 1),
      c: UI.clamp(Math.floor((p.x - 8) / cell), 0, N - 1),
    });
    const inBoard = p => p.x >= 8 && p.x < 8 + boardS && p.y >= 8 && p.y < 8 + boardS;
    const local = e => { const r = cv.el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

    /* ── Ввод: рисуем путь пальцем; замыкание = очистка всего цвета ────── */
    cv.el.addEventListener('pointerdown', e => {
      if (busy || over || !loop.running) return;
      const p = local(e);
      if (!inBoard(p)) return;
      const { r, c } = cellAt(p);
      path = [[r, c]];
      pathColor = board[r][c];
      loopMade = false;
      api.sfx('pick');
      e.preventDefault();
    });
    window.addEventListener('pointermove', e => {
      if (!path.length || busy || over) return;
      const p = local(e);
      if (!inBoard(p)) return;
      const { r, c } = cellAt(p);
      const last = path[path.length - 1];
      if (r === last[0] && c === last[1]) return;
      // шаг назад — снимаем последнюю точку
      if (path.length >= 2) {
        const prev = path[path.length - 2];
        if (r === prev[0] && c === prev[1]) { path.pop(); api.sfx('back'); return; }
      }
      const adj = Math.abs(r - last[0]) + Math.abs(c - last[1]) === 1;
      if (!adj || board[r][c] !== pathColor) return;
      const visited = path.findIndex(([pr, pc]) => pr === r && pc === c);
      if (visited >= 0) { // замкнули петлю!
        loopMade = true;
        resolvePath(true);
        return;
      }
      path.push([r, c]);
      api.sfx('pick'); // лёгкий «тик» на каждую точку
    }, { signal: ac.signal });
    const release = () => { if (path.length && !resolving) resolvePath(false); };
    window.addEventListener('pointerup', release, { signal: ac.signal });
    window.addEventListener('pointercancel', release, { signal: ac.signal });

    /* ── Разбор пути / петли ───────────────────────────────────────────── */
    async function resolvePath(isLoop) {
      if (resolving || over) return;
      resolving = true; busy = true;
      const cells = isLoop
        ? (() => { const out = []; for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (board[r][c] === pathColor) out.push([r, c]); return out; })()
        : path.slice();
      if (cells.length < 2 && !isLoop) { path = []; resolving = false; busy = false; return; }

      const now = performance.now();
      moves--;
      api.chip('moves', moves);

      let pts;
      if (isLoop) {
        pts = 60 + cells.length * 12;
        api.sfx('lineclear');
        api.sfx('combo', { level: 3 });
        floats.add(8 + boardS / 2, 8 + boardS * 0.4, 'ПЕТЛЯ! Все точки цвета', { size: 20, color: '#FFFFFF' });
      } else {
        pts = cells.length * 10 + (cells.length >= 6 ? 40 : 0);
        api.sfx('match');
        if (cells.length >= 6) api.sfx('combo', { level: 2 });
      }
      api.addScore(pts);
      got[pathColor] += cells.length;

      for (const [r, c] of cells) {
        const color = COLORS[board[r][c]];
        board[r][c] = -1;
        fx.set(key(r, c), { type: 'clear', t0: now, color });
        const [x, y] = center(r, c);
        parts.burst(x, y, { colors: [color, '#FFFFFF'], count: isLoop ? 7 : 5, size: 6 });
      }
      const [hx, hy] = center(cells[0][0], cells[0][1]);
      floats.add(hx, hy, '+' + UI.fmt(pts), { size: 19, color: COLORS[pathColor] });

      path = [];
      updateObjectives();
      await UI.wait(300);
      if (!alive) { resolving = false; busy = false; return; }

      // гравитация
      const falls = applyGravity();
      if (falls.length) {
        api.sfx('fall');
        const now2 = performance.now();
        let maxDur = 0;
        for (const f of falls) {
          const dur = 110 + 55 * (f.to - f.from);
          maxDur = Math.max(maxDur, dur);
          fx.set(key(f.to, f.c), { type: 'fall', from: f.from, t0: now2, dur });
        }
        await UI.wait(maxDur + 70);
        if (!alive) { resolving = false; busy = false; return; }
      }

      // победа / поражение / перемешивание
      if (got.every((g, i) => g >= NEED)) {
        over = true;
        api.sfx('win');
        setTimeout(() => alive && api.onEnd({
          win: true, icon: '🔵', title: 'Все цели собраны!',
          subtitle: `Осталось ходов: ${Math.max(0, moves)}`,
          stats: [{ k: 'Счёт', v: UI.fmt(api.score()) }, { k: 'Ходов осталось', v: Math.max(0, moves) }],
        }), 600);
        return;
      }
      if (moves <= 0) {
        over = true;
        api.sfx('lose');
        setTimeout(() => alive && api.onEnd({
          win: false, icon: '⭕', title: 'Ходы закончились',
          subtitle: 'Петли из 4 точек сжигают целый цвет — используй их!',
          stats: [
            { k: 'Счёт', v: UI.fmt(api.score()) },
            ...got.map((g, i) => ({ k: '● ' + (NEED - Math.min(g, NEED)) + ' осталось', v: COLORS[i] })),
          ].slice(0, 3),
        }), 600);
        return;
      }
      if (!logic.hasMove(board)) await ensureMoves();
      resolving = false;
      busy = false;
    }

    function applyGravity() {
      const falls = [];
      for (let c = 0; c < N; c++) {
        let w = N - 1;
        for (let r = N - 1; r >= 0; r--) {
          if (board[r][c] >= 0) {
            if (w !== r) {
              board[w][c] = board[r][c];
              board[r][c] = -1;
              falls.push({ c, from: r, to: w });
            }
            w--;
          }
        }
        const spawnCount = w + 1;
        for (let r = w; r >= 0; r--) {
          board[r][c] = (Math.random() * COLORS.length) | 0;
          falls.push({ c, from: r - spawnCount, to: r, spawn: true });
        }
      }
      return falls;
    }

    async function ensureMoves() {
      api.toast('Нет соединений — перемешиваю точки');
      api.sfx('shuffle');
      let tries = 0;
      do {
        for (let r = 0; r < N; r++)
          for (let c = 0; c < N; c++)
            board[r][c] = (Math.random() * COLORS.length) | 0;
      } while (!logic.hasMove(board) && ++tries < 40);
      const now = performance.now();
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) fx.set(key(r, c), { type: 'spawn', t0: now });
      await UI.wait(400);
    }

    /* ── Панель целей: 4 цветных счётчика ──────────────────────────────── */
    function buildExtra() {
      const el = api.extra('');
      el.innerHTML = COLORS.map((c, i) =>
        `<div class="chip" id="obj-${i}" style="padding:5px 12px 6px">
           <span class="chip-label"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${c};margin-right:5px"></span>Цель</span>
           <span class="chip-value">${NEED}</span>
         </div>`).join('');
      objEls = COLORS.map((_, i) => el.querySelector(`#obj-${i} .chip-value`));
      updateObjectives();
    }
    function updateObjectives() {
      objEls.forEach((el, i) => {
        const left = Math.max(0, NEED - got[i]);
        el.textContent = left === 0 ? '✓' : left;
        el.parentElement.style.opacity = left === 0 ? '0.55' : '1';
      });
    }

    /* ── Отрисовка ─────────────────────────────────────────────────────── */
    function drawDot(x, y, rad, color, scale = 1, alpha = 1) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      const g = ctx.createRadialGradient(-rad * 0.3, -rad * 0.3, rad * 0.1, 0, 0, rad);
      g.addColorStop(0, UI.lighten(color, 0.4));
      g.addColorStop(1, color);
      ctx.beginPath(); ctx.arc(0, 0, rad, 0, Math.PI * 2);
      ctx.fillStyle = g; ctx.fill();
      ctx.beginPath(); ctx.arc(-rad * 0.28, -rad * 0.34, rad * 0.18, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fill();
      ctx.restore();
    }

    function draw(t) {
      const P = api.palette();
      const now = performance.now();
      ctx.clearRect(0, 0, cv.w, cv.h);

      ctx.save();
      ctx.shadowColor = 'rgba(70,50,110,0.18)';
      ctx.shadowBlur = 22; ctx.shadowOffsetY = 8;
      UI.rr(ctx, 0, 0, boardS + 16, boardS + 16, 20);
      ctx.fillStyle = P.board; ctx.fill();
      ctx.restore();

      // линия пути: под точками, толстая, со скруглениями
      if (path.length > 1 && !resolving) {
        ctx.save();
        ctx.strokeStyle = COLORS[pathColor];
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = cell * 0.26;
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.beginPath();
        path.forEach(([r, c], i) => {
          const [x, y] = center(r, c);
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        });
        ctx.stroke();
        ctx.restore();
      }

      const rad = cell * 0.34;
      for (let r = 0; r < N; r++)
        for (let c = 0; c < N; c++) {
          const v = board[r][c];
          const k = key(r, c);
          let oy = 0, scale = 1, alpha = 1;
          const f = fx.get(k);
          if (f) {
            if (f.type === 'fall') {
              const kk = (now - f.t0) / f.dur;
              if (kk >= 1) fx.delete(k);
              else {
                oy = (f.from - r) * cell * (1 - UI.E.outBackSoft(kk));
              }
            } else if (f.type === 'spawn') {
              const kk = (now - f.t0) / 240;
              if (kk >= 1) fx.delete(k);
              else scale = UI.popScale(kk);
            }
          }
          if (v < 0) continue;
          const [x, y] = center(r, c);
          const inPath = path.some(([pr, pc]) => pr === r && pc === c);
          if (inPath) {
            scale *= 1.1 + 0.05 * Math.sin(now / 110); // пульс подключённых точек
            if (path.length && r === path[path.length - 1][0] && c === path[path.length - 1][1]) {
              ctx.beginPath(); ctx.arc(x, y + oy, rad * 1.5, 0, Math.PI * 2); // голова
              ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 3; ctx.stroke();
            }
          }
          drawDot(x, y + oy, rad, COLORS[v], scale, alpha);
        }

      // сгорающие точки
      for (const [k, f] of fx) {
        if (f.type !== 'clear') continue;
        const kk = (now - f.t0) / 280;
        if (kk >= 1) { fx.delete(k); continue; }
        const [r, c] = k.split(',').map(Number);
        const [x, y] = center(r, c);
        drawDot(x, y, rad, f.color, 1 - 0.9 * UI.E.outCubic(kk), 1 - kk);
      }

      parts.draw(ctx);
      floats.draw(ctx);
    }

    /* ── Состояние ─────────────────────────────────────────────────────── */
    function reset() {
      board = logic.createBoard();
      moves = MOVES; over = false; busy = false; resolving = false;
      got = [0, 0, 0, 0];
      path = []; pathColor = -1; loopMade = false;
      fx.clear(); parts.clear(); floats.clear();
      api.setScore(0);
      api.chip('moves', moves, { bump: false });
      updateObjectives();
    }

    reset();
    api.chips([
      { id: 'score', label: 'Счёт', value: 0 },
      { id: 'best', label: 'Рекорд', value: 0, gold: true },
      { id: 'moves', label: 'Ходы', value: MOVES },
    ]);
    buildExtra();
    layout();
    loop.start();
    api.hintOnce('Веди по точкам одного цвета. Замкни петлю из 4 — сгорит весь цвет!');

    return {
      restart() { reset(); loop.start(); },
      pause() { loop.stop(); path = []; },
      resume() { if (!over) loop.start(); },
      destroy() { alive = false; loop.stop(); ac.abort(); roDispose(); },
    };
  }

  /* Превью: линия соединяет три точки по кругу */
  function preview(ctx, w, h, t, P) {
    const rad = Math.min(w, h) * 0.14;
    const pts = [
      [w * 0.3, h * 0.62], [w * 0.5, h * 0.34], [w * 0.7, h * 0.62],
    ];
    const colors = ['#FF7E8A', '#FF7E8A', '#FF7E8A'];
    const cycle = t % 2.8;
    const drawN = cycle < 1.9 ? Math.min(3, cycle / 0.55 + 1) : 3;
    // соединительная линия растёт
    if (drawN > 1) {
      ctx.save();
      ctx.strokeStyle = colors[0]; ctx.globalAlpha = 0.5;
      ctx.lineWidth = rad * 0.7; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      const lim = Math.min(drawN, 3);
      for (let i = 0; i < Math.floor(lim); i++) i ? ctx.lineTo(...pts[i]) : ctx.moveTo(...pts[0]);
      const frac = lim % 1;
      if (frac > 0 && Math.floor(lim) < 3) {
        const a = pts[Math.floor(lim)], b = pts[Math.floor(lim) + 1];
        ctx.lineTo(UI.lerp(a[0], b[0], frac), UI.lerp(a[1], b[1], frac));
      }
      ctx.stroke();
      ctx.restore();
    }
    pts.forEach(([x, y], i) => {
      const on = i < Math.floor(drawN) || (i === Math.floor(drawN) && drawN % 1 > 0);
      const g = ctx.createRadialGradient(x - rad * 0.3, y - rad * 0.3, rad * 0.1, x, y, rad);
      g.addColorStop(0, UI.lighten(colors[i], 0.4)); g.addColorStop(1, colors[i]);
      ctx.beginPath(); ctx.arc(x, y, on ? rad * 1.08 : rad, 0, Math.PI * 2);
      ctx.fillStyle = g; ctx.fill();
    });
    if (cycle > 2.2) { // точки «сгорают»
      const k = (cycle - 2.2) / 0.6;
      pts.forEach(([x, y]) => {
        ctx.globalAlpha = 1 - k;
        ctx.beginPath(); ctx.arc(x, y, rad * (1 - k * 0.9), 0, Math.PI * 2);
        ctx.fillStyle = '#fff'; ctx.fill();
        ctx.globalAlpha = 1;
      });
    }
  }

  global.MiniGames.register({
    id: 'twodots', title: 'Two Dots', icon: '🔵',
    tagline: 'Соединяй линии одинаковых точек. Замкни петлю — и сгорит весь цвет!',
    accent: ['#38B6FF', '#5EEAD4'],
    preview, create, logic,
  });
})(typeof window !== 'undefined' ? window : globalThis);
