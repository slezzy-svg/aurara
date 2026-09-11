/* main.js — оболочка приложения.
   ───────────────────────────────────────────────────────────────────────────
   • Hash-роутер: #/ → главная, #/play/<id> → экран игры (работает кнопка «назад» браузера).
   • Главная: карточки игр с живыми canvas-превью и рекордами.
   • Экран игры: шапка (счёт/рекорд/ходы), пауза/рестарт/звук/настройки, модалки.
   • API для игр (create(mount, api) → {restart, pause, resume, destroy}).
   • Настройки: звук, слайдеры музыка/эффекты, анимации, тема, сброс рекордов.
   ─────────────────────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  const $ = id => document.getElementById(id);
  const elHome = $('screen-home'), elGame = $('screen-game'), elGrid = $('games-grid');
  const elMount = $('game-mount'), elExtra = $('game-extra'), elChips = $('game-chips');
  const elIcon = $('game-icon'), elTitle = $('game-title');

  let current = null;        // экземпляр игры {restart,pause,resume,destroy}
  let currentDef = null;     // описание игры из реестра
  let paused = false;
  let scoreVal = 0, bestShown = 0;
  let chipEls = {};          // id чипа → {value, isNum, gold}
  let scoreAnim = null;      // rAF-анимация «прыгающего» счёта
  let settingsOpen = false;

  /* ══════════════════ ТЕМА ══════════════════ */
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    document.dispatchEvent(new CustomEvent('pb:theme')); // игры обновят палитру canvas
  }
  function currentTheme() {
    return Store.settings.theme ||
      (typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }
  applyTheme(currentTheme());

  /* ══════════════════ ЗВУК: разблокировка после первого жеста ═══════════ */
  const unlock = () => global.AudioEngine.unlock();
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  /* ══════════════════ ПЕРЕХОДЫ МЕЖДУ ЭКРАНАМИ (300 мс) ═════════════════ */
  function switchScreen(from, to) {
    if (from === to) return;
    from.classList.add('is-exit');
    to.hidden = false;
    to.classList.add('is-enter');
    // форс-репейнт, чтобы переход гарантированно сыграл
    requestAnimationFrame(() => requestAnimationFrame(() => to.classList.remove('is-enter')));
    setTimeout(() => { from.hidden = true; from.classList.remove('is-exit'); }, 310);
  }

  /* ══════════════════ API, которое получает каждая игра ════════════════ */
  function makeAPI(def) {
    const api = {
      mount: elMount,
      sfx: (name, opts) => global.AudioEngine.play(name, opts),
      anims: () => global.UI.animsOn(),
      palette: () => global.UI.palette(),

      /* Чипы статистики в шапке */
      chips(defs) {
        elChips.innerHTML = '';
        chipEls = {};
        for (const d of defs) {
          const chip = document.createElement('div');
          chip.className = 'chip' + (d.gold ? ' gold' : '');
          const label = document.createElement('span');
          label.className = 'chip-label'; label.textContent = d.label;
          const value = document.createElement('span');
          value.className = 'chip-value'; value.textContent = d.value;
          chip.append(label, value); elChips.append(chip);
          chipEls[d.id] = { value, isNum: typeof d.value === 'number' };
        }
      },
      chip(id, v, { bump = true } = {}) {
        const c = chipEls[id];
        if (!c) return;
        if (c.isNum && typeof v === 'number') c.value.textContent = UI.fmt(v);
        else c.value.textContent = v;
        if (bump) { c.value.classList.remove('bump'); void c.value.offsetWidth; c.value.classList.add('bump'); }
      },

      /* Счёт: анимированный инкремент + живое отражение рекорда */
      addScore(n) { setScoreInternal(scoreVal + n); },
      setScore(n) { setScoreInternal(n); },
      score: () => scoreVal,

      /* Своя панель под шапкой (цели уровня, кнопки) */
      extra(html) {
        elExtra.innerHTML = html || '';
        elExtra.hidden = !html;
        return elExtra;
      },

      toast: (m, ms) => UI.toast(m, ms),
      shake: el => UI.shake(el),
      confirm: ({ title, text, yes = 'Да', no = 'Отмена' }) =>
        UI.modal({
          icon: '❓', title, sub: text,
          buttons: [{ label: yes, value: true }, { label: no, kind: 'ghost', value: false }],
        }),
      /* Подсказка правил — один раз за всё время */
      hintOnce(text) {
        if (Store.seenHint(def.id)) return;
        Store.markHintSeen(def.id);
        UI.toast(text, 4200);
      },

      /* Финал: модалка победы/проигрыша + рекорд + конфетти.
         Если модалка уже открыта (например, «Продолжить» в 2048) — второй вызов подавляем. */
      async onEnd(o = {}) {
        if (document.querySelector('.modal-overlay')) return;
        const best = Store.best(def.id);
        const isRecord = scoreVal > best && scoreVal > 0;
        if (isRecord) Store.setBest(def.id, scoreVal);
        if (o.win) Store.addWin(def.id);
        // звук и конфетти — сразу при показе модалки
        global.AudioEngine.play(isRecord ? 'record' : (o.win ? 'win' : 'lose'));
        if (isRecord) UI.confetti();
        const action = await UI.modal({
          icon: o.icon || (o.win ? '🏆' : (isRecord ? '🏅' : '🎲')),
          title: o.title || (o.win ? 'Победа!' : 'Игра окончена'),
          sub: o.subtitle || '',
          record: isRecord,
          stats: o.stats || [
            { k: 'Счёт', v: UI.fmt(scoreVal) },
            { k: 'Рекорд', v: UI.fmt(Math.max(best, scoreVal)) },
          ],
          buttons: (o.buttons || []).concat([
            { label: '🔁 Ещё раз', value: 'again' },
            { label: '🏠 В меню', kind: 'ghost', value: 'menu' },
          ]),
        });
        if (o.onAction) o.onAction(action);
        if (action === 'again') restartGame();
        else if (action === 'menu') goHome();
      },
    };
    return api;
  }

  function setScoreInternal(n) {
    scoreVal = Math.max(0, Math.round(n));
    // Плавный «прыгающий» инкремент: число догоняет цель за ~350 мс
    const c = chipEls.score;
    if (!c) return;
    if (scoreAnim) cancelAnimationFrame(scoreAnim);
    if (!UI.animsOn()) { apiSafeChip('score', scoreVal); return; }
    const from = parseInt(String(c.value.textContent).replace(/\s/g, '')) || 0;
    const to = scoreVal, t0 = performance.now(), dur = 350;
    const step = now => {
      const k = UI.clamp((now - t0) / dur, 0, 1);
      c.value.textContent = UI.fmt(UI.lerp(from, to, UI.E.outCubic(k)));
      if (k < 1) scoreAnim = requestAnimationFrame(step);
    };
    scoreAnim = requestAnimationFrame(step);
    apiSafeChip('score', scoreVal, { bump: true });
  }
  function apiSafeChip(id, v, opts) { /* обновить чип без re-tween */ 
    const c = chipEls[id];
    if (!c) return;
    c.value.textContent = UI.fmt(v);
    if (opts && opts.bump) { c.value.classList.remove('bump'); void c.value.offsetWidth; c.value.classList.add('bump'); }
  }

  function refreshBestChip() {
    bestShown = Store.best(currentDef.id);
    if (chipEls.best) {
      chipEls.best.value.classList.toggle('gold', bestShown > 0);
      apiSafeChip('best', bestShown, {});
      chipEls.best.value.textContent = UI.fmt(bestShown);
    }
  }

  /* ══════════════════ ЖИЗНЕННЫЙ ЦИКЛ ИГРЫ ══════════════════════════════ */
  function destroyGame() {
    if (current) { try { current.destroy(); } catch (e) { console.error(e); } current = null; }
    elMount.innerHTML = '';
    elExtra.innerHTML = ''; elExtra.hidden = true;
    elChips.innerHTML = ''; chipEls = {};
    paused = false;
    if (scoreAnim) cancelAnimationFrame(scoreAnim);
    $('btn-pause').textContent = '⏸';
  }

  function startGame(id) {
    const def = global.MiniGames.get(id);
    if (!def) return goHome();
    destroyGame();
    currentDef = def;
    scoreVal = 0;

    // акценты игры прокрашивают кнопки/иконку экрана
    document.documentElement.style.setProperty('--ga1', def.accent[0]);
    document.documentElement.style.setProperty('--ga2', def.accent[1]);
    elIcon.textContent = def.icon;
    elTitle.textContent = def.title;

    const api = makeAPI(def);
    current = def.create(elMount, api);
    Store.addPlay(id);
    switchScreen(elHome, elGame);
    refreshBestChip();
    stopPreviewLoop();
  }

  function restartGame() {
    if (!current) return;
    scoreVal = 0;
    paused = false; $('btn-pause').textContent = '⏸';
    try { current.restart(); } catch (e) { console.error(e); }
    refreshBestChip();
  }

  function goHome() {
    destroyGame();
    switchScreen(elGame, elHome);
    refreshCardRecords();
    startPreviewLoop();
    location.hash = '';
  }

  /* ══════════════════ ПАУЗА ════════════════════════════════════════════ */
  async function pauseGame() {
    if (!current || paused) return;
    paused = true;
    $('btn-pause').textContent = '▶';
    if (current.pause) current.pause();
    const action = await UI.modal({
      icon: '⏸', title: 'Пауза',
      sub: 'Отдохните — игра никуда не убежит.',
      buttons: [
        { label: '▶ Продолжить', value: 'resume' },
        { label: '🔁 Заново', kind: 'ghost', value: 'restart' },
        { label: '⚙️ Настройки', kind: 'ghost', value: 'settings' },
        { label: '🏠 В меню', kind: 'ghost', value: 'menu' },
      ],
    });
    paused = false;
    $('btn-pause').textContent = '⏸';
    if (action === 'resume') { if (current && current.resume) current.resume(); }
    else if (action === 'restart') restartGame();
    else if (action === 'settings') { openSettings(() => { if (current) pauseGame(); }); }
    else if (action === 'menu') goHome();
    else { if (current && current.resume) current.resume(); } // Esc/клик мимо = продолжить
  }

  /* ══════════════════ НАСТРОЙКИ ════════════════════════════════════════ */
  function openSettings(onClose) {
    if (settingsOpen) return;
    settingsOpen = true;
    const s = Store.settings;

    const ov = document.createElement('div');
    ov.className = 'modal-overlay';
    const box = document.createElement('div');
    box.className = 'modal';
    box.setAttribute('role', 'dialog');
    box.innerHTML = `
      <div class="modal-icon">⚙️</div>
      <h3 class="modal-title">Настройки</h3>
      <div class="settings-row"><span>🔔 Звук</span><label class="switch"><input type="checkbox" id="set-sound"><span class="track"></span></label></div>
      <div class="settings-row"><span>🎵 Музыка</span><input type="range" class="slider" id="set-music" min="0" max="1" step="0.05"></div>
      <div class="settings-row"><span>🔊 Эффекты</span><input type="range" class="slider" id="set-sfx" min="0" max="1" step="0.05"></div>
      <div class="settings-row"><span>✨ Анимации</span><label class="switch"><input type="checkbox" id="set-anim"><span class="track"></span></label></div>
      <div class="settings-row"><span>🌗 Тема</span>
        <div class="segmented" id="set-theme">
          <button type="button" data-t="light">☀️ Светлая</button>
          <button type="button" data-t="dark">🌙 Тёмная</button>
        </div>
      </div>
      <div class="settings-note">Громкость всего звука ≤ 0.3 — спокойно для ушей.<br>При prefers-reduced-motion анимации отключаются сами.</div>
      <div class="modal-actions">
        <button class="btn btn-primary" id="set-done">Готово</button>
        <button class="btn btn-ghost" id="set-reset">🗑 Сбросить рекорды</button>
      </div>`;
    ov.append(box);
    document.getElementById('modal-root').append(ov);

    const $b = id => box.querySelector('#' + id);
    $b('set-sound').checked = s.sound;
    $b('set-anim').checked = s.anim;
    $b('set-music').value = s.music;
    $b('set-sfx').value = s.sfx;
    const themeSeg = $b('set-theme');
    const theme = currentTheme();
    themeSeg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.t === theme));

    $b('set-sound').addEventListener('change', e => {
      Store.set('sound', e.target.checked);
      global.AudioEngine.setEnabled(e.target.checked);
    });
    $b('set-anim').addEventListener('change', e => {
      Store.set('anim', e.target.checked);
      global.AudioEngine.play('click');
    });
    $b('set-music').addEventListener('input', e => {
      Store.set('music', parseFloat(e.target.value));
      global.AudioEngine.setMusicVol(parseFloat(e.target.value));
    });
    $b('set-sfx').addEventListener('input', e => {
      Store.set('sfx', parseFloat(e.target.value));
      global.AudioEngine.setSfxVol(parseFloat(e.target.value));
      global.AudioEngine.play('pop'); // пример для настройки громкости
    });
    themeSeg.addEventListener('click', e => {
      const b = e.target.closest('button[data-t]');
      if (!b) return;
      Store.set('theme', b.dataset.t);
      applyTheme(b.dataset.t);
      themeSeg.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
      global.AudioEngine.play('click');
    });

    const close = () => {
      settingsOpen = false;
      ov.classList.add('closing');
      setTimeout(() => ov.remove(), 300);
      if (onClose) onClose();
    };
    $b('set-done').addEventListener('click', () => { global.AudioEngine.play('click'); close(); });
    $b('set-reset').addEventListener('click', async () => {
      const ok = await UI.modal({
        icon: '🗑', title: 'Сбросить рекорды?',
        sub: 'Все рекорды и статистика будут удалены.',
        buttons: [{ label: 'Сбросить', value: true }, { label: 'Отмена', kind: 'ghost', value: false }],
      });
      if (ok) { Store.resetAll(); refreshCardRecords(); refreshBestChip(); UI.toast('Рекорды сброшены'); }
    });

    requestAnimationFrame(() => requestAnimationFrame(() => ov.classList.add('open')));
  }

  /* ══════════════════ ГЛАВНАЯ: карточки + живые превью ═════════════════ */
  const previews = []; // {def, cv, t, speed}

  function buildHome() {
    elGrid.innerHTML = '';
    global.MiniGames.all().forEach((def, i) => {
      const card = document.createElement('article');
      card.className = 'game-card';
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `${def.title}: ${def.tagline}`);
      card.style.setProperty('--a1', def.accent[0]);
      card.style.setProperty('--a2', def.accent[1]);
      card.style.animationDelay = `${i * 60}ms`; // каскадное появление карточек

      const preview = document.createElement('div');
      preview.className = 'card-preview';
      const cvs = document.createElement('canvas');
      preview.append(cvs);

      const body = document.createElement('div');
      body.className = 'card-body';
      const titleRow = document.createElement('div');
      titleRow.className = 'card-title';
      const ic = document.createElement('span'); ic.className = 'card-icon'; ic.textContent = def.icon;
      const h3 = document.createElement('h3'); h3.textContent = def.title;
      titleRow.append(ic, h3);
      const tag = document.createElement('p'); tag.className = 'card-tag'; tag.textContent = def.tagline;
      const meta = document.createElement('div'); meta.className = 'card-meta';
      const best = document.createElement('span'); best.className = 'card-best';
      const play = document.createElement('span'); play.className = 'card-play'; play.textContent = 'Играть';
      meta.append(best, play);
      body.append(titleRow, tag, meta);

      card.append(preview, body);
      card.addEventListener('click', () => { global.AudioEngine.play('click'); location.hash = '#/play/' + def.id; });
      card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); location.hash = '#/play/' + def.id; } });
      elGrid.append(card);

      // canvas-превью (рисуется функцией самой игры — единый стиль)
      const ctx = cvs.getContext('2d');
      previews.push({ def, cvs, ctx, t: Math.random() * 10, speed: 0.85 + Math.random() * 0.3, bestEl: best, w: 0, h: 0 });
    });
    sizePreviews();
    refreshCardRecords();
    addEventListener('resize', sizePreviews);
  }

  function sizePreviews() {
    for (const p of previews) {
      const r = p.cvs.parentElement.getBoundingClientRect();
      p.w = Math.max(1, r.width); p.h = Math.max(1, r.height);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      p.cvs.width = p.w * dpr; p.cvs.height = p.h * dpr;
      p.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawPreview(p, 0);
    }
  }

  function drawPreview(p, dt) {
    p.t += dt * p.speed;
    p.ctx.clearRect(0, 0, p.w, p.h);
    try { p.def.preview(p.ctx, p.w, p.h, p.t, UI.palette()); } catch (e) { /* превью не должно ломать сайт */ }
  }

  function refreshCardRecords() {
    for (const p of previews) {
      const b = Store.best(p.def.id);
      if (b > 0) { p.bestEl.textContent = '🏆 ' + UI.fmt(b); p.bestEl.classList.add('has'); }
      else { p.bestEl.textContent = 'Рекорда пока нет'; p.bestEl.classList.remove('has'); }
    }
  }

  /* Один общий rAF на все превью; останавливается, когда главная скрыта
     или анимации выключены (тогда рисуем один статичный кадр). */
  let prevRaf = 0, prevLast = 0;
  function previewFrame(now) {
    const dt = (now - prevLast) / 1000; prevLast = now;
    if (!elHome.hidden && UI.animsOn() && !document.hidden) {
      for (const p of previews) drawPreview(p, Math.min(dt, 0.05));
    }
    prevRaf = requestAnimationFrame(previewFrame);
  }
  function startPreviewLoop() {
    if (!prevRaf) { prevLast = performance.now(); prevRaf = requestAnimationFrame(previewFrame); }
    if (!UI.animsOn()) sizePreviews(); // статичный кадр
  }
  function stopPreviewLoop() { if (prevRaf) { cancelAnimationFrame(prevRaf); prevRaf = 0; } }

  /* ══════════════════ КНОПКИ И ГОРЯЧИЕ КЛАВИШИ ═════════════════════════ */
  $('btn-back').addEventListener('click', () => { global.AudioEngine.play('click'); goHome(); });
  $('btn-pause').addEventListener('click', () => { global.AudioEngine.play('click'); pauseGame(); });
  $('btn-restart').addEventListener('click', () => { global.AudioEngine.play('click'); restartGame(); });
  $('btn-mute').addEventListener('click', () => {
    const on = !Store.settings.sound;
    Store.set('sound', on);
    global.AudioEngine.unlock();
    global.AudioEngine.setEnabled(on);
    $('btn-mute').textContent = on ? '🔊' : '🔇';
    UI.toast(on ? 'Звук включён' : 'Звук выключен', 1400);
  });
  $('btn-settings-home').addEventListener('click', () => { global.AudioEngine.play('click'); openSettings(); });
  $('btn-settings-game').addEventListener('click', () => { global.AudioEngine.play('click'); openSettings(() => { if (current && !paused) return; }); });
  $('btn-theme-home').addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    Store.set('theme', next);
    applyTheme(next);
    global.AudioEngine.play('click');
  });
  $('btn-random').addEventListener('click', () => {
    const all = global.MiniGames.all();
    const pick = all[(Math.random() * all.length) | 0];
    global.AudioEngine.play('click');
    location.hash = '#/play/' + pick.id;
  });

  /* Esc — пауза/меню; стрелки не скроллят страницу во время игры */
  window.addEventListener('keydown', e => {
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const modalOpen = document.querySelector('.modal-overlay');
    if (e.key === 'Escape' && !modalOpen) {
      if (!elGame.hidden) pauseGame();
      return;
    }
    if (!elGame.hidden && !modalOpen && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
      e.preventDefault();
    }
  });

  /* Автопауза при уходе со вкладки */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && current && !paused && !document.querySelector('.modal-overlay')) pauseGame();
  });

  /* Лёгкий параллакс фона за курсором (только для «мышиных» устройств) */
  if (window.matchMedia && matchMedia('(pointer: fine)').matches && !UI.REDUCED) {
    const bg = $('bg');
    window.addEventListener('pointermove', e => {
      bg.style.setProperty('--mx', (e.clientX / innerWidth - 0.5).toFixed(3));
      bg.style.setProperty('--my', (e.clientY / innerHeight - 0.5).toFixed(3));
    }, { passive: true });
  }

  /* ══════════════════ РОУТЕР ═══════════════════════════════════════════ */
  function route() {
    const m = location.hash.match(/^#\/play\/([\w-]+)/);
    if (m && global.MiniGames.get(m[1])) startGame(m[1]);
    else if (!elGame.hidden) goHome();
    else { startPreviewLoop(); }
  }
  window.addEventListener('hashchange', route);

  /* ══════════════════ СТАРТ ════════════════════════════════════════════ */
  document.addEventListener('DOMContentLoaded', () => {
    buildHome();
    route();
    $('btn-mute').textContent = Store.settings.sound ? '🔊' : '🔇';
  });

  /* Для отладки и smoke-тестов */
  global.App = {
    route, startGame, goHome, restartGame, pauseGame, openSettings,
    get current() { return current; },
    get currentId() { return currentDef && currentDef.id; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
