/* 期中複習競賽：路由與各畫面（學生 #join、投影 #board、老師 #admin） */
(function () {
  'use strict';
  const Z = window.MQ;
  const B = Z.backend;
  const LS = Z.LS;
  const CH = Z.CHOICES;
  const ICON = { A: '▲', B: '◆', C: '●', D: '■' };

  /* ---------- 共用狀態 ---------- */
  const S = { game: null, bank: null, players: null, answers: null };
  const me = { name: LS.get('mq.name', ''), pin: LS.get('mq.pin', '') };
  const game = () => Object.assign({}, Z.DEFAULT_GAME, S.game || {});
  const bank = () => {
    const b = S.bank; const qs = Z.toArray(b && b.questions);
    if (!qs.length) return { title: Z.DEFAULT.title, questions: Z.DEFAULT.questions, isDefault: true };
    return { title: b.title || Z.DEFAULT.title, questions: qs, isDefault: false };
  };
  const isAdmin = () => me.pin === Z.adminPin;
  const players = () => Object.keys(S.players || {}).map((k) => Object.assign({ id: k }, S.players[k])).sort((a, b) => (a.at || 0) - (b.at || 0));

  /* ---------- DOM 小工具 ---------- */
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') el[k] = !!v;
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v);
    }
    mount(el, children);
    return el;
  }
  function mount(el, ...children) {
    const add = (c) => {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) c.forEach(add);
      else el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    };
    children.forEach(add); return el;
  }
  const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
  let toastTimer;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  /* ---------- 作答資料 ---------- */
  const runAnswers = (g) => (S.answers && S.answers[g.run]) || {};
  const answersAt = (g, idx) => runAnswers(g)[idx] || {};
  function countsAt(g, idx) {
    const c = { A: 0, B: 0, C: 0, D: 0 };
    Object.values(answersAt(g, idx)).forEach((a) => { if (a && c[a.choice] !== undefined) c[a.choice] += 1; });
    return c;
  }
  const sum = (c) => CH.reduce((s, k) => s + c[k], 0);

  /* 成績：全部從 answers[run] 與題庫算出來（學生端、投影、控制台用同一套） */
  function results() {
    const g = game(); const qs = bank().questions; const ra = runAnswers(g);
    const scores = {}; const mine = {};
    qs.forEach((q, i) => {
      const byDev = ra[i] || {};
      Object.keys(byDev).forEach((d) => {
        if (!byDev[d]) return;
        if (scores[d] === undefined) scores[d] = 0;
        if (!mine[d]) mine[d] = {};
        mine[d][i] = byDev[d].choice;
        if (byDev[d].choice === q.answer) scores[d] += 1;
      });
    });
    const list = Object.values(scores);
    const dist = Array.from({ length: qs.length + 1 }, () => 0);
    list.forEach((s) => { dist[s] += 1; });
    const avg = list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
    const perQ = qs.map((q, i) => {
      const c = countsAt(g, i); const n = sum(c);
      return { index: i, n: i + 1, section: q.section, text: q.text, answer: q.answer, counts: c, answered: n, rate: n ? c[q.answer] / n : null };
    });
    return { total: qs.length, participants: list.length, scores, mine, dist, avg, perQ };
  }

  /* ---------- 老師動作 ---------- */
  const stamp = () => ({ updatedAt: B.now() });
  const A = {
    start() {
      const g = game(); const n = bank().questions.length;
      if (!n) { toast('題庫是空的'); return; }
      const run = g.status === 'lobby' ? g.run : g.run + 1; /* 從成績頁再比一次＝新的一局 */
      B.update('game', Object.assign({ status: 'question', index: 0, run }, stamp()));
    },
    end() { B.update('game', Object.assign({ status: 'reveal' }, stamp())); },
    next() {
      const g = game(); const n = bank().questions.length;
      if (g.index + 1 >= n) A.finish();
      else B.update('game', Object.assign({ status: 'question', index: g.index + 1 }, stamp()));
    },
    finish() { B.update('game', Object.assign({ status: 'finished' }, stamp())); },
    recap(i) { B.update('game', Object.assign({ status: 'recap', index: i }, stamp())); },
    results() { B.update('game', Object.assign({ status: 'finished' }, stamp())); },
    lobby() { const g = game(); B.update('game', Object.assign({ status: 'lobby', index: 0, run: g.status === 'lobby' ? g.run : g.run + 1 }, stamp())); },
    setBank(title, questions) { return B.set('bank', { title, questions }); },
    useDefault() { return B.set('bank', null); },
    clearAll() { return B.multi({ game: null, players: null, answers: null }); },
  };

  /* 控制列：投影與控制台共用 */
  function controlBar() {
    const g = game(); const n = bank().questions.length; const isLast = g.index + 1 >= n;
    const btn = (label, fn, cls) => h('button', { class: cls || '', onclick: fn }, label);
    const items = [];
    if (g.status === 'lobby') items.push(btn('▶ 開始競賽', A.start, 'primary big'));
    else if (g.status === 'question') { items.push(btn('⏹ 結束作答，公佈答案', A.end, 'primary big warn')); items.push(btn('提早結束看成績', A.finish, 'small')); }
    else if (g.status === 'reveal') { items.push(btn(isLast ? '🏁 看成績' : '下一題 →', A.next, 'primary big')); if (!isLast) items.push(btn('提早結束看成績', A.finish, 'small')); }
    else if (g.status === 'recap') items.push(btn('← 回成績頁', A.results, 'primary big'));
    else if (g.status === 'finished') { items.push(btn('🔁 再比一次', A.start, 'primary')); items.push(btn('回大廳', A.lobby, '')); }
    return h('div', { class: 'ctrl-bar' }, items);
  }

  /* ---------- 共用畫面片段 ---------- */
  function questionHead(g, q, extra) {
    return h('div', { class: 'row between' },
      h('div', { class: 'row' },
        h('span', { class: 'q-code', style: 'font-size:1.3rem' }, (g.status === 'recap' ? '回看 ' : '') + '第 ' + (g.index + 1) + ' / ' + bank().questions.length + ' 題'),
        q.section ? h('span', { class: 'tag' }, q.section) : null),
      extra || null);
  }
  function tiles(g, q, opts) {
    const revealed = g.status === 'reveal' || g.status === 'recap';
    const c = countsAt(g, g.index); const n = sum(c); const max = Math.max(1, ...CH.map((k) => c[k]));
    return h('div', { class: 'tiles' + (opts && opts.compact ? ' compact' : '') }, CH.map((k) => {
      const correct = revealed && q.answer === k;
      const cls = ['tile', 'tile-' + k.toLowerCase(), revealed ? (correct ? 'correct' : 'wrong') : '', opts && opts.mine === k ? 'mine' : ''].join(' ');
      const inner = [
        h('div', { class: 'tile-head' },
          h('span', { class: 'tile-letter' }, h('i', null, ICON[k]), k),
          revealed ? h('span', { class: 'tile-count num' }, c[k] + ' 人 · ' + (n ? Math.round((c[k] / n) * 100) : 0) + '%' + (correct ? ' ✓' : '')) : null),
        h('div', { class: 'tile-text' }, q.options[k]),
        revealed ? h('div', { class: 'tile-bar' }, h('span', { style: 'width:' + Math.round((c[k] / max) * 100) + '%' })) : null,
      ];
      if (opts && opts.onPick) return h('button', { class: cls, disabled: !!opts.locked, onclick: () => opts.onPick(k) }, inner);
      return h('div', { class: cls }, inner);
    }));
  }
  function explainBox(q) {
    return h('div', { class: 'explain' }, h('span', { class: 'explain-tag' }, '正解 ' + q.answer), h('span', null, q.explain || '（本題無解析）'));
  }
  function histogram(dist, highlight) {
    const max = Math.max(1, ...dist);
    return h('div', { class: 'hist' }, dist.map((count, k) => h('div', { class: 'hist-col' + (highlight === k ? ' me' : ''), title: '答對 ' + k + ' 題：' + count + ' 人' },
      h('span', { class: 'hist-count num' }, count > 0 ? count : ''),
      h('div', { class: 'hist-bar', style: 'height:' + Math.round((count / max) * 100) + '%' }),
      h('span', { class: 'hist-label num' }, k))));
  }
  function hardestList(r, clickable) {
    const list = r.perQ.filter((p) => p.answered > 0).sort((a, b) => a.rate - b.rate || b.answered - a.answered);
    if (!list.length) return h('div', { class: 'empty' }, '沒有人作答');
    return h('ol', { class: 'hard-list' }, list.map((p) => {
      const rate = Math.round(p.rate * 100);
      const row = [
        h('span', { class: 'hard-rate num ' + (rate < 50 ? 'bad' : rate < 75 ? 'mid' : 'ok') }, rate + '%'),
        h('span', { class: 'hard-n' }, 'Q' + p.n),
        h('span', { class: 'hard-text' }, h('small', null, p.section), p.text),
        h('span', { class: 'hard-ans' }, '正解 ' + p.answer),
      ];
      return h('li', null, clickable ? h('button', { class: 'hard-row', onclick: () => A.recap(p.index) }, row) : h('div', { class: 'hard-row' }, row));
    }));
  }

  /* ---------- 學生：#join ---------- */
  function viewJoin(root) {
    let pending = null; let pendingKey = '';
    function render() {
      clear(root);
      const g = game(); const bk = bank(); const qs = bk.questions;
      if (!me.name) {
        const input = h('input', { type: 'text', maxlength: 20, placeholder: '例如 學號後四碼或暱稱', autocomplete: 'off' });
        const join = () => {
          const v = input.value.trim(); if (!v) { toast('請輸入你的 ID'); return; }
          me.name = v; LS.set('mq.name', v);
          B.set('players/' + Z.deviceId, { name: v, at: B.now() }).then(render, (e) => { console.error(e); toast('寫入失敗，請稍後再試'); });
        };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
        mount(root, h('div', { class: 'card stack' },
          h('p', { class: 'eyebrow' }, '期中複習競賽'), h('h1', null, bk.title),
          h('p', { class: 'muted' }, '共 ' + qs.length + ' 題四選一。輸入一個 ID 進場，老師開始後題目會直接出現在這裡。'),
          h('label', { class: 'field' }, h('span', null, '你的 ID'), input),
          h('button', { class: 'primary block', onclick: join }, '進場'),
        ));
        return;
      }
      const top = h('div', { class: 'row between' }, h('span', { class: 'muted' }, '👤 ' + me.name), h('button', { class: 'small', onclick: () => { me.name = ''; LS.set('mq.name', ''); render(); } }, '改 ID'));
      if (g.status === 'lobby') {
        mount(root, top, h('div', { class: 'card stack center' },
          h('div', { style: 'font-size:3rem' }, '🏆'), h('h1', null, bk.title),
          h('p', { class: 'muted' }, '共 ' + qs.length + ' 題四選一。等待老師按下「開始競賽」…'),
          h('p', { class: 'muted' }, '已進場 ' + players().length + ' 人')));
        return;
      }
      if (g.status === 'finished') { mount(root, top, myResult()); return; }

      const q = qs[g.index];
      if (!q) { mount(root, top, h('div', { class: 'empty' }, '等待題目…')); return; }
      const revealed = g.status === 'reveal' || g.status === 'recap';
      const key = g.run + '/' + g.index;
      if (pendingKey !== key) { pending = null; pendingKey = key; }
      const server = answersAt(g, g.index)[Z.deviceId];
      const mine = (server && server.choice) || pending;
      const locked = !!mine || revealed;
      const pick = (k) => {
        if (locked) return;
        pending = k; render();
        B.set('answers/' + g.run + '/' + g.index + '/' + Z.deviceId, { choice: k, at: B.now() })
          .catch((e) => { console.error(e); pending = null; toast('送出失敗（可能已鎖定）'); render(); });
      };
      const parts = [top, questionHead(g, q), h('h2', { class: 'q-text', style: 'font-size:1.2rem' }, q.text)];
      if (revealed) {
        const right = mine === q.answer;
        parts.push(h('div', { class: 'verdict ' + (mine ? (right ? 'right' : 'wrong') : 'none') }, mine ? (right ? '答對了 🎉' : '答錯了，正解是 ' + q.answer) : '你沒有作答，正解是 ' + q.answer));
      }
      parts.push(tiles(g, q, { compact: true, mine, locked, onPick: pick }));
      if (revealed) parts.push(explainBox(q));
      else if (mine) parts.push(h('div', { class: 'notice' }, '已送出 ✓ 你選了 ' + mine + '，等待老師公佈'));
      else parts.push(h('p', { class: 'muted' }, '點一個選項作答，送出後不能更改。'));
      mount(root, parts);
    }
    function myResult() {
      const r = results(); const total = r.total; const myCorrect = r.scores[Z.deviceId];
      const answered = myCorrect !== undefined;
      const scores = Object.values(r.scores);
      const beat = answered && scores.length ? Math.round((scores.filter((s) => s < myCorrect).length / scores.length) * 100) : null;
      const mineMap = r.mine[Z.deviceId] || {};
      const wrong = answered ? r.perQ.filter((p) => mineMap[p.index] !== p.answer).map((p) => Object.assign({ mine: mineMap[p.index] || '—' }, p)) : [];
      return h('div', { class: 'stack' },
        h('div', { class: 'score-card' },
          h('div', { class: 'score-label' }, answered ? '你的分數' : '你沒有參加這一輪'),
          h('div', { class: 'score-num num' }, answered ? Z.toScore(myCorrect, total) : '—'),
          h('div', { class: 'score-sub' }, (answered ? '答對 ' + myCorrect + ' / ' + total + ' 題' : '共 ' + total + ' 題') + (beat !== null ? ' · 贏過 ' + beat + '% 的同學' : '')),
          h('div', { class: 'score-avg' }, '全班平均 ' + Z.toScore(r.avg, total) + ' 分（' + r.participants + ' 人作答）')),
        h('div', { class: 'card stack' },
          h('h3', null, '全班答對題數分佈'), histogram(r.dist, answered ? myCorrect : null),
          answered ? h('p', { class: 'muted', style: 'text-align:center;font-size:.8rem' }, '深色＝你的位置') : null),
        answered ? h('div', { class: 'card stack' },
          h('h3', null, wrong.length ? '要加強的 ' + wrong.length + ' 題' : '全部答對，太強了 🎉'),
          h('ul', { class: 'wrong-list' }, wrong.map((p) => h('li', null,
            h('span', { class: 'wrong-n' }, 'Q' + p.n),
            h('span', { class: 'wrong-body' }, h('small', null, p.section), p.text, h('em', null, '你選 ' + p.mine + ' · 正解 ' + p.answer)))))) : null,
      );
    }
    render();
    return render;
  }

  /* ---------- 投影：#board ---------- */
  function viewBoard(root) {
    document.querySelector('main').classList.add('wide'); root.classList.add('board');
    let qrDone = false; const qrHolder = h('div', { class: 'qr-box' });
    function qr(size) {
      if (!window.QRCode) return;
      clear(qrHolder); new QRCode(qrHolder, { text: Z.siteUrl(), width: size, height: size, correctLevel: QRCode.CorrectLevel.M });
      mount(qrHolder, h('p', { class: 'muted', style: 'font-size:.9rem;word-break:break-all' }, Z.siteUrl()));
    }
    function render() {
      clear(root);
      const g = game(); const bk = bank(); const qs = bk.questions; const ps = players();
      const admin = isAdmin();
      mount(root, h('div', { class: 'row between' },
        h('div', null, h('p', { class: 'eyebrow' }, '期中複習競賽'), h('h1', null, bk.title)),
        h('div', { class: 'row' },
          h('span', { class: 'phase-pill live' }, Z.STATUS_LABEL[g.status] || g.status),
          h('span', { class: 'phase-pill' }, '已進場 ' + ps.length + ' 人'),
          h('a', { class: 'btn small', href: '#admin' }, admin ? '控制台' : '老師登入')),
      ));
      if (g.status === 'lobby') {
        mount(root, h('div', { class: 'board-grid' },
          h('div', { class: 'card', style: 'display:grid;place-items:center' }, qrHolder),
          h('div', { class: 'card stack' },
            h('h2', null, '掃碼進場'), h('div', { class: 'big num' }, ps.length), h('p', { class: 'muted' }, '人已進場 · 共 ' + qs.length + ' 題'),
            h('div', { class: 'chips' }, ps.map((p) => h('span', { class: 'tag', style: 'font-size:1rem' }, p.name))),
            admin ? controlBar() : h('p', { class: 'muted' }, '老師請到控制台按「開始競賽」'),
          ),
        ));
        if (!qrDone) { qr(260); qrDone = true; }
        return;
      }
      if (g.status === 'finished') {
        const r = results();
        mount(root,
          h('div', { class: 'row', style: 'gap:12px' },
            h('div', { class: 'card stat' }, h('div', { class: 'big num' }, Z.toScore(r.avg, r.total)), h('p', { class: 'muted' }, '全班平均分')),
            h('div', { class: 'card stat' }, h('div', { class: 'big num' }, r.avg.toFixed(1), h('small', { class: 'muted' }, ' / ' + r.total)), h('p', { class: 'muted' }, '平均答對題數')),
            h('div', { class: 'card stat' }, h('div', { class: 'big num' }, r.participants), h('p', { class: 'muted' }, '人作答')),
          ),
          h('div', { class: 'board-grid' },
            h('div', { class: 'card stack' }, h('h2', null, '答對題數分佈'), histogram(r.dist, null), h('p', { class: 'muted', style: 'text-align:center' }, '答對題數（滿分 ' + r.total + ' 題＝100 分）')),
            h('div', { class: 'card stack' }, h('h2', null, '錯最多的題目' + (admin ? ' · 點一題回看加強複習' : '')), hardestList(r, admin)),
          ),
          admin ? controlBar() : null,
        );
        return;
      }
      const q = qs[g.index];
      if (!q) { mount(root, h('div', { class: 'empty' }, '題庫是空的')); return; }
      const revealed = g.status === 'reveal' || g.status === 'recap';
      const answered = sum(countsAt(g, g.index));
      const progress = ps.length ? Math.min(100, Math.round((answered / ps.length) * 100)) : 0;
      mount(root,
        questionHead(g, q, h('div', { class: 'row' },
          !revealed ? h('span', { class: 'phase-pill pulse' }, '作答中…') : null,
          h('span', { class: 'phase-pill' }, '在線 ' + ps.length),
          h('span', { class: 'phase-pill live' }, '已回答 ' + answered))),
        !revealed ? h('div', { class: 'progress' }, h('span', { style: 'width:' + progress + '%' })) : null,
        h('h2', { class: 'board-q' }, q.text),
        tiles(g, q),
        revealed ? explainBox(q) : null,
        admin ? controlBar() : null,
      );
    }
    render();
    return render;
  }

  /* ---------- 老師：#admin ---------- */
  function viewAdmin(root) {
    document.querySelector('main').classList.add('wide');
    let editing = false; let draft = null;
    function render() {
      clear(root);
      if (!isAdmin()) {
        const input = h('input', { type: 'password', placeholder: 'PIN', inputmode: 'numeric' });
        const go = () => { if (input.value === Z.adminPin) { me.pin = input.value; LS.set('mq.pin', me.pin); render(); } else toast('PIN 不對'); };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
        mount(root, h('div', { class: 'card stack', style: 'max-width:420px' }, h('h1', null, '老師控制台'), h('label', { class: 'field' }, h('span', null, 'PIN'), input), h('button', { class: 'primary', onclick: go }, '進入')));
        return;
      }
      const g = game(); const bk = bank(); const qs = bk.questions; const ps = players(); const r = results();
      const q = qs[g.index];
      mount(root,
        h('div', { class: 'row between' },
          h('div', null, h('p', { class: 'eyebrow' }, '老師控制台 · 班級 ' + Z.classId + (B.kind === 'mock' ? '（本機測試模式）' : '')), h('h1', null, bk.title)),
          h('div', { class: 'row' }, h('a', { class: 'btn small', href: '#board' }, '投影畫面'), h('a', { class: 'btn small', href: '#join' }, '學生畫面'),
            h('button', { class: 'small', onclick: () => { me.pin = ''; LS.set('mq.pin', ''); render(); } }, '登出'))),
        h('div', { class: 'card stack' },
          h('div', { class: 'row between' },
            h('div', null, h('span', { class: 'phase-pill live' }, Z.STATUS_LABEL[g.status]), ' ',
              g.status !== 'lobby' && g.status !== 'finished' && q ? h('b', null, '第 ' + (g.index + 1) + ' / ' + qs.length + ' 題') : h('span', { class: 'muted' }, qs.length + ' 題 · 第 ' + g.run + ' 局')),
            h('span', { class: 'muted' }, '已進場 ' + ps.length + ' 人' + (g.status === 'question' ? ' · 已回答 ' + sum(countsAt(g, g.index)) : ''))),
          q && g.status !== 'lobby' && g.status !== 'finished' ? h('p', { class: 'q-text' }, q.text + '　（正解 ' + q.answer + '）') : null,
          controlBar(),
        ),
        h('div', { class: 'grid-2' },
          h('div', { class: 'card stack' },
            h('div', { class: 'row between' }, h('h2', null, '題庫'), h('div', { class: 'row' },
              h('button', { class: 'small', onclick: () => { editing = !editing; draft = null; render(); } }, editing ? '收起' : '✏️ 編輯'),
              h('button', { class: 'small', onclick: () => { if (confirm('載回預設 25 題？')) A.useDefault().then(() => toast('已載回預設題庫')); } }, '載回預設 25 題'))),
            h('p', { class: 'muted' }, qs.length + ' 題' + (bk.isDefault ? '（預設：期中考複習卷）' : '（自訂）') + '。' + (g.status === 'lobby' ? '' : '進行中改題會立刻影響目前這局，建議回大廳再改。')),
            editing ? bankEditor() : h('ol', { class: 'bank-list' }, qs.map((x, i) => h('li', null, h('b', null, 'Q' + (i + 1) + ' '), h('span', { class: 'muted' }, x.section ? x.section + '｜' : ''), x.text, h('span', { class: 'tag' }, '答 ' + x.answer)))),
          ),
          h('div', { class: 'card stack' },
            h('div', { class: 'row between' }, h('h2', null, '學生與成績'), h('div', { class: 'row' },
              h('button', { class: 'small', onclick: exportXlsx }, '⬇ Excel'),
              h('button', { class: 'small danger', onclick: () => { if (confirm('清空進場名單、所有作答與進度？題庫會保留。')) A.clearAll().then(() => toast('已清空')); } }, '清空'))),
            h('p', { class: 'muted' }, '本局 ' + r.participants + ' 人作答 · 平均 ' + Z.toScore(r.avg, r.total) + ' 分'),
            h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
              h('thead', null, h('tr', null, h('th', null, 'ID'), h('th', { class: 'num' }, '已答'), h('th', { class: 'num' }, '答對'), h('th', { class: 'num' }, '分數'))),
              h('tbody', null, ps.map((p) => {
                const mine = r.mine[p.id] || {}; const k = r.scores[p.id];
                return h('tr', null, h('td', null, p.name), h('td', { class: 'num' }, Object.keys(mine).length), h('td', { class: 'num' }, k === undefined ? '–' : k), h('td', { class: 'num' }, k === undefined ? '–' : Z.toScore(k, r.total)));
              })))),
            g.status === 'finished' || g.status === 'recap' ? h('div', { class: 'stack' }, h('h3', null, '錯最多的題目（點一題回看）'), hardestList(r, true)) : null,
          ),
        ),
      );
    }
    function bankEditor() {
      const bk = bank();
      if (draft === null) draft = Z.formatBankText(bk.title, bk.questions);
      const ta = h('textarea', { rows: 18, spellcheck: 'false', style: 'font-family:ui-monospace,Consolas,monospace;font-size:.85rem' });
      ta.value = draft; ta.addEventListener('input', () => { draft = ta.value; });
      const errBox = h('ul', { class: 'errors', hidden: true });
      const apply = () => {
        const p = Z.parseBankText(draft);
        clear(errBox); errBox.hidden = !p.errors.length;
        if (p.errors.length) { mount(errBox, p.errors.slice(0, 6).map((e) => h('li', null, e))); return; }
        A.setBank(p.title || bk.title, p.questions).then(() => { toast('已套用 ' + p.questions.length + ' 題'); editing = false; draft = null; render(); }, (e) => { console.error(e); toast('寫入失敗'); });
      };
      return h('div', { class: 'stack' },
        h('p', { class: 'muted', style: 'font-size:.85rem' }, '格式：[章節]、1. 題目、(A)…(D)、答：C、解：…（可直接從 Word 貼上）'),
        ta, errBox,
        h('div', { class: 'row' }, h('button', { class: 'primary', onclick: apply }, '套用題庫'), h('button', { onclick: () => { editing = false; draft = null; render(); } }, '取消')));
    }
    function exportXlsx() {
      if (!window.XLSX) { toast('Excel 元件未載入'); return; }
      const r = results(); const qs = bank().questions; const ps = players(); const g = game();
      const nameOf = {}; ps.forEach((p) => { nameOf[p.id] = p.name; });
      const ids = new Set(ps.map((p) => p.id)); Object.keys(r.scores).forEach((d) => ids.add(d));
      const rows = [...ids].map((d) => {
        const row = { ID: nameOf[d] || '（未進場）', 答對: r.scores[d] === undefined ? '' : r.scores[d], 分數: r.scores[d] === undefined ? '' : Z.toScore(r.scores[d], r.total) };
        qs.forEach((x, i) => { row['Q' + (i + 1)] = (r.mine[d] || {})[i] || ''; });
        return row;
      });
      const qrows = r.perQ.map((p) => ({ 題號: p.n, 章節: p.section, 題目: p.text, A: qs[p.index].options.A, B: qs[p.index].options.B, C: qs[p.index].options.C, D: qs[p.index].options.D, 正解: p.answer, 作答人數: p.answered, 答對率: p.rate === null ? '' : Math.round(p.rate * 100) + '%', 選A: p.counts.A, 選B: p.counts.B, 選C: p.counts.C, 選D: p.counts.D, 解析: qs[p.index].explain || '' }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '成績');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(qrows), '題目');
      XLSX.writeFile(wb, '期中複習競賽_' + Z.classId + '_第' + g.run + '局.xlsx');
    }
    render();
    return render;
  }

  /* ---------- 路由 ---------- */
  const VIEWS = { join: viewJoin, board: viewBoard, admin: viewAdmin };
  let current = null;
  function navigate() {
    let name = location.hash.replace('#', '');
    if (!VIEWS[name]) name = 'join';
    const main = document.querySelector('main'); main.classList.remove('wide');
    const root = clear(document.getElementById('view')); root.className = '';
    current = { name, update: VIEWS[name](root) };
    document.getElementById('pill').textContent = Z.STATUS_LABEL[game().status] || '';
    window.scrollTo(0, 0);
  }
  function onData() {
    document.getElementById('pill').textContent = Z.STATUS_LABEL[game().status] || '';
    if (current && current.update) current.update();
  }
  window.addEventListener('hashchange', navigate);
  let booted = false; const KEYS = ['game', 'bank', 'players', 'answers']; const arrived = new Set();
  KEYS.forEach((k) => B.listen(k, (v) => {
    S[k] = v; arrived.add(k);
    if (!booted && arrived.size === KEYS.length) { booted = true; navigate(); return; }
    if (booted) onData();
  }));
  setTimeout(() => { if (!booted) { booted = true; navigate(); } }, 3000);
  window.MQApp = { S, me, game, bank, results, A };
})();
