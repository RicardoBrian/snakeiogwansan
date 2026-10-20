// 전광판 (프로젝터용, 읽기 전용): board?code=1234
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const t = (k, p) => I18N.t(k, p);
  const fmtTime = (ms) => {
    const sec = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  };

  const cfg = window.FIREBASE_CONFIG || {};
  if (!cfg.databaseURL) { document.body.textContent = t('noConfig'); return; }

  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  if (!/^[0-9]{4}$/.test(code || '')) {
    $('pick').classList.remove('hidden');
    $('pick').addEventListener('submit', (e) => {
      e.preventDefault();
      params.set('code', $('pickCode').value.trim());
      location.search = params.toString();
    });
    return;
  }

  firebase.initializeApp(cfg);
  const db = firebase.database();
  if (params.has('emu')) db.useEmulator('127.0.0.1', 9000);
  let serverOffset = 0;
  const now = () => Date.now() + serverOffset;
  db.ref('.info/serverTimeOffset').on('value', (s) => { serverOffset = s.val() || 0; });

  const S = { meta: null, state: null, standings: {}, results: {}, live: {}, liveKey: null, members: 0, presence: {}, ready: {} };
  const ref = (p) => db.ref(`rooms/${code}/${p}`);
  ref('meta').on('value', (s) => { S.meta = s.val(); render(); });
  ref('state').on('value', (s) => {
    S.state = s.val();
    const rk = S.state && S.state.roundKey;
    if (rk && rk !== S.liveKey) {
      if (S.liveRef) S.liveRef.off();
      S.liveKey = rk;
      S.live = {};
      S.liveRef = ref(`roundScores/${rk}`);
      S.liveRef.on('value', (x) => { S.live = x.val() || {}; render(); });
    }
    render();
  });
  ref('standings').on('value', (s) => { S.standings = s.val() || {}; render(); });
  ref('roundResults').on('value', (s) => { S.results = s.val() || {}; render(); });
  ref('members').on('value', (s) => { S.members = s.numChildren(); render(); });
  ref('presence').on('value', (s) => { S.presence = s.val() || {}; render(); });
  ref('ready').on('value', (s) => { S.ready = s.val() || {}; render(); });
  // 다음 라운드 준비 현황 (접속 중인 학생 기준)
  function readyCount(X, tt) {
    const r = (X.state && X.state.roundKey && X.ready[X.state.roundKey]) || {};
    const online = Object.entries(X.presence || {}).filter(([, v]) => v && tt - (+v.t || 0) < 30000).map(([sid]) => sid);
    return { n: online.filter((sid) => r[sid] === true).length, m: online.length };
  }

  function table(id, head, rows, numFrom) {
    const tb = $(id);
    tb.innerHTML = '';
    const tr = document.createElement('tr');
    head.forEach((h, j) => { const th = document.createElement('th'); th.textContent = h; if (j >= numFrom) th.className = 'num'; tr.appendChild(th); });
    tb.appendChild(tr);
    rows.forEach((r, i) => {
      const row = document.createElement('tr');
      if (i < 3) row.className = 'top' + (i + 1);
      r.forEach((c, j) => { const td = document.createElement('td'); td.textContent = c; if (j >= numFrom) td.className = 'num'; row.appendChild(td); });
      tb.appendChild(row);
    });
  }

  // 동점이면 F1처럼 더 높은 라운드 성적(승점이 큰 라운드)이 많은 쪽이 앞
  function cmpStanding(a, b) {
    if (b.total !== a.total) return b.total - a.total;
    const pa = Object.values(a.r).sort((x, y) => y - x), pb = Object.values(b.r).sort((x, y) => y - x);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pb[i] || 0) !== (pa[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
    return a.name < b.name ? -1 : 1;
  }
  function standings() {
    return Object.entries(S.standings || {})
      .map(([sid, v]) => ({ sid, name: (v && v.name) || sid, total: +(v && v.total) || 0, r: (v && v.r) || {} }))
      .sort(cmpStanding);
  }

  function render() {
    $('view').classList.remove('hidden');
    if (!S.meta) {
      $('code').textContent = code;
      $('name').textContent = '';
      $('phase').textContent = t('errRoom');
      return;
    }
    const meta = S.meta, st = S.state || { phase: 'lobby', round: 0 }, tt = now();
    $('code').textContent = code;
    $('url').textContent = location.host;
    $('name').textContent = meta.name;

    let phaseKey = 'phLobby', timer = '', low = false;
    if (st.phase === 'round') {
      if (tt < st.startAt) { phaseKey = 'phCountdown'; timer = String(Math.max(1, Math.ceil((st.startAt - tt) / 1000))); }
      else if (tt < st.endAt) { phaseKey = 'phRound'; timer = fmtTime(st.endAt - tt); low = st.endAt - tt <= 10000; }
      else { phaseKey = 'phTally'; timer = '0:00'; }
    } else if (st.phase === 'results') { phaseKey = 'phResults'; if (st.nextAt) { timer = fmtTime(st.nextAt - tt); low = st.nextAt - tt <= 10000; } }
    else if (st.phase === 'finished') phaseKey = 'phFinished';
    $('phase').textContent = t(phaseKey, { r: st.round || 0, n: meta.rounds });
    $('sub').textContent = st.phase === 'results'
      ? t('boardReady', readyCount(S, tt))
      : t('boardSub', { m: S.members, n: meta.rounds, dur: fmtTime(meta.duration * 1000) });
    $('timer').textContent = timer;
    $('timer').classList.toggle('low', low);

    const stand = standings();
    const rk = st.roundKey;
    const results = rk && S.results[rk] ? Object.values(S.results[rk]) : [];

    // 왼쪽: 진행 중이면 실시간 라운드 순위, 결과 단계면 라운드 결과
    let left = null;
    if (st.phase === 'round') {
      const live = Object.entries(S.live || {})
        .map(([sid, v]) => ({ name: (v && v.name) || sid, best: Math.floor(+(v && v.best) || 0) }))
        .sort((a, b) => b.best - a.best).slice(0, 10);
      left = { title: t('liveRound', { r: st.round }), head: ['#', t('colName'), t('colBest')], rows: live.map((e, i) => [i + 1, e.name, e.best]), numFrom: 2 };
    } else if ((st.phase === 'results' || st.phase === 'finished') && results.length) {
      left = { title: t('roundResultTitle', { r: st.round }), head: ['#', t('colName'), t('colBest'), t('colPts')],
        rows: results.slice(0, 10).map((e) => [e.rank, e.name, e.best, '+' + e.pts]), numFrom: 2 };
    }
    $('leftBox').classList.toggle('hidden', !left);
    if (left) { $('leftTitle').textContent = left.title; table('leftTable', left.head, left.rows, left.numFrom); }

    const showStand = stand.length > 0 && st.round > 0;
    $('rightBox').classList.toggle('hidden', !showStand);
    if (showStand) table('rightTable', ['#', t('colName'), t('colTotal')], stand.slice(0, 15).map((e, i) => [i + 1, e.name, e.total]), 2);

    // 최종: 시상대
    const pod = $('podium');
    pod.classList.toggle('hidden', st.phase !== 'finished' || !stand.length);
    if (st.phase === 'finished') {
      pod.innerHTML = '';
      [1, 0, 2].forEach((i) => {
        const e = stand[i];
        if (!e) return;
        const d = document.createElement('div');
        d.className = 'p' + (i + 1);
        const b = document.createElement('b'); b.textContent = ['🥇', '🥈', '🥉'][i];
        const n = document.createElement('div'); n.className = 'n'; n.textContent = e.name;
        const sc = document.createElement('div'); sc.className = 's'; sc.textContent = t('ptsN', { n: e.total });
        d.append(b, n, sc);
        pod.appendChild(d);
      });
    }

    const msg = $('msg');
    const showMsg = st.phase === 'lobby';
    msg.classList.toggle('hidden', !showMsg);
    if (showMsg) msg.textContent = t('boardLobby', { m: S.members });
  }

  setInterval(render, 250);
  addEventListener('langchange', render);
})();
