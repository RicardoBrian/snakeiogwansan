// 오목 연습 모드 학생 화면: 코드 없이 들어와서 로비에서 대국을 만들고/참가하고/관전
// 대국 기록은 서버(/api/omok 의 p* 작업)만 쓰고, 이 화면은 읽기 + 요청만 합니다.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const t = (k, p) => I18N.t(k, p);
  const C = OmokCore;
  const GRACE_MS = 1500;       // 서버와 같은 값
  const ONLINE_MS = 8000;      // 이 안에 신호가 있으면 접속 중
  const BEAT_MS = 3000;

  if (!window.firebase || !firebase.apps.length) return; // 서버 설정이 없으면 omok.js 가 이미 안내함
  const db = firebase.database();
  const SV = firebase.database.ServerValue;
  let serverOffset = 0;
  const now = () => Date.now() + serverOffset;
  db.ref('.info/serverTimeOffset').on('value', (s) => { serverOffset = s.val() || 0; });
  let connected = false;
  db.ref('.info/connected').on('value', (s) => { connected = !!s.val(); });

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 무시 */ }
    },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* 무시 */ } }
  };
  const tokKey = (sid) => `omok_p_tok_${sid}`;

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
  const setLoginError = (msg) => { $('loginError').textContent = msg || ''; };

  // ===== 입장 =====
  let me = null; // { sid, name, token }
  $('practiceBtn').addEventListener('click', async () => {
    const sid = $('sidInput').value.trim();
    const name = $('nameInput').value.trim();
    if (!/^[0-9A-Za-z]{1,12}$/.test(sid)) return setLoginError(t('errSid'));
    if (!name || name.length > 10) return setLoginError(t('errName'));
    if (!connected) return setLoginError(t('errConnecting'));
    $('practiceBtn').disabled = $('joinBtn').disabled = true;
    setLoginError('');
    const r = await api('pRegister', { sid, name, token: store.get(tokKey(sid)) || '' });
    $('practiceBtn').disabled = $('joinBtn').disabled = false;
    if (!r.ok) { setLoginError(r.code === 'already_registered' ? t('pErrTaken') : t(...errKey(r))); return; }
    store.set(tokKey(sid), r.token);
    store.set('snake_sid', sid); store.set('snake_name', name);
    enter({ sid, name: r.name, token: r.token });
  });
  $('pLeaveBtn').onclick = () => leave();

  // ===== 상태 =====
  let players = {}, online = {}, tables = {};
  let refs = [], beatTimer = 0;
  let shownTid = null;                // 화면에 보여 주는 대국 (내 대국 또는 관전)
  let pending = null, hover = null, lastTouchPos = null, lastClaim = 0;

  function enter(who) {
    me = who;
    players = {}; online = {}; tables = {}; shownTid = null; pending = null; hover = null; sigs.clear();
    const ref = (p, fn) => { const x = db.ref(`omokPractice/${p}`); x.on('value', fn); refs.push(x); };
    ref('players', (s) => { players = C.obj(s.val()); render(); });
    ref('online', (s) => { online = C.obj(s.val()); renderLists(); });
    ref('tables', (s) => { tables = C.obj(s.val()); render(); });
    const me_ = db.ref(`omokPractice/online/${me.sid}`);
    me_.onDisconnect().remove();
    const beat = () => me_.set({ t: SV.TIMESTAMP }).catch(() => {});
    beat();
    beatTimer = setInterval(beat, BEAT_MS);
    $('login').classList.add('hidden');
    $('practice').classList.remove('hidden');
    $('pMe').textContent = `${me.sid} ${me.name}`;
  }

  function leave() {
    if (!me) return;
    const mine = myActiveTid();
    if (mine) api('pLeave', { sid: me.sid, token: me.token, tid: mine }); // 대국 중이면 기권, 기다리던 테이블이면 삭제
    refs.forEach((r) => r.off());
    refs = [];
    clearInterval(beatTimer);
    const o = db.ref(`omokPractice/online/${me.sid}`);
    o.onDisconnect().cancel();
    o.remove().catch(() => {});
    me = null; shownTid = null; pending = null; hover = null;
    $('practice').classList.add('hidden');
    $('login').classList.remove('hidden');
  }

  const colorOf = (g, sid) => (g.b === sid ? 'b' : g.w === sid ? 'w' : null);
  const seated = (g) => !!(g.b && g.w);
  function myActiveTid() {
    for (const [id, g] of Object.entries(tables)) if (g && !g.res && colorOf(g, me.sid)) return id;
    return null;
  }
  const nameOfSid = (sid) => (players[sid] && players[sid].name) || sid;
  const isOnline = (sid) => online[sid] && now() - (Number(online[sid].t) || 0) < ONLINE_MS;

  // ===== 화면 =====
  function render() {
    if (!me) return;
    // 내가 앉은 진행 중 대국이 있으면 그걸 보여 줌 (새로고침·다른 기기에서 만든 경우도)
    const mine = myActiveTid();
    if (mine && !(shownTid && tables[shownTid] && colorOf(tables[shownTid], me.sid))) shownTid = mine;
    // 상대가 '한 판 더'를 눌러 새 대국이 만들어졌으면 따라감
    const cur = shownTid && tables[shownTid];
    if (mine && cur && cur.res && cur.rematch === mine) { shownTid = mine; pending = null; hover = null; }
    if (shownTid && !tables[shownTid]) { shownTid = null; pending = null; }
    const g = shownTid ? tables[shownTid] : null;

    $('pMatchBox').classList.toggle('hidden', !g);
    let msg = t('pStLobby'), cls = '';
    if (g) {
      const my = colorOf(g, me.sid);
      const live = !g.res && seated(g);
      if (!seated(g) && !g.res) msg = t('pStWaiting');
      else if (live) msg = t(my ? 'pStPlaying' : 'pStWatching');
      else if (g.res) {
        if (my) {
          const o = C.outcome(g, me.sid);
          msg = `${t(o === 'w' ? 'oResWin' : o === 'l' ? 'oResLoss' : 'oResDraw')} (${t('oWhy_' + (g.why || 'five'))})`;
          cls = o === 'w' ? 'win' : o === 'l' ? 'loss' : '';
        } else msg = `${t(g.res === 'b' ? 'oResB' : g.res === 'w' ? 'oResW' : 'oResD')} (${t('oWhy_' + (g.why || 'five'))})`;
      }
      renderMatch(g, my);
    }
    $('pStatus').textContent = msg;
    $('pStatus').className = 'status ' + cls;
    $('pCreateBtn').disabled = !!mine;
    renderLists();
    tick();
  }

  function renderMatch(g, my) {
    const watching = !my;
    $('pWatchBar').classList.toggle('hidden', !watching);
    if (watching) $('pWatchText').textContent = t('oWatching', { b: g.bn || '—', w: g.wn || '—' });
    for (const [id, c] of [['pPB', 'b'], ['pPW', 'w']]) {
      const el = $(id), sid = g[c], nm = g[c + 'n'];
      el.querySelector('.pl-name').textContent = sid ? nm + (sid === me.sid ? ` (${t('oMe')})` : '') : t('pSeatEmpty');
      el.classList.toggle('me', sid === me.sid);
    }
    const live = !g.res && seated(g);
    // 버튼: 기권(대국 중), 한 판 더(끝난 뒤), 닫기(관전/끝남/기다리는 중 취소)
    $('pResignBtn').classList.toggle('hidden', !(my && live));
    const rm = $('pRematchBtn');
    const canRematch = !!my && !!g.res && seated(g);
    rm.classList.toggle('hidden', !canRematch);
    if (canRematch) rm.textContent = t(g.rematch ? 'pRematchGo' : 'pRematch');
    const close = $('pCloseBtn');
    close.classList.toggle('hidden', live && !!my);
    close.textContent = t(!seated(g) && !g.res && my ? 'pCancel' : 'pLobby');

    const touch = matchMedia('(pointer: coarse)').matches;
    $('pHint').textContent = watching ? '' : t(touch ? 'oHintTouch' : 'oHintMouse', { s: g.moveTime || 60 });
    if (pending != null && C.moves(g).includes(pending)) pending = null;
    drawBoard(g, my);
  }

  function isMyTurn(g, my) {
    return !!my && !g.res && seated(g) && C.turn(g) === my && pending == null;
  }
  function drawBoard(g, my) {
    const cv = $('pBoardCv');
    if (!my) { C.drawBoard(cv, g); return; }
    C.drawBoard(cv, g, { hover: isMyTurn(g, my) ? hover : null, hoverColor: my, pending, pendingColor: my });
  }

  // 대국 목록 + 접속자
  function renderLists() {
    if (!me) return;
    const list = document.createElement('tbody');
    const busy = new Set();
    for (const g of Object.values(tables)) if (g && !g.res) [g.b, g.w].forEach((s) => s && busy.add(s));
    const mine = myActiveTid();
    const rows = Object.entries(tables)
      .filter(([, g]) => g && !g.res)
      .sort((a, b) => (Number(b[1].created) || 0) - (Number(a[1].created) || 0));
    for (const [tid, g] of rows) {
      const tr = document.createElement('tr');
      if (tid === shownTid) tr.className = 'on';
      const td = document.createElement('td');
      const btn = document.createElement('button');
      btn.type = 'button';
      if (!seated(g)) {
        const sid = g.b || g.w;
        td.textContent = `${g.b ? '⚫' : '⚪'} ${nameOfSid(sid)} · ${t('pWaitingRow')}`;
        if (sid === me.sid) { btn.className = 'ghost'; btn.textContent = t('pCancel'); btn.onclick = () => closeTable(); }
        else { btn.textContent = t('pJoin'); btn.disabled = !!mine; btn.onclick = () => join(tid); }
      } else {
        td.textContent = `⚫ ${g.bn} vs ⚪ ${g.wn} · ${t('oMovesN', { n: C.moves(g).length })}`;
        if (colorOf(g, me.sid)) { btn.className = 'ghost'; btn.textContent = t('pMyGame'); btn.onclick = () => { shownTid = tid; render(); }; }
        else { btn.className = 'ghost'; btn.textContent = t('oWatch'); btn.onclick = () => { shownTid = tid; pending = null; render(); $('pMatchBox').scrollIntoView({ behavior: 'smooth', block: 'start' }); }; }
      }
      const tb = document.createElement('td');
      tb.appendChild(btn);
      tr.append(td, tb);
      list.appendChild(tr);
    }
    if (!rows.length) {
      const tr = document.createElement('tr'), td = document.createElement('td');
      td.className = 'muted'; td.textContent = t('pNoTables');
      tr.appendChild(td); list.appendChild(tr);
    }
    swapIn($('pTblList'), list);

    const sids = Object.keys(online).filter(isOnline).sort((a, b) => (a === me.sid ? -1 : b === me.sid ? 1 : a < b ? -1 : 1));
    $('pOnlineTitle').textContent = t('pOnline', { n: sids.length });
    const ol = document.createElement('tbody');
    for (const sid of sids) {
      const tr = document.createElement('tr'), td = document.createElement('td');
      const dot = document.createElement('span');
      dot.className = 'dot' + (busy.has(sid) ? ' busy' : '');
      td.append(dot, document.createTextNode(`${nameOfSid(sid)}${sid === me.sid ? ` (${t('oMe')})` : ''}${busy.has(sid) ? ' · ' + t('pInGame') : ''}`));
      if (sid === me.sid) tr.className = 'me';
      tr.appendChild(td); ol.appendChild(tr);
    }
    swapIn($('pOnlineList'), ol);
  }
  // 내용이 달라졌을 때만 바꿈 (0.25초마다 다시 그리면 누르던 버튼이 사라져 클릭이 안 됨)
  const sigs = new Map();
  function swapIn(table, tbody) {
    const sig = tbody.innerHTML;
    if (sigs.get(table.id) === sig) return;
    sigs.set(table.id, sig);
    table.replaceChildren(...tbody.childNodes);
  }

  // ===== 동작 =====
  const auth = (extra) => Object.assign({ sid: me.sid, token: me.token }, extra);

  $('pCreateBtn').onclick = async () => {
    $('pCreateBtn').disabled = true;
    const r = await api('pCreate', auth());
    if (!me) return;
    if (!r.ok) { toast(t(...errKey(r))); render(); return; }
    shownTid = r.tid; pending = null; hover = null;
    render();
  };

  async function join(tid) {
    const r = await api('pJoin', auth({ tid }));
    if (!me) return;
    if (!r.ok) { toast(t(...errKey(r))); return; }
    shownTid = tid; pending = null; hover = null;
    render();
  }

  // 기다리는 테이블이면 취소, 끝났거나 관전 중이면 로비로
  async function closeTable() {
    const g = shownTid && tables[shownTid];
    const tid = shownTid;
    shownTid = null; pending = null; hover = null;
    if (g && !g.res && colorOf(g, me.sid) && !seated(g)) await api('pLeave', auth({ tid }));
    if (me) render();
  }
  $('pCloseBtn').onclick = closeTable;

  $('pResignBtn').onclick = async () => {
    const g = shownTid && tables[shownTid];
    if (!g || g.res || !colorOf(g, me.sid) || !confirm(t('oConfirmResign'))) return;
    const r = await api('pLeave', auth({ tid: shownTid }));
    if (!r.ok) toast(t(...errKey(r)));
  };

  $('pRematchBtn').onclick = async () => {
    const g = shownTid && tables[shownTid];
    if (!g) return;
    $('pRematchBtn').disabled = true;
    const r = await api('pRematch', auth({ tid: shownTid }));
    $('pRematchBtn').disabled = false;
    if (!me) return;
    if (!r.ok) { toast(t(...errKey(r))); return; }
    shownTid = r.tid; pending = null; hover = null;
    render();
  };

  // 타이머, 시간 초과 처리 (0.25초마다)
  function tick() {
    if (!me) return;
    const g = shownTid ? tables[shownTid] : null;
    if (!g) return;
    const my = colorOf(g, me.sid);
    const live = !g.res && seated(g);
    const limit = (Number(g.moveTime) || 60) * 1000;
    const left = live ? (Number(g.at) || now()) + limit - now() : null;
    const turn = C.turn(g);
    for (const [id, c] of [['pPB', 'b'], ['pPW', 'w']]) {
      const el = $(id), tm = el.querySelector('.pl-time');
      const on = live && turn === c;
      el.classList.toggle('turn', on);
      tm.textContent = on ? Math.max(0, Math.ceil(Math.min(left, limit) / 1000)) : '';
      tm.classList.toggle('low', on && left < 6000);
    }
    const tt = $('pTurnText');
    if (live) {
      if (my) { tt.textContent = t(turn === my ? 'oYourTurn' : 'oTheirTurn'); tt.className = turn === my ? 'mine' : ''; }
      else { tt.textContent = t('oWatchTurn', { name: turn === 'b' ? g.bn : g.wn }); tt.className = ''; }
    } else tt.textContent = '';
    // 차례인 쪽 시간이 지나면 시간패 요청 (대국자 누구든 요청 가능, 서버가 시각 확인)
    if (my && live && left < -GRACE_MS - 300 && Date.now() - lastClaim > 3000) {
      lastClaim = Date.now();
      api('pTimeout', auth({ tid: shownTid }));
    }
  }
  setInterval(() => { if (me) { tick(); renderLists(); } }, 250);

  // ===== 돌 놓기 =====
  const cv = $('pBoardCv');
  const current = () => {
    const g = me && shownTid ? tables[shownTid] : null;
    return g ? { g, my: colorOf(g, me.sid) } : null;
  };
  cv.addEventListener('pointermove', (e) => {
    const c = current();
    if (!c || e.pointerType !== 'mouse') return;
    const p = C.posAt(cv, e.clientX, e.clientY);
    if (p !== hover) { hover = p; drawBoard(c.g, c.my); }
  });
  cv.addEventListener('pointerleave', () => { const c = current(); if (c && hover != null) { hover = null; drawBoard(c.g, c.my); } });
  cv.addEventListener('pointerup', (e) => {
    const c = current();
    if (!c || !isMyTurn(c.g, c.my)) return;
    const p = C.posAt(cv, e.clientX, e.clientY);
    if (p == null || C.moves(c.g).includes(p)) return;
    // 터치: 첫 탭은 미리보기, 같은 자리를 한 번 더 탭하면 놓기 (잘못 누르는 실수 방지)
    if (e.pointerType !== 'mouse' && lastTouchPos !== p) {
      lastTouchPos = p; hover = p; drawBoard(c.g, c.my);
      return;
    }
    lastTouchPos = null; hover = null;
    place(c.g, c.my, p);
  });

  async function place(g, my, pos) {
    const tid = shownTid;
    pending = pos;
    drawBoard(g, my);
    const r = await api('pMove', auth({ tid, pos }));
    if (!me) return;
    if (!r.ok) toast(t(...errKey(r)));
    pending = null;
    render();
  }

  addEventListener('resize', () => { if (me) render(); });
  addEventListener('langchange', () => { if (me) render(); });
})();
