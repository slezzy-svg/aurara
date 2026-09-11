/* registry.js — реестр игр.
   Каждый модуль из js/games/*.js регистрирует себя через MiniGames.register({id, title, ...}).
   Файл не зависит от DOM, поэтому его же использует Node-тесты (tests/). */
(function (g) {
  'use strict';
  const MiniGames = {
    _games: {},
    /** Зарегистрировать игру: {id, title, icon, tagline, accent[2], preview(ctx,w,h,t,pal), create(mount,api), logic?} */
    register(def) {
      if (!def || !def.id || typeof def.create !== 'function') {
        throw new Error('MiniGames.register: некорректное описание игры (нужны id и create())');
      }
      this._games[def.id] = def;
    },
    get(id) { return this._games[id] || null; },
    all() { return Object.values(this._games); },
  };
  g.MiniGames = MiniGames;
})(typeof window !== 'undefined' ? window : globalThis);
