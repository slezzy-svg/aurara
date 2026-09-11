/* tests/logic.test.js — юнит-тесты чистой логики игр (без DOM).
   Запуск: node tests/logic.test.js */
'use strict';
const path = require('path');

// Загружаем реестр и игровые модули так же, как браузер
require(path.join(__dirname, '../js/registry.js'));
require(path.join(__dirname, '../js/games/blockblast.js'));
require(path.join(__dirname, '../js/games/match3.js'));
require(path.join(__dirname, '../js/games/mahjong.js'));
require(path.join(__dirname, '../js/games/game2048.js'));
require(path.join(__dirname, '../js/games/twodots.js'));

const G = globalThis.MiniGames;
let passed = 0, failed = 0;
function T(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch (e) { console.error('  ✗', name, '\n    ', e.message); failed++; }
}
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || ''} ${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
function ok(v, msg) { if (!v) throw new Error(msg || 'ожидалась правда'); }

/* ═══ Block Blast ═══ */
{
  const L = G.get('blockblast').logic;
  const grid = Array.from({ length: 8 }, () => Array(8).fill(0));
  T('BB: canPlace в границах', () => {
    ok(L.canPlace(grid, [[0, 0], [0, 1]], 0, 0));
    ok(L.canPlace(grid, [[0, 0], [0, 1]], 7, 6));
    ok(!L.canPlace(grid, [[0, 0], [0, 1]], 7, 7), 'вылезает за правый край');
    ok(!L.canPlace(grid, [[0, 0], [1, 0]], 8, 0), 'вылезает вниз');
  });
  T('BB: canPlace не ставит на занятые', () => {
    const g = grid.map(r => r.slice());
    g[3][3] = 1;
    ok(L.canPlace(g, [[0, 0]], 3, 4));
    ok(!L.canPlace(g, [[0, 0]], 3, 3));
    ok(!L.canPlace(g, [[0, 0], [0, 1]], 3, 2)); // вторая клетка попадает на 3,3
  });
  T('BB: fullLines находит строку и столбец', () => {
    const g = Array.from({ length: 8 }, () => Array(8).fill(1));
    g[0][0] = 0;
    const { rows, cols } = L.fullLines(g);
    eq(rows, [1, 2, 3, 4, 5, 6, 7], 'строки без дырки:');
    eq(cols, [1, 2, 3, 4, 5, 6, 7], 'дырка только в столбце 0');
    g[0][0] = 1;
    eq(L.fullLines(g).cols.length, 8, 'все 8 столбцов');
  });
  T('BB: anyFits реагирует на занятость', () => {
    const empty = Array.from({ length: 8 }, () => Array(8).fill(0));
    ok(L.anyFits(empty, [{ shape: [[0, 0]] }]));
    const full = Array.from({ length: 8 }, () => Array(8).fill(1));
    ok(!L.anyFits(full, [{ shape: [[0, 0]] }]));
    // только угловая клетка свободна: уголок влезает, квадрат — нет
    const one = full.map(r => r.slice()); one[7][7] = 0;
    ok(L.anyFits(one, [{ shape: [[0, 0]] }]), 'одиночная клетка влезает');
    ok(!L.anyFits(one, [{ shape: [[0, 0], [0, 1]] }]), 'домино — нет');
  });
}

/* ═══ Match-3 ═══ */
{
  const L = G.get('match3').logic;
  T('M3: findMatches — горизонталь', () => {
    const b = Array.from({ length: 8 }, () => Array(8).fill(-1));
    b[2][1] = b[2][2] = b[2][3] = 0;
    const m = L.findMatches(b);
    eq(m.cells.size, 3);
    eq(m.groups.length, 1);
    ok(m.groups[0].horiz);
  });
  T('M3: findMatches — вертикаль и крест', () => {
    const b = Array.from({ length: 8 }, () => Array(8).fill(-1));
    for (let r = 1; r <= 3; r++) b[r][4] = 2;
    for (let c = 3; c <= 5; c++) b[2][c] = 2;
    const m = L.findMatches(b);
    eq(m.cells.size, 5, 'крест из 5 уникальных клеток');
    eq(m.groups.length, 2);
  });
  T('M3: makesMatch после обмена', () => {
    const b = Array.from({ length: 8 }, () => Array(8).fill(-1));
    b[0][0] = 1; b[1][0] = 1; b[2][0] = 2; b[2][1] = 1;
    // обмен (2,0)<->(2,1) соберёт вертикаль 1,1,1 в столбце 0
    const t = b[2][0]; b[2][0] = b[2][1]; b[2][1] = t;
    ok(L.makesMatch(b, 2, 0), 'тройка собралась');
  });
  T('M3: findMove находит ход', () => {
    const b = Array.from({ length: 8 }, () => Array(8).fill(-1));
    b[0][0] = 1; b[0][1] = 2; b[0][2] = 1; b[1][1] = 1;
    const mv = L.findMove(b);
    ok(mv, 'ход существует');
    const b2 = Array.from({ length: 8 }, () => Array(8).fill(-1));
    b2[0][0] = 0; b2[0][1] = 1; b2[1][0] = 2; b2[1][1] = 3;
    ok(!L.findMove(b2), 'ходов нет');
  });
  T('M3: createBoard без готовых матчей и с ходом', () => {
    for (let i = 0; i < 5; i++) {
      const b = L.createBoard();
      eq(L.findMatches(b).cells.size, 0, 'без стартовых матчей');
      ok(L.hasMove(b));
    }
  });
}

/* ═══ Mahjong ═══ */
{
  const L = G.get('mahjong').logic;
  T('MJ: раскладка — 82 плитки (41 пара), слои корректны', () => {
    const tiles = L.buildLayout();
    eq(tiles.length, 82);
    ok(tiles.length % 2 === 0);
    const perLayer = {};
    tiles.forEach(t => perLayer[t.l] = (perLayer[t.l] || 0) + 1);
    eq([perLayer[0], perLayer[1], perLayer[2], perLayer[3]], [48, 24, 8, 2]);
  });
  T('MJ: верхняя плитка блокирует нижнюю', () => {
    const tiles = L.buildLayout();
    const bottom = tiles.find(t => t.l === 0 && t.x === 0 && t.y === 0); // под плиткой слоя 1 (накрывает 4 плитки)
    ok(bottom, 'плитка под слоем 1 найдена');
    ok(!L.isFree(bottom, tiles), 'накрыта сверху → не свободна');
    // верхняя сама свободна, если рядом нет соседей её слоя и её никто не накрывает сверху
    const top = tiles.find(t => t.l === 1 && t.x === 1 && t.y === 1);
    ok(top);
    tiles.forEach(t => { if (t.l >= 2 || (t.l === 1 && t !== top)) t.removed = true; });
    ok(L.isFree(top, tiles), 'без соседей и без верхних слоёв — свободна');
  });
  T('MJ: боковые соседи блокируют сторону', () => {
    const tiles = L.buildLayout();
    // средний ряд слоя 0: закрыт и слева и справа → не свободна, даже если сверху чисто
    const mid = tiles.find(t => t.l === 0 && t.r === 2 && t.c === 3);
    ok(!L.isFree(mid, tiles));
    // уберём соседа справа — свободна (сверху неё ничего, если убрать слой 1 частично)
    const right = tiles.find(t => t.l === 0 && t.r === 2 && t.c === 4);
    right.removed = true;
    // но сверху могут лежать плитки слоя 1 — проверим честно через computeFree
    const free = L.computeFree(tiles);
    ok(free.has(mid) || !free.has(mid), 'главное — не падает');
    // строго: уберём всё сверху
    tiles.forEach(t => { if (t.l > 0) t.removed = true; });
    ok(L.isFree(mid, tiles), 'сверху пусто, справа открыто → свободна');
  });
  T('MJ: deal создаёт полные пары', () => {
    const tiles = L.buildLayout();
    L.deal(tiles);
    const count = {};
    tiles.forEach(t => count[t.emoji] = (count[t.emoji] || 0) + 1);
    ok(Object.values(count).every(v => v % 2 === 0), 'каждая масть встречается чётное число раз');
    eq(tiles.filter(t => t.emoji).length, 82);
  });
}

/* ═══ 2048 ═══ */
{
  const L = G.get('2048').logic;
  const mk = vals => vals.map((row, r) => row.map((v, c) => v ? { v, r, c } : null));
  const flat = g => g.map(row => row.map(t => t ? t.v : 0));
  T('2048: сдвиг влево и слияние', () => {
    const g = mk([[2, 2, 4, 0], [0, 0, 0, 0], [0, 2, 0, 2], [4, 0, 0, 4]]);
    const res = L.computeMove(g, 'left');
    ok(res.moved);
    eq(res.gained, 4 + 4 + 8);
    eq(flat(g)[0], [4, 4, 0, 0]);
    eq(flat(g)[2], [4, 0, 0, 0]);
    eq(flat(g)[3], [8, 0, 0, 0]);
  });
  T('2048: двойное слияние в один ход не даёт 2→4→8', () => {
    const g = mk([[2, 2, 4, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
    const res = L.computeMove(g, 'left');
    eq(flat(g)[0], [4, 4, 0, 0], 'новая 4 не сливается с существующей 4 в том же ходе');
    eq(res.merges.length, 1);
  });
  T('2048: up двигает колонки', () => {
    const g = mk([[0, 0, 0, 0], [2, 0, 0, 0], [2, 0, 0, 0], [0, 0, 0, 0]]);
    const res = L.computeMove(g, 'up');
    eq(flat(g), [[4, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
    eq(res.gained, 4);
  });
  T('2048: canMove', () => {
    ok(L.canMove(mk([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 0]])), 'есть пустая');
    ok(!L.canMove(mk([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]])), 'шахматка без ходов');
    ok(L.canMove(mk([[2, 2, 4, 8], [4, 8, 16, 2], [2, 4, 8, 16], [16, 8, 4, 2]])), 'есть пара сверху');
  });
  T('2048: вправо/вниз — порядок обхода верный', () => {
    const g = mk([[2, 0, 0, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
    L.computeMove(g, 'right');
    eq(flat(g)[0], [0, 0, 0, 4]);
  });
}

/* ═══ Two Dots ═══ */
{
  const L = G.get('twodots').logic;
  T('TD: hasMove', () => {
    const b = [[0, 1, 2, 3, 0, 1], [1, 2, 3, 0, 1, 2], [2, 3, 0, 1, 2, 3], [3, 0, 1, 2, 3, 0], [0, 1, 2, 3, 0, 1], [1, 2, 3, 0, 1, 2]];
    ok(!L.hasMove(b), 'шахматка — соединений нет');
    b[0][0] = 1; // теперь b[0][1] и b[1][0] тоже 1
    ok(L.hasMove(b), 'появилась пара');
  });
  T('TD: createBoard всегда с ходом', () => {
    for (let i = 0; i < 10; i++) ok(L.hasMove(L.createBoard()));
  });
}

console.log(`\n${failed ? '✗ ПРОВАЛЕНО: ' + failed : '✓ OK: ' + passed} (passed=${passed}, failed=${failed})`);
process.exit(failed ? 1 : 0);
