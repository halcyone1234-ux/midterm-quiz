/* 資料層：常數、裝置匿名碼、題庫文字格式、Firebase Realtime Database（或本機 mock） */
(function () {
  'use strict';

  const CHOICES = ['A', 'B', 'C', 'D'];
  const STATUS_LABEL = { lobby: '等待開始', question: '作答中', reveal: '公佈答案', finished: '成績', recap: '回看' };
  const DEFAULT_GAME = { status: 'lobby', index: 0, run: 1, updatedAt: 0 };

  /* ---- localStorage helpers ---- */
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };
  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
  let deviceId = LS.get('mq.deviceId', null);
  if (!deviceId) { deviceId = uuid(); LS.set('mq.deviceId', deviceId); }

  const params = new URLSearchParams(location.search);
  const DEFAULT_CLASS = (window.MQ_CONFIG && window.MQ_CONFIG.defaultClassId) || '1151-midterm';
  const classId = (params.get('c') || DEFAULT_CLASS).replace(/[^\w-]/g, '');
  const ROOT = 'quiz/' + classId;

  /* ---- backend: Firebase or local mock ---- */
  const cfg = window.MQ_CONFIG && window.MQ_CONFIG.firebase;
  const forceMock = params.get('mock') === '1';
  const useFirebase = !forceMock && !!(cfg && cfg.apiKey && !/^YOUR_/i.test(cfg.apiKey) && window.firebase);
  let backend;

  if (useFirebase) {
    firebase.initializeApp(cfg);
    const db = firebase.database();
    backend = {
      kind: 'firebase',
      listen(path, cb) {
        const ref = db.ref(ROOT + '/' + path);
        const h = ref.on('value', (snap) => cb(snap.val()), (err) => { console.error('listen', path, err); cb(null); });
        return () => ref.off('value', h);
      },
      once(path) { return db.ref(ROOT + '/' + path).once('value').then((s) => s.val()); },
      set(path, val) { return db.ref(ROOT + '/' + path).set(val); },
      update(path, obj) { return db.ref(ROOT + '/' + path).update(obj); },
      remove(path) { return db.ref(ROOT + '/' + path).remove(); },
      multi(obj) { return db.ref(ROOT).update(obj); },
      now() { return firebase.database.ServerValue.TIMESTAMP; },
    };
  } else {
    /* 本機 mock：資料存在 localStorage，靠 storage 事件讓同一台電腦的分頁互相同步 */
    const KEY = 'mq.mock.' + classId;
    const listeners = [];
    const load = () => LS.get(KEY, {});
    const save = (tree) => { LS.set(KEY, tree); notify(); };
    const getAt = (tree, path) => path.split('/').filter(Boolean).reduce((o, k) => (o && o[k] !== undefined ? o[k] : null), tree);
    const setAt = (tree, path, val) => {
      const parts = path.split('/').filter(Boolean);
      if (!parts.length) return val === null ? {} : val;
      let o = tree;
      for (let i = 0; i < parts.length - 1; i++) { if (typeof o[parts[i]] !== 'object' || o[parts[i]] === null) o[parts[i]] = {}; o = o[parts[i]]; }
      if (val === null || val === undefined) delete o[parts[parts.length - 1]]; else o[parts[parts.length - 1]] = val;
      prune(tree); return tree;
    };
    const prune = (o) => { Object.keys(o).forEach((k) => { if (o[k] && typeof o[k] === 'object') { prune(o[k]); if (!Object.keys(o[k]).length) delete o[k]; } }); };
    const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
    function notify() { const tree = load(); listeners.forEach((l) => { try { l.cb(clone(getAt(tree, l.path))); } catch (e) { console.error(e); } }); }
    window.addEventListener('storage', (e) => { if (e.key === KEY) notify(); });
    backend = {
      kind: 'mock',
      listen(path, cb) {
        const l = { path, cb }; listeners.push(l);
        setTimeout(() => cb(clone(getAt(load(), path))), 0);
        return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); };
      },
      once(path) { return Promise.resolve(clone(getAt(load(), path))); },
      set(path, val) { save(setAt(load(), path, clone(val))); return Promise.resolve(); },
      update(path, obj) { let t = load(); Object.keys(obj).forEach((k) => { t = setAt(t, path + '/' + k, clone(obj[k])); }); save(t); return Promise.resolve(); },
      remove(path) { save(setAt(load(), path, null)); return Promise.resolve(); },
      multi(obj) { let t = load(); Object.keys(obj).forEach((p) => { t = setAt(t, p, clone(obj[p])); }); save(t); return Promise.resolve(); },
      now() { return Date.now(); },
    };
  }

  /* Firebase 會把陣列存成物件（鍵 0,1,2…）；這裡一律轉回陣列 */
  const toArray = (v) => {
    if (!v) return [];
    if (Array.isArray(v)) return v.filter(Boolean);
    return Object.keys(v).sort((a, b) => Number(a) - Number(b)).map((k) => v[k]).filter(Boolean);
  };

  /* ---- 題庫 ⇄ 純文字（老師在控制台改題用；格式與期中考複習卷排版一致，可直接從 Word 貼） ---- */
  const RE_SECTION = /^\[(.+)\]\s*$/;
  const RE_TITLE = /^#\s*(.+)$/;
  const RE_QUESTION = /^(\d{1,3})\s*[.、)．]\s*(.*)$/;
  const RE_OPTION = /^[（(]?([A-Da-d])[)）.．、:：]\s*(.*)$/;
  const RE_ANSWER = /^(答|答案|正解|Ans|ans)\s*[:：]\s*[（(]?([A-Da-d])/;
  const RE_EXPLAIN = /^(解|解析|說明)\s*[:：]\s*(.*)$/;

  function parseBankText(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    let title = ''; let section = ''; const questions = []; let cur = null; let field = null;
    const flush = () => { if (cur) questions.push(cur); cur = null; field = null; };
    for (const raw of lines) {
      const line = raw.trim(); if (!line) continue;
      let m;
      if ((m = line.match(RE_TITLE)) && !cur) { title = m[1].trim(); continue; }
      if ((m = line.match(RE_SECTION))) { flush(); section = m[1].trim(); continue; }
      if ((m = line.match(RE_QUESTION))) { flush(); cur = { section, text: m[2].trim(), options: { A: '', B: '', C: '', D: '' }, answer: '', explain: '' }; field = 'text'; continue; }
      if (!cur) continue;
      if ((m = line.match(RE_ANSWER))) { cur.answer = m[2].toUpperCase(); field = null; continue; }
      if ((m = line.match(RE_EXPLAIN))) { cur.explain = m[2].trim(); field = 'explain'; continue; }
      if ((m = line.match(RE_OPTION))) { const letter = m[1].toUpperCase(); cur.options[letter] = m[2].trim(); field = letter; continue; }
      if (field === 'text') cur.text = (cur.text + ' ' + line).trim();
      else if (field === 'explain') cur.explain = (cur.explain + ' ' + line).trim();
      else if (field && CHOICES.includes(field)) cur.options[field] = (cur.options[field] + ' ' + line).trim();
    }
    flush();
    const errors = [];
    questions.forEach((q, i) => {
      if (!q.text) errors.push('第 ' + (i + 1) + ' 題沒有題目文字');
      const missing = CHOICES.filter((c) => !q.options[c]);
      if (missing.length) errors.push('第 ' + (i + 1) + ' 題缺少選項 ' + missing.join('、'));
      if (!CHOICES.includes(q.answer)) errors.push('第 ' + (i + 1) + ' 題沒有「答：」或答案不是 A–D');
    });
    if (!questions.length) errors.push('沒有解析到任何題目（每題以「1.」「2.」開頭）');
    return { title, questions, errors };
  }

  function formatBankText(title, questions) {
    const out = []; if (title) out.push('# ' + title, '');
    let last = null;
    questions.forEach((q, i) => {
      if (q.section !== last) { out.push('[' + (q.section || '未分章節') + ']'); last = q.section; }
      out.push((i + 1) + '. ' + q.text);
      CHOICES.forEach((c) => out.push('(' + c + ') ' + (q.options[c] || '')));
      out.push('答：' + q.answer);
      if (q.explain) out.push('解：' + q.explain);
      out.push('');
    });
    return out.join('\n');
  }

  const toScore = (correct, total) => (total ? Math.round((correct / total) * 100) : 0);

  window.MQ = {
    CHOICES, STATUS_LABEL, DEFAULT_GAME, LS, deviceId, classId, backend, toArray,
    parseBankText, formatBankText, toScore,
    DEFAULT: window.MQ_DEFAULT || { title: '考前複習', questions: [] },
    adminPin: String((window.MQ_CONFIG && window.MQ_CONFIG.adminPin) || '1151'),
    siteUrl() {
      const base = location.origin + location.pathname.replace(/[^/]*$/, '');
      return base + (classId !== DEFAULT_CLASS ? '?c=' + classId : '');
    },
  };
})();
