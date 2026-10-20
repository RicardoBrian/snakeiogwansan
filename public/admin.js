(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const t = (k, p) => I18N.t(k, p);

  // 게이트 화면 메시지는 키로 기억해 두었다가 언어가 바뀌면 다시 그림
  let gateMsg = null;
  function setGate(key, params) { gateMsg = key ? { key, params } : null; renderGate(); }
  function renderGate() { $('gateErr').textContent = gateMsg ? t(gateMsg.key, gateMsg.params) : ''; }
  addEventListener('langchange', renderGate);

  const cfg = window.FIREBASE_CONFIG || {};
  if (!cfg.databaseURL) {
    setGate('noConfig');
    return;
  }

  let password = '';

  // 서버 오류는 코드로 받아서 현재 언어로 표시
  const errText = (r) => t('err_' + (r.code || 'server')) + (r.detail ? ` (${r.detail})` : '');

  async function adminAction(action, extra) {
    try {
      const res = await fetch('api/admin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.assign({ password, action }, extra || {}))
      });
      const data = await res.json().catch(() => ({ ok: false, code: 'server', detail: String(res.status) }));
      if (res.status === 401) {
        try { sessionStorage.removeItem('snake_admin_pw'); } catch (e) { /* 무시 */ }
      }
      return data;
    } catch (e) {
      return { ok: false, code: 'network', detail: e.message };
    }
  }
  async function run(action, extra) {
    const r = await adminAction(action, extra);
    if (!r.ok) alert(t('failed', { msg: errText(r) }));
    return r;
  }

  async function login(pw) {
    password = pw;
    const r = await adminAction('check');
    if (!r.ok) { setGate('failed', { msg: errText(r) }); return; }
    try { sessionStorage.setItem('snake_admin_pw', pw); } catch (e) { /* 무시 */ }
    setGate(null);
    $('gate').classList.add('hidden');
    $('main').classList.remove('hidden');
    start();
  }
  $('gateForm').addEventListener('submit', (e) => {
    e.preventDefault();
    setGate('checking');
    login($('pw').value);
  });
  try {
    const saved = sessionStorage.getItem('snake_admin_pw');
    if (saved) login(saved);
  } catch (e) { /* 무시 */ }

  // 탭
  const TABS = { room: 'tabRoom', omok: 'tabOmok', practice: 'tabPractice' };
  function showTab(name) {
    for (const [k, id] of Object.entries(TABS)) {
      $(id).classList.toggle('hidden', name !== k);
      $(id + 'Btn').classList.toggle('active', name === k);
    }
  }
  for (const k of Object.keys(TABS)) $(TABS[k] + 'Btn').onclick = () => showTab(k);

  let db = null, serverOffset = 0;
  const now = () => Date.now() + serverOffset;

  function start() {
    firebase.initializeApp(cfg);
    db = firebase.database();
    if (new URLSearchParams(location.search).has('emu')) db.useEmulator('127.0.0.1', 9000);
    db.ref('.info/serverTimeOffset').on('value', (s) => { serverOffset = s.val() || 0; });
    startRooms();
    startPractice();
    // 오목 리그(omok-admin.js)도 같은 로그인/DB 를 사용
    window.dispatchEvent(new CustomEvent('adminstart', { detail: { db, now, run, fill, downloadCsv } }));
  }

  // ================= 연습 모드 =================
  function startPractice() {
    // 라운드 상태
    let locked = null;
    function renderStatus() {
      if (locked === null) return;
      $('status').textContent = t(locked ? 'statusLocked' : 'statusOpen');
      $('status').style.color = locked ? '#f87171' : '#4ade80';
    }
    db.ref('settings/locked').on('value', (s) => { locked = !!s.val(); renderStatus(); });
    $('openBtn').onclick = () => run('unlock');
    $('lockBtn').onclick = () => { if (confirm(t('confirmLock'))) run('lock'); };

    // 현재 접속자
    let players = {};
    db.ref('players').on('value', (s) => { players = s.val() || {}; });
    function renderLive() {
      const nowT = now();
      const list = Object.entries(players)
        .filter(([, v]) => v && nowT - (+v.t || 0) < 4000)
        .map(([sid, v]) => ({ sid, name: v.n || '', m: Math.floor(+v.m || 0) }))
        .sort((a, b) => b.m - a.m);
      $('liveCount').textContent = t('liveCount', { n: list.length });
      fill($('liveBody'), list.map((p, i) => [i + 1, p.sid, p.name, p.m]), [3]);
    }
    setInterval(renderLive, 1000);

    // 전체 순위
    let scores = [], sortKey = 'best';
    db.ref('scores').on('value', (s) => {
      scores = Object.entries(s.val() || {}).map(([sid, v]) => ({
        sid, name: (v && v.name) || '', best: +(v && v.best) || 0, kills: +(v && v.kills) || 0, games: +(v && v.games) || 0
      }));
      renderRank();
    });
    function sorted() {
      const other = sortKey === 'best' ? 'kills' : 'best';
      return scores.slice().sort((a, b) => b[sortKey] - a[sortKey] || b[other] - a[other]);
    }
    function renderRank() {
      const rows = sorted().map((v, i) => [i + 1, v.sid, v.name, v.best, v.kills, v.games]);
      fill($('rankBody'), rows, [3, 4, 5], true);
    }
    $('sortBest').onclick = () => { sortKey = 'best'; $('sortBest').classList.add('on'); $('sortKills').classList.remove('on'); renderRank(); };
    $('sortKills').onclick = () => { sortKey = 'kills'; $('sortKills').classList.add('on'); $('sortBest').classList.remove('on'); renderRank(); };

    addEventListener('langchange', () => { renderStatus(); renderLive(); });

    $('csvBtn').onclick = () => {
      const head = ['colRank', 'colSid', 'colName', 'colBest', 'colKills', 'colGames'].map((k) => t(k));
      const rows = [head].concat(sorted().map((v, i) => [i + 1, v.sid, v.name, v.best, v.kills, v.games]));
      downloadCsv(rows, 'snake_practice');
    };

    $('clearFood').onclick = () => { if (confirm(t('confirmFood'))) run('clearFood'); };
    $('clearScores').onclick = () => {
      if (confirm(t('confirmReset1')) && confirm(t('confirmReset2'))) run('resetScores');
    };
  }

  // ================= 대회 (게임방) =================
  const fmtTime = (ms) => {
    const sec = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  };

  function startRooms() {
    // 게임 만들기
    $('createForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const points = $('fPoints').value.split(/[,\s]+/).filter(Boolean).map(Number);
      if (!points.length || points.some((p) => !Number.isInteger(p) || p < 0 || p > 100)) { alert(t('badPoints')); return; }
      const btn = $('createForm').querySelector('button');
      btn.disabled = true;
      const r = await run('createRoom', {
        name: $('fName').value.trim(),
        rounds: Number($('fRounds').value),
        duration: Math.round(Number($('fDuration').value) * 60),
        points,
        killBonus: Number($('fKillBonus').value)
      });
      btn.disabled = false;
      if (r.ok) { $('fName').value = ''; selectRoom(r.code); }
    });

    // 게임 목록
    let index = {};
    let sel = null, refs = [], R = null, finishing = false;
    db.ref('roomIndex').on('value', (s) => { index = s.val() || {}; renderIndex(); });
    function renderIndex() {
      const tb = $('roomBody');
      tb.innerHTML = '';
      const list = Object.entries(index).sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
      $('noRooms').classList.toggle('hidden', list.length > 0);
      for (const [code, v] of list) {
        const tr = document.createElement('tr');
        if (code === sel) tr.className = 'sel';
        const cells = [code, v.name || '', v.rounds || '', new Date(v.createdAt || 0).toLocaleString()];
        cells.forEach((c, j) => { const td = document.createElement('td'); td.textContent = c; if (j === 2) td.className = 'num'; tr.appendChild(td); });
        const td = document.createElement('td');
        td.style.whiteSpace = 'nowrap';
        const open = document.createElement('button');
        open.className = 'small go'; open.textContent = t('open'); open.onclick = () => selectRoom(code);
        const del = document.createElement('button');
        del.className = 'small stop'; del.textContent = t('delete'); del.style.marginLeft = '6px';
        del.onclick = async () => {
          if (!confirm(t('confirmDelete', { code }))) return;
          const r = await run('deleteRoom', { code });
          if (r.ok && sel === code) selectRoom(null);
        };
        td.appendChild(open); td.appendChild(del);
        tr.appendChild(td);
        tb.appendChild(tr);
      }
    }

    // 선택한 게임방
    function selectRoom(code) {
      refs.forEach((r) => r.off());
      refs = [];
      sel = code;
      R = { meta: null, state: null, standings: {}, live: {}, liveKey: null, members: 0 };
      renderIndex();
      $('detail').classList.toggle('hidden', !code);
      if (!code) return;
      const ref = (p) => { const x = db.ref(`rooms/${code}/${p}`); refs.push(x); return x; };
      ref('meta').on('value', (s) => { R.meta = s.val(); renderDetail(); renderStandings(); });
      ref('state').on('value', (s) => {
        R.state = s.val();
        const rk = R.state && R.state.roundKey;
        if (rk && rk !== R.liveKey) {
          if (R.liveRef) R.liveRef.off();
          R.liveKey = rk;
          R.live = {};
          R.liveRef = ref(`roundScores/${rk}`);
          R.liveRef.on('value', (x) => { R.live = x.val() || {}; renderLiveRound(); });
        }
        renderDetail();
      });
      ref('standings').on('value', (s) => { R.standings = s.val() || {}; renderStandings(); });
      ref('members').on('value', (s) => { R.members = s.numChildren(); renderDetail(); });
      $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function phaseInfo() {
      const st = R.state || {}, meta = R.meta || {}, tt = now();
      if (st.phase === 'round') {
        if (tt < st.startAt) return { key: 'phCountdown', timer: fmtTime(st.startAt - tt) };
        if (tt < st.endAt) return { key: 'phRound', timer: fmtTime(st.endAt - tt) };
        return { key: 'phTally', timer: '0:00' };
      }
      if (st.phase === 'results') return { key: 'phResults', timer: '' };
      if (st.phase === 'finished') return { key: 'phFinished', timer: '' };
      return { key: 'phLobby', timer: meta.duration ? fmtTime(meta.duration * 1000) : '' };
    }

    function renderDetail() {
      if (!sel || !R || !R.meta) return;
      const st = R.state || {}, meta = R.meta;
      $('dCode').textContent = sel;
      $('dName').textContent = meta.name || '';
      const ph = phaseInfo();
      $('dPhase').textContent = t(ph.key, { r: st.round || 0, n: meta.rounds });
      $('dTimer').textContent = ph.timer;
      $('dInfo').textContent = t('roomInfo', {
        r: st.round || 0, n: meta.rounds, m: R.members,
        dur: fmtTime((meta.duration || 0) * 1000), pts: (meta.points || []).join(','), kb: meta.killBonus || 0
      });
      const canStart = (st.phase === 'lobby' || st.phase === 'results') && (st.round || 0) < meta.rounds;
      const sb = $('startRoundBtn');
      sb.disabled = !canStart;
      sb.classList.toggle('hidden', st.phase === 'finished');
      sb.textContent = t('startRoundN', { r: Math.min((st.round || 0) + 1, meta.rounds) });
      $('endNowBtn').disabled = !(st.phase === 'round' && now() < st.endAt);
      $('finishBtn').classList.toggle('hidden', !(st.phase === 'round' && now() > st.endAt + 8000));
      $('liveTitle').textContent = t('liveRound', { r: st.round || 0 });
    }

    function renderLiveRound() {
      if (!R) return;
      const rows = Object.entries(R.live || {})
        .map(([sid, v]) => ({ sid, name: (v && v.name) || '', best: Math.floor(+(v && v.best) || 0), kills: +(v && v.kills) || 0 }))
        .sort((a, b) => b.best - a.best || b.kills - a.kills);
      fill($('liveRoundBody'), rows.map((v, i) => [i + 1, v.sid, v.name, v.best, v.kills]), [3, 4], true);
    }

    // 동점이면 F1처럼 더 높은 라운드 성적(승점이 큰 라운드)이 많은 쪽이 앞
    function cmpStanding(a, b) {
      if (b.total !== a.total) return b.total - a.total;
      const pa = Object.values(a.r).sort((x, y) => y - x), pb = Object.values(b.r).sort((x, y) => y - x);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pb[i] || 0) !== (pa[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
      return a.name < b.name ? -1 : 1;
    }
    function standingsRows() {
      const n = (R.meta && R.meta.rounds) || 0;
      return Object.entries(R.standings || {})
        .map(([sid, v]) => ({ sid, name: (v && v.name) || '', total: +(v && v.total) || 0, r: (v && v.r) || {} }))
        .sort(cmpStanding)
        .map((v, i) => [i + 1, v.sid, v.name]
          .concat(Array.from({ length: n }, (_, k) => (v.r['r' + (k + 1)] != null ? v.r['r' + (k + 1)] : '-')), [v.total]));
    }
    function renderStandings() {
      if (!R) return;
      const n = (R.meta && R.meta.rounds) || 0;
      const head = document.createElement('tr');
      ['#', t('colSid'), t('colName')].concat(Array.from({ length: n }, (_, k) => 'R' + (k + 1)), [t('colTotal')]).forEach((h, j) => {
        const th = document.createElement('th'); th.textContent = h; if (j >= 3) th.className = 'num'; head.appendChild(th);
      });
      $('standHead').innerHTML = '';
      $('standHead').appendChild(head);
      const numCols = Array.from({ length: n + 1 }, (_, k) => k + 3);
      fill($('standBody'), standingsRows(), numCols, true);
    }

    $('startRoundBtn').onclick = async () => { $('startRoundBtn').disabled = true; await run('startRound', { code: sel }); renderDetail(); };
    $('endNowBtn').onclick = () => { if (confirm(t('confirmEndNow'))) run('endRoundNow', { code: sel }); };
    $('finishBtn').onclick = () => run('finishRound', { code: sel });
    $('boardBtn').onclick = () => window.open(`board?code=${sel}${location.search.includes('emu') ? '&emu=1' : ''}`, '_blank');
    $('roomCsvBtn').onclick = () => {
      const n = (R.meta && R.meta.rounds) || 0;
      const head = [t('colRank'), t('colSid'), t('colName')].concat(Array.from({ length: n }, (_, k) => 'R' + (k + 1)), [t('colTotal')]);
      downloadCsv([head].concat(standingsRows()), `snake_${sel}_${(R.meta && R.meta.name) || ''}`);
    };

    // 타이머 갱신 + 라운드 시간이 끝나면 자동 집계 (이 페이지가 열려 있어야 함)
    setInterval(async () => {
      if (!sel || !R || !R.state) return;
      renderDetail();
      const st = R.state;
      if (st.phase === 'round' && now() > st.endAt + 2500 && !finishing) {
        finishing = true;
        const r = await adminAction('finishRound', { code: sel });
        finishing = false;
        if (!r.ok && r.code !== 'round_not_over') console.warn('finishRound', r);
      }
    }, 500);

    addEventListener('langchange', () => { renderIndex(); renderDetail(); renderStandings(); renderLiveRound(); });
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
})();
