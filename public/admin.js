// 관리자 페이지 틀: 구글 로그인, 왼쪽 게임 메뉴, 주소(#게임/화면/코드) 이동, 공용 도우미
// 게임마다 *-admin.js 에서 Admin.register({...}) 로 붙습니다. (snake-admin.js, omok-admin.js 참고)
//   id     : 'snake'          → <section class="game" data-game="snake"> 와 연결
//   icon   : '🐍', name: 번역 키, path: 학생 주소('snake')
//   views  : [{ id: 'rooms', label: 번역 키 }, ...]  → 화면 안 <div data-view="rooms">
//   start(ctx)        : 로그인 후 한 번 (DB 연결 등)
//   route(view, arg)  : 이 게임/화면이 열릴 때 (arg: 주소 끝의 코드, 없으면 '')
window.Admin = (() => {
  'use strict';
  const games = [];
  return { games, register(def) { games.push(def); } };
})();

(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const t = (k, p) => I18N.t(k, p);

  // 로그인 화면 메시지는 키로 기억해 두었다가 언어가 바뀌면 다시 그림
  let gateMsg = null;
  function setGate(key, params) { gateMsg = key ? { key, params } : null; renderGate(); }
  function renderGate() { $('gateErr').textContent = gateMsg ? t(gateMsg.key, gateMsg.params) : ''; }
  addEventListener('langchange', renderGate);

  const cfg = window.FIREBASE_CONFIG || {};
  if (!cfg.databaseURL) { setGate('noConfig'); $('googleBtn').disabled = true; return; }
  if (!cfg.apiKey || !cfg.projectId) { setGate('noAuthConfig'); $('googleBtn').disabled = true; return; }

  // 구글 로그인 (Firebase Authentication). 관리자 이메일인지는 서버가 확인
  firebase.initializeApp(cfg);
  const emu = new URLSearchParams(location.search).has('emu');
  const auth = firebase.auth();
  if (emu) auth.useEmulator('http://127.0.0.1:9099', { disableWarnings: true });

  // 서버 오류는 코드로 받아서 현재 언어로 표시
  const errText = (r) => t('err_' + (r.code || 'server')) + (r.detail ? ` (${r.detail})` : '');

  async function adminAction(action, extra) {
    try {
      const user = auth.currentUser;
      if (!user) return { ok: false, code: 'bad_login' };
      const idToken = await user.getIdToken();
      const res = await fetch('api/admin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.assign({ idToken, action }, extra || {}))
      });
      return await res.json().catch(() => ({ ok: false, code: 'server', detail: String(res.status) }));
    } catch (e) {
      return { ok: false, code: 'network', detail: e.message };
    }
  }
  async function run(action, extra) {
    const r = await adminAction(action, extra);
    if (!r.ok) alert(t('failed', { msg: errText(r) }));
    return r;
  }

  let started = false;
  auth.onAuthStateChanged(async (user) => {
    $('gateSignOut').classList.toggle('hidden', !user);
    if (!user) {
      $('main').classList.add('hidden');
      $('gate').classList.remove('hidden');
      if (started) location.reload(); // 로그아웃하면 실시간 연결도 정리
      return;
    }
    setGate('checking');
    const r = await adminAction('check');
    if (!r.ok) { setGate('failed', { msg: errText(r) }); return; }
    setGate(null);
    $('whoText').textContent = user.email;
    $('gate').classList.add('hidden');
    $('main').classList.remove('hidden');
    if (!started) { started = true; start(); }
  });

  $('googleBtn').onclick = async () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await auth.signInWithPopup(provider);
    } catch (e) {
      if (e.code === 'auth/popup-blocked') return auth.signInWithRedirect(provider);
      if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
      setGate(e.code === 'auth/unauthorized-domain' ? 'authDomainErr' : 'failed', { msg: e.code || e.message, host: location.hostname });
    }
  };
  $('gateSignOut').onclick = () => auth.signOut();
  $('signOutBtn').onclick = () => auth.signOut();

  // ================= 게임 메뉴 + 주소 이동 =================
  let db = null, serverOffset = 0;
  const now = () => Date.now() + serverOffset;
  const games = Admin.games;
  let cur = { game: null, view: null, arg: '' };

  // 주소: #게임/화면/코드  (예: #omok/leagues/1234)
  function parseHash() {
    const [g, v, a] = decodeURIComponent(location.hash.replace(/^#/, '')).split('/');
    let game = games.find((x) => x.id === g);
    if (!game) {
      let saved = null;
      try { saved = localStorage.getItem('admin_game'); } catch (e) { /* 무시 */ }
      game = games.find((x) => x.id === saved) || games[0];
    }
    const view = game.views.find((x) => x.id === v) || game.views[0];
    return { game, view: view.id, arg: game.id === g && view.id === v ? a || '' : '' };
  }
  function setRoute(gameId, view, arg) {
    const h = '#' + [gameId, view, arg].filter(Boolean).join('/');
    if (location.hash !== h) history.replaceState(null, '', h);
    applyRoute();
  }
  function applyRoute() {
    const r = parseHash();
    const same = cur.game === r.game && cur.view === r.view && cur.arg === r.arg;
    cur = r;
    try { localStorage.setItem('admin_game', r.game.id); } catch (e) { /* 무시 */ }
    document.querySelectorAll('section.game').forEach((s) => s.classList.toggle('hidden', s.dataset.game !== r.game.id));
    const sec = document.querySelector(`section.game[data-game="${r.game.id}"]`);
    sec.querySelectorAll('[data-view]').forEach((v) => v.classList.toggle('hidden', v.dataset.view !== r.view));
    renderChrome();
    if (!same && r.game.route) r.game.route(r.view, r.arg);
  }
  addEventListener('hashchange', applyRoute);

  const studentUrl = (g) => new URL(g.path, location.href).href;

  // 왼쪽 메뉴, 게임 이름, 학생 주소, 하위 탭
  function renderChrome() {
    const nav = $('gameNav');
    nav.innerHTML = '';
    for (const g of games) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'nav-item' + (g === cur.game ? ' active' : '');
      b.innerHTML = '<span class="nav-icon"></span><span></span>';
      b.firstChild.textContent = g.icon;
      b.lastChild.textContent = t(g.name);
      b.onclick = () => setRoute(g.id, '', '');
      nav.appendChild(b);
    }
    const g = cur.game;
    if (!g) return;
    $('gameTitle').textContent = `${g.icon} ${t(g.name)}`;
    $('gameUrl').textContent = studentUrl(g).replace(/^https?:\/\//, '');
    const tabs = $('subtabs');
    tabs.innerHTML = '';
    tabs.classList.toggle('hidden', g.views.length < 2);
    for (const v of g.views) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = t(v.label);
      b.className = v.id === cur.view ? 'active' : '';
      b.onclick = () => setRoute(g.id, v.id, '');
      tabs.appendChild(b);
    }
  }
  $('gameUrlCopy').onclick = () => copyText(studentUrl(cur.game), $('gameUrlCopy'));
  $('gameUrlOpen').onclick = () => window.open(studentUrl(cur.game) + (emu ? '?emu=1' : ''), '_blank');
  addEventListener('langchange', () => { if (started) renderChrome(); });

  function start() {
    db = firebase.database();
    if (emu) db.useEmulator('127.0.0.1', 9000);
    db.ref('.info/serverTimeOffset').on('value', (s) => { serverOffset = s.val() || 0; });
    for (const g of games) {
      g.start(Object.assign({}, ctx, {
        // 이 게임 안에서 화면/코드를 바꿀 때 (주소도 같이 바뀜)
        go: (view, arg) => setRoute(g.id, view, arg),
        current: () => (cur.game === g ? { view: cur.view, arg: cur.arg } : null)
      }));
    }
    applyRoute();
  }

  // ================= 게임들이 같이 쓰는 도우미 =================
  function copyText(text, btn) {
    const done = () => {
      if (!btn) return;
      btn.textContent = t('copied');
      setTimeout(() => { btn.textContent = t('copy'); }, 1500);
    };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => prompt('', text));
    else prompt('', text);
  }

  function downloadCsv(rows, name) {
    const csv = '﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `${name}_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`;
    a.click();
  }

  function fill(tbody, rows, numCols, medals) {
    tbody.innerHTML = '';
    rows.forEach((r, i) => {
      const tr = document.createElement('tr');
      if (medals && i < 3) tr.className = 'top' + (i + 1);
      r.forEach((c, j) => {
        const td = document.createElement('td');
        td.textContent = c;
        if (numCols.includes(j)) td.className = 'num';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  // 왼쪽 목록 카드. items: [{ id, title, sub, badge: { text, tone: live|wait|reg|done } }]
  function cards(el, items, selId, onPick) {
    el.innerHTML = '';
    for (const it of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'card' + (it.id === selId ? ' sel' : '');
      b.innerHTML = '<div class="card-top"><span class="card-code"></span><span class="card-title"></span><span class="badge"></span></div><div class="card-sub"></div>';
      b.querySelector('.card-code').textContent = it.id;
      b.querySelector('.card-title').textContent = it.title;
      const bd = b.querySelector('.badge');
      if (it.badge) { bd.textContent = it.badge.text; bd.classList.add(it.badge.tone); } else bd.remove();
      b.querySelector('.card-sub').textContent = it.sub || '';
      b.onclick = () => onPick(it.id);
      el.appendChild(b);
    }
  }

  // 진행 단계 표시. steps: 번역된 글자 목록, at: 지금 단계 번호(0부터), 끝까지 갔으면 steps.length
  function steps(el, labels, at) {
    el.innerHTML = '';
    labels.forEach((s, i) => {
      const li = document.createElement('li');
      li.textContent = `${i + 1}. ${s}`;
      li.className = i < at ? 'done' : i === at ? 'now' : '';
      el.appendChild(li);
    });
  }

  function badge(el, b) {
    el.className = 'badge' + (b ? ' ' + b.tone : '');
    el.textContent = b ? b.text : '';
  }

  const ctx = {
    get db() { return db; },
    now, run, adminAction, t, $, fill, downloadCsv, copyText, cards, steps, badge,
    date: (ms) => new Date(ms || 0).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    emu
  };
})();
