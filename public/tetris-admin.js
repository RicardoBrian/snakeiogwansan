// 관리자 페이지 — 🧱 테트리스 대전
Admin.register((() => {
  'use strict';
  let $, t, db, now, run, fill, downloadCsv, X;
  const C = window.TCOMMON;
  const STALE_MS = 6000;

  let rooms = {}, lobbyAll = {};
  let sel = null, refs = [];
  let boards = {}, entries = {}, results = {};
  const thumbEls = new Map();

  const room = () => (sel && rooms[sel]) || null;
  const game = () => (room() && room().game) || null;
  const sortedCodes = () => Object.keys(rooms).sort((a, b) => (+rooms[b].created || 0) - (+rooms[a].created || 0));
  const freshLobby = (code) => {
    const out = {}, lob = lobbyAll[code] || {}, nt = now();
    for (const sid of Object.keys(lob)) if (lob[sid] && nt - (+lob[sid].t || 0) < STALE_MS) out[sid] = lob[sid];
    return out;
  };
  function isLive() {
    const g = game();
    return !!g && !C.isFinished(g.id, g, entries[g.id], results[g.id], now());
  }
  // 목록 카드 상태 (선택한 방만 판 진행 여부를 정확히 앎)
  function badgeOf(code) {
    const g = rooms[code] && rooms[code].game;
    if (!g) return { text: t('tBadgeIdle'), tone: 'reg' };
    if (code === sel ? isLive() : !g.over && now() < +g.start + 600000) return { text: t('tBadgeLive', { no: g.no }), tone: 'live' };
    return { text: t('tBadgeDone', { no: g.no }), tone: 'wait' };
  }

  function renderList() {
    const codes = sortedCodes();
    $('tNoRooms').classList.toggle('hidden', codes.length > 0);
    X.cards($('tCards'), codes.map((code) => ({
      id: code,
      title: rooms[code].name || '',
      sub: t('tCardSub', { m: Object.keys(freshLobby(code)).length, date: X.date(rooms[code].created) }),
      badge: badgeOf(code)
    })), sel, (code) => X.go('rooms', code));
  }

  function show(mode, code) {
    $('tEmpty').classList.toggle('hidden', mode !== 'empty');
    $('tCreate').classList.toggle('hidden', mode !== 'create');
    $('tDetail').classList.toggle('hidden', mode !== 'detail');
    if (mode === 'create') { $('tName').value = ''; $('tName').focus(); }
    select(mode === 'detail' ? code : null);
  }

  function select(code) {
    if (code === sel && (refs.length || !code)) { renderList(); return; }
    refs.forEach((off) => off());
    refs = [];
    sel = code;
    boards = {}; entries = {}; results = {};
    thumbEls.forEach((el) => el.remove());
    thumbEls.clear();
    if (code) {
      const listen = (path, fn) => {
        const ref = db.ref(path), cb = (s) => fn(s.val() || {});
        ref.on('value', cb);
        refs.push(() => ref.off('value', cb));
      };
      listen(`tetris/boards/${code}`, (v) => { boards = v; renderThumbs(); });
      listen(`tetris/entries/${code}`, (v) => { entries = v; renderDetail(); });
      listen(`tetris/results/${code}`, (v) => { results = v; renderDetail(); });
    }
    renderList();
    renderDetail();
  }

  function renderDetail() {
    if (!room()) return;
    const r = room(), g = game();
    $('tCode').textContent = sel;
    $('tDName').textContent = r.name || '';
    X.badge($('tBadge'), badgeOf(sel));
    const m = Object.keys(freshLobby(sel)).length;
    $('tInfo').textContent = t('tInfoLine', { m, g: g ? g.no : 0 });
    let phase;
    if (!g) phase = t('tNextIdle', { code: sel, m });
    else {
      const e = entries[g.id] || {}, res = results[g.id] || {};
      if (!g.over && now() < g.start) phase = t('tNextCountdown', { no: g.no, s: Math.ceil((g.start - now()) / 1000) });
      else if (isLive()) phase = t('tNextPlaying', { no: g.no, a: C.aliveCount(e, res), n: Object.keys(e).length });
      else phase = t('tNextDone', { no: g.no, m });
    }
    $('tPhase').textContent = phase;
    $('tStopBtn').classList.toggle('hidden', !isLive());
    renderThumbs();
    renderStandings();
    renderLast();
  }

  // 실시간 보드
  function renderThumbs() {
    if (!room()) return;
    const g = game();
    const e = g ? entries[g.id] || {} : {}, r = g ? results[g.id] || {} : {};
    const present = freshLobby(sel);
    $('tLobbyCount').textContent = t('tInLobby', { n: Object.keys(present).length });
    for (const s of Object.keys(e)) present[s] = present[s] || { n: e[s].n };
    const sids = Object.keys(present).sort();
    for (const [s, el] of thumbEls) if (!present[s]) { el.remove(); thumbEls.delete(s); }
    const box = $('tThumbs');
    const cell = Math.max(8, Math.min(14, Math.floor(((box.clientWidth || 600) - 30) / 4 / 10)));
    const places = g ? C.placements(e, r) : [];
    const live = isLive();
    sids.forEach((sid) => {
      let el = thumbEls.get(sid);
      if (!el) {
        el = document.createElement('div');
        el.innerHTML = '<div class="tb"><canvas></canvas><b class="tstat"></b></div><span class="tname"></span>';
        thumbEls.set(sid, el);
      }
      box.appendChild(el); // 학번 순서 유지
      const bd = boards[sid];
      const b = bd && g && bd.g === g.id ? bd.b : '';
      const key = `${b}|${cell}`;
      if (el._key !== key) { el._key = key; C.drawThumb(el.querySelector('canvas'), b, cell); }
      el.querySelector('.tname').textContent = `${sid} ${(present[sid] && present[sid].n) || ''}`;
      let txt = '', cls = '';
      if (g && e[sid]) {
        const res = r[sid], p = places.find((x) => x.sid === sid);
        if (res && res.win) { txt = t('tWinner'); cls = 'win'; }
        else if (res && !res.stop) { txt = p ? t('tYouPlace', { n: p.place }) : 'KO'; cls = 'dead'; }
        else if (!live && p) txt = t('tYouPlace', { n: p.place });
      } else { txt = t(live ? 'tStatSpec' : 'tStatWait'); cls = 'idle'; }
      el.className = 'thumb' + (cls ? ' ' + cls : '');
      el.querySelector('.tstat').textContent = txt;
    });
  }

  // 누적 순위 / 지금(또는 가장 최근) 판 결과
  const standRows = () => C.standings(entries, results, game())
    .map((v, i) => [i + 1, v.sid, v.name, v.pts, v.wins, v.games, v.sent]);
  function renderStandings() { fill($('tStandBody'), standRows(), [3, 4, 5, 6], true); }
  function renderLast() {
    const g = game();
    const gids = Object.keys(entries).sort((a, b) => C.gameNo(a) - C.gameNo(b));
    const gid = g && entries[g.id] ? g.id : gids[gids.length - 1];
    if (!gid) { $('tLastTitle').textContent = t('tNoGame'); fill($('tLastBody'), [], []); return; }
    const e = entries[gid] || {}, r = results[gid] || {};
    const done = C.isFinished(gid, g, e, r, now()), n = Object.keys(e).length;
    $('tLastTitle').textContent = t('tLastGame', { no: C.gameNo(gid) });
    fill($('tLastBody'), C.placements(e, r).map((p) => [
      p.dead || done ? p.place : t('tAlive'), p.name, p.sent, p.lines, done && n >= 2 ? C.placePoints(p.place) : '-'
    ]), [2, 3, 4], done);
  }

  function startRooms() {
    db.ref('tetris/rooms').on('value', (s) => {
      rooms = s.val() || {};
      if (sel && !rooms[sel]) X.go('rooms', '');
      renderList();
      renderDetail();
    });
    db.ref('tetris/lobby').on('value', (s) => { lobbyAll = s.val() || {}; renderList(); renderDetail(); });
    // 카운트다운 초, 접속 끊긴 학생 정리
    setInterval(() => { if (room()) renderDetail(); }, 1000);

    $('tNewBtn').onclick = () => X.go('rooms', 'new');
    $('tCreateCancel').onclick = () => X.go('rooms', '');
    $('tCreateForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.querySelector('button[form="tCreateForm"]');
      btn.disabled = true;
      const r = await run('tetrisCreate', { name: $('tName').value.trim() });
      btn.disabled = false;
      if (r.ok) X.go('rooms', r.code);
    });

    $('tStartBtn').onclick = () => {
      if (isLive() && !confirm(t('tConfirmStartLive'))) return;
      run('tetrisStart', { code: sel });
    };
    $('tStopBtn').onclick = () => { if (confirm(t('tConfirmStop'))) run('tetrisStop', { code: sel }); };
    $('tResetBtn').onclick = () => { if (confirm(t('tConfirmReset'))) run('tetrisReset', { code: sel }); };
    $('tDeleteBtn').onclick = () => { if (confirm(t('tConfirmDelete'))) run('tetrisDelete', { code: sel }); };
    $('tLinkBtn').onclick = () => X.copyText(new URL('tetris?code=' + sel, location.href).href, $('tLinkBtn'));
    $('tCsvBtn').onclick = () => {
      const head = ['colRank', 'colSid', 'colName', 'tColPts', 'tColWins', 'colGames', 'tColSent'].map((k) => t(k));
      downloadCsv([head].concat(standRows()), `tetris_${sel}`);
    };
    addEventListener('langchange', () => { renderList(); renderDetail(); });
  }

  return {
    id: 'tetris', icon: '🧱', name: 'gTetris', path: 'tetris',
    views: [{ id: 'rooms', label: 'vTetrisRooms' }],
    start(ctx) {
      X = ctx;
      ({ $, t, db, now, run, fill, downloadCsv } = ctx);
      startRooms();
    },
    route(view, arg) {
      if (arg === 'new') show('create');
      else if (arg) show('detail', arg);
      else show('empty');
    }
  };
})());
