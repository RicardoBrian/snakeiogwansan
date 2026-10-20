(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);

  const cfg = window.FIREBASE_CONFIG || {};
  if (!cfg.databaseURL) {
    $('gateErr').textContent = 'Firebase 설정이 없습니다. Cloudflare 환경변수 FIREBASE_DATABASE_URL 을 확인하세요.';
    return;
  }

  let password = '';

  async function adminAction(action) {
    try {
      const res = await fetch('api/admin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password, action })
      });
      const data = await res.json().catch(() => ({ ok: false, error: `서버 오류 (${res.status})` }));
      if (res.status === 401) {
        try { sessionStorage.removeItem('snake_admin_pw'); } catch (e) { /* 무시 */ }
      }
      return data;
    } catch (e) {
      return { ok: false, error: '서버에 연결할 수 없습니다: ' + e.message };
    }
  }
  async function run(action) {
    const r = await adminAction(action);
    if (!r.ok) alert('실패: ' + r.error);
  }

  async function login(pw) {
    password = pw;
    const r = await adminAction('check');
    if (!r.ok) { $('gateErr').textContent = r.error; return; }
    try { sessionStorage.setItem('snake_admin_pw', pw); } catch (e) { /* 무시 */ }
    $('gateErr').textContent = '';
    $('gate').classList.add('hidden');
    $('main').classList.remove('hidden');
    start();
  }
  $('gateForm').addEventListener('submit', (e) => {
    e.preventDefault();
    $('gateErr').textContent = '확인 중...';
    login($('pw').value);
  });
  try {
    const saved = sessionStorage.getItem('snake_admin_pw');
    if (saved) login(saved);
  } catch (e) { /* 무시 */ }

  function start() {
    firebase.initializeApp(cfg);
    const db = firebase.database();
    if (new URLSearchParams(location.search).has('emu')) db.useEmulator('127.0.0.1', 9000);

    let serverOffset = 0;
    db.ref('.info/serverTimeOffset').on('value', (s) => { serverOffset = s.val() || 0; });

    // 라운드 상태
    db.ref('settings/locked').on('value', (s) => {
      const locked = !!s.val();
      $('status').textContent = locked ? '⏸ 입장 잠금 (라운드 종료됨)' : '🟢 게임 진행 중 (입장 가능)';
      $('status').style.color = locked ? '#f87171' : '#4ade80';
    });
    $('openBtn').onclick = () => run('unlock');
    $('lockBtn').onclick = () => { if (confirm('라운드를 종료할까요? 게임 중인 학생들의 게임이 끝납니다.')) run('lock'); };

    // 현재 접속자
    let players = {};
    db.ref('players').on('value', (s) => { players = s.val() || {}; });
    function renderLive() {
      const t = Date.now() + serverOffset;
      const list = Object.entries(players)
        .filter(([, v]) => v && t - (+v.t || 0) < 4000)
        .map(([sid, v]) => ({ sid, name: v.n || '', m: Math.floor(+v.m || 0) }))
        .sort((a, b) => b.m - a.m);
      $('liveCount').textContent = `(${list.length}명)`;
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

    $('csvBtn').onclick = () => {
      const rows = [['순위', '학번', '이름', '최고점수', '처치', '판수']].concat(
        sorted().map((v, i) => [i + 1, v.sid, v.name, v.best, v.kills, v.games]));
      const csv = '﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      a.download = `snake_순위_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`;
      a.click();
    };

    $('clearFood').onclick = () => { if (confirm('맵의 먹이를 모두 지울까요? (게임 중인 학생이 있으면 자동으로 다시 생깁니다)')) run('clearFood'); };
    $('clearScores').onclick = () => {
      if (confirm('전체 기록을 초기화할까요? 되돌릴 수 없습니다.') && confirm('정말 초기화합니까?')) {
        run('resetScores');
      }
    };
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
