// 관리자 페이지 — 오목 리그 탭 (로그인/DB 는 admin.js 가 준비한 것을 'adminstart' 로 받음)
addEventListener('adminstart', (ev) => {
  'use strict';
  const { db, now, run, fill, downloadCsv } = ev.detail;
  const $ = (id) => document.getElementById(id);
  const t = (k, p) => I18N.t(k, p);
  const C = OmokCore;

  // ----- 리그 만들기 -----
  $('oCreateForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('oCreateForm').querySelector('button');
    btn.disabled = true;
    const r = await run('omokCreate', {
      name: $('oName').value.trim(),
      moveTime: Number($('oMoveTime').value),
      win: Number($('oWin').value), draw: Number($('oDraw').value), loss: Number($('oLoss').value)
    });
    btn.disabled = false;
    if (r.ok) { $('oName').value = ''; select(r.code); }
  });

  // ----- 리그 목록 -----
  let index = {}, sel = null, refs = [], L = null, viewMid = null, viewRound = 0;
  db.ref('omokIndex').on('value', (s) => { index = s.val() || {}; renderList(); });
  function renderList() {
    const tb = $('oListBody');
    tb.innerHTML = '';
    const list = Object.entries(index).sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
    $('oNoLeagues').classList.toggle('hidden', list.length > 0);
    for (const [code, v] of list) {
      const tr = document.createElement('tr');
      if (code === sel) tr.className = 'sel';
      [code, v.name || '', new Date(v.createdAt || 0).toLocaleString()].forEach((c) => {
        const td = document.createElement('td'); td.textContent = c; tr.appendChild(td);
      });
      const td = document.createElement('td');
      td.style.whiteSpace = 'nowrap';
      td.appendChild(button(t('open'), 'small go', () => select(code)));
      const del = button(t('delete'), 'small stop', async () => {
        if (!confirm(t('confirmDelete', { code }))) return;
        const r = await run('omokDelete', { code });
        if (r.ok && sel === code) select(null);
      });
      del.style.marginLeft = '6px';
      td.appendChild(del);
      tr.appendChild(td);
      tb.appendChild(tr);
    }
  }

  function button(text, cls, onclick) {
    const b = document.createElement('button');
    b.className = cls; b.textContent = text; b.onclick = onclick;
    return b;
  }

  // ----- 선택한 리그 -----
  function select(code) {
    refs.forEach((r) => r.off());
    refs = [];
    sel = code; viewMid = null; viewRound = 0;
    L = { meta: null, state: null, members: {}, games: {}, byes: {} };
    renderList();
    $('oDetail').classList.toggle('hidden', !code);
    $('oViewer').classList.add('hidden');
    if (!code) return;
    const ref = (p) => { const x = db.ref(`omok/${code}/${p}`); refs.push(x); return x; };
    ref('meta').on('value', (s) => { L.meta = s.val(); render(); });
    ref('state').on('value', (s) => {
      const prev = L.state && L.state.round;
      L.state = s.val();
      // 새 라운드가 시작되면 그 라운드 대국을 보여 줌
      if (L.state && L.state.round !== prev) viewRound = L.state.round || 1;
      render();
    });
    ref('members').on('value', (s) => { L.members = C.obj(s.val()); render(); });
    ref('games').on('value', (s) => { L.games = s.val() || {}; render(); });
    ref('byes').on('value', (s) => { L.byes = s.val() || {}; render(); });
    $('oDetail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const nameOf = (sid) => (L.members[sid] && L.members[sid].name) || sid;
  const studentUrl = () => `${location.origin}${location.pathname.replace(/admin(\.html)?$/, '')}omok?code=${sel}`;
  const unfinished = (r) => Object.values(L.games['r' + r] || {}).filter((g) => g && !g.res).length;

  function render() {
    if (!sel || !L || !L.meta || !L.state) return;
    const meta = L.meta, st = L.state, n = meta.rounds || 0, m = Object.keys(L.members).length;
    $('oCode').textContent = sel;
    $('oDName').textContent = `${meta.name || ''} · ⏱ ${meta.moveTime}s · ${meta.win}/${meta.draw}/${meta.loss}`;
    $('oLink').textContent = t('oStudentLink', { url: studentUrl() });

    renderPhase();

    // 버튼
    const sb = $('oScheduleBtn');
    sb.classList.toggle('hidden', st.phase !== 'register' && st.phase !== 'ready');
    sb.textContent = t(st.phase === 'ready' ? 'oReshuffleBtn' : 'oScheduleBtn');
    sb.disabled = m < 2;
    $('oReopenBtn').classList.toggle('hidden', st.phase !== 'ready');
    const canStart = (st.phase === 'ready' || st.phase === 'results') && (st.round || 0) < n;
    $('oStartBtn').classList.toggle('hidden', !canStart);
    $('oStartBtn').textContent = t('oStartBtn', { r: (st.round || 0) + 1 });
    $('oEndBtn').classList.toggle('hidden', st.phase !== 'round');
    $('oEndBtn').textContent = t('oEndBtn', { r: st.round });

    renderGames();
    renderStandings();
    renderMembers();
  }

  function renderPhase() {
    const st = L.state, n = L.meta.rounds || 0, m = Object.keys(L.members).length;
    let ph;
    if (st.phase === 'register') ph = t('oPhRegister', { m });
    else if (st.phase === 'ready') ph = t('oPhReady', { m, n });
    else if (st.phase === 'round') {
      const total = Object.keys(L.games['r' + st.round] || {}).length;
      ph = now() < st.startAt ? t('oPhCountdown', { r: st.round, n })
        : t('oPhRound', { r: st.round, n, done: total - unfinished(st.round), total });
    } else if (st.phase === 'results') ph = t('oPhResults', { r: st.round, n });
    else ph = t('oPhFinished', { n });
    $('oPhase').textContent = ph;
  }

  // ----- 라운드별 대국 -----
  const resText = (g) => {
    if (!g.res) return g.at ? t('oLive') : '';
    const w = g.res === 'd' ? t('oResD') : g.res === 'b' ? `${t('oResB')} (${nameOf(g.b)})` : `${t('oResW')} (${nameOf(g.w)})`;
    return `${w} · ${t('oWhy_' + (g.why || 'admin'))}`;
  };

  function renderGames() {
    const n = L.meta.rounds || 0;
    const rs = $('oRoundSel');
    if (rs.options.length !== n || rs.dataset.lang !== I18N.lang) {
      rs.innerHTML = '';
      for (let i = 1; i <= n; i++) {
        const o = document.createElement('option');
        o.value = i; o.textContent = `${t('oColRound')} ${i}`;
        rs.appendChild(o);
      }
      rs.dataset.lang = I18N.lang;
    }
    if (!viewRound || viewRound > n) viewRound = Math.max(1, L.state.round || 1);
    rs.value = viewRound;
    rs.classList.toggle('hidden', !n);
    $('oNoSchedule').classList.toggle('hidden', n > 0);
    const rk = 'r' + viewRound;
    $('oByeText').textContent = L.byes[rk] ? t('oByeInfo', { name: nameOf(L.byes[rk]) }) : '';

    // 수가 놓일 때마다 표를 새로 만들면 열려 있는 "판정" 목록이 닫히므로, 대국 구성이 같으면 글자만 고침
    const tb = $('oGamesBody');
    const games = Object.entries(L.games[rk] || {}).sort((a, b) => Number(a[0].slice(1)) - Number(b[0].slice(1)));
    const key = `${sel}:${rk}:${games.map(([mid]) => mid).join()}:${I18N.lang}`;
    if (tb.dataset.key !== key) {
      tb.dataset.key = key;
      tb.innerHTML = '';
      for (const [mid] of games) tb.appendChild(gameRow(mid));
    }
    games.forEach(([mid, g], i) => {
      const tr = tb.children[i];
      tr.className = mid === viewMid ? 'sel' : '';
      tr.children[1].title = g.b; tr.children[2].title = g.w;
      [mid.slice(1), nameOf(g.b), nameOf(g.w), C.moves(g).length, resText(g)]
        .forEach((c, j) => { tr.children[j].textContent = c; });
    });

    const vg = viewMid && L.games[rk] && L.games[rk][viewMid];
    $('oViewer').classList.toggle('hidden', !vg);
    if (vg) {
      $('oViewerTitle').textContent = `${t('oViewer')} · R${viewRound} · ⚫ ${nameOf(vg.b)} vs ⚪ ${nameOf(vg.w)}`;
      C.drawBoard($('oViewerCv'), vg);
    }
  }
  function gameRow(mid) {
    const tr = document.createElement('tr');
    for (let j = 0; j < 5; j++) { const td = document.createElement('td'); if (j === 3) td.className = 'num'; tr.appendChild(td); }
    const td = document.createElement('td');
    td.style.whiteSpace = 'nowrap';
    td.appendChild(button(t('oView'), 'small', () => { viewMid = mid; render(); }));
    // 결과 직접 정하기
    const s = document.createElement('select');
    s.style.marginLeft = '6px';
    [['', t('oSetPh')], ['b', t('oResB')], ['w', t('oResW')], ['d', t('oResD')]].forEach(([v, txt]) => {
      const o = document.createElement('option'); o.value = v; o.textContent = txt; s.appendChild(o);
    });
    s.onchange = async () => {
      const res = s.value;
      s.value = '';
      const g = L.games['r' + viewRound] && L.games['r' + viewRound][mid];
      if (!res || !g) return;
      const label = res === 'd' ? t('oResD') : res === 'b' ? t('oResB') : t('oResW');
      if (!confirm(t('oConfirmSet', { r: viewRound, b: nameOf(g.b), w: nameOf(g.w), res: label }))) return;
      await run('omokSetResult', { code: sel, round: viewRound, mid, res });
    };
    td.appendChild(s);
    tr.appendChild(td);
    return tr;
  }
  $('oRoundSel').onchange = () => { viewRound = Number($('oRoundSel').value); viewMid = null; render(); };

  // ----- 순위 -----
  const table = () => C.standings(L.meta, L.members, L.games);
  function renderStandings() {
    fill($('oStandBody'), table().map((r) => [r.rank, r.sid, r.name, r.p, r.w, r.d, r.l, r.pts]), [3, 4, 5, 6, 7], true);
  }

  // ----- 등록한 학생 -----
  function renderMembers() {
    const list = Object.entries(L.members).sort((a, b) => (a[1].at || 0) - (b[1].at || 0));
    $('oMembersTitle').textContent = t('oMembers', { m: list.length });
    const tb = $('oMembersBody');
    tb.innerHTML = '';
    for (const [sid, v] of list) {
      const tr = document.createElement('tr');
      [sid, v.name || '', t(v.th ? 'oLoginOn' : 'oLoginOff')].forEach((c) => {
        const td = document.createElement('td'); td.textContent = c; tr.appendChild(td);
      });
      const td = document.createElement('td');
      td.style.whiteSpace = 'nowrap';
      if (v.th) {
        td.appendChild(button(t('oResetLogin'), 'small', () => {
          if (confirm(t('oConfirmResetLogin', { sid, name: v.name }))) run('omokResetLogin', { code: sel, sid });
        }));
      }
      if (L.state.phase === 'register') {
        const b = button(t('oRemove'), 'small stop', () => {
          if (confirm(t('oConfirmRemove', { sid, name: v.name }))) run('omokRemoveMember', { code: sel, sid });
        });
        b.style.marginLeft = '6px';
        td.appendChild(b);
      }
      tr.appendChild(td);
      tb.appendChild(tr);
    }
  }

  // ----- 진행 버튼 -----
  $('oScheduleBtn').onclick = async () => {
    const m = Object.keys(L.members).length;
    const n = m % 2 ? m : m - 1;
    if (!confirm(t('oConfirmSchedule', { m, n }))) return;
    $('oScheduleBtn').disabled = true;
    await run('omokSchedule', { code: sel });
    render();
  };
  $('oReopenBtn').onclick = () => { if (confirm(t('oConfirmReopen'))) run('omokReopen', { code: sel }); };
  $('oStartBtn').onclick = async () => {
    $('oStartBtn').disabled = true;
    await run('omokStartRound', { code: sel });
    $('oStartBtn').disabled = false;
  };
  $('oEndBtn').onclick = async () => {
    const r = L.state.round;
    if (!confirm(t('oConfirmEnd', { r, k: unfinished(r) }))) return;
    $('oEndBtn').disabled = true;
    await run('omokEndRound', { code: sel });
    $('oEndBtn').disabled = false;
  };

  // CSV: 순위 + 라운드별 상대/결과
  $('oCsvBtn').onclick = () => {
    const n = L.meta.rounds || 0;
    const head = [t('colRank'), t('colSid'), t('colName'), t('oColP'), t('oColW'), t('oColD'), t('oColL'), t('oColPts')]
      .concat(Array.from({ length: n }, (_, k) => 'R' + (k + 1)));
    const rows = table().map((r) => [r.rank, r.sid, r.name, r.p, r.w, r.d, r.l, r.pts].concat(Array.from({ length: n }, (_, k) => {
      const rk = 'r' + (k + 1);
      const g = Object.values(L.games[rk] || {}).find((x) => x && (x.b === r.sid || x.w === r.sid));
      if (!g) return L.byes[rk] === r.sid ? t('oBye') : '';
      const o = C.outcome(g, r.sid);
      const opp = g.b === r.sid ? g.w : g.b;
      return `${o ? t(o === 'w' ? 'oColW' : o === 'l' ? 'oColL' : 'oColD') : '-'} vs ${nameOf(opp)} (${t(g.b === r.sid ? 'oBlack' : 'oWhite')})`;
    })));
    downloadCsv([head].concat(rows), `omok_${sel}_${L.meta.name || ''}`);
  };

  // 진행 중 표시 갱신 (카운트다운 → 진행 중)
  setInterval(() => { if (L && L.state && L.state.phase === 'round' && L.meta) renderPhase(); }, 1000);
  addEventListener('langchange', () => { renderList(); render(); });
});
