/* games/blockblast.js — Block Blast.
   Правила: перетаскивай фигуры из лотка на сетку 8×8. Полная строка или
   столбец сгорает. Комбо растёт, если постановка очищает линии подряд.
   Проигрыш — когда ни одна из оставшихся фигур не влезает.
   Ввод: мышь/тач (pointer events), фигура центрируется на курсоре. */
(function (global) {
  'use strict';

  const N = 8;
  const COLORS = ['#FF8FA3', '#FFC46B', '#8CE99A', '#7CC6FF', '#C8B6FF', '#FF9ED2'];
  const EMOJ = '🧱';

  /* Фигуры: массив [row, col] сдвигов. 1–5 клеток, от точки до уголков и S/Z. */
  const SHAPES = [
    [[0, 0]],
    [[0, 0], [0, 1]], [[0, 0], [1, 0]],
    [[0, 0], [0, 1], [0, 2]], [[0, 0], [1, 0], [2, 0]],
    [[0, 0], [0, 1], [1, 0], [1, 1]],
    [[0, 0], [0, 1], [0, 2], [0, 3]], [[0, 0], [1, 0], [2, 0], [3, 0]],
    [[0, 0], [1, 0], [1, 1]], [[0, 0], [0, 1], [1, 0]], [[0, 0], [0, 1], [1, 1]], [[0, 1], [1, 0], [1, 1]],
    [[0, 0], [0, 1], [0, 2], [1, 0], [2, 0]],
    [[0, 0], [0, 1], [0, 2], [1, 1]],
    [[0, 1], [0, 2], [1, 0], [1, 1]], [[0, 0], [0, 1], [1, 1], [1, 2]],
  ];

  /* ── Чистая логика (тестируется в Node) ─────────────────────────────── */
  const logic = {
    SHAPES,
    bounds(shape) {
      let h = 0, w = 0;
      for (const [r, c] of shape) { h = Math.max(h, r + 1); w = Math.max(w, c + 1); }
      return { h, w };
    },
    canPlace(grid, shape, r, c) {
      for (const [dr, dc] of shape) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || rr >= N || cc < 0 || cc >= N || grid[rr][cc]) return false;
      }
      return true;
    },
    fullLines(grid) {
      const rows = [], cols = [];
      for (let r = 0; r < N; r++) if (grid[r].every(v => v)) rows.push(r);
      for (let c = 0; c < N; c++) {
        let full = true;
        for (let r = 0; r < N; r++) if (!grid[r][c]) { full = false; break; }
        if (full) cols.push(c);
      }
      return { rows, cols };
    },
    anyFits(grid, pieces) {
      for (const p of pieces) {
        if (!p) continue;
        const { h, w } = logic.bounds(p.shape);
        for (let r = 0; r <= N - h; r++)
          for (let c = 0; c <= N - w; c++)
            if (logic.canPlace(grid, p.shape, r, c)) return true;
      }
      return false;
    },
  };

  function makePiece() {
    const shape = logic.SHAPES[(Math.random() * logic.SHAPES.length) | 0];
    return { shape, color: 1 + ((Math.random() * COLORS.length) | 0) };
  }

  function create(mount, api) {
    const cv = UI.canvasIn(mount);
    const ctx = cv.ctx;
    const ac = new AbortController(); // все слушатели снимаются одним вызовом
    const parts = UI.particles();
    const floats = UI.floaters();

    let grid, tray, score, combo, over, alive = true;
    const spawns = new Map();  // "r,c" → t0 появления (squash & stretch)
    const clears = new Map();  // "r,c" → {t0, color} (scale+rotate+fade)
    let trayPop = [0, 0, 0];   // t0 появления фигуры в слоте
    let dragging = null;       // {slot, piece, x, y, r0, c0, valid}
    let flashRows = [], flashCols = [], flashT0 = 0;

    // геометрия
    let boardX = 0, boardY = 0, boardS = 300, cell = 36, trayY = 0, trayH = 90, slotW = 90;

    const loop = UI.loop((dt, t) => {
      parts.step(dt); floats.step(dt);
      draw(t);
    });

    /* ── Раскладка: квадратная доска сверху + лоток на 3 фигуры снизу ── */
    function layout() {
      const W = mount.clientWidth || 320, H = mount.clientHeight || 480;
      const pad = 8;
      trayH = UI.clamp(H * 0.19, 64, 120);
      const gap = 14;
      boardS = Math.min(W - 20, H - trayH - gap - 24);
      boardS = Math.max(200, boardS);
      cv.fit(W, boardS + trayH + gap + 12);
      boardX = (W - boardS) / 2;
      boardY = 6;
      cell = boardS / N;
      trayY = boardY + boardS + gap;
      slotW = Math.min((W - 24 - 16) / 3, boardS / 2.6);
    }
    const roDispose = UI.observeResize(mount, layout);

    /* ── Ввод: pointer events, drag&drop ───────────────────────────────── */
    function local(e) {
      const r = cv.el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    function hitTray(p) {
      const W = cv.w;
      for (let i = 0; i < 3; i++) {
        const x = (W - 3 * slotW - 16) / 2 + i * (slotW + 8);
        if (p.x >= x && p.x <= x + slotW && p.y >= trayY && p.y <= trayY + trayH) return i;
      }
      return null;
    }
    function slotRect(i) {
      const W = cv.w;
      return { x: (W - 3 * slotW - 16) / 2 + i * (slotW + 8), y: trayY, w: slotW, h: trayH };
    }
    function dragTarget(p) {
      // фигура висит центром на курсоре → считаем левую-верхнюю клетку
      const { h, w } = logic.bounds(dragging.piece.shape);
      const c0 = Math.round((p.x - boardX - w * cell / 2) / cell);
      const r0 = Math.round((p.y - boardY - h * cell / 2) / cell);
      const valid = logic.canPlace(grid, dragging.piece.shape, r0, c0);
      return { r0, c0, valid };
    }

    cv.el.addEventListener('pointerdown', e => {
      if (over || paused()) return;
      const p = local(e);
      const slot = hitTray(p);
      if (slot != null && tray[slot]) {
        dragging = { slot, piece: tray[slot], x: p.x, y: p.y, r0: -99, c0: -99, valid: false };
        api.sfx('pick');
        e.preventDefault();
      }
    });
    window.addEventListener('pointermove', e => {
      if (!dragging) return;
      const p = local(e);
      dragging.x = p.x; dragging.y = p.y;
      Object.assign(dragging, dragTarget(p));
    }, { signal: ac.signal });
    window.addEventListener('pointerup', () => {
      if (!dragging) return;
      const d = dragging;
      dragging = null;
      if (d.valid) place(d);
      else api.sfx('back');
    }, { signal: ac.signal });
    window.addEventListener('pointercancel', () => { dragging = null; }, { signal: ac.signal });

    /* ── Постановка фигуры + очистка линий ─────────────────────────────── */
    function place(d) {
      const now = performance.now();
      const { piece, r0, c0, slot } = d;
      for (const [dr, dc] of piece.shape) {
        const r = r0 + dr, c = c0 + dc;
        grid[r][c] = piece.color;
        spawns.set(r + ',' + c, now);
      }
      tray[slot] = null;
      dragging = null;
      api.sfx('place');
      api.addScore(piece.shape.length);

      const { rows, cols } = logic.fullLines(grid);
      const lines = rows.length + cols.length;
      if (lines > 0) {
        combo++;
        // очки за линии: 1→100, 2→300, 3→600, 4→1000 … × комбо-множитель
        const pts = 50 * lines * (lines + 1) * combo;
        const cleared = new Set();
        rows.forEach(r => { for (let c = 0; c < N; c++) cleared.add(r + ',' + c); });
        cols.forEach(c => { for (let r = 0; r < N; r++) cleared.add(r + ',' + c); });
        for (const key of cleared) {
          const [r, c] = key.split(',').map(Number);
          const color = COLORS[grid[r][c] - 1];
          grid[r][c] = 0;
          clears.set(key, { t0: now, color });
          // 8 частиц на клетку + вспышка цвета
          parts.burst(boardX + c * cell + cell / 2, boardY + r * cell + cell / 2, { colors: [color, '#FFFFFF'], count: 8, size: 7 });
        }
        flashRows = rows; flashCols = cols; flashT0 = now;
        api.addScore(pts);
        api.sfx('lineclear');
        api.sfx('combo', { level: combo });
        floats.add(cv.w / 2, boardY + boardS / 2, '+' + UI.fmt(pts) + (combo > 1 ? '  ×' + combo : ''), { size: 24, color: '#FFFFFF' });
      } else {
        combo = 0;
      }

      if (tray.every(p => !p)) refillTray();
      checkOver();
    }

    function refillTray() {
      const now = performance.now();
      for (let i = 0; i < 3; i++) { tray[i] = makePiece(); trayPop[i] = now + i * 70; }
      api.sfx('drop');
    }

    function checkOver() {
      if (over) return;
      if (!logic.anyFits(grid, tray)) {
        over = true;
        api.sfx('dead');
        setTimeout(() => {
          if (!alive) return;
          api.onEnd({
            win: false,
            icon: '🧱',
            title: 'Больше не влезает!',
            subtitle: 'Совет: оставляй место под длинные фигуры.',
          });
        }, 700);
      }
    }

    /* ── Отрисовка ─────────────────────────────────────────────────────── */
    function drawCell(x, y, size, color, scale = 1, rot = 0, alpha = 1) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x + size / 2, y + size / 2);
      ctx.rotate(rot);
      ctx.scale(scale, scale);
      const g = size * 0.04;
      UI.rr(ctx, -size / 2 + g, -size / 2 + g, size - g * 2, size - g * 2, size * 0.24);
      ctx.fillStyle = color;
      ctx.fill();
      // блик сверху — «candy» объём
      UI.rr(ctx, -size / 2 + g * 2.4, -size / 2 + g * 2.4, size - g * 4.8, (size - g * 4.8) * 0.42, size * 0.2);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fill();
      ctx.restore();
    }

    function draw(t) {
      const P = api.palette();
      const now = performance.now();
      ctx.clearRect(0, 0, cv.w, cv.h);

      /* панель доски */
      ctx.save();
      ctx.shadowColor = 'rgba(70,50,110,0.18)';
      ctx.shadowBlur = 22; ctx.shadowOffsetY = 8;
      UI.rr(ctx, boardX - 8, boardY - 8, boardS + 16, boardS + 16, 20);
      ctx.fillStyle = P.board; ctx.fill();
      ctx.restore();

      /* треки клеток */
      for (let r = 0; r < N; r++)
        for (let c = 0; c < N; c++) {
          UI.rr(ctx, boardX + c * cell + 1.5, boardY + r * cell + 1.5, cell - 3, cell - 3, cell * 0.22);
          ctx.fillStyle = P.track; ctx.fill();
        }

      /* подсказка линий, которые закроет текущая фигура (пульс белым) */
      if (dragging && dragging.valid) {
        const { r0, c0 } = dragging;
        const ghost = dragging.piece.shape;
        const would = new Set();
        for (let r = 0; r < N; r++) {
          const add = ghost.some(s => r0 + s[0] === r) &&
            grid[r].filter(Boolean).length + ghost.filter(s => r0 + s[0] === r && !grid[r][c0 + s[1]]).length === N;
          if (add) for (let c = 0; c < N; c++) would.add(r + ',' + c);
        }
        for (let c = 0; c < N; c++) {
          let have = 0;
          for (let r = 0; r < N; r++) if (grid[r][c]) have++;
          const add = ghost.some(s => c0 + s[1] === c) &&
            have + ghost.filter(s => c0 + s[1] === c && !grid[r0 + s[0]][c]).length === N;
          if (add) for (let r = 0; r < N; r++) would.add(r + ',' + c);
        }
        const pulse = 0.5 + 0.5 * Math.sin(now / 130);
        for (const key of would) {
          const [r, c] = key.split(',').map(Number);
          UI.rr(ctx, boardX + c * cell + 1.5, boardY + r * cell + 1.5, cell - 3, cell - 3, cell * 0.22);
          ctx.fillStyle = `rgba(255,255,255,${0.15 + 0.25 * pulse})`;
          ctx.fill();
        }
      }

      /* поставленные клетки + анимации появления */
      for (let r = 0; r < N; r++)
        for (let c = 0; c < N; c++) {
          const v = grid[r][c];
          if (!v) continue;
          const key = r + ',' + c;
          let scale = 1;
          if (spawns.has(key)) {
            const k = (now - spawns.get(key)) / 230; // 230 мс pop-in
            if (k >= 1) spawns.delete(key);
            else scale = UI.popScale(k); // 0.6 → 1.1 → 1.0
          }
          drawCell(boardX + c * cell, boardY + r * cell, cell, COLORS[v - 1], scale);
        }

      /* сгорающие клетки: scale + rotate + fade */
      for (const [key, fx] of clears) {
        const k = (now - fx.t0) / 260;
        if (k >= 1) { clears.delete(key); continue; }
        const [r, c] = key.split(',').map(Number);
        drawCell(boardX + c * cell, boardY + r * cell, cell, fx.color,
          1 - 0.9 * UI.E.outCubic(k),           // схлопывание
          (r % 2 ? 1 : -1) * 2.1 * UI.E.outCubic(k), // вращение
          1 - k);                                // затухание
      }

      /* вспышка очищенных линий */
      if (flashRows.length || flashCols.length) {
        const k = (now - flashT0) / 330;
        if (k >= 1) { flashRows = []; flashCols = []; }
        else {
          ctx.save();
          ctx.globalAlpha = 0.55 * (1 - k);
          ctx.fillStyle = '#FFFFFF';
          for (const r of flashRows) UI.rr(ctx, boardX, boardY + r * cell, boardS, cell, 8), ctx.fill();
          for (const c of flashCols) UI.rr(ctx, boardX + c * cell, boardY, cell, boardS, 8), ctx.fill();
          ctx.restore();
        }
      }

      /* призрак фигуры на доске */
      if (dragging && dragging.r0 > -50) {
        const { piece, r0, c0, valid } = dragging;
        const color = valid ? COLORS[piece.color - 1] : '#FF5470';
        for (const [dr, dc] of piece.shape) {
          const r = r0 + dr, c = c0 + dc;
          if (r < 0 || r >= N || c < 0 || c >= N) continue;
          UI.rr(ctx, boardX + c * cell + 2, boardY + r * cell + 2, cell - 4, cell - 4, cell * 0.22);
          ctx.fillStyle = color;
          ctx.globalAlpha = valid ? 0.45 : 0.3;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
        }
      }

      /* лоток с тремя фигурами */
      for (let i = 0; i < 3; i++) {
        const s = slotRect(i);
        UI.rr(ctx, s.x, s.y, s.w, s.h, 16);
        ctx.fillStyle = P.track; ctx.fill();
        const p = tray[i];
        if (!p) continue;
        const { h, w } = logic.bounds(p.shape);
        const mini = Math.min((s.w - 18) / 4.4, (s.h - 18) / 4.4);
        const px = s.x + (s.w - w * mini) / 2;
        const py = s.y + (s.h - h * mini) / 2;
        let sc = 1;
        const tk = (now - trayPop[i]) / 240;
        if (tk >= 0 && tk < 1) sc = UI.popScale(tk);
        for (const [dr, dc] of p.shape)
          drawCell(px + dc * mini, py + dr * mini, mini, COLORS[p.color - 1], sc);
      }

      /* фигура «в руке»: чуть больше, с тенью */
      if (dragging) {
        const { piece, x, y } = dragging;
        const { h, w } = logic.bounds(piece.shape);
        ctx.save();
        ctx.shadowColor = 'rgba(40,20,70,0.35)';
        ctx.shadowBlur = 18; ctx.shadowOffsetY = 10;
        for (const [dr, dc] of piece.shape)
          drawCell(x - w * cell / 2 + dc * cell, y - h * cell / 2 + dr * cell, cell * 1.04, COLORS[piece.color - 1], 1.04);
        ctx.restore();
      }

      parts.draw(ctx);
      floats.draw(ctx);
    }

    /* ── Управление состоянием ─────────────────────────────────────────── */
    function reset() {
      grid = Array.from({ length: N }, () => Array(N).fill(0));
      score = 0; combo = 0; over = false;
      spawns.clear(); clears.clear(); parts.clear(); floats.clear();
      dragging = null; flashRows = []; flashCols = [];
      tray = [null, null, null];
      refillTray();
      api.setScore(0);
      api.chip('score', 0, { bump: false });
    }

    const paused = () => !loop.running;

    reset();
    api.chips([
      { id: 'score', label: 'Счёт', value: 0 },
      { id: 'best', label: 'Рекорд', value: 0, gold: true },
    ]);
    layout();
    loop.start();
    api.hintOnce('Перетащи фигуру из лотка на поле. Заполняй линии — они сгорают!');

    return {
      restart() { reset(); loop.start(); },
      pause() { dragging = null; loop.stop(); },
      resume() { if (!over) loop.start(); },
      destroy() {
        alive = false;
        loop.stop();
        ac.abort();
        roDispose();
      },
    };
  }

  /* Превью на карточке: мини-поле, фигура прилетает и закрывает линию */
  function preview(ctx, w, h, t, P) {
    const cs = Math.min(w / 5.4, h / 4.2);
    const ox = (w - 5 * cs) / 2, oy = (h - 4 * cs) / 2 + cs * 0.2;
    const track = 'rgba(255,255,255,0.22)';
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 5; c++) {
        UI.rr(ctx, ox + c * cs + 1, oy + r * cs + 1, cs - 2, cs - 2, cs * 0.24);
        ctx.fillStyle = track; ctx.fill();
      }
    // «уже стоящие» блоки
    const filled = [[0, 0], [0, 1], [0, 3], [0, 4], [1, 0], [1, 4], [2, 1], [2, 2], [2, 3], [2, 4], [3, 0], [3, 1], [3, 3], [3, 4]];
    for (const [r, c] of filled) {
      UI.rr(ctx, ox + c * cs + 1, oy + r * cs + 1, cs - 2, cs - 2, cs * 0.24);
      ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fill();
    }
    // падающая фигура 1×2 в «дырку» [0,2] сверху
    const cycle = t % 2.2;
    let dy = -1.6 * cs, sc = 1;
    if (cycle < 1.4) {
      const k = UI.E.outCubic(cycle / 1.4);
      dy = UI.lerp(-1.6 * cs, 0, k);
    } else if (cycle < 1.7) {
      dy = 0; sc = UI.popScale((cycle - 1.4) / 0.3);
    } else {
      // линия собрана — вспышка
      dy = -2 * cs;
      const k = (cycle - 1.7) / 0.5;
      ctx.save();
      ctx.globalAlpha = 0.8 * (1 - k);
      ctx.fillStyle = '#FFFFFF';
      UI.rr(ctx, ox, oy, 5 * cs, cs, 8); ctx.fill();
      ctx.restore();
    }
    for (const [r, c] of [[0, 2], [1, 2]]) {
      UI.rr(ctx, ox + c * cs + 1, oy + r * cs + 1 + dy, cs - 2, cs - 2, cs * 0.24);
      ctx.fillStyle = '#FF8FA3'; ctx.fill();
      if (sc !== 1) { /* масштаб для простоты пропускаем в превью */ }
    }
  }

  global.MiniGames.register({
    id: 'blockblast', title: 'Block Blast', icon: EMOJ,
    tagline: 'Перетаскивай фигуры на поле 8×8 и сжигай целые линии. Комбо — за серии очисток!',
    accent: ['#7C6CF0', '#A78BFA'],
    preview, create, logic,
  });
})(typeof window !== 'undefined' ? window : globalThis);
