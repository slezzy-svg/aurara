/* games/_template.js — ШАБЛОН НОВОЙ ИГРЫ.
   ───────────────────────────────────────────────────────────────────────────
   Как добавить игру (3 шага):
     1. Скопируйте файл: cp js/games/_template.js js/games/mygame.js
     2. Реализуйте create() (и по желанию preview() и logic).
     3. Подключите скрипт в index.html рядом с остальными играми:
            <script src="js/games/mygame.js"></script>
     Всё: карточка на главной, роутер, рекорды, пауза, звук и настройки
     достанутся игре автоматически.

   Контракт игры:
     create(mount, api) → { restart(), pause(), resume(), destroy() }
       • mount — контейнер, вставьте в него canvas через UI.canvasIn(mount).
       • api   — методы оболочки (см. ниже).
     Договорённости:
       • Рисуйте только в своём canvas; DOM-UI — через api.chips()/api.extra().
       • Ввод слушайте на своём canvas, а глобальные слушатели (window)
         вешайте с { signal: ac.signal } и делайте ac.abort() в destroy().
       • Тяжёлые анимации проверяйте через api.anims() — это настройка
         «Анимации» + prefers-reduced-motion.
       • Финал — один вызов api.onEnd({...}); повторные вызовы оболочка
         сама подавит, если модалка уже открыта.
   ─────────────────────────────────────────────────────────────────────────── */
(function (global) {
  'use strict';

  /* ── Чистая логика БЕЗ DOM — удобно покрывать Node-тестами ──────────── */
  const logic = {
    // foo(a, b) { return a + b; },
  };

  /* ── Создание игры ───────────────────────────────────────────────────── */
  function create(mount, api) {
    /* 1. Canvas на весь контейнер (DPR, resize — уже позаботились) */
    const cv = UI.canvasIn(mount);
    const ctx = cv.ctx;

    /* 2. Слушатели: локальные — на canvas, глобальные — через AbortController */
    const ac = new AbortController();
    window.addEventListener('keydown', e => {
      /* e.preventDefault() для игровых клавиш */
    }, { signal: ac.signal });

    /* 3. «Сочность»: частицы, всплывающие очки */
    const parts = UI.particles();
    const floats = UI.floaters();

    /* 4. Игровой цикл: dt в секундах, закэпленный на 50 мс */
    const loop = UI.loop((dt, t) => {
      parts.step(dt); floats.step(dt);
      draw(t);
    });

    /* 5. Геометрия: пересчитываете под размер контейнера */
    function layout() {
      const W = mount.clientWidth || 320, H = mount.clientHeight || 440;
      cv.fit(W, H);
    }
    const roDispose = UI.observeResize(mount, layout); // ← не забудьте disconnect

    function draw(t) {
      const P = api.palette(); // цвета темы (светлая/тёмная) для canvas
      ctx.clearRect(0, 0, cv.w, cv.h);
      // … панели: UI.rr(ctx, x, y, w, h, r) — скруглённый прямоугольник
      // … появление фишки: scale = UI.popScale(k)  // 0.6 → 1.1 → 1.0
      // … уничтожение:  scale↓ + rotate + fade  +  parts.burst(x, y, {count: 10})
      parts.draw(ctx);
      floats.draw(ctx);
    }

    /* 6. Чипы в шапке. 'score' и 'best' — обязательные друзья: score
          анимируется «прыжком», best подсвечивается золотым. */
    api.chips([
      { id: 'score', label: 'Счёт', value: 0 },
      { id: 'best', label: 'Рекорд', value: 0, gold: true },
      // { id: 'moves', label: 'Ходы', value: 10 },
    ]);

    /* 7. Подсказка правил при первом запуске (сохраняется в localStorage) */
    api.hintOnce('Правила игры одним предложением.');

    layout();
    loop.start();

    /* 8. Возвратите управление состоянием оболочке */
    return {
      restart() { /* сброс состояния и loop.start() */ },
      pause() { loop.stop(); },          // остановить цикл и таймеры
      resume() { loop.start(); },        // (следите за флагом «игра окончена»)
      destroy() {
        loop.stop();
        ac.abort();        // снимет все window-слушатели
        roDispose();       // отключит ResizeObserver
      },
    };
  }

  /* ── Превью на карточке (необязательно): (ctx, w, h, t, palette), t — сек ── */
  function preview(ctx, w, h, t, P) {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(w / 2 + Math.sin(t) * w * 0.2, h / 2, Math.min(w, h) * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }

  global.MiniGames.register({
    id: 'template',            // латиницей, для URL: #/play/template
    title: 'Шаблон игры',      // название на карточке
    icon: '🎯',                // эмодзи-иконка
    tagline: 'Одно предложение о правилах — видно на карточке.',
    accent: ['#8E7CFF', '#C4B5FF'], // градиент карточки и кнопок
    preview, create, logic,
  });
})(typeof window !== 'undefined' ? window : globalThis);
