/* games/mahjong.js — Маджонг-солитер.
   Правила: убирай ПАРЫ одинаковых свободных плиток. Плитка свободна, если
   сверху её ничего не накрывает и открыта левая ИЛИ правая сторона.
   Подсвеченные плитки — доступные. Тупик — поле само перемешается. */
(function (global) {
  'use strict';

  /* Эмодзи-«масти». 82 плитки = 41 пара, масти повторяются как в классике. */
  const EMOJIS = ['🍒', '🍋', '🍇', '🍉', '🍓', '🥑', '🌶', '🌽', '🍄', '🌰', '🥕', '🍎',
    '🍍', '🥝', '🥥', '🍑', '🥔', '🍅', '🥬', '🍫', '🍩', '🍪', '🧁', '🍰', '🎂', '🍶'];

  /* Слои пирамиды: [строки, столбцы]. Верхние слои сдвинуты на полплитки. */
  const LAYERS = [[6, 8], [4, 6], [2, 4], [1, 2]];

  const logic = {
    /** Собрать раскладку: плитки с координатами в «полуплитках» (x, y — целые) */
    buildLayout() {
      const tiles = [];
      let id = 0;
      LAYERS.forEach(([rows, cols], l) => {
        for (let r = 0; r < rows; r++)
          for (let c = 0; c < cols; c++)
            tiles.push({ id: id++, l, r, c, x: c * 2 + l, y: r * 2 + l, emoji: '', removed: false });
      });
      // порядок отрисовки: снизу вверх, слева направо
      tiles.sort((a, b) => (a.l - b.l) || (a.y - b.y) || (a.x - b.x));
      return tiles;
    },
    /** Плита свободна: ничего сверху не лежит и открыта левая или правая сторона */
    isFree(t, tiles) {
      for (const u of tiles) {
        if (u.removed || u === t) continue;
        if (u.l > t.l && Math.abs(u.x - t.x) < 2 && Math.abs(u.y - t.y) < 2) return false; // накрыта сверху
      }
      let left = false, right = false;
      for (const u of tiles) {
        if (u.removed || u.l !== t.l || u === t) continue;
        if (u.y === t.y) {
          if (u.x === t.x - 2) left = true;
          else if (u.x === t.x + 2) right = true;
        }
      }
      return !left || !right;
    },
    computeFree(tiles) {
      const free = new Set();
      for (const t of tiles) if (!t.removed && logic.isFree(t, tiles)) free.add(t.id);
      return free;
    },
    /** Найти пару среди свободных (для подсказки и проверки тупика) */
    findFreePair(tiles, freeSet) {
      const byEmoji = new Map();
      for (const t of tiles) {
        if (t.removed || !freeSet.has(t.id)) continue;
        const arr = byEmoji.get(t.emoji);
        if (arr) { arr.push(t); if (arr.length >= 2) return [arr[0], arr[1]]; }
        else byEmoji.set(t.emoji, [t]);
      }
      return null;
    },
    /** Раздать эмодзи парами (случайно) */
    deal(tiles) {
      const alive = tiles.filter(t => !t.removed);
      const pairs = alive.length / 2;
      const deck = [];
      for (let i = 0; i < pairs; i++) deck.push(EMOJIS[i % EMOJIS.length], EMOJIS[i % EMOJIS.length]);
      // перемешиваем и раздаём: две подряд одинаковые карточки → пара
      for (let i = deck.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;[deck[i], deck[j]] = [deck[j], deck[i]];
      }
      alive.forEach((t, i) => t.emoji = deck[i]);
    },
  };

  function create(mount, api) {
    const cv = UI.canvasIn(mount);
    const ctx = cv.ctx;
    const ac = new AbortController();
    const parts = UI.particles();
    const floats = UI.floaters();

    let tiles, freeSet, sel, hoverId, score, pairsLeft, over, alive = true;
    let lastMatch = -1e9, chain = 0;
    let hintPair = null, hintT0 = 0;
    let dying = [];         // улетевшая пара: {tile, t0, mx, my}
    let shakeFx = new Map(); // id → t0 (не угадал пару)
    let extraEl = null, hintBtn = null;

    let ux = 20, uy = 22.4, tileW = 38, tileH = 43, offX = 10, offY = 10;

    const loop = UI.loop((dt, t) => {
      parts.step(dt); floats.step(dt);
      // плавный подъём плиток к целевой высоте
      for (const tl of tiles) {
        if (tl.removed) continue;
        const target = sel === tl.id ? -6 : (freeSet.has(tl.id) ? -2 : 0);
        tl.lift = (tl.lift || 0) + (target - (tl.lift || 0)) * Math.min(1, dt * 14);
      }
      draw(t);
    });

    function layout() {
      const W = mount.clientWidth || 640, H = mount.clientHeight || 480;
      const pad = 8;
      // контент: 16 юнитов в ширину, ~13.35 в высоту (при uy = 1.12·ux)
      ux = Math.min((W - pad * 2) / 16.1, (H - pad * 2 - 8) / 13.5);
      ux = Math.max(10, ux);
      uy = ux * 1.12;
      tileW = 1.92 * ux; tileH = 1.92 * uy;
      const cw = 16 * ux, ch = 13.35 * ux;
      cv.fit(cw + pad * 2, ch + pad * 2 + 6);
      offX = pad; offY = pad + 4;
    }
    const roDispose = UI.observeResize(mount, layout);

    const px = t => offX + t.x * ux;
    const py = t => offY + t.y * uy + (t.lift || 0);

    /* ── Ввод ──────────────────────────────────────────────────────────── */
    const local = e => { const r = cv.el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    function hitTest(p) {
      // сверху вниз по z-порядку
      for (let i = tiles.length - 1; i >= 0; i--) {
        const t = tiles[i];
        if (t.removed) continue;
        if (p.x >= px(t) - 1 && p.x <= px(t) + tileW + 1 && p.y >= py(t) - 4 && p.y <= py(t) + tileH + 2) return t;
      }
      return null;
    }
    cv.el.addEventListener('pointermove', e => {
      const t = hitTest(local(e));
      hoverId = t ? t.id : null;
      cv.el.style.cursor = t && freeSet.has(t.id) ? 'pointer' : 'default';
    });
    cv.el.addEventListener('pointerdown', e => {
      if (over || !loop.running) return;
      const t = hitTest(local(e));
      if (!t || t.removed || !freeSet.has(t.id)) {
        if (sel != null) { sel = null; api.sfx('back'); }
        return;
      }
      e.preventDefault();
      if (sel == null) { sel = t.id; api.sfx('pick'); return; }
      if (sel === t.id) { sel = null; api.sfx('back'); return; }
      const a = tiles.find(x => x.id === sel);
      if (a && a.emoji === t.emoji) matchPair(a, t);
      else {
        // не пара: встряхиваем обе, выбираем новую
        api.sfx('invalid');
        shakeFx.set(a.id, performance.now());
        shakeFx.set(t.id, performance.now());
        sel = t.id;
        api.sfx('pick');
      }
    });

    function matchPair(a, b) {
      const now = performance.now();
      // серия: пары, снятые подряд в течение 4 с, наращивают множитель
      chain = (now - lastMatch < 4000) ? chain + 1 : 1;
      lastMatch = now;
      const pts = 100 + (chain - 1) * 50;
      api.addScore(pts);

      const mx = (px(a) + px(b)) / 2 + tileW / 2;
      const my = (py(a) + py(b)) / 2 + tileH / 2;
      dying.push({ tile: a, t0: now, mx, my }, { tile: b, t0: now, mx, my });
      a.removed = b.removed = true;
      sel = null;
      pairsLeft--;
      api.chip('pairs', pairsLeft);

      api.sfx('match');
      if (chain > 1) {
        api.sfx('combo', { level: Math.min(chain, 8) });
        floats.add(mx, my - 20, 'Серия ×' + chain, { size: 17, color: '#FFE27A' });
      }
      floats.add(mx, my, '+' + pts, { size: 19, color: '#FFFFFF' });
      parts.burst(px(a) + tileW / 2, py(a) + tileH / 2, { colors: ['#FFE9A8', '#FFFFFF'], count: 9, size: 6 });
      parts.burst(px(b) + tileW / 2, py(b) + tileH / 2, { colors: ['#FFE9A8', '#FFFFFF'], count: 9, size: 6 });

      freeSet = logic.computeFree(tiles);

      if (pairsLeft === 0) {
        over = true;
        api.sfx('win');
        setTimeout(() => alive && api.onEnd({
          win: true, icon: '🀄', title: 'Пирамида разобрана!',
          subtitle: chain > 1 ? 'Отличная серия в конце!' : 'Чистая победа!',
        }), 650);
        return;
      }
      if (!logic.findFreePair(tiles, freeSet)) deadLock();
    }

    /* Тупик: перемешиваем эмодзи среди оставшихся плиток */
    async function deadLock() {
      api.toast('Пар больше нет — перемешиваю плитки…');
      api.sfx('shuffle');
      const aliveTiles = tiles.filter(t => !t.removed);
      let tries = 0;
      do { logic.deal(tiles); } while (!logic.findFreePair(tiles, freeSet) && ++tries < 60);
      if (!logic.findFreePair(tiles, freeSet)) {
        // гарантия: принудительно делаем пару среди двух свободных
        const fp = tiles.filter(t => !t.removed && freeSet.has(t.id)).slice(0, 2);
        if (fp.length === 2) {
          const partner = aliveTiles.find(t => t !== fp[0] && t.emoji === fp[0].emoji);
          if (partner) { const tmp = fp[1].emoji; fp[1].emoji = partner.emoji; partner.emoji = tmp; }
        }
      }
      const now = performance.now();
      for (const t of aliveTiles) t.spawnT0 = now; // пересборка с pop-анимацией
      await UI.wait(420);
      if (!alive) return;
      freeSet = logic.computeFree(tiles);
    }

    /* Подсказка: подсветить свободную пару (−50 очков) */
    function showHint() {
      if (over || busyHint) return;
      const pair = logic.findFreePair(tiles, freeSet);
      if (!pair) return;
      hintPair = pair; hintT0 = performance.now();
      api.setScore(Math.max(0, api.score() - 50));
      api.sfx('hint');
      setTimeout(() => { hintPair = null; }, 2600);
    }
    let busyHint = false;

    /* ── Отрисовка ─────────────────────────────────────────────────────── */
    function drawTile(t, now) {
      const P = api.palette();
      let x = px(t), y = py(t);
      const isFree = freeSet.has(t.id);
      // тряска при неудачной попытке
      if (shakeFx.has(t.id)) {
        const k = (now - shakeFx.get(t.id)) / 380;
        if (k >= 1) shakeFx.delete(t.id);
        else x += Math.sin(k * 34) * 4 * (1 - k);
      }
      // pop-появление после перемешивания
      let scale = 1;
      if (t.spawnT0) {
        const k = (now - t.spawnT0) / 260;
        if (k >= 1) t.spawnT0 = 0;
        else scale = UI.popScale(k);
      }
      const isSel = sel === t.id;
      const hinted = hintPair && (hintPair[0] === t || hintPair[1] === t);

      ctx.save();
      ctx.translate(x + tileW / 2, y + tileH / 2);
      ctx.scale(scale, scale);
      ctx.translate(-tileW / 2, -tileH / 2);

      // «толщина» плитки — тёмная боковина
      UI.rr(ctx, 2.5, 3.5, tileW, tileH, Math.min(8, tileW * 0.16));
      ctx.fillStyle = P.slab; ctx.fill();

      // лицо с вертикальным градиентом
      const g = ctx.createLinearGradient(0, 0, 0, tileH);
      g.addColorStop(0, P.faceA); g.addColorStop(1, P.faceB);
      UI.rr(ctx, 0, 0, tileW, tileH, Math.min(8, tileW * 0.16));
      ctx.fillStyle = g; ctx.fill();

      // мягкое свечение доступных плиток (подсказка «можно брать»)
      if (isFree && !isSel) {
        ctx.shadowColor = P.glow;
        ctx.shadowBlur = 9 + 3 * Math.sin(now / 320 + t.id);
        ctx.strokeStyle = 'rgba(120,220,170,0.35)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
      if (isSel) {
        ctx.shadowColor = P.glow; ctx.shadowBlur = 16;
        ctx.strokeStyle = P.glow; ctx.lineWidth = 3;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
      if (hinted) {
        ctx.strokeStyle = `rgba(255,215,90,${0.5 + 0.5 * Math.sin(now / 110)})`;
        ctx.lineWidth = 3.5;
        ctx.stroke();
      }

      // символ
      ctx.font = `${Math.round(tileW * 0.52)}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = P.ink;
      ctx.fillText(t.emoji, tileW / 2, tileH / 2 + 1);

      // занятые плитки притемняем — акцент на доступных
      if (!isFree) {
        UI.rr(ctx, 0, 0, tileW, tileH, Math.min(8, tileW * 0.16));
        ctx.fillStyle = P.dim; ctx.fill();
      }
      ctx.restore();
    }

    function draw(t) {
      const now = performance.now();
      ctx.clearRect(0, 0, cv.w, cv.h);
      for (const tl of tiles) if (!tl.removed) drawTile(tl, now);

      // улетевшие пары: движутся друг к другу, scale→0 + fade
      dying = dying.filter(d => {
        const k = (now - d.t0) / 300;
        if (k >= 1) return false;
        const tl = d.tile;
        const x0 = offX + tl.x * ux, y0 = offY + tl.y * uy;
        const x = UI.lerp(x0, d.mx - tileW / 2, UI.E.outCubic(k));
        const y = UI.lerp(y0, d.my - tileH / 2, UI.E.outCubic(k));
        ctx.save();
        ctx.globalAlpha = 1 - k;
        ctx.translate(x + tileW / 2, y + tileH / 2);
        ctx.scale(1 - 0.8 * k, 1 - 0.8 * k);
        ctx.rotate(k * 0.6);
        ctx.font = `${Math.round(tileW * 0.52)}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(tl.emoji, 0, 0);
        ctx.restore();
        return true;
      });

      parts.draw(ctx);
      floats.draw(ctx);
    }

    /* ── Панель под шапкой: кнопка подсказки ───────────────────────────── */
    function buildExtra() {
      extraEl = api.extra(`<button class="btn btn-ghost" id="mj-hint" style="padding:8px 18px;font-size:.85rem">💡 Подсказка · −50</button>`);
      hintBtn = extraEl.querySelector('#mj-hint');
      hintBtn.addEventListener('click', showHint);
    }

    /* ── Состояние ─────────────────────────────────────────────────────── */
    function reset() {
      tiles = logic.buildLayout();
      logic.deal(tiles);
      // стартовое правило: хотя бы одна пара должна быть доступна
      let guard = 0;
      freeSet = logic.computeFree(tiles);
      while (!logic.findFreePair(tiles, freeSet) && guard++ < 30) {
        logic.deal(tiles);
        freeSet = logic.computeFree(tiles);
      }
      pairsLeft = tiles.length / 2;
      score = 0; over = false; sel = null; hoverId = null; chain = 0; lastMatch = -1e9;
      dying = []; shakeFx.clear(); hintPair = null;
      parts.clear(); floats.clear();
      api.setScore(0);
      api.chip('pairs', pairsLeft, { bump: false });
      const now = performance.now();
      for (const t of tiles) t.spawnT0 = now; // стартовая «сдача» с pop-анимацией
    }

    reset();
    api.chips([
      { id: 'score', label: 'Счёт', value: 0 },
      { id: 'best', label: 'Рекорд', value: 0, gold: true },
      { id: 'pairs', label: 'Пар', value: 41 },
    ]);
    buildExtra();
    layout();
    loop.start();
    api.hintOnce('Убирай пары одинаковых СВЕТЯЩИХСЯ плиток. Тёмные пока закрыты!');

    return {
      restart() { reset(); loop.start(); },
      pause() { loop.stop(); },
      resume() { if (!over) loop.start(); },
      destroy() {
        alive = false; loop.stop(); ac.abort(); roDispose();
      },
    };
  }

  /* Превью: пара сверху попеременно светится и «лопается» */
  function preview(ctx, w, h, t, P) {
    const tw = Math.min(w / 4.4, h / 2.6), th = tw * 1.16;
    const bx = (w - tw * 3 - 8) / 2, by = h * 0.58;
    const drawMini = (x, y, emoji, glow) => {
      UI.rr(ctx, x + 2, y + 2.5, tw, th, 6); ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fill();
      const g = ctx.createLinearGradient(x, y, x, y + th);
      g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(1, 'rgba(235,226,205,0.95)');
      UI.rr(ctx, x, y, tw, th, 6); ctx.fillStyle = g; ctx.fill();
      if (glow > 0) { ctx.strokeStyle = `rgba(80,220,150,${glow})`; ctx.lineWidth = 2.5; ctx.stroke(); }
      ctx.font = `${Math.round(tw * 0.5)}px "Segoe UI Emoji","Apple Color Emoji",sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#4A4458';
      ctx.fillText(emoji, x + tw / 2, y + th / 2);
    };
    const cycle = t % 3;
    const glow = cycle < 1.6 ? 0.55 + 0.45 * Math.sin(t * 6) : 0;
    const popK = cycle >= 1.6 && cycle < 2 ? (cycle - 1.6) / 0.4 : -1;
    const topY = by - th * 0.62 + 2;
    if (popK < 0 || popK >= 1) {
      drawMini(bx + tw * 0.5 + 4, topY, '🍒', glow);
      drawMini(bx + tw * 1.5 + 8, topY, '🍒', glow);
    }
    drawMini(bx, by, '🍄', 0);
    drawMini(bx + tw + 8, by, '🍋', 0);
    drawMini(bx + tw * 2 + 16, by, '🍄', 0);
    if (popK >= 0 && popK < 1) {
      // «лопнувшая» пара: частицы-точки
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2 + t;
        ctx.globalAlpha = 1 - popK;
        ctx.beginPath();
        ctx.arc(bx + tw + 4 + Math.cos(a) * tw * 0.7 * popK, topY + th / 2 + Math.sin(a) * th * 0.7 * popK, 3 * (1 - popK), 0, Math.PI * 2);
        ctx.fillStyle = '#FF8FA3'; ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  global.MiniGames.register({
    id: 'mahjong', title: 'Маджонг', icon: '🀄',
    tagline: 'Разбери пирамиду: убирай пары свободных плиток. Серии пар дают комбо.',
    accent: ['#34C38F', '#7BE0A8'],
    preview, create, logic,
  });
})(typeof window !== 'undefined' ? window : globalThis);
