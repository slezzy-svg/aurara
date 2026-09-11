/* games/match3.js — Candy-мэтч-3 (lite).
   Правила: меняй местами соседние конфеты (клик или свайп), собирай 3+ в ряд.
   Каскады дают множитель ×2, ×3… За 30 ходов набери 2 500 очков.
   Если ходов нет — поле само перемешается. */
(function (global) {
  'use strict';

  const N = 8, TYPES = 5;
  const COLORS = ['#FF7EB6', '#FFA45C', '#7ED957', '#58C7FF', '#B78CFF'];
  const MOVES = 30, GOAL = 2500;

  /* ── Чистая логика (тестируется в Node) ─────────────────────────────── */
  const logic = {
    findMatches(b) {
      const cells = new Set(), groups = [];
      for (let r = 0; r < N; r++) { // горизонтали
        let c = 0;
        while (c < N) {
          const t = b[r][c];
          if (t < 0) { c++; continue; }
          let e = c;
          while (e + 1 < N && b[r][e + 1] === t) e++;
          if (e - c >= 2) {
            const g = [];
            for (let i = c; i <= e; i++) { g.push([r, i]); cells.add(r + ',' + i); }
            groups.push({ cells: g, horiz: true });
          }
          c = e + 1;
        }
      }
      for (let c = 0; c < N; c++) { // вертикали
        let r = 0;
        while (r < N) {
          const t = b[r][c];
          if (t < 0) { r++; continue; }
          let e = r;
          while (e + 1 < N && b[e + 1][c] === t) e++;
          if (e - r >= 2) {
            const g = [];
            for (let i = r; i <= e; i++) { g.push([i, c]); cells.add(i + ',' + c); }
            groups.push({ cells: g, horiz: false });
          }
          r = e + 1;
        }
      }
      return { cells, groups };
    },
    lineLen(b, r, c, dr, dc) {
      const t = b[r][c];
      let n = 0, rr = r + dr, cc = c + dc;
      while (rr >= 0 && rr < N && cc >= 0 && cc < N && b[rr][cc] === t) { n++; rr += dr; cc += dc; }
      return n;
    },
    makesMatch(b, r, c) {
      if (b[r][c] < 0) return false;
      return logic.lineLen(b, r, c, 0, -1) + logic.lineLen(b, r, c, 0, 1) >= 2 ||
             logic.lineLen(b, r, c, -1, 0) + logic.lineLen(b, r, c, 1, 0) >= 2;
    },
    findMove(b) {
      for (let r = 0; r < N; r++)
        for (let c = 0; c < N; c++)
          for (const [dr, dc] of [[0, 1], [1, 0]]) {
            const r2 = r + dr, c2 = c + dc;
            if (r2 >= N || c2 >= N || b[r][c] === b[r2][c2]) continue;
            const tmp = b[r][c]; b[r][c] = b[r2][c2]; b[r2][c2] = tmp;
            const ok = logic.makesMatch(b, r, c) || logic.makesMatch(b, r2, c2);
            b[r2][c2] = b[r][c]; b[r][c] = tmp;
            if (ok) return { a: [r, c], b: [r2, c2] };
          }
      return null;
    },
    hasMove(b) { return !!logic.findMove(b); },
    createBoard() {
      let b, guard = 0;
      do {
        b = Array.from({ length: N }, () => Array(N).fill(0));
        for (let r = 0; r < N; r++)
          for (let c = 0; c < N; c++) {
            let t = (Math.random() * TYPES) | 0;
            // избегаем готовых троек при генерации
            while ((c >= 2 && b[r][c - 1] === t && b[r][c - 2] === t) ||
                   (r >= 2 && b[r - 1][c] === t && b[r - 2][c] === t)) t = (t + 1) % TYPES;
            b[r][c] = t;
          }
      } while (!logic.hasMove(b) && ++guard < 40);
      return b;
    },
  };

  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0;[a[i], a[j]] = [a[j], a[i]]; } return a; };

  function create(mount, api) {
    const cv = UI.canvasIn(mount);
    const ctx = cv.ctx;
    const ac = new AbortController();
    const parts = UI.particles();
    const floats = UI.floaters();

    let board, moves, over, busy, sel, hint, hintT0, lastInput, alive = true;
    let press = null;
    const fx = new Map(); // "r,c" → эффект (slide / fall / spawn / clear)

    let boardX = 0, boardY = 0, boardS = 320, cell = 40;

    const loop = UI.loop((dt, t) => { parts.step(dt); floats.step(dt); draw(t); });

    function layout() {
      const W = mount.clientWidth || 320, H = mount.clientHeight || 480;
      boardS = Math.max(220, Math.min(W - 16, H - 12));
      cv.fit(boardS + 16, boardS + 16);
      boardX = 8; boardY = 8;
      cell = boardS / N;
    }
    const roDispose = UI.observeResize(mount, layout);

    const key = (r, c) => r + ',' + c;
    const cellAt = p => ({
      r: UI.clamp(Math.floor((p.y - boardY) / cell), 0, N - 1),
      c: UI.clamp(Math.floor((p.x - boardX) / cell), 0, N - 1),
    });
    const inBoard = p => p.x >= boardX && p.x < boardX + boardS && p.y >= boardY && p.y < boardY + boardS;
    const local = e => { const r = cv.el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const adjacent = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;

    /* ── Ввод: клик по соседним или свайп ──────────────────────────────── */
    cv.el.addEventListener('pointerdown', e => {
      if (busy || over || !loop.running) return;
      const p = local(e);
      if (!inBoard(p)) return;
      const cellPos = cellAt(p);
      lastInput = performance.now(); hint = null;
      if (sel && sel.r === cellPos.r && sel.c === cellPos.c) { // повторный тап — снять выбор
        sel = null; api.sfx('back');
      } else if (sel && adjacent(sel, cellPos)) {
        press = { ...cellPos, x: p.x, y: p.y, used: true };
        trySwap({ r: sel.r, c: sel.c }, cellPos);
        sel = null;
      } else {
        sel = cellPos; api.sfx('pick');
      }
      if (!press) press = { ...cellPos, x: p.x, y: p.y, used: false };
      e.preventDefault();
    });
    window.addEventListener('pointermove', e => {
      if (!press || press.used || busy || over) return;
      const p = local(e);
      const dx = p.x - press.x, dy = p.y - press.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < cell * 0.35) return;
      const dir = Math.abs(dx) > Math.abs(dy) ? [0, Math.sign(dx)] : [Math.sign(dy), 0];
      const to = { r: press.r + dir[0], c: press.c + dir[1] };
      press.used = true; sel = null;
      if (to.r >= 0 && to.r < N && to.c >= 0 && to.c < N) trySwap({ r: press.r, c: press.c }, to);
    }, { signal: ac.signal });
    const release = () => { press = null; };
    window.addEventListener('pointerup', release, { signal: ac.signal });
    window.addEventListener('pointercancel', release, { signal: ac.signal });

    /* ── Обмен с проверкой ─────────────────────────────────────────────── */
    async function trySwap(A, B) {
      if (busy || over) return;
      busy = true;
      const t0 = performance.now();
      const vA = board[A.r][A.c], vB = board[B.r][B.c];
      board[A.r][A.c] = vB; board[B.r][B.c] = vA;
      fx.set(key(A.r, A.c), { type: 'slide', fromR: B.r, fromC: B.c, t0 });
      fx.set(key(B.r, B.c), { type: 'slide', fromR: A.r, fromC: A.c, t0 });
      api.sfx('swap');
      await UI.wait(180);
      if (!alive) return;
      if (!logic.findMatches(board).cells.size) {
        // неудачный обмен — откат
        board[A.r][A.c] = vA; board[B.r][B.c] = vB;
        fx.set(key(A.r, A.c), { type: 'slide', fromR: B.r, fromC: B.c, t0: performance.now() });
        fx.set(key(B.r, B.c), { type: 'slide', fromR: A.r, fromC: A.c, t0: performance.now() });
        api.sfx('invalid');
        UI.shake(cv.el);
        await UI.wait(180);
        busy = false;
        return;
      }
      moves--;
      api.chip('moves', moves);
      await resolveCascades();
      if (!alive) return;
      if (moves <= 0) { endRound(); return; }
      await ensureMoves();
      if (!alive) return;
      busy = false;
    }

    /* ── Каскады: матч → взрыв → гравитация → снова матч… ──────────────── */
    async function resolveCascades() {
      let cascade = 0;
      while (alive) {
        const m = logic.findMatches(board);
        if (!m.cells.size) break;
        cascade++;
        const now = performance.now();
        let pts = 0;
        let midR = 0, midC = 0, n = 0;
        for (const k of m.cells) {
          const [r, c] = k.split(',').map(Number);
          const color = COLORS[board[r][c]];
          board[r][c] = -1;
          fx.set(k, { type: 'clear', t0: now, color });
          parts.burst(boardX + c * cell + cell / 2, boardY + r * cell + cell / 2, { colors: [color, '#FFFFFF'], count: 5, size: 6 });
          pts += 30; midR += r; midC += c; n++;
        }
        for (const g of m.groups) {
          if (g.cells.length >= 4) { // бонус за длинную линию
            pts += 60;
            const [gr, gc] = g.cells[Math.floor(g.cells.length / 2)];
            floats.add(boardX + gc * cell + cell / 2, boardY + gr * cell + cell / 2, 'Линия ' + g.cells.length + '!', { size: 15, color: '#FFE27A' });
          }
        }
        pts *= cascade; // множитель каскада: ×1, ×2, ×3…
        api.addScore(pts);
        api.sfx('match', { step: Math.min(cascade - 1, 7) }); // каждый каскад выше тоном
        if (cascade > 1) {
          api.sfx('combo', { level: cascade });
          floats.add(boardX + boardS / 2, boardY + boardS * 0.32, 'Каскад ×' + cascade, { size: 22, color: '#FFFFFF' });
        }
        floats.add(boardX + (midC / n) * cell + cell / 2, boardY + (midR / n) * cell, '+' + UI.fmt(pts), { size: 18, color: '#FFFFFF' });
        await UI.wait(300);
        if (!alive) return;
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
        }
      }
    }

    /* Гравитация + досыпание сверху. Возвращает список падений. */
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
          board[r][c] = (Math.random() * TYPES) | 0;
          falls.push({ c, from: r - spawnCount, to: r, spawn: true });
        }
      }
      return falls;
    }

    /* Если ходов нет — перемешивание с анимацией пересборки */
    async function ensureMoves() {
      if (logic.hasMove(board)) return;
      api.toast('Ходов нет — перемешиваем конфеты!');
      api.sfx('shuffle');
      const cells = [];
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (board[r][c] >= 0) cells.push([r, c]);
      let tries = 0;
      do {
        const types = shuffle(cells.map(([r, c]) => board[r][c]));
        cells.forEach(([r, c], i) => board[r][c] = types[i]);
      } while ((logic.findMatches(board).cells.size || !logic.hasMove(board)) && ++tries < 80);
      const now = performance.now();
      for (const [r, c] of cells) fx.set(key(r, c), { type: 'spawn', t0: now });
      await UI.wait(400);
    }

    function endRound() {
      if (over) return;
      over = true; busy = true;
      const win = api.score() >= GOAL;
      api.sfx(win ? 'win' : 'lose');
      setTimeout(() => {
        if (!alive) return;
        api.onEnd({
          win,
          icon: win ? '🍬' : '🫧',
          title: win ? 'Цель достигнута!' : 'Ходы закончились',
          subtitle: win ? 'Каскады — твой лучший друг.' : `Не хватило ${UI.fmt(GOAL - api.score())} очков до цели.`,
          stats: [
            { k: 'Счёт', v: UI.fmt(api.score()) },
            { k: 'Цель', v: UI.fmt(GOAL) },
            { k: 'Рекорд', v: UI.fmt(Math.max(Store.best('match3'), api.score())) },
          ],
        });
      }, 550);
    }

    /* ── Отрисовка ─────────────────────────────────────────────────────── */
    function drawCandy(x, y, rad, color, scale = 1, alpha = 1, squish = 1, rot = 0) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.scale(scale, scale * squish);
      const g = ctx.createRadialGradient(-rad * 0.35, -rad * 0.35, rad * 0.12, 0, 0, rad);
      g.addColorStop(0, UI.lighten(color, 0.45));
      g.addColorStop(1, color);
      ctx.beginPath(); ctx.arc(0, 0, rad, 0, Math.PI * 2);
      ctx.fillStyle = g; ctx.fill();
      // сахарный блик
      ctx.beginPath(); ctx.arc(-rad * 0.32, -rad * 0.36, rad * 0.2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fill();
      ctx.restore();
    }

    function draw(t) {
      const P = api.palette();
      const now = performance.now();
      ctx.clearRect(0, 0, cv.w, cv.h);

      ctx.save();
      ctx.shadowColor = 'rgba(70,50,110,0.18)';
      ctx.shadowBlur = 22; ctx.shadowOffsetY = 8;
      UI.rr(ctx, boardX - 8, boardY - 8, boardS + 16, boardS + 16, 20);
      ctx.fillStyle = P.board; ctx.fill();
      ctx.restore();

      for (let r = 0; r < N; r++)
        for (let c = 0; c < N; c++) {
          UI.rr(ctx, boardX + c * cell + 1.5, boardY + r * cell + 1.5, cell - 3, cell - 3, cell * 0.26);
          ctx.fillStyle = P.track; ctx.fill();
        }

      /* подсказка простоя: через 6 с без ввода — покачиваем возможный ход */
      if (!hint && !busy && !over && sel == null && now - lastInput > 6000) {
        hint = logic.findMove(board); hintT0 = now;
      }
      if (hint && now - hintT0 > 3600) hint = null;

      const rad = cell * 0.36;
      for (let r = 0; r < N; r++)
        for (let c = 0; c < N; c++) {
          const v = board[r][c];
          const k = key(r, c);
          let ox = 0, oy = 0, scale = 1, alpha = 1, squish = 1, rot = 0;
          const f = fx.get(k);
          if (f) {
            if (f.type === 'slide') {
              const kk = (now - f.t0) / 170;
              if (kk >= 1) fx.delete(k);
              else {
                const rest = 1 - UI.E.outCubic(kk);
                ox = (f.fromC - c) * cell * rest;
                oy = (f.fromR - r) * cell * rest;
              }
            } else if (f.type === 'fall') {
              const kk = (now - f.t0) / f.dur;
              if (kk >= 1) fx.delete(k);
              else {
                oy = (f.from - r) * cell * (1 - UI.E.outBackSoft(kk)); // лёгкий отскок при посадке
                if (kk > 0.78) squish = 1 - 0.2 * Math.sin((kk - 0.78) / 0.22 * Math.PI); // squash при приземлении
              }
            } else if (f.type === 'spawn') {
              const kk = (now - f.t0) / 240;
              if (kk >= 1) fx.delete(k);
              else scale = UI.popScale(kk);
            }
          }
          if (v < 0) continue;
          const x = boardX + c * cell + cell / 2 + ox;
          const y = boardY + r * cell + cell / 2 + oy;
          // выбранная конфета — пульсирующее кольцо
          if (sel && sel.r === r && sel.c === c) {
            const pr = rad * (1.18 + 0.06 * Math.sin(now / 150));
            ctx.beginPath(); ctx.arc(x, y, pr, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 3; ctx.stroke();
          }
          let wobble = 0;
          if (hint && ((hint.a[0] === r && hint.a[1] === c) || (hint.b[0] === r && hint.b[1] === c))) {
            wobble = Math.sin(now / 90) * cell * 0.06; // «посмотри сюда»
          }
          drawCandy(x + wobble, y, rad, COLORS[v], scale, alpha, squish, rot);
        }

      /* сгорающие конфеты (board уже -1): scale + rotate + fade */
      for (const [k, f] of fx) {
        if (f.type !== 'clear') continue;
        const kk = (now - f.t0) / 280;
        if (kk >= 1) { fx.delete(k); continue; }
        const [r, c] = k.split(',').map(Number);
        drawCandy(boardX + c * cell + cell / 2, boardY + r * cell + cell / 2,
          rad, f.color,
          1 - 0.85 * UI.E.outCubic(kk),
          1 - kk, 1,
          2.4 * UI.E.outCubic(kk));
      }

      parts.draw(ctx);
      floats.draw(ctx);
    }

    /* ── Состояние ─────────────────────────────────────────────────────── */
    function reset() {
      board = logic.createBoard();
      moves = MOVES; over = false; busy = false; sel = null; hint = null;
      press = null; lastInput = performance.now();
      fx.clear(); parts.clear(); floats.clear();
      api.setScore(0);
      api.chip('moves', moves, { bump: false });
    }

    reset();
    api.chips([
      { id: 'score', label: 'Счёт', value: 0 },
      { id: 'best', label: 'Рекорд', value: 0, gold: true },
      { id: 'moves', label: 'Ходы', value: MOVES },
      { id: 'goal', label: 'Цель', value: UI.fmt(GOAL) },
    ]);
    layout();
    loop.start();
    api.hintOnce('Меняй соседние конфеты местами: собери 3+ в ряд за 30 ходов и набей 2 500 очков.');

    return {
      restart() { reset(); loop.start(); },
      pause() { loop.stop(); press = null; },
      resume() { if (!over) loop.start(); },
      destroy() { alive = false; loop.stop(); ac.abort(); roDispose(); },
    };
  }

  /* Превью: две конфеты меняются местами, третья «дышит» */
  function preview(ctx, w, h, t, P) {
    const rad = Math.min(w, h) * 0.16;
    const cy = h / 2;
    const cs = rad * 2.6;
    const cx = w / 2;
    const k = Math.sin(t * 2.4);
    const swap = UI.E.inOutQuad(UI.clamp(0.5 + k * 0.9, 0, 1));
    const pos = [
      [cx - cs * 1.5, cy],
      [cx - cs * 0.5 + swap * cs, cy - Math.sin(swap * Math.PI) * rad * 0.5],
      [cx + cs * 0.5 - swap * cs, cy + Math.sin(swap * Math.PI) * rad * 0.5],
      [cx + cs * 1.5, cy],
    ];
    const cols = ['#FF7EB6', '#FFA45C', '#7ED957', '#58C7FF'];
    pos.forEach(([x, y], i) => {
      const pulse = i === 1 ? 1 + 0.08 * Math.sin(t * 4) : 1;
      const g = ctx.createRadialGradient(x - rad * 0.35, y - rad * 0.35, rad * 0.1, x, y, rad * pulse);
      g.addColorStop(0, UI.lighten(cols[i], 0.5)); g.addColorStop(1, cols[i]);
      ctx.beginPath(); ctx.arc(x, y, rad * pulse, 0, Math.PI * 2);
      ctx.fillStyle = g; ctx.fill();
      ctx.beginPath(); ctx.arc(x - rad * 0.3, y - rad * 0.35, rad * 0.2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fill();
    });
  }

  global.MiniGames.register({
    id: 'match3', title: 'Candy Match', icon: '🍬',
    tagline: 'Мэтч-3: собирай ряды из конфет, запускай каскады и комбо за 30 ходов.',
    accent: ['#FF7EB6', '#FFB86B'],
    preview, create, logic,
  });
})(typeof window !== 'undefined' ? window : globalThis);
