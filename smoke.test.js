/* tests/smoke.test.js — интеграционный тест всего сайта в jsdom.
   Запуск (нужен установленный jsdom, см. README):
     cd /tmp/smoke && npm i jsdom
     node /home/user/puzzlebox/tests/smoke.test.js
   Проверяет: загрузку всех скриптов, построение главной, запуск каждой игры,
   кадры рендера, реакцию на клавиатуру/указатель, паузу/рестарт/настройки. */
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const { JSDOM, VirtualConsole } = require(path.join('/tmp/smoke/node_modules/jsdom'));

const ROOT = path.join(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Мини-статик-сервер: отдаём файлы проекта, чтобы jsdom грузил скрипты по-http */
function startServer(port) {
  const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
  const srv = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    fs.readFile(p, (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'text/plain' });
      res.end(data);
    });
  });
  return new Promise(res => srv.listen(port, '127.0.0.1', () => res(srv)));
}

const errors = [];
let dom;

/* Стаб 2D-контекста: любые методы — no-op, градиенты — заглушки.
   Так jsdom без нативного canvas может исполнять canvas-код. */
function stub2D() {
  const grad = { addColorStop() {} };
  const target = {};
  return new Proxy(target, {
    get(t, k) {
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => grad;
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      if (k === 'canvas') return null;
      if (typeof k !== 'string') return undefined;
      if (!(k in t)) t[k] = () => undefined;
      return t[k];
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

async function main() {
  const srv = await startServer(8099);
  const vc = new VirtualConsole(); // глушим ожидаемые предупреждения jsdom
  vc.on('jsdomError', e => { if (!/Could not load link/.test(e.message)) errors.push('jsdom: ' + e.message); });
  dom = await JSDOM.fromURL('http://127.0.0.1:8099/index.html', {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true, // даёт requestAnimationFrame
    virtualConsole: vc,
  });
  process.on('exit', () => srv.close());
  const { window } = dom;
  const { document } = window;

  // стабы окружения
  window.HTMLCanvasElement.prototype.getContext = function () {
    if (!this.__ctx) this.__ctx = stub2D();
    return this.__ctx;
  };
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.addEventListener('error', e => errors.push('window.onerror: ' + e.message));

  const t = (name, fn) => errors.push
    ? (async () => {
      try { await fn(); console.log('  ✓', name); }
      catch (e) { errors.push(`${name}: ${e.message}`); console.error('  ✗', name, e.message); }
    })()
    : null;

  await new Promise(res => window.addEventListener('load', res));
  await sleep(150); // DOMContentLoaded + boot

  const T = async (name, fn) => {
    try { await fn(); console.log('  ✓', name); }
    catch (e) { errors.push(`${name}: ${e.message}`); console.error('  ✗', name, '\n     ', e.stack.split('\n').slice(0, 3).join('\n      ')); }
  };
  const ok = (v, m) => { if (!v) throw new Error(m || 'ожидалась правда'); };

  console.log('── Smoke-тест Puzzle Box ──');

  await T('Главная построена: 6 карточек с canvas-превью', () => {
    const cards = document.querySelectorAll('.game-card');
    ok(cards.length === 6, `карточек: ${cards.length}, ожидалось 6`);
    ok(document.querySelectorAll('.card-preview canvas').length === 6);
  });

  await T('Роутер по хэшу открывает игру', () => {
    window.location.hash = '#/play/2048';
    return sleep(120).then(() => {
      ok(window.App.currentId === '2048', 'currentId=' + window.App.currentId);
      ok(document.getElementById('screen-game').hidden === false);
      ok(document.querySelector('#game-mount canvas'), 'canvas игры вставлен');
    });
  });

  const ids = ['blockblast', 'match3', 'mahjong', '2048', 'twodots', 'snake'];

  for (const id of ids) {
    await T(`Игра «${id}»: создание, 400 мс кадров, ввод, пауза, рестарт, выход`, async () => {
      window.App.startGame(id);
      await sleep(80);
      ok(window.App.current, 'экземпляр создан');
      ok(window.App.currentId === id);
      await sleep(400); // кадры рендера идут
      // симулируем клик по центру канваса (pointerdown)
      const cvs = document.querySelector('#game-mount canvas');
      const ev = (type, x, y) => {
        const e = new window.MouseEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0 });
        cvs.dispatchEvent(e);
        window.dispatchEvent(new window.MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));
      };
      ev('pointerdown', 60, 60); ev('pointermove', 120, 120); ev('pointerup', 130, 130);
      await sleep(120);
      // клавиатура (актуально для 2048/змейки)
      const key = k => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
      key('ArrowLeft'); key('ArrowUp'); key('ArrowRight'); key('a'); key('w');
      await sleep(250);
      window.App.current.pause();
      await sleep(60);
      window.App.current.resume();
      await sleep(60);
      window.App.current.restart();
      await sleep(200);
      window.App.current.destroy();
      window.App.goHome();
      await sleep(80);
      ok(document.getElementById('screen-home').hidden === false);
    });
  }

  await T('Настройки: модалка открывается и живёт', async () => {
    window.App.openSettings();
    await sleep(80);
    ok(document.querySelector('.modal-overlay'), 'модалка настроек открыта');
    const slider = document.getElementById('set-music');
    ok(slider, 'слайдер музыки есть');
    slider.value = '0.3';
    slider.dispatchEvent(new window.Event('input', { bubbles: true }));
    await sleep(60);
    document.getElementById('set-done').click();
    await sleep(420);
    ok(!document.querySelector('.modal-overlay'), 'модалка закрылась');
  });

  await T('localStorage: рекорд сохраняется', async () => {
    window.Store.setBest('snake', 777);
    ok(window.Store.best('snake') === 777);
  });

  console.log(errors.length ? `\n✗ ОШИБКИ (${errors.length}):\n - ` + errors.join('\n - ') : '\n✓ SMOKE OK — ошибок нет');
  process.exit(errors.length ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
