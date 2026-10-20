(() => {
  'use strict';
  const C = window.TCOMMON;

  // ---------- 게임 설정 ----------
  const BW = 10, BH = 40, VIS = 20, TOP = BH - VIS; // 보드 40줄 중 아래 20줄만 보임
  const SPAWN_Y = TOP - 2;          // 블록은 보이는 칸 바로 위에서 나와 한 칸 내려옴
  const LOCK_DELAY = 500;           // 바닥에 닿은 뒤 굳기까지(ms)
  const MAX_RESETS = 15;            // 바닥에서 움직여 굳는 시간을 다시 늘릴 수 있는 횟수
  const MAX_LEVEL = 15;             // 방 설정(levelSec)마다 레벨 +1 (떨어지는 속도 증가)
  const PRESSURE_EVERY = 8;         // 방 설정(pressureFrom)부터 8초마다 아래에서 방해 줄 1줄 (0이면 없음)
  const ENTRY_GRACE = 2000;         // 시작 후 이 시간 안에 방에 있으면 참가 (보안 규칙은 3초)
  const STALE_MS = 6000, BEAT_MS = 2000;
  const HIDDEN_LIMIT = 3000;        // 다른 창으로 나가 있으면 탈락까지 시간(ms)
  const PUBLISH_GAP = 120;          // 내 보드 전송 최소 간격(ms)
  const ATTACK = { normal: [0, 0, 1, 2, 4], tspin: [0, 2, 4, 6], mini: [0, 0, 1] };
  const COMBO = [0, 0, 1, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5];
  const PC_BONUS = 10;
  const gravityMs = (lv) => Math.pow(0.8 - (lv - 1) * 0.007, lv - 1) * 1000; // 테트리스 가이드라인 속도표

  const ACTS = ['left', 'right', 'soft', 'hard', 'cw', 'ccw', 'r180', 'hold'];
  const DEFAULT_CFG = {
    das: 150, arr: 30, sdf: 20,
    keys: { left: ['ArrowLeft'], right: ['ArrowRight'], soft: ['ArrowDown'], hard: ['Space'],
      cw: ['ArrowUp', 'KeyX'], ccw: ['KeyZ'], r180: ['KeyA'], hold: ['KeyC', 'ShiftLeft'] }
  };

  // 블록 모양 (1 I, 2 J, 3 L, 4 O, 5 S, 6 T, 7 Z) — 회전 상태별 칸 목록을 미리 계산
  const SHAPES = {
    1: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
    2: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
    3: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
    4: [[1, 1], [1, 1]],
    5: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
    6: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
    7: [[1, 1, 0], [0, 1, 1], [0, 0, 0]]
  };
  const CELLS = {};
  for (const k of Object.keys(SHAPES)) {
    let m = SHAPES[k];
    CELLS[k] = [];
    for (let r = 0; r < 4; r++) {
      const cells = [];
      m.forEach((row, y) => row.forEach((v, x) => { if (v) cells.push([x, y]); }));
      CELLS[k].push(cells);
      m = m.map((row, y) => row.map((v, x) => m[m.length - 1 - x][y])); // 시계 방향 회전
    }
  }
  // SRS 벽 킥 표 (위쪽이 +y 인 원래 표 그대로, 쓸 때 y 부호를 뒤집음)
  const KICK_JLSTZ = {
    '01': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '10': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '12': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '21': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '23': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '32': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '30': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '03': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]]
  };
  const KICK_I = {
    '01': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '10': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '12': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    '21': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '23': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '32': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '30': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '03': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]]
  };
  const KICK_180 = [[0, 0], [0, 1], [1, 1], [-1, 1], [1, 0], [-1, 0]];

  const $ = (id) => document.getElementById(id);
  const t = (k, p) => I18N.t(k, p);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  // 같은 seed → 같은 난수 (모두 같은 블록 순서)
  function makeRng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let x = a;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- 설정 저장 ----------
  function loadCfg() {
    const c = JSON.parse(JSON.stringify(DEFAULT_CFG));
    try {
      const s = JSON.parse(localStorage.getItem('tetris_cfg') || 'null');
      if (s) {
        for (const k of ['das', 'arr', 'sdf']) if (typeof s[k] === 'number') c[k] = s[k];
        if (s.keys) for (const a of ACTS) if (Array.isArray(s.keys[a])) c.keys[a] = s.keys[a].filter((x) => typeof x === 'string');
      }
    } catch (e) { /* 저장소 사용 불가 */ }
    return c;
  }
  let cfg = loadCfg();
  function saveCfg() { try { localStorage.setItem('tetris_cfg', JSON.stringify(cfg)); } catch (e) { /* 무시 */ } }

  // ---------- Firebase 초기화 ----------
  const fbCfg = window.FIREBASE_CONFIG || {};
  if (!fbCfg.databaseURL) {
    const showNoConfig = () => { $('loginError').textContent = t('noConfig'); };
    showNoConfig();
    addEventListener('langchange', showNoConfig);
    $('joinBtn').disabled = true;
    return;
  }
  firebase.initializeApp(fbCfg);
  const db = firebase.database();
  if (new URLSearchParams(location.search).has('emu')) db.useEmulator('127.0.0.1', 9000);
  const SV = firebase.database.ServerValue;

  let serverOffset = 0;
  const now = () => Date.now() + serverOffset;
  db.ref('.info/serverTimeOffset').on('value', (s) => { serverOffset = s.val() || 0; });

  // ---------- 상태 ----------
  let profile = { sid: '', name: '' };
  let rooms = {}, lobbyAll = {};
  let selectedRid = '';
  let rid = null, room = null;        // 들어가 있는 방
  let boards = {}, entries = {}, results = {};
  let G = null;                       // 내 게임 (판이 끝나도 다음 판 전까지 화면에 남김)
  let seenKey = null;                 // 마지막으로 본 판 (id@start)
  let subs = [], beatTimer = null, hiddenTimer = null;
  let loginMsg = null;
  let rulesErr = false;               // Firebase 보안 규칙이 아직 게시되지 않아 쓰기가 막힘
  const denied = (e) => /permission/i.test(String((e && (e.code || e.message)) || ''));
  let connected = false;

  function setLoginError(key, params) { loginMsg = key ? { key, params } : null; renderTexts(); }
  function renderTexts() {
    $('connText').textContent = t(connected ? 'connected' : 'connecting');
    $('loginError').textContent = loginMsg ? t(loginMsg.key, loginMsg.params) : '';
  }
  addEventListener('langchange', () => {
    renderTexts(); renderRooms(); renderHelp(); renderStatus(); scheduleSide();
    if (!$('settings').classList.contains('hidden')) renderKeyList();
  });
  db.ref('.info/connected').on('value', (s) => { connected = !!s.val(); renderTexts(); });
  renderTexts();

  let toastTimer = null;
  function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  // ---------- 방 목록 (로그인 화면) ----------
  db.ref('tetris/rooms').on('value', (s) => { rooms = s.val() || {}; renderRooms(); });
  db.ref('tetris/lobby').on('value', (s) => { lobbyAll = s.val() || {}; renderRooms(); scheduleSide(); });
  try { selectedRid = localStorage.getItem('tetris_room') || ''; } catch (e) { /* 무시 */ }
  // 관리자가 복사해 준 입장 링크(?code=1234)면 그 방을 골라 둠
  const linkCode = new URLSearchParams(location.search).get('code');
  if (/^[0-9]{4}$/.test(linkCode || '')) selectedRid = linkCode;

  const freshLobby = (r) => {
    const out = {}, lob = lobbyAll[r] || {}, nt = now();
    for (const sid of Object.keys(lob)) if (lob[sid] && nt - (+lob[sid].t || 0) < STALE_MS) out[sid] = lob[sid];
    return out;
  };

  function renderRooms() {
    const box = $('roomList');
    box.innerHTML = '';
    const ids = Object.keys(rooms).sort((a, b) => (+rooms[a].created || 0) - (+rooms[b].created || 0));
    if (!rooms[selectedRid]) selectedRid = ids.length === 1 ? ids[0] : '';
    if (!ids.length) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = t('tNoRooms');
      box.appendChild(p);
    }
    for (const id of ids) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'roomBtn' + (id === selectedRid ? ' sel' : '');
      const nm = document.createElement('b');
      nm.textContent = `${id} ${rooms[id].name || ''}`;
      const info = document.createElement('span');
      const g = rooms[id].game;
      info.textContent = t('tRoomInfo', { n: Object.keys(freshLobby(id)).length }) + (g ? ' · ' + t('tRoomGames', { no: g.no }) : '');
      b.append(nm, info);
      b.addEventListener('click', () => {
        selectedRid = id;
        try { localStorage.setItem('tetris_room', id); } catch (e) { /* 무시 */ }
        renderRooms();
      });
      box.appendChild(b);
    }
  }

  // ---------- 로그인 ----------
  try {
    $('sidInput').value = localStorage.getItem('snake_sid') || '';
    $('nameInput').value = localStorage.getItem('snake_name') || '';
  } catch (e) { /* 저장소 사용 불가 */ }

  $('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const sid = $('sidInput').value.trim();
    const name = $('nameInput').value.trim();
    if (!/^[0-9A-Za-z]{1,12}$/.test(sid)) { setLoginError('errSid'); return; }
    if (!name || name.length > 10) { setLoginError('errName'); return; }
    if (!connected) { setLoginError('errConnecting'); return; }
    if (!rooms[selectedRid]) { setLoginError(Object.keys(rooms).length ? 'tErrRoom' : 'tNoRooms'); return; }
    for (const r of Object.keys(lobbyAll)) if (freshLobby(r)[sid]) { setLoginError('errDup'); return; }
    try { localStorage.setItem('snake_sid', sid); localStorage.setItem('snake_name', name); } catch (e2) { /* 무시 */ }
    setLoginError(null);
    profile = { sid, name };
    enterRoom(selectedRid);
  });

  // ---------- 방 입장 / 퇴장 ----------
  function listen(ref, ev, fn) { ref.on(ev, fn); subs.push(() => ref.off(ev, fn)); }

  function enterRoom(r) {
    rid = r; room = rooms[r] || null; seenKey = null; G = null;
    boards = {}; entries = {}; results = {};
    const sid = profile.sid;
    const lref = db.ref(`tetris/lobby/${rid}/${sid}`);
    lref.onDisconnect().remove();
    db.ref(`tetris/boards/${rid}/${sid}`).onDisconnect().remove();
    const beat = () => lref.set({ n: profile.name, t: SV.TIMESTAMP })
      .then(() => { if (rulesErr) { rulesErr = false; renderStatus(); } })
      .catch((e) => { if (denied(e)) { rulesErr = true; renderStatus(); } });
    beat();
    beatTimer = setInterval(beat, BEAT_MS);

    listen(db.ref(`tetris/rooms/${rid}`), 'value', onRoom);
    listen(db.ref(`tetris/boards/${rid}`), 'value', (s) => { boards = s.val() || {}; scheduleSide(); });
    listen(db.ref(`tetris/entries/${rid}`), 'value', (s) => { entries = s.val() || {}; onGameData(); });
    listen(db.ref(`tetris/results/${rid}`), 'value', (s) => { results = s.val() || {}; onGameData(); });
    listen(db.ref(`tetris/attacks/${rid}/${sid}`), 'child_added', onAttack);

    $('meName').textContent = `${sid} ${profile.name}`;
    $('login').classList.add('hidden');
    $('room').classList.remove('hidden');
    if (document.activeElement) document.activeElement.blur();
    resize();
    renderHelp();
  }

  function leaveRoom(msgKey) {
    if (!rid) return;
    if (G && G.alive) die('tLeftGame');
    if (G) db.ref(`tetris/results/${rid}/${G.gid}/${profile.sid}`).onDisconnect().cancel();
    subs.forEach((off) => off());
    subs = [];
    clearInterval(beatTimer);
    clearTimeout(hiddenTimer);
    const lref = db.ref(`tetris/lobby/${rid}/${profile.sid}`), bref = db.ref(`tetris/boards/${rid}/${profile.sid}`);
    lref.onDisconnect().cancel(); bref.onDisconnect().cancel();
    lref.remove().catch(() => {}); bref.remove().catch(() => {});
    rid = null; room = null; G = null;
    thumbEls.forEach((el) => el.remove());
    thumbEls.clear();
    $('room').classList.add('hidden');
    $('login').classList.remove('hidden');
    setLoginError(msgKey || null);
    renderRooms();
  }
  $('leaveBtn').addEventListener('click', () => {
    if (G && G.alive && !confirm(t('tConfirmLeave'))) return;
    leaveRoom(null);
  });

  // ---------- 판 진행 ----------
  function onRoom(s) {
    const v = s.val();
    if (!v) { leaveRoom('tRoomGone'); return; }
    room = v;
    $('roomName').textContent = v.name || '';
    const game = v.game || null;
    const key = game ? `${game.id}@${game.start}` : null;
    // 판이 바뀌었거나(새 판/초기화) 관리자가 끝냈으면 내 판 종료
    if (G && G.alive && (!game || game.id !== G.gid || game.over)) finishMine('stop');
    if (game && key !== seenKey) {
      seenKey = key;
      if (!game.over && now() < game.start + ENTRY_GRACE) joinGame(game, key);
    }
    onGameData();
  }

  function joinGame(game, key) {
    const gid = game.id, sid = profile.sid;
    db.ref(`tetris/entries/${rid}/${gid}/${sid}`).set({ n: profile.name }).then(() => {
      if (seenKey !== key || !rid) return;
      G = newGame(game);
      db.ref(`tetris/results/${rid}/${gid}/${sid}`).onDisconnect().set({ t: SV.TIMESTAMP, dc: 1 });
      resetInput();
      publish(true);
      renderStatus();
    }).catch((e) => {
      // 늦게 들어오면 보안 규칙에 막힘 → 이번 판은 관전. 시간 안인데 막혔으면 규칙이 게시되지 않은 것
      if (denied(e) && now() < game.start) rulesErr = true;
      renderStatus();
    });
  }

  function newGame(game) {
    const g = {
      gid: game.id, start: +game.start, rng: makeRng(+game.seed || 1), bag: [], queue: [],
      board: new Uint8Array(BW * BH), cur: null, hold: 0, held: false,
      alive: true, started: false, endKey: null, endAt: 0,
      lastRot: false, lastKick: 0, b2b: false, combo: -1,
      incoming: [], sent: 0, lines: 0, pieces: 0,
      lockT: 0, resets: 0, lowY: 0, fallAcc: 0, level: 1,
      levelSec: C.roomOpts(room).levelSec, nextPressure: C.roomOpts(room).pressureFrom || Infinity,
      action: null, lastPub: 0, pubTimer: null
    };
    fillQueue(g);
    return g;
  }
  function fillQueue(g) {
    while (g.queue.length < 6) {
      if (!g.bag.length) {
        g.bag = [1, 2, 3, 4, 5, 6, 7];
        for (let i = 6; i > 0; i--) { const j = Math.floor(g.rng() * (i + 1)); [g.bag[i], g.bag[j]] = [g.bag[j], g.bag[i]]; }
      }
      g.queue.push(g.bag.shift());
    }
  }

  // 참가자/결과가 바뀔 때: 마지막 생존자면 1위 기록
  function onGameData() {
    if (G && G.alive && G.started) {
      const e = entries[G.gid] || {}, r = results[G.gid] || {};
      if (Object.keys(e).length >= 2 && e[profile.sid] && !r[profile.sid] && C.aliveCount(e, r) <= 1) finishMine('win');
    }
    renderStatus();
    scheduleSide();
  }

  function writeResult(extra) {
    const ref = db.ref(`tetris/results/${rid}/${G.gid}/${profile.sid}`);
    ref.onDisconnect().cancel();
    ref.set(Object.assign({ t: SV.TIMESTAMP, sent: G.sent, lines: G.lines, pieces: G.pieces }, extra)).catch(() => {});
  }
  function die(key) {
    if (!G || !G.alive) return;
    G.alive = false; G.cur = null; G.endKey = key; G.endAt = now();
    clearTimeout(hiddenTimer);
    writeResult({});
    publish(true);
    renderStatus();
  }
  function finishMine(kind) {
    if (!G || !G.alive) return;
    G.alive = false; G.cur = null; G.endAt = now();
    G.endKey = kind === 'win' ? null : 'tStopped';
    clearTimeout(hiddenTimer);
    writeResult(kind === 'win' ? { win: 1 } : { stop: 1 });
    publish(true);
    renderStatus();
  }

  // ---------- 블록 조작 ----------
  function collide(type, rot, x, y) {
    for (const [cx, cy] of CELLS[type][rot]) {
      const X = x + cx, Y = y + cy;
      if (X < 0 || X >= BW || Y < 0 || Y >= BH) return true;
      if (G.board[Y * BW + X]) return true;
    }
    return false;
  }
  const grounded = () => collide(G.cur.type, G.cur.rot, G.cur.x, G.cur.y + 1);

  function spawn(type) {
    if (!type) { type = G.queue.shift(); fillQueue(G); }
    G.cur = { type, rot: 0, x: type === 4 ? 4 : 3, y: SPAWN_Y };
    G.lastRot = false; G.lockT = 0; G.resets = 0; G.fallAcc = 0;
    if (collide(type, 0, G.cur.x, G.cur.y)) { die('tDeathTop'); return; }
    if (!collide(type, 0, G.cur.x, G.cur.y + 1)) G.cur.y++;
    G.lowY = G.cur.y;
  }

  // 움직일 때마다 굳는 시간 초기화 (더 내려가면 횟수도 초기화)
  function moved(isDown) {
    if (G.cur.y > G.lowY) { G.lowY = G.cur.y; G.resets = 0; G.lockT = 0; }
    else if (!isDown && G.resets < MAX_RESETS) { G.resets++; G.lockT = 0; }
  }
  function tryMove(dx, dy) {
    const c = G.cur;
    if (!c || collide(c.type, c.rot, c.x + dx, c.y + dy)) return false;
    c.x += dx; c.y += dy;
    G.lastRot = false;
    moved(dy > 0);
    return true;
  }
  function rotate(dir) {
    const c = G.cur;
    if (!c || c.type === 4) return;
    const to = (c.rot + dir + 4) % 4;
    const kicks = dir === 2 ? KICK_180 : (c.type === 1 ? KICK_I : KICK_JLSTZ)[`${c.rot}${to}`];
    for (let i = 0; i < kicks.length; i++) {
      const nx = c.x + kicks[i][0], ny = c.y - kicks[i][1];
      if (!collide(c.type, to, nx, ny)) {
        c.x = nx; c.y = ny; c.rot = to;
        G.lastRot = true; G.lastKick = i;
        moved(false);
        return;
      }
    }
  }
  function holdPiece() {
    if (!G.cur || G.held) return;
    const type = G.cur.type, prev = G.hold;
    G.hold = type;
    spawn(prev || 0);
    G.held = true;
  }
  function hardDrop() {
    if (!G.cur) return;
    while (tryMove(0, 1));
    lockPiece();
  }
  const occupied = (x, y) => x < 0 || x >= BW || y < 0 || y >= BH || !!G.board[y * BW + x];

  function lockPiece() {
    const c = G.cur;
    // T-스핀: 마지막 동작이 회전이고 T 주변 네 모서리 중 3곳 이상이 막힘
    let spin = null;
    if (c.type === 6 && G.lastRot) {
      const f = [[0, 0], [2, 0], [2, 2], [0, 2]].map(([dx, dy]) => occupied(c.x + dx, c.y + dy));
      if (f.filter(Boolean).length >= 3) {
        const front = f[c.rot] && f[(c.rot + 1) % 4];
        spin = front || G.lastKick === 4 ? 'tspin' : 'mini';
      }
    }
    let lockOut = true;
    for (const [cx, cy] of CELLS[c.type][c.rot]) {
      G.board[(c.y + cy) * BW + c.x + cx] = c.type;
      if (c.y + cy >= TOP) lockOut = false;
    }
    // 줄 지우기
    let cleared = 0, w = BH - 1;
    for (let y = BH - 1; y >= 0; y--) {
      let full = true;
      for (let x = 0; x < BW; x++) if (!G.board[y * BW + x]) { full = false; break; }
      if (full) { cleared++; continue; }
      if (w !== y) G.board.copyWithin(w * BW, y * BW, y * BW + BW);
      w--;
    }
    if (cleared) G.board.fill(0, 0, (w + 1) * BW);
    G.pieces++;
    G.cur = null;
    if (lockOut && !cleared) { die('tDeathTop'); return; }

    // 공격 계산
    let atk = 0;
    const labels = [];
    if (spin) labels.push(spin === 'mini' ? 'T-SPIN MINI' : 'T-SPIN');
    if (cleared) {
      G.combo++;
      G.lines += cleared;
      atk = (ATTACK[spin || 'normal'][cleared]) || 0;
      if (!spin) labels.push(['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'TETRIS'][cleared]);
      else labels[0] += ' ' + ['', 'SINGLE', 'DOUBLE', 'TRIPLE'][cleared];
      if (cleared === 4 || spin) {
        if (G.b2b) { atk += 1; labels.push('BACK-TO-BACK'); }
        G.b2b = true;
      } else G.b2b = false;
      atk += COMBO[Math.min(G.combo, COMBO.length - 1)];
      if (G.combo >= 1) labels.push(`${G.combo} COMBO`);
      if (G.board.every((v) => !v)) { atk += PC_BONUS; labels.push('PERFECT CLEAR'); }
    } else G.combo = -1;
    if (labels.length) G.action = { labels, atk, at: performance.now() };

    if (atk > 0) {
      // 받을 방해 줄과 먼저 상쇄
      while (atk > 0 && G.incoming.length) {
        const g = G.incoming[0], k = Math.min(g.l, atk);
        g.l -= k; atk -= k;
        if (!g.l) G.incoming.shift();
      }
      if (atk > 0) sendAttack(atk);
    }
    if (!cleared && G.incoming.length) {
      let ok = true;
      for (const g of G.incoming) ok = addGarbage(g.l, g.h) && ok;
      G.incoming = [];
      if (!ok) { die('tDeathTop'); return; }
    }
    G.held = false;
    spawn();
    publish();
  }

  function addGarbage(n, hole) {
    let ok = true;
    for (let i = 0; i < n * BW; i++) if (G.board[i]) { ok = false; break; }
    G.board.copyWithin(0, n * BW);
    for (let y = BH - n; y < BH; y++) for (let x = 0; x < BW; x++) G.board[y * BW + x] = x === hole ? 0 : 8;
    return ok;
  }

  function sendAttack(lines) {
    G.sent += lines;
    const e = entries[G.gid] || {}, r = results[G.gid] || {};
    const targets = Object.keys(e).filter((s) => s !== profile.sid && !r[s]);
    if (!targets.length) return;
    const to = targets[Math.floor(Math.random() * targets.length)];
    db.ref(`tetris/attacks/${rid}/${to}`).push({ l: Math.min(20, lines), g: G.gid, f: profile.name });
  }
  function onAttack(s) {
    const v = s.val() || {};
    s.ref.remove();
    if (!G || !G.alive || !G.started || String(v.g) !== G.gid) return;
    G.incoming.push({ l: clamp(Math.floor(+v.l) || 1, 1, 20), h: Math.floor(Math.random() * BW) });
  }

  // 내 보드를 다른 학생/관리자 썸네일용으로 전송 (보이는 20줄만)
  function publish(force) {
    if (!G || !rid) return;
    const tn = performance.now();
    clearTimeout(G.pubTimer);
    if (!force && tn - G.lastPub < PUBLISH_GAP) {
      G.pubTimer = setTimeout(() => publish(true), PUBLISH_GAP - (tn - G.lastPub));
      return;
    }
    G.lastPub = tn;
    let b = '';
    for (let i = TOP * BW; i < BH * BW; i++) b += G.board[i];
    db.ref(`tetris/boards/${rid}/${profile.sid}`).set({
      n: profile.name, g: G.gid, b, d: G.alive ? 0 : 1, i: G.incoming.reduce((a, g) => a + g.l, 0), t: SV.TIMESTAMP
    }).catch(() => {});
  }

  // ---------- 입력 ----------
  const held = { left: false, right: false, soft: false };
  let dasDir = 0, dasT = 0, arrT = 0, waitKey = null;
  function resetInput() { held.left = held.right = held.soft = false; dasDir = 0; dasT = 0; arrT = 0; }
  const playing = () => G && G.alive && G.started && G.cur;

  function press(act) {
    if (act === 'left' || act === 'right') {
      held[act] = true;
      dasDir = act === 'left' ? -1 : 1; dasT = 0; arrT = 0;
      if (playing()) tryMove(dasDir, 0);
      return;
    }
    if (act === 'soft') { held.soft = true; return; }
    if (!playing()) return;
    if (act === 'hard') hardDrop();
    else if (act === 'cw') rotate(1);
    else if (act === 'ccw') rotate(-1);
    else if (act === 'r180') rotate(2);
    else if (act === 'hold') holdPiece();
  }
  function release(act) {
    if (act === 'left' || act === 'right') {
      held[act] = false;
      const d = act === 'left' ? -1 : 1;
      if (dasDir === d) { dasDir = held.left ? -1 : held.right ? 1 : 0; dasT = 0; arrT = 0; }
    } else if (act === 'soft') held.soft = false;
  }
  function actionOf(code) {
    for (const a of ACTS) if (cfg.keys[a].includes(code)) return a;
    return null;
  }

  addEventListener('keydown', (e) => {
    if (waitKey) {
      e.preventDefault();
      if (e.code !== 'Escape') {
        for (const a of ACTS) cfg.keys[a] = cfg.keys[a].filter((k) => k !== e.code);
        cfg.keys[waitKey] = [e.code];
        saveCfg();
        renderHelp();
      }
      waitKey = null;
      renderKeyList();
      return;
    }
    if (!rid || !$('settings').classList.contains('hidden')) return;
    if (e.target && e.target.tagName === 'INPUT') return;
    const act = actionOf(e.code);
    if (!act) return;
    e.preventDefault();
    if (!e.repeat) press(act);
  });
  addEventListener('keyup', (e) => {
    const act = actionOf(e.code);
    if (act) { release(act); if (rid) e.preventDefault(); }
  });
  addEventListener('blur', resetInput);
  document.addEventListener('visibilitychange', () => {
    clearTimeout(hiddenTimer);
    if (document.hidden && G && G.alive) hiddenTimer = setTimeout(() => die('deathHidden'), HIDDEN_LIMIT);
  });

  // 터치 버튼
  if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
  document.querySelectorAll('#touchPad button').forEach((b) => {
    const act = b.dataset.act;
    let pid = null;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); pid = e.pointerId; b.classList.add('active'); press(act); });
    const up = (e) => { if (e.pointerId !== pid) return; pid = null; b.classList.remove('active'); release(act); };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('pointerleave', up);
  });
  addEventListener('contextmenu', (e) => { if (rid) e.preventDefault(); });

  // ---------- 설정 화면 ----------
  const keyLabel = (code) => ({ ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: 'Space' })[code] ||
    code.replace(/^Key|^Digit/, '').replace(/(Left|Right)$/, '').replace('Control', 'Ctrl');
  function renderHelp() {
    $('help').textContent = document.body.classList.contains('touch') ? '' :
      ACTS.map((a) => `${t('k_' + a)} ${cfg.keys[a].map(keyLabel).join('/') || '-'}`).join(' · ');
  }
  function renderKeyList() {
    const box = $('keyList');
    box.innerHTML = '';
    for (const a of ACTS) {
      const row = document.createElement('div');
      row.className = 'keyRow';
      const lb = document.createElement('span');
      lb.textContent = t('k_' + a);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ghost' + (waitKey === a ? ' wait' : '');
      b.textContent = waitKey === a ? t('tPressKey') : (cfg.keys[a].map(keyLabel).join(' / ') || '-');
      b.addEventListener('click', () => { waitKey = a; renderKeyList(); b.blur(); });
      row.append(lb, b);
      box.appendChild(row);
    }
  }
  function openSettings() {
    resetInput();
    $('cfgDas').value = cfg.das; $('cfgArr').value = cfg.arr; $('cfgSdf').value = cfg.sdf;
    waitKey = null;
    renderKeyList();
    $('settings').classList.remove('hidden');
  }
  for (const [id, k, max] of [['cfgDas', 'das', 500], ['cfgArr', 'arr', 200], ['cfgSdf', 'sdf', 500]]) {
    $(id).addEventListener('change', () => {
      cfg[k] = clamp(Math.round(+$(id).value) || 0, 0, max);
      $(id).value = cfg[k];
      saveCfg();
    });
  }
  $('setBtn').addEventListener('click', openSettings);
  $('cfgClose').addEventListener('click', () => {
    waitKey = null;
    $('settings').classList.add('hidden');
    if (document.activeElement) document.activeElement.blur();
  });
  $('cfgReset').addEventListener('click', () => {
    cfg = JSON.parse(JSON.stringify(DEFAULT_CFG));
    saveCfg();
    openSettings();
    renderHelp();
  });

  // ---------- 화면 배치 ----------
  const canvas = $('play'), ctx = canvas.getContext('2d');
  const UNITS_W = 19.8, UNITS_H = 21.3;
  const FX = 5.2, FY = 1; // 필드 위치 (칸 단위)
  let cell = 24, DPR = 1, fontStack = 'sans-serif';
  function readFont() { fontStack = getComputedStyle(document.body).fontFamily || 'sans-serif'; }
  readFont();
  addEventListener('langchange', readFont);

  function resize() {
    const wide = innerWidth >= 900;
    document.body.classList.toggle('wide', wide);
    const touch = document.body.classList.contains('touch');
    const availW = wide ? Math.min(innerWidth * 0.55, innerWidth - 360) : innerWidth - 24;
    const availH = innerHeight - 52 - 70 - (touch ? 140 : 28) - 16;
    cell = clamp(Math.floor(Math.min(availW / UNITS_W, (wide || !touch ? availH : innerHeight * 0.6) / UNITS_H)), 12, 36);
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(UNITS_W * cell), h = Math.round(UNITS_H * cell);
    canvas.width = Math.round(w * DPR); canvas.height = Math.round(h * DPR);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    const m = $('fieldMsg').style;
    m.left = FX * cell + 'px'; m.top = FY * cell + 'px'; m.width = 10 * cell + 'px'; m.height = 20 * cell + 'px';
    $('fieldWrap').style.width = w + 'px';
    scheduleSide();
  }
  addEventListener('resize', resize);

  // ---------- 그리기 ----------
  function drawMini(type, cx, cy, s, alpha) {
    const cells = CELLS[type][0];
    const xs = cells.map((c) => c[0]), ys = cells.map((c) => c[1]);
    const w = Math.max(...xs) - Math.min(...xs) + 1, h = Math.max(...ys) - Math.min(...ys) + 1;
    const ox = cx - (w * s) / 2 - Math.min(...xs) * s, oy = cy - (h * s) / 2 - Math.min(...ys) * s;
    for (const [x, y] of cells) C.drawCell(ctx, ox + x * s, oy + y * s, s, type, alpha);
  }
  function panel(x, y, w, h, label) {
    ctx.fillStyle = '#0f1522';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#2a3550';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = '#9aa7c2';
    ctx.font = `bold ${Math.round(cell * 0.55)}px ${fontStack}`;
    ctx.textAlign = 'left';
    ctx.fillText(label, x + 2, y - cell * 0.25);
  }

  function render() {
    const c = cell, fx = FX * c, fy = FY * c;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, UNITS_W * c, UNITS_H * c);
    // 필드
    ctx.fillStyle = '#0a0e16';
    ctx.fillRect(fx, fy, 10 * c, 20 * c);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < BW; x++) { ctx.moveTo(fx + x * c + 0.5, fy); ctx.lineTo(fx + x * c + 0.5, fy + 20 * c); }
    for (let y = 1; y < VIS; y++) { ctx.moveTo(fx, fy + y * c + 0.5); ctx.lineTo(fx + 10 * c, fy + y * c + 0.5); }
    ctx.stroke();
    panel(0, fy, 4 * c, 3 * c, 'HOLD');
    panel(15.6 * c, fy, 4.2 * c, 15 * c, 'NEXT');

    if (G) {
      const dim = G.alive ? 1 : 0.45;
      for (let y = TOP - 1; y < BH; y++) {
        for (let x = 0; x < BW; x++) {
          const v = G.board[y * BW + x];
          if (v) C.drawCell(ctx, fx + x * c, fy + (y - TOP) * c, c, G.alive ? v : 8, dim);
        }
      }
      const cur = G.cur;
      if (cur) {
        let gy = cur.y;
        while (!collide(cur.type, cur.rot, cur.x, gy + 1)) gy++;
        for (const [x, y] of CELLS[cur.type][cur.rot]) C.drawCell(ctx, fx + (cur.x + x) * c, fy + (gy + y - TOP) * c, c, cur.type, 0.22);
        for (const [x, y] of CELLS[cur.type][cur.rot]) C.drawCell(ctx, fx + (cur.x + x) * c, fy + (cur.y + y - TOP) * c, c, cur.type);
      }
      if (G.hold) drawMini(G.hold, 2 * c, fy + 1.5 * c, c * 0.8, G.held ? 0.35 : 1);
      for (let i = 0; i < 5; i++) drawMini(G.queue[i], 17.7 * c, fy + (1.5 + i * 3) * c, c * 0.8);
      // 받을 방해 줄 막대
      const inc = Math.min(VIS, G.incoming.reduce((a, g) => a + g.l, 0));
      if (inc) {
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(4.5 * c, fy + (20 - inc) * c, 0.5 * c, inc * c);
      }
      // 기술 이름 (T-SPIN, TETRIS, COMBO …)
      const a = G.action;
      if (a) {
        const age = (performance.now() - a.at) / 1500;
        if (age >= 1) G.action = null;
        else {
          ctx.globalAlpha = 1 - age * age;
          ctx.textAlign = 'center';
          ctx.font = `bold ${Math.round(c * 0.5)}px ${fontStack}`;
          a.labels.forEach((l, i) => {
            ctx.fillStyle = /SPIN|TETRIS|PERFECT/.test(l) ? '#fbbf24' : '#e8ecf4';
            ctx.fillText(l, 2 * c, fy + (4.4 + i * 0.8) * c);
          });
          if (a.atk) { ctx.fillStyle = '#f87171'; ctx.fillText(`+${a.atk}`, 2 * c, fy + (4.4 + a.labels.length * 0.8) * c); }
          ctx.globalAlpha = 1;
        }
      }
    }
    ctx.strokeStyle = '#3b4a6b';
    ctx.lineWidth = 2;
    ctx.strokeRect(fx - 1, fy - 1, 10 * c + 2, 20 * c + 2);
  }

  // ---------- 상태 문구 ----------
  const curGame = () => (room && room.game) || null;
  function placeOf(gid, sid) {
    const p = C.placements(entries[gid], results[gid]).find((x) => x.sid === sid);
    return p ? p.place : null;
  }
  function setMsg(big, small) {
    const show = !!(big || small);
    $('fieldMsg').classList.toggle('hidden', !show);
    $('msgBig').textContent = big || '';
    $('msgSmall').textContent = small || '';
  }
  function renderStatus() {
    if (!rid) return;
    const game = curGame();
    const e = game ? entries[game.id] || {} : {}, r = game ? results[game.id] || {} : {};
    const finished = !game || C.isFinished(game.id, game, e, r, now());
    const no = game ? C.noLabel(room, game.no) : '';
    const allDone = C.allDone(room, entries, results, now());
    // 위쪽 막대
    let st = t('tStIdle');
    if (game && now() < game.start && !game.over) st = t('tStCountdown', { no });
    else if (game && !finished) st = t('tStPlaying', { no, a: C.aliveCount(e, r), n: Object.keys(e).length });
    else if (allDone) st = t('tStAllDone');
    else if (game) st = t('tStDone', { no });
    $('statusText').textContent = st;
    // 필드 위 안내
    if (rulesErr) setMsg(t('tRulesBig'), t('tRulesSub'));
    else if (G && game && G.gid === game.id) {
      if (G.alive && !G.started) {
        const s = Math.ceil((G.start - now()) / 1000);
        setMsg(s > 0 ? String(s) : 'GO!', t('tGetReady'));
      } else if (G.alive) setMsg('', '');
      else {
        const mine = r[profile.sid];
        const place = placeOf(G.gid, profile.sid);
        const big = mine && mine.win ? t('tWinner') : place ? t('tYouPlace', { n: place }) : t('tKO');
        const n = Object.keys(e).length;
        let small = G.endKey ? t(G.endKey) : '';
        if (finished) small = (n >= 2 && place ? t('tPointsGot', { n: C.placePoints(place, C.roomOpts(room).points) }) + ' · ' : '') + t(allDone ? 'tAllDoneSub' : 'tWaitNext');
        else small = (small ? small + ' · ' : '') + t('tStillPlaying');
        setMsg(big, small);
      }
    } else if (game && !finished) setMsg(t('tSpectating'), t('tSpectatingSub'));
    else if (allDone) setMsg(t('tStAllDone'), t('tAllDoneSub'));
    else setMsg(t('tWaiting'), t('tWaitingSub'));
  }
  function renderStats() {
    if (!G) {
      $('stLevel').textContent = '1'; $('stTime').textContent = '0:00';
      $('stSent').textContent = '0'; $('stLines').textContent = '0'; $('stPps').textContent = '0.00';
      return;
    }
    const end = G.alive ? now() : G.endAt;
    const sec = Math.max(0, (end - G.start) / 1000);
    $('stLevel').textContent = G.level;
    $('stTime').textContent = `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
    $('stSent').textContent = G.sent;
    $('stLines').textContent = G.lines;
    $('stPps').textContent = sec > 0 ? (G.pieces / sec).toFixed(2) : '0.00';
  }

  // ---------- 다른 학생 썸네일 / 누적 순위 ----------
  const thumbEls = new Map();
  let sideQueued = false;
  function scheduleSide() {
    if (sideQueued || !rid) return;
    sideQueued = true;
    requestAnimationFrame(() => { sideQueued = false; renderThumbs(); renderStandings(); });
  }
  function thumbCell(n) {
    const box = $('thumbs');
    const W = box.clientWidth, H = document.body.classList.contains('wide') ? box.clientHeight : Infinity;
    for (let s = 14; s > 4; s--) {
      const tw = 10 * s + 6, th = 20 * s + 26;
      const cols = Math.max(1, Math.floor((W + 8) / (tw + 8)));
      if (H === Infinity) { if (s <= 9 && cols >= Math.min(n, 3)) return s; continue; }
      if (Math.ceil(n / cols) * (th + 8) - 8 <= H) return s;
    }
    return 4;
  }
  function renderThumbs() {
    const game = curGame();
    const e = game ? entries[game.id] || {} : {}, r = game ? results[game.id] || {} : {};
    const present = freshLobby(rid);
    for (const s of Object.keys(e)) if (boards[s]) present[s] = present[s] || { n: e[s].n };
    delete present[profile.sid];
    const sids = Object.keys(present).sort();
    for (const [s, el] of thumbEls) if (!present[s]) { el.remove(); thumbEls.delete(s); }
    const box = $('thumbs');
    if (!sids.length) {
      if (!box.querySelector('.empty')) {
        const p = document.createElement('p');
        p.className = 'muted empty';
        box.appendChild(p);
      }
      box.querySelector('.empty').textContent = t('tLobbyEmpty');
    } else if (box.querySelector('.empty')) box.querySelector('.empty').remove();
    const s = thumbCell(sids.length);
    sids.forEach((sid) => {
      let el = thumbEls.get(sid);
      if (!el) {
        el = document.createElement('div');
        el.className = 'thumb';
        el.innerHTML = '<div class="tb"><canvas></canvas><b class="tstat"></b></div><span class="tname"></span>';
        thumbEls.set(sid, el);
      }
      box.appendChild(el); // 학번 순서 유지
      const bd = boards[sid];
      const b = bd && game && bd.g === game.id ? bd.b : '';
      const key = `${b}|${s}`;
      if (el._key !== key) { el._key = key; C.drawThumb(el.querySelector('canvas'), b, s); }
      el.querySelector('.tname').textContent = (present[sid] && present[sid].n) || sid;
      const stat = el.querySelector('.tstat');
      let txt = '', cls = '';
      if (game && e[sid]) {
        const res = r[sid];
        if (res && res.win) { txt = t('tWinner'); cls = 'win'; }
        else if (res && !res.stop) { const p = placeOf(game.id, sid); txt = p ? t('tYouPlace', { n: p }) : 'KO'; cls = 'dead'; }
        else if (bd && bd.i > 0 && bd.g === game.id) { txt = `▲${bd.i}`; cls = 'inc'; }
      } else txt = t(game && !C.isFinished(game.id, game, e, r, now()) ? 'tStatSpec' : 'tStatWait');
      stat.textContent = txt;
      el.className = 'thumb' + (cls ? ' ' + cls : '') + (game && e[sid] ? '' : ' idle');
    });
  }
  function renderStandings() {
    const opts = C.roomOpts(room);
    $('pointsLine').textContent = C.pointsLine(opts.points, t);
    const rows = C.standings(entries, results, curGame(), opts.points);
    const tb = $('standBody');
    tb.innerHTML = '';
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5; td.className = 'muted'; td.textContent = t('noRecords');
      tr.appendChild(td); tb.appendChild(tr);
    }
    rows.forEach((v, i) => {
      const tr = document.createElement('tr');
      if (v.sid === profile.sid) tr.className = 'me';
      [i + 1, v.name, v.pts, v.wins, v.games].forEach((x, j) => {
        const td = document.createElement('td');
        td.textContent = x;
        if (j >= 2) td.className = 'num';
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
  }

  // ---------- 메인 루프 ----------
  let lastT = performance.now(), slowAcc = 0, pressureShown = null;
  function step(dt) {
    const el = (now() - G.start) / 1000;
    G.level = Math.min(MAX_LEVEL, 1 + Math.floor(el / G.levelSec));
    if (el >= G.nextPressure) {
      G.incoming.push({ l: 1, h: Math.floor(Math.random() * BW) });
      G.nextPressure += PRESSURE_EVERY;
      if (pressureShown !== G.gid) { pressureShown = G.gid; toast(t('tPressure')); }
    }
    // 꾹 누르기 (DAS → ARR)
    if (dasDir) {
      const before = dasT;
      dasT += dt;
      if (dasT >= cfg.das && G.cur) {
        if (cfg.arr <= 0) { while (tryMove(dasDir, 0)); }
        else {
          arrT += dasT - Math.max(before, cfg.das);
          while (arrT >= cfg.arr) { arrT -= cfg.arr; if (!tryMove(dasDir, 0)) { arrT = 0; break; } }
        }
      }
    }
    if (!G.cur) return;
    // 중력 + 소프트 드롭
    const rowMs = held.soft ? Math.min(gravityMs(G.level), cfg.sdf) : gravityMs(G.level);
    if (!grounded()) {
      if (rowMs <= 0) { while (tryMove(0, 1)); }
      else {
        G.fallAcc += dt;
        while (G.fallAcc >= rowMs) { G.fallAcc -= rowMs; if (!tryMove(0, 1)) break; }
      }
    }
    if (grounded()) {
      G.fallAcc = 0;
      G.lockT += dt;
      if (G.lockT >= LOCK_DELAY) lockPiece();
    }
  }
  function frame(ts) {
    const dt = Math.min(50, ts - lastT);
    lastT = ts;
    if (rid && G && G.alive) {
      if (!G.started && now() >= G.start) { G.started = true; spawn(); renderStatus(); }
      if (G.started && G.alive) step(dt);
    }
    if (rid) {
      render();
      slowAcc += dt;
      if (slowAcc >= 200) { slowAcc = 0; renderStatus(); renderStats(); }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  // 접속 목록의 '오래된 학생' 정리용
  setInterval(() => { if (rid) scheduleSide(); else renderRooms(); }, 3000);
})();
