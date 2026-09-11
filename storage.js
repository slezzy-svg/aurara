/* storage.js — прогресс, рекорды и настройки в localStorage.
   ВАЖНО: доступ к localStorage обёрнут в try/catch с fallback в память —
   страница должна жить даже в sandbox-iframe, где localStorage бросает SecurityError. */
(function (global) {
  'use strict';

  const KEY = 'puzzlebox.v1';
  const mem = {}; // резервное хранилище

  const DEFAULTS = {
    settings: {
      sound: true,   // главный выключатель звука
      music: 0.55,   // громкость эмбиента (0..1)
      sfx: 0.8,      // громкость эффектов (0..1)
      anim: true,    // анимации вкл/выкл (плюс уважаем prefers-reduced-motion)
      theme: null,   // 'light' | 'dark' | null (= как в системе)
    },
    best:  {},       // рекорды: { gameId: число }
    wins:  {},       // сколько раз доходили до победы
    plays: {},       // сколько раз запускали игру
    seen:  {},       // показывали ли подсказку-правило при первом запуске
  };

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return (k in mem) ? mem[k] : null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { mem[k] = v; } }

  function deepMerge(base, patch) {
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    if (!patch || typeof patch !== 'object') return out;
    for (const k of Object.keys(patch)) {
      const pv = patch[k];
      if (pv && typeof pv === 'object' && !Array.isArray(pv) && base && typeof base[k] === 'object' && !Array.isArray(base[k])) {
        out[k] = deepMerge(base[k], pv);
      } else if (pv !== undefined) {
        out[k] = pv;
      }
    }
    return out;
  }

  let data = deepMerge(DEFAULTS, safeParse(lsGet(KEY)));
  function safeParse(s) { try { return JSON.parse(s) || {}; } catch (e) { return {}; } }
  function save() { lsSet(KEY, JSON.stringify(data)); }

  const Store = {
    get data() { return data; },
    save,
    get settings() { return data.settings; },
    set(key, val) { data.settings[key] = val; save(); },

    /* Рекорды */
    best(id) { return data.best[id] || 0; },
    setBest(id, v) { data.best[id] = Math.max(this.best(id), v); save(); },
    resetAll() { data.best = {}; data.wins = {}; data.plays = {}; data.seen = {}; save(); },

    /* Статистика запусков/побед */
    addPlay(id) { data.plays[id] = (data.plays[id] || 0) + 1; save(); },
    addWin(id) { data.wins[id] = (data.wins[id] || 0) + 1; save(); },

    /* Одноразовые подсказки правил */
    seenHint(id) { return !!data.seen[id]; },
    markHintSeen(id) { data.seen[id] = true; save(); },
  };

  global.Store = Store;
})(typeof window !== 'undefined' ? window : globalThis);
