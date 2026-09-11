/* games/game2048.js — 2048.
   Правила: свайпы/стрелки двигают все плитки. Одинаковые складываются.
   Дойди до 2048 — победа (можно продолжить). Ходов нет — конец.
   Плитки едут с ease-out, слияние «хлопается» с overshot, новая появляется
   squash&stretch (0.6 → 1.1 → 1.0). */
(function (global) {
  'use strict';

  const N = 4;
  const BG = { // [фон, текст]
    2: ['#EFE6DA', '#7A7167'], 4: ['#EDE0C8', '#7A7167'], 8: ['#F9BD8B', '#8C4A1F'],
    16: ['#F7A46B', '#7C3A16'], 32: ['#F58A6C', '#FFFFFF'], 64: ['#F26B52', '#FFFFFF'],
    128: ['#F2A7C9', '#8C2E5C'], 256: ['#EC8FBB', '#FFFFFF'], 512: ['#C39BEA', '#FFFFFF'],
    1024: ['#A97FE8', '#FFFFFF'], 2048: ['#8A5CF6', '#FFFFFF'],
  };
  const DEFAULT_TILE = ['#5F4B8B', '#FFFFFF'];
  const DIRS = {
    left: { dr: 0, dc: -1 }, right: { dr: 0, dc: 1 },
    up: { dr: -1, dc: 0 }, down: { dr: 1, dc: 0 },
  };

  /* ── Чистая логика (тестируется в Node) ─────────────────────────────── */
  const logic = {
    /** grid: 4×4 из плиток {v, r, c} или null. Мутирует и возвращает события. */
    computeMove(grid, dirName) {
      const { dr, dc } = DIRS[dirName];
      const idx = [0, 1, 2, 3];
      const rows = dr > 0 ? [3, 2, 1, 0] : idx;
      const cols = dc > 0 ? [3, 2, 1, 0] : idx;
      let moved = false, gained = 0;
      const merges = [], slides = [];
      for (const r of rows) for (const c of cols) {
        const t = grid[r][c];
        if (!t) continue;
        let rr = r, cc = c;
        for (;;) { // едем до упора
          const nr = rr + dr, nc = cc + dc;
          if (nr < 0 || nr >= N || nc < 0 || nc >= N || grid[nr][nc]) break;
          rr = nr; cc = nc;
        }
        const nr = rr + dr, nc = cc + dc;
        const nt = (nr >= 0 && nr < N && nc >= 0 && nc < N) ? grid[nr][nc] : null;
        if (nt && nt.v === t.v && !nt.merged) {
          // слияние: t поглощается nt
          grid[r][c] = null;
          nt.v *= 2; nt.merged = true;
          moved = true; gained += nt.v;
          merges.push({ tile: nt, oldV: nt.v / 2, newV: nt.v, r: nr, c: nc });
          slides.push({ tile: t, fromR: r, fromC: c, toR: nr, toC: nc, into: true });
          continue;
        }
        if (rr !== r || cc !== c) {
          grid[r][c] = null;
          t.r = rr; t.c = cc;
          grid[rr][cc] = t;
          moved = true;
          slides.push({ tile: t, fromR: r, fromC: c, toR: rr, toC: cc, into: false });
        }
      }
      for (const row of grid) for (const t of row) if (t) t.merged = false;
      return { moved, gained, merges, slides };
    },
    canMove(grid) {
      for (let r = 0; r < N; r++)
        for (let c = 0; c < N; c++) {
          const t = grid[r][c];
          if (!t) return true;
          if (c + 1 < N && grid[r][c + 1] && grid[r][c + 1].v === t.v) return true;
          if (r + 1 < N && grid[r + 1][c] && grid[r + 1][c].v === t.v) return true;
        }
      return false;
    },
  };

  function create(mount, api) {
    const cv = UI.canvasIn(mount);
    const ctx = cv.ctx;
    const ac = new AbortController();
    const parts = UI.particles();
    const floats = UI.floaters();

    let grid, score, over, busy, wonShown, alive = true, pending = null;
    let deadTiles = []; // поглощённые плитки доигрывают слайд и исчезают
    let tileSeq = 0;

    let boardS = 340, pad = 10, cell = 70;

    const loop = UI.loop((dt, t) => { parts.step(dt); floats.step(dt); draw(t); });

    function layout() {
      const W = mount.clientWidth || 340, H = mount.clientHeight || 460;
      boardS = Math.max(240, Math.min(W - 14, H - 10));
      pad = Math.max(8, boardS * 0.03);
      cell = (boardS - pad * 5) / N;
      cv.fit(boardS + 10, boardS + 10);
    }
    const roDispose = UI.observeResize(mount, layout);

    const pos = i => pad + 2 + i * (cell + pad); // координата клетки
    const local = e => { const r = cv.el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

    /* ── Ввод: стрелки/WASD + свайпы; занятость → буфер на 1 ход ──────── */
    window.addEventListener('keydown', e => {
      if (!loop.running || over) return;
      const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', a: 'left', d: 'right', w: 'up', s: 'down', ф: 'left', в: 'right', ц: 'up', ы: 'down' };
      const dir = map[e.key] || map[e.key.toLowerCase && e.key.toLowerCase()];
      if (!dir) return;
      e.preventDefault();
      if (busy) { pending = dir; return; }
      move(dir);
    }, { signal: ac.signal });

    let swipe = null;
    cv.el.addEventListener('pointerdown', e => {
      if (over) return;
      swipe = local(e);
      e.preventDefault();
    });
    window.addEventListener('pointerup', e => {
      if (!swipe) return;
      const p = local(e);
      const dx = p.x - swipe.x, dy = p.y - swipe.y;
      swipe = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24 || over) return;
      const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      if (busy) { pending = dir; return; }
      move(dir);
    }, { signal: ac.signal });

    function spawnTile() {
      const empty = [];
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!grid[r][c]) empty.push([r, c]);
      if (!empty.length) return;
      const [r, c] = empty[(Math.random() * empty.length) | 0];
      const t = { id: ++tileSeq, v: Math.random() < 0.9 ? 2 : 4, r, c, spawnT0: performance.now() };
      grid[r][c] = t;
    }

    function move(dir) {
      const res = logic.computeMove(grid, dir);
      if (!res.moved) { api.sfx('invalid'); UI.shake(cv.el); return; }
      busy = true;
      api.sfx('slide');
      // до «хлопка» плитка-цель рисуется со старым значением
      for (const m of res.merges) m.tile.renderV = m.oldV;
      const now = performance.now();
      let maxDur = 0;
      for (const s of res.slides) {
        const dist = Math.abs(s.toR - s.fromR) + Math.abs(s.toC - s.fromC);
        const dur = 80 + dist * 45;
        maxDur = Math.max(maxDur, dur);
        s.tile.fx = { fromR: s.fromR, fromC: s.fromC, t0: now, dur };
        if (s.into) deadTiles.push(s.tile);
      }
      const anim = api.anims();

      // слияния «хлопаются» по приезде
      setTimeout(() => {
        if (!alive) return;
        for (const m of res.merges) {
          m.tile.renderV = null;
          m.tile.popT0 = performance.now();
          const [bg] = tileColors(m.newV);
          parts.burst(pos(m.c) + cell / 2, pos(m.r) + cell / 2, { colors: [bg, '#FFFFFF'], count: 9, size: 6 });
          floats.add(pos(m.c) + cell / 2, pos(m.r) + cell / 2 - 8, '+' + m.newV, { size: 16, color: '#FFFFFF' });
        }
        if (res.merges.length) {
          api.sfx('merge');
          if (res.merges.length > 1) { // два+ слияния за ход — комбо-бонус
            const bonus = res.merges.length * 25;
            api.addScore(bonus);
            floats.add(cv.w / 2, cv.h * 0.2, 'Двойное слияние! +' + bonus, { size: 18, color: '#FFE27A' });
            api.sfx('combo', { level: res.merges.length + 1 });
          }
          api.addScore(res.gained);
        }
      }, anim ? maxDur : 0);

      setTimeout(() => {
        if (!alive) return;
        deadTiles = [];
        spawnTile();
        api.sfx('pop');
        busy = false;
        // победа / конец?
        if (!wonShown && res.merges.some(m => m.newV >= 2048)) {
          wonShown = true;
          showWin();
          return;
        }
        if (!logic.canMove(grid)) { endLose(); return; }
        if (pending) { const d = pending; pending = null; move(d); }
      }, anim ? maxDur + 110 : 20);
    }

    async function showWin() {
      busy = true;
      await api.onEnd({
        win: true, icon: '🔢', title: '2048! Победа!',
        subtitle: 'Можно продолжить — сколько ещё вытянет поле?',
        buttons: [{ label: '▶ Продолжить', value: 'continue' }],
      });
      if (alive) busy = false;
    }

    function endLose() {
      if (over) return;
      over = true; busy = true;
      api.sfx('dead');
      setTimeout(() => {
        if (!alive) return;
        api.onEnd({
          win: false, icon: '🧊', title: 'Поле забито',
          subtitle: 'Классика: держи крупные плитки в одном углу.',
        });
      }, 600);
    }

    /* ── Отрисовка ─────────────────────────────────────────────────────── */
    function tileColors(v) { return BG[v] || DEFAULT_TILE; }

    function drawTile(t, now) {
      const P = api.palette();
      let x = pos(t.c), y = pos(t.r), scale = 1, alpha = 1;
      if (t.fx) { // слайд из старой позиции
        const k = (now - t.fx.t0) / t.fx.dur;
        if (k >= 1) t.fx = null;
        else {
          const rest = 1 - UI.E.outQuad(k);
          x = UI.lerp(x, pos(t.fx.fromC), rest);
          y = UI.lerp(y, pos(t.fx.fromR), rest);
        }
      }
      if (t.spawnT0) { // появление: 0.6 → 1.1 → 1.0
        const k = (now - t.spawnT0) / 210;
        if (k >= 1) t.spawnT0 = 0;
        else scale = UI.popScale(k);
      }
      if (t.popT0) { // слияние: «хлопок» 1 → 1.22 → 1
        const k = (now - t.popT0) / 200;
        if (k >= 1) t.popT0 = 0;
        else scale = 1 + 0.22 * Math.sin(Math.min(k, 1) * Math.PI);
      }
      const v = t.renderV || t.v;
      const [bg, fg] = tileColors(t.renderV ? t.renderV : t.v);
      ctx.save();
      ctx.globalAlpha = alpha;
      const cx = x + cell / 2, cy = y + cell / 2;
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);
      if (v >= 512) { // крупные плитки слегка светятся
        ctx.shadowColor = bg; ctx.shadowBlur = 18;
      }
      UI.rr(ctx, -cell / 2, -cell / 2, cell, cell, cell * 0.16);
      ctx.fillStyle = bg; ctx.fill();
      ctx.shadowBlur = 0;
      const fs = v < 100 ? cell * 0.42 : v < 1000 ? cell * 0.34 : cell * 0.27;
      ctx.font = `800 ${fs}px "Nunito","Segoe UI",system-ui,sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = fg;
      ctx.fillText(String(v), 0, 2);
      ctx.restore();
    }

    function draw(t) {
      const P = api.palette();
      const now = performance.now();
      ctx.clearRect(0, 0, cv.w, cv.h);

      ctx.save();
      ctx.shadowColor = 'rgba(70,50,110,0.18)';
      ctx.shadowBlur = 22; ctx.shadowOffsetY = 8;
      UI.rr(ctx, 2, 2, boardS + 6, boardS + 6, 18);
      ctx.fillStyle = P.board; ctx.fill();
      ctx.restore();

      for (let r = 0; r < N; r++)
        for (let c = 0; c < N; c++) {
          UI.rr(ctx, pos(c), pos(r), cell, cell, cell * 0.16);
          ctx.fillStyle = P.track; ctx.fill();
        }

      // мёртвые (поглощённые) плитки доигрывают слайд под живыми
      for (const t of deadTiles) drawTile(t, now);
      for (let r = 0; r < N; r++)
        for (let c = 0; c < N; c++) if (grid[r][c]) drawTile(grid[r][c], now);

      parts.draw(ctx);
      floats.draw(ctx);
    }

    /* ── Состояние ─────────────────────────────────────────────────────── */
    function reset() {
      grid = Array.from({ length: N }, () => Array(N).fill(null));
      score = 0; over = false; busy = false; wonShown = false; pending = null;
      deadTiles = [];
      parts.clear(); floats.clear();
      api.setScore(0);
      spawnTile(); spawnTile();
    }

    reset();
    api.chips([
      { id: 'score', label: 'Счёт', value: 0 },
      { id: 'best', label: 'Рекорд', value: 0, gold: true },
    ]);
    layout();
    loop.start();
    api.hintOnce('Стрелки, WASD или свайпы. Одинаковые плитки складываются — доберись до 2048!');

    return {
      restart() { reset(); loop.start(); },
      pause() { loop.stop(); },
      resume() { if (!over) loop.start(); },
      destroy() { alive = false; loop.stop(); ac.abort(); roDispose(); },
    };
  }

  /* Превью: «2» приезжает в «2» и хлопается в «4» */
  function preview(ctx, w, h, t, P) {
    const cs = Math.min(w / 4.6, h / 2.4);
    const ox = (w - cs * 3) / 2, oy = (h - cs) / 2;
    const cell = (x, y, v, a, b) => {
      UI.rr(ctx, x, y, cs, cs, cs * 0.18);
      ctx.fillStyle = a; ctx.fill();
      ctx.font = `800 ${cs * 0.42}px "Nunito","Segoe UI",system-ui,sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = b;
      ctx.fillText(v, x + cs / 2, y + cs / 2 + 1);
    };
    const cycle = t % 2.6;
    // статичные: пустая и 4
    cell(ox, oy, '', 'rgba(255,255,255,0.22)', '#000');
    cell(ox + cs * 2, oy, '4', '#EDE0C8', '#7A7167');
    let moverK = 0, pop = 0;
    if (cycle < 1) moverK = UI.E.outCubic(cycle);
    else if (cycle < 1.35) { moverK = 1; pop = Math.sin((cycle - 1) / 0.35 * Math.PI); }
    if (cycle < 1.35) {
      const x = UI.lerp(ox - cs * 1.1, ox + cs, moverK);
      const sc = 1 + 0.18 * pop;
      ctx.save();
      ctx.translate(x + cs / 2, oy + cs / 2); ctx.scale(sc, sc); ctx.translate(-cs / 2, -cs / 2);
      cell(0, 0, '2', '#F9BD8B', '#8C4A1F');
      ctx.restore();
    } else {
      // после слияния показываем удвоенную плитку
      const k = (cycle - 1.35) / 1.25;
      ctx.save();
      ctx.globalAlpha = 1 - k;
      const sc = 1 + 0.1 * Math.sin(Math.min(1, k * 3) * Math.PI);
      ctx.translate(ox + cs * 1.5, oy + cs / 2); ctx.scale(sc, sc);
      cell(-cs / 2, -cs / 2, '4', '#F7A46B', '#7C3A16');
      ctx.restore();
    }
  }

  global.MiniGames.register({
    id: '2048', title: '2048', icon: '🔢',
    tagline: 'Складывай одинаковые плитки свайпами и доберись до заветной 2048.',
    accent: ['#FFB13D', '#FF7E5F'],
    preview, create, logic,
  });
})(typeof window !== 'undefined' ? window : globalThis);
