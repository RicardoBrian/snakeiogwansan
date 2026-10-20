// 오목 리그 학생 화면: 등록 → 대기 → 라운드마다 내 대국 → 최종 순위
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const t = (k, p) => I18N.t(k, p);
  const C = OmokCore;
  const GRACE_MS = 1500; // 서버와 같은 값: 제한 시간이 이만큼 지나면 시간패 처리를 요청

  let loginMsg = null;
  function setLoginError(key, params) { loginMsg = key ? { key, params } : null; renderLoginError(); }
  function renderLoginError() { $('loginError').textContent = loginMsg ? t(loginMsg.key, loginMsg.params) : ''; }

  const cfg = window.FIREBASE_CONFIG || {};
  if (!cfg.databaseURL) { setLoginError('noConfig'); $('joinBtn').disabled = true; return; }
  firebase.initializeApp(cfg);
  const db = firebase.database();
  if (new URLSearchParams(location.search).has('emu')) db.useEmulator('127.0.0.1', 9000);
  let serverOffset = 0, connected = false;
  const now = () => Date.now() + serverOffset;
  db.ref('.info/serverTimeOffset').on('value', (s) => { serverOffset = s.val() || 0; });
  db.ref('.info/connected').on('value', (s) => { connected = !!s.val(); renderConn(); });
  function renderConn() { $('connText').textContent = t(connected ? 'connected' : 'connecting'); }

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 무시 */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* 무시 */ } }
  };
  const tokKey = (code, sid) => `omok_tok_${code}_${sid}`;

  async function api(action, extra) {
    try {
      const res = await fetch('api/omok', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.assign({ action }, extra))
      });
      return await res.json().catch(() => ({ ok: false, code: 'server' }));
    } catch (e) {
      return { ok: false, code: 'network' };
    }
  }
  const errKey = (r) => {
    const k = 'oerr_' + r.code;
    return t(k) !== k ? [k] : ['oerr_other', { code: r.code }];
  };

  let toastTimer = 0;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  // ===== 로그인 =====
  const q = new URLSearchParams(location.search);
  $('codeInput').value = q.get('code') || store.get('omok_code') || '';
  $('sidInput').value = store.get('snake_sid') || '';
  $('nameInput').value = store.get('snake_name') || '';

  let me = null; // { code, sid, name, token }
  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = $('codeInput').value.trim();
    const sid = $('sidInput').value.trim();
    const name = $('nameInput').value.trim();
    if (!/^[0-9]{4}$/.test(code)) return setLoginError('oErrCode');
    if (!/^[0-9A-Za-z]{1,12}$/.test(sid)) return setLoginError('errSid');
    if (!name || name.length > 10) return setLoginError('errName');
    if (!connected) return setLoginError('errConnecting');
    $('joinBtn').disabled = true;
    setLoginError(null);
    const r = await api('register', { code, sid, name, token: store.get(tokKey(code, sid)) || '' });
    $('joinBtn').disabled = false;
    if (!r.ok) { setLoginError(...errKey(r)); return; }
    store.set(tokKey(code, sid), r.token);
    store.set('omok_code', code); store.set('snake_sid', sid); store.set('snake_name', name);
    enter({ code, sid, name: r.name, token: r.token });
  });

  $('leaveBtn').onclick = () => leave();

  // ===== 리그 화면 =====
  let L = null, refs = [];
  function enter(who) {
    me = who;
    L = { meta: null, state: null, members: {}, games: {}, byes: {}, loaded: false };
    const ref = (p) => { const x = db.ref(`omok/${me.code}/${p}`); refs.push(x); return x; };
    ref('meta').on('value', (s) => {
      L.meta = s.val();
      if (!L.meta && L.loaded) { leave(); setLoginError('oLeagueGone'); return; }
      L.loaded = true;
      render();
    });
    ref('state').on('value', (s) => { L.state = s.val(); render(); });
    ref('members').on('value', (s) => {
      L.members = C.obj(s.val());
      // 관리자가 빼거나 로그인을 풀면 이 기기는 더 이상 둘 수 없음
      const m = L.members[me.sid];
      if (L.loaded && (!m || !m.th)) { store.del(tokKey(me.code, me.sid)); leave(); setLoginError(m ? 'oerr_bad_token' : 'oerr_not_member'); return; }
      render();
    });
    ref('games').on('value', (s) => { L.games = s.val() || {}; render(); });
    ref('byes').on('value', (s) => { L.byes = s.val() || {}; render(); });
    $('login').classList.add('hidden');
    $('app').classList.remove('hidden');
    $('lgCode').textContent = me.code;
    $('meText').textContent = `${me.sid} ${me.name}`;
  }
  function leave() {
    refs.forEach((r) => r.off());
    refs = [];
    me = null; L = null; pending = null; hover = null;
    $('app').classList.add('hidden');
    $('countdown').classList.add('hidden');
    $('login').classList.remove('hidden');
  }

  // 지금 보여 줄 내 대국 (라운드 중이거나 방금 끝난 라운드)
  function myGame() {
    const st = L.state || {};
    if (!st.round) return null;
    const rk = 'r' + st.round;
    for (const [mid, g] of Object.entries(L.games[rk] || {})) {
      if (g && (g.b === me.sid || g.w === me.sid)) return { mid, g, round: st.round };
    }
    return null;
  }
  const nameOf = (sid) => (L.members[sid] && L.members[sid].name) || sid;

  let pending = null, hover = null, lastClaim = 0;

  function render() {
    if (!L || !L.meta || !L.state) return;
    const st = L.state, meta = L.meta, n = meta.rounds || 0;
    $('lgName').textContent = meta.name || '';
    const mg = (st.phase === 'round' || st.phase === 'results' || st.phase === 'finished') ? myGame() : null;
    const table = C.standings(meta, L.members, L.games);
    const mine = table.find((r) => r.sid === me.sid);

    // 상태 줄
    let msg = '', cls = '';
    if (st.phase === 'register') msg = t('oStRegister', { n: Object.keys(L.members).length });
    else if (st.phase === 'ready') msg = t('oStReady', { n });
    else if (st.phase === 'finished') { msg = t('oStFinished', { rank: mine ? mine.rank : '-', pts: mine ? mine.pts : 0 }); cls = 'win'; }
    else if (st.phase === 'round' || st.phase === 'results') {
      const r = st.round;
      if (!mg) msg = L.byes['r' + r] === me.sid ? t('oStBye', { r, n }) : t('oNoGame');
      else if (mg.g.res) {
        const o = C.outcome(mg.g, me.sid);
        msg = `${t(o === 'w' ? 'oResWin' : o === 'l' ? 'oResLoss' : 'oResDraw')} (${t('oWhy_' + (mg.g.why || 'admin'))}) · ` +
          t(st.phase === 'round' ? 'oStDone' : 'oStResults', { r, n });
        cls = o === 'w' ? 'win' : o === 'l' ? 'loss' : '';
      } else if (st.phase === 'results') msg = t('oStResults', { r, n });
      else msg = t('oStPlaying', { r, n });
    }
    $('statusText').textContent = msg;
    $('statusText').className = 'status ' + cls;

    // 대국판
    $('matchBox').classList.toggle('hidden', !mg);
    if (mg) renderMatch(mg);

    renderStandings(table);
    renderMyGames();
    tick();
  }

  function renderMatch(mg) {
    const g = mg.g;
    const myColor = g.b === me.sid ? 'b' : 'w';
    for (const [id, c] of [['pB', 'b'], ['pW', 'w']]) {
      const el = $(id);
      const sid = c === 'b' ? g.b : g.w;
      el.querySelector('.pl-name').textContent = nameOf(sid) + (sid === me.sid ? ` (${t('oMe')})` : '');
      el.classList.toggle('me', sid === me.sid);
    }
    $('resignBtn').classList.toggle('hidden', !!g.res || L.state.phase !== 'round');
    const touch = matchMedia('(pointer: coarse)').matches;
    $('hintText').textContent = t(touch ? 'oHintTouch' : 'oHintMouse', { s: L.meta.moveTime || 30 });
    if (pending != null && C.moves(g).includes(pending)) pending = null;
    drawBoard(mg, myColor);
  }

  function drawBoard(mg, myColor) {
    const canPlay = isMyTurn(mg);
    C.drawBoard($('boardCv'), mg.g, {
      hover: canPlay ? hover : null, hoverColor: myColor,
      pending, pendingColor: myColor
    });
  }

  function isMyTurn(mg) {
    if (!mg || mg.g.res || L.state.phase !== 'round' || now() < L.state.startAt) return false;
    const myColor = mg.g.b === me.sid ? 'b' : 'w';
    return C.turn(mg.g) === myColor && pending == null;
  }

  // 타이머, 카운트다운, 시간초과 처리 (0.25초마다)
  function tick() {
    if (!L || !L.state || !L.meta) return;
    const st = L.state;
    // 카운트다운
    const cd = st.phase === 'round' ? st.startAt - now() : 0;
    $('countdown').classList.toggle('hidden', !(cd > 0));
    if (cd > 0) {
      $('countdownSub').textContent = t('oStCountdown', { r: st.round });
      $('countdownNum').textContent = Math.ceil(cd / 1000);
    }
    const mg = st.phase === 'round' || st.phase === 'results' ? myGame() : null;
    if (!mg) return;
    const g = mg.g, turn = C.turn(g), limit = (L.meta.moveTime || 30) * 1000;
    const live = !g.res && st.phase === 'round';
    const left = live ? (Number(g.at) || st.startAt) + limit - now() : null;
    for (const [id, c] of [['pB', 'b'], ['pW', 'w']]) {
      const el = $(id), tm = el.querySelector('.pl-time');
      const on = live && turn === c;
      el.classList.toggle('turn', on);
      tm.textContent = on ? Math.max(0, Math.ceil(Math.min(left, limit) / 1000)) : '';
      tm.classList.toggle('low', on && left < 6000);
    }
    const myColor = g.b === me.sid ? 'b' : 'w';
    const tt = $('turnText');
    if (live && now() >= st.startAt) {
      tt.textContent = t(turn === myColor ? 'oYourTurn' : 'oTheirTurn');
      tt.className = turn === myColor ? 'mine' : '';
    } else tt.textContent = '';
    // 차례인 쪽 시간이 지나면 서버에 시간패 처리 요청 (양쪽 모두 요청할 수 있음, 서버가 시각 확인)
    if (live && left < -GRACE_MS - 300 && Date.now() - lastClaim > 3000) {
      lastClaim = Date.now();
      api('timeout', { code: me.code, sid: me.sid, token: me.token, mid: mg.mid });
    }
  }
  setInterval(tick, 250);

  // ===== 돌 놓기 =====
  const cv = $('boardCv');
  let lastTouchPos = null;
  cv.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || !L) return;
    const p = C.posAt(cv, e.clientX, e.clientY);
    if (p !== hover) { hover = p; const mg = myGame(); if (mg) drawBoard(mg, mg.g.b === me.sid ? 'b' : 'w'); }
  });
  cv.addEventListener('pointerleave', () => { if (hover != null && L) { hover = null; render(); } });
  cv.addEventListener('pointerup', (e) => {
    if (!L) return;
    const mg = myGame();
    if (!mg || !isMyTurn(mg)) return;
    const p = C.posAt(cv, e.clientX, e.clientY);
    if (p == null || C.moves(mg.g).includes(p)) return;
    const myColor = mg.g.b === me.sid ? 'b' : 'w';
    // 터치: 첫 탭은 미리보기, 같은 자리를 한 번 더 탭하면 놓기 (잘못 누르는 실수 방지)
    if (e.pointerType !== 'mouse' && lastTouchPos !== p) {
      lastTouchPos = p; hover = p; drawBoard(mg, myColor);
      return;
    }
    lastTouchPos = null; hover = null;
    place(mg, p, myColor);
  });

  async function place(mg, pos, myColor) {
    pending = pos;
    drawBoard(mg, myColor);
    const r = await api('move', { code: me.code, sid: me.sid, token: me.token, mid: mg.mid, pos });
    if (!L) return;
    if (!r.ok) {
      pending = null;
      toast(t(...errKey(r)));
    } else if (r.timeout) {
      pending = null;
    }
    const cur = myGame();
    if (cur && (!r.ok || C.moves(cur.g).includes(pos))) pending = null;
    render();
  }

  $('resignBtn').onclick = async () => {
    const mg = myGame();
    if (!mg || mg.g.res || !confirm(t('oConfirmResign'))) return;
    const r = await api('resign', { code: me.code, sid: me.sid, token: me.token, mid: mg.mid });
    if (!r.ok) toast(t(...errKey(r)));
  };

  // ===== 표 =====
  function renderStandings(table) {
    const tb = $('standTbl');
    tb.innerHTML = '';
    tb.appendChild(row('th', ['#', t('colName'), t('oColP'), t('oColW'), t('oColD'), t('oColL'), t('oColPts')], [2, 3, 4, 5, 6]));
    for (const r of table) {
      const tr = row('td', [r.rank, r.name, r.p, r.w, r.d, r.l, r.pts], [2, 3, 4, 5, 6]);
      if (r.sid === me.sid) tr.className = 'me';
      tb.appendChild(tr);
    }
  }

  function renderMyGames() {
    const tb = $('myTbl');
    tb.innerHTML = '';
    const n = L.meta.rounds || 0;
    if (!n) { tb.appendChild(row('td', [t('oWaiting')], [])); return; }
    tb.appendChild(row('th', [t('oColRound'), t('oColOpp'), t('oColColor'), t('oColResult')], []));
    const cur = L.state.round || 0;
    for (let i = 1; i <= n; i++) {
      const rk = 'r' + i;
      let cells;
      let rc = '';
      const g = Object.values(L.games[rk] || {}).find((x) => x && (x.b === me.sid || x.w === me.sid));
      if (!g) cells = [i, '—', '', L.byes[rk] === me.sid ? t('oBye') : ''];
      else {
        const opp = g.b === me.sid ? g.w : g.b;
        const o = C.outcome(g, me.sid);
        const res = o ? t(o === 'w' ? 'oColW' : o === 'l' ? 'oColL' : 'oColD') : i === cur && L.state.phase === 'round' ? t('oLive') : '';
        cells = [i, nameOf(opp), t(g.b === me.sid ? 'oBlack' : 'oWhite'), res];
        if (o) rc = 'r-' + o;
      }
      const tr = row('td', cells, []);
      if (rc) tr.lastChild.className = rc;
      if (i === cur) tr.style.fontWeight = '700';
      tb.appendChild(tr);
    }
  }

  function row(tag, cells, numCols) {
    const tr = document.createElement('tr');
    cells.forEach((c, j) => {
      const el = document.createElement(tag);
      el.textContent = c;
      if (numCols.includes(j)) el.className = 'num';
      tr.appendChild(el);
    });
    return tr;
  }

  addEventListener('resize', () => { if (L) render(); });
  addEventListener('langchange', () => { renderLoginError(); renderConn(); if (L) render(); });
  renderConn();

  // 이 기기에 토큰이 남아 있으면 바로 다시 입장 (새로고침해도 이어서)
  const autoCode = $('codeInput').value, autoSid = $('sidInput').value;
  const autoTok = autoCode && autoSid ? store.get(tokKey(autoCode, autoSid)) : null;
  if (autoTok) {
    api('register', { code: autoCode, sid: autoSid, name: $('nameInput').value, token: autoTok }).then((r) => {
      if (r.ok && !me) enter({ code: autoCode, sid: autoSid, name: r.name, token: autoTok });
      else if (!r.ok && r.code !== 'network') store.del(tokKey(autoCode, autoSid));
    });
  }
})();
