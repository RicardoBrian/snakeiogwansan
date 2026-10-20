// 관리자 페이지 — 🐍 뱀 게임 (대회 게임방 + 연습 모드)
Admin.register((() => {
  'use strict';
  let $, t, db, now, run, fill, downloadCsv, X;

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

  // 목록 카드와 상세에 같이 쓰는 상태 표시
  function phaseBadge(st, meta) {
    const ph = (st && st.phase) || 'lobby', r = (st && st.round) || 0, n = (meta && meta.rounds) || '?';
    if (ph === 'round') return { text: t('bRound', { r, n }), tone: 'live' };
    if (ph === 'results') return { text: t('bResults', { r, n }), tone: 'wait' };
    if (ph === 'finished') return { text: t('bFinished'), tone: 'done' };
    return { text: t('bLobby'), tone: 'reg' };
  }

  let index = {}, states = {}, stateRefs = {};
  let sel = null, mode = 'empty', refs = [], R = null, finishing = false;

  function startRooms() {
    // ----- 목록 (상태 표시를 위해 게임방마다 state 도 구독) -----
    db.ref('roomIndex').on('value', (s) => {
      index = s.val() || {};
      for (const code of Object.keys(stateRefs)) if (!index[code]) { stateRefs[code].off(); delete stateRefs[code]; delete states[code]; }
      for (const code of Object.keys(index)) {
        if (stateRefs[code]) continue;
        stateRefs[code] = db.ref(`rooms/${code}/state`);
        stateRefs[code].on('value', (x) => { states[code] = x.val(); renderList(); });
      }
      renderList();
      if (sel && !index[sel]) X.go('rooms', '');
    });

    $('sNewBtn').onclick = () => X.go('rooms', 'new');
    $('sCreateCancel').onclick = () => X.go('rooms', '');

    // ----- 만들기 -----
    $('createForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const points = $('fPoints').value.split(/[,\s]+/).filter(Boolean).map(Number);
      if (!points.length || points.some((p) => !Number.isInteger(p) || p < 0 || p > 100)) { alert(t('badPoints')); return; }
      const btn = document.querySelector('button[form="createForm"]');
      btn.disabled = true;
      const r = await run('createRoom', {
        name: $('fName').value.trim(),
        rounds: Number($('fRounds').value),
        duration: Math.round(Number($('fDuration').value) * 60),
        points,
        killBonus: Number($('fKillBonus').value)
      });
      btn.disabled = false;
      if (r.ok) { $('fName').value = ''; X.go('rooms', r.code); }
    });

    // ----- 상세 버튼 -----
    $('startRoundBtn').onclick = async () => { $('startRoundBtn').disabled = true; await run('startRound', { code: sel }); renderDetail(); };
    $('endNowBtn').onclick = () => { if (confirm(t('confirmEndNow'))) run('endRoundNow', { code: sel }); };
    $('finishBtn').onclick = () => run('finishRound', { code: sel });
    $('sLinkBtn').onclick = () => X.copyText(new URL('snake?room=' + sel, location.href).href, $('sLinkBtn'));
    $('boardBtn').onclick = () => window.open(`board?code=${sel}${X.emu ? '&emu=1' : ''}`, '_blank');
    $('roomCsvBtn').onclick = () => {
      const n = (R.meta && R.meta.rounds) || 0;
      const head = [t('colRank'), t('colSid'), t('colName')].concat(Array.from({ length: n }, (_, k) => 'R' + (k + 1)), [t('colTotal')]);
      downloadCsv([head].concat(standingsRows()), `snake_${sel}_${(R.meta && R.meta.name) || ''}`);
    };
    $('sDeleteBtn').onclick = async () => {
      if (!confirm(t('confirmDelete', { code: sel }))) return;
      const r = await run('deleteRoom', { code: sel });
      if (r.ok) X.go('rooms', '');
    };

    // 타이머 갱신 + 라운드 시간이 끝나면 자동 집계 (이 페이지가 열려 있어야 함, 다른 게임 화면을 보고 있어도 동작)
    setInterval(async () => {
      if (!sel || !R || !R.state) return;
      renderDetail();
      const st = R.state;
      if (st.phase === 'round' && now() > st.endAt + 2500 && !finishing) {
        finishing = true;
        const r = await X.adminAction('finishRound', { code: sel });
        finishing = false;
        if (!r.ok && r.code !== 'round_not_over') console.warn('finishRound', r);
      }
    }, 500);

    addEventListener('langchange', () => { renderList(); renderDetail(); renderStandings(); renderLiveRound(); });
  }

  function renderList() {
    const list = Object.entries(index).sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
    $('noRooms').classList.toggle('hidden', list.length > 0);
    X.cards($('roomCards'), list.map(([code, v]) => ({
      id: code, title: v.name || '',
      sub: `${t('listRounds', { n: v.rounds || '?' })} · ${X.date(v.createdAt)}`,
      badge: states[code] !== undefined ? phaseBadge(states[code], v) : null
    })), mode === 'detail' ? sel : null, (code) => X.go('rooms', code));
  }

  // 화면: empty(안내) | create(만들기) | detail(게임방)
  function show(m, code) {
    mode = m;
    $('sEmpty').classList.toggle('hidden', m !== 'empty');
    $('sCreate').classList.toggle('hidden', m !== 'create');
    $('detail').classList.toggle('hidden', m !== 'detail');
    if (m === 'create') $('fName').focus();
    selectRoom(m === 'detail' ? code : null);
    // 좁은 화면에선 목록 아래에 상세가 있으므로 그쪽으로 이동
    if (m !== 'empty' && innerWidth <= 1200) $('detail').parentElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    renderList();
  }

  function selectRoom(code) {
    if (code === sel) return;
    refs.forEach((r) => r.off());
    refs = [];
    sel = code;
    R = { meta: null, state: null, standings: {}, live: {}, liveKey: null, members: 0 };
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
  }

  function phaseInfo() {
    const st = R.state || {}, meta = R.meta || {}, tt = now(), r = st.round || 0, n = meta.rounds;
    if (st.phase === 'round') {
      if (tt < st.startAt) return { text: t('sNextCountdown', { r, n }), timer: fmtTime(st.startAt - tt) };
      if (tt < st.endAt) return { text: t('sNextRound', { r, n }), timer: fmtTime(st.endAt - tt) };
      return { text: t('phTally', { r, n }), timer: '0:00' };
    }
    if (st.phase === 'results') return { text: t('sNextResults', { r, n, next: r + 1 }), timer: '' };
    if (st.phase === 'finished') return { text: t('sNextFinished', { n }), timer: '' };
    return { text: t('sNextLobby', { m: R.members }), timer: meta.duration ? fmtTime(meta.duration * 1000) : '' };
  }

  function renderDetail() {
    if (!sel || !R || !R.meta) return;
    const st = R.state || {}, meta = R.meta;
    $('dCode').textContent = sel;
    $('dName').textContent = meta.name || '';
    X.badge($('dBadge'), phaseBadge(st, meta));
    const ph = phaseInfo();
    $('dPhase').textContent = ph.text;
    $('dTimer').textContent = ph.timer;
    $('dInfo').textContent = t('roomInfo', {
      r: st.round || 0, n: meta.rounds, m: R.members,
      dur: fmtTime((meta.duration || 0) * 1000), pts: (meta.points || []).join(','), kb: meta.killBonus || 0
    });
    const at = st.phase === 'finished' ? 3 : (st.phase === 'round' || st.phase === 'results') ? 1 : 0;
    X.steps($('sSteps'), [t('sStep1'), t('sStep2', { n: meta.rounds }), t('sStep3')], at);
    const canStart = (st.phase === 'lobby' || st.phase === 'results') && (st.round || 0) < meta.rounds;
    const sb = $('startRoundBtn');
    sb.disabled = !canStart;
    sb.classList.toggle('hidden', !canStart);
    sb.textContent = t('startRoundN', { r: Math.min((st.round || 0) + 1, meta.rounds) });
    $('endNowBtn').classList.toggle('hidden', !(st.phase === 'round' && now() < st.endAt));
    $('finishBtn').classList.toggle('hidden', !(st.phase === 'round' && now() > st.endAt + 8000));
    $('liveTitle').textContent = t('liveRound', { r: st.round || 0 });
    $('liveTitle').parentElement.classList.toggle('hidden', !st.round);
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

  return {
    id: 'snake', icon: '🐍', name: 'gSnake', path: 'snake',
    views: [{ id: 'rooms', label: 'vRooms' }, { id: 'practice', label: 'tabPractice' }],
    start(ctx) {
      X = ctx;
      ({ $, t, db, now, run, fill, downloadCsv } = ctx);
      startRooms();
      startPractice();
    },
    route(view, arg) {
      if (view !== 'rooms') return;
      if (arg === 'new') show('create');
      else if (arg) show('detail', arg);
      else show('empty');
    }
  };
})());
