(() => {
  'use strict';

  // ---------- 게임 설정 ----------
  const WORLD = 4000;            // 맵 크기 (정사각형)
  const FOOD_TARGET = 700;       // 맵에 유지할 먹이 개수
  const SEND_INTERVAL = 100;     // 내 위치 전송 주기(ms) = 초당 10회
  const STALE_MS = 4000;         // 이 시간 동안 소식 없는 플레이어는 숨김
  const INTERP_DELAY = 100;      // 다른 플레이어 몸통은 이만큼 과거 시점으로 보간해서 그림 (머리는 현재 시각으로 예측)
  const PREDICT_MAX = 250;       // 머리 예측 최대 시간(ms) — 길게 예측하면 방향을 틀 때 없는 목이 생김
  const HIT_RATIO = 0.9;         // 머리와 몸통이 (반지름 합 × 이 값)보다 가까우면 충돌
  const SPEED = 170, BOOST_SPEED = 340;
  const START_MASS = 20, BOOST_FLOOR = 10, BOOST_RESUME = 13, BOOST_COST = 2;
  const SAVE_INTERVAL = 5000;     // 게임 중 최고 점수 저장 주기(ms)
  const SP = 5;                  // 몸통 궤적 점 간격
  const SPAWN_GRACE = 1500;      // 시작 직후 무적 시간(ms)
  const HIDDEN_LIMIT = 3000;     // 다른 창으로 나가 있으면 탈락까지 시간(ms)

  const $ = (id) => document.getElementById(id);
  const t = (k, p) => I18N.t(k, p);
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const angDiff = (t, a) => {
    let d = (t - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  };
  const radiusOf = (m) => 9 + Math.min(21, Math.sqrt(m) * 0.9);
  const lengthOf = (m) => 60 + 8 * Math.pow(m, 0.85);
  const turnRateOf = (m) => Math.max(2.4, 5 - m / 250);
  const foodRadius = (v) => Math.min(11, 4 + v * 1.5);
  // 몸통 굵기 비율: 꼬리 쪽 40%는 점점 가늘어짐 (t: 0=머리, 1=꼬리). 그리기와 충돌 판정에 똑같이 사용
  const taper = (t) => 1 - 0.4 * Math.max(0, (t - 0.6) / 0.4);
  const hueOf = (sid) => {
    let h = 7;
    for (const c of sid) h = (h * 131 + c.charCodeAt(0) * 17) % 360;
    return h;
  };

  // ---------- Firebase 초기화 ----------
  const cfg = window.FIREBASE_CONFIG || {};
  if (!cfg.databaseURL) {
    const showNoConfig = () => { $('loginError').textContent = t('noConfig'); };
    showNoConfig();
    addEventListener('langchange', showNoConfig);
    $('joinBtn').disabled = true;
    $('practiceBtn').disabled = true;
    return;
  }
  firebase.initializeApp(cfg);
  const db = firebase.database();
  if (new URLSearchParams(location.search).has('emu')) db.useEmulator('127.0.0.1', 9000);
  const SV = firebase.database.ServerValue;
  // 연습 모드는 DB 최상위, 대회는 rooms/{코드}/ 아래에 같은 구조(players, food, notices)를 씀
  let base = '';
  let playersRef = null, foodRef = null;

  let serverOffset = 0;
  const now = () => Date.now() + serverOffset;
  db.ref('.info/serverTimeOffset').on('value', (s) => { serverOffset = s.val() || 0; });

  // 화면 문구는 키로 기억해 두었다가 언어가 바뀌면 다시 그림
  let loginMsg = null, deadMsg = null, deadErr = null;
  function setLoginError(key, params) { loginMsg = key ? { key, params } : null; renderTexts(); }
  function renderTexts() {
    $('connText').textContent = t(connected ? 'connected' : 'connecting');
    $('loginError').textContent = loginMsg ? t(loginMsg.key, loginMsg.params) : '';
    $('deadError').textContent = deadErr ? t(deadErr) : '';
    if (deadMsg) {
      $('deadTitle').textContent = t(deadMsg.title);
      $('deadMsg').textContent = t(deadMsg.key, deadMsg.params);
    }
  }
  addEventListener('langchange', () => { renderTexts(); renderFame(); updateHud(); renderRoom(); });

  let connected = false;
  db.ref('.info/connected').on('value', (s) => {
    connected = !!s.val();
    renderTexts();
  });

  let locked = false;
  db.ref('settings/locked').on('value', (s) => {
    locked = !!s.val();
    updateLockText();
    if (locked && !room && me && me.alive) endGame('roundOver', 'roundEnded', null, null, false);
  });
  // 잠금은 연습 모드에만 적용 (대회는 게임방 라운드로 진행)
  function updateLockText() {
    if (!locked && loginMsg && loginMsg.key === 'locked') setLoginError(null);
  }
  renderTexts();

  // ---------- 상태 ----------
  let me = null;                    // 내 뱀
  let profile = { sid: '', name: '' };
  const remotes = new Map();        // 다른 플레이어
  const foods = new Map();          // 먹이
  const mouse = { x: innerWidth / 2 + 100, y: innerHeight / 2 };
  let steerMode = 'mouse', keyLeft = false, keyRight = false;
  let boostKey = false, boostMouse = false, boostTouch = false;
  let steerId = null, boostId = null;
  const cam = { x: WORLD / 2, y: WORLD / 2, scale: 0.6 };
  let sendAcc = 0, boostDropAcc = 0, hostAcc = 0, hudAcc = 0, saveAcc = 0;
  let noticeSid = null, hiddenTimer = null;

  // ---------- 궤적(몸통) ----------
  function trailAdvance(s, x, y, len) {
    const p = s.pts, n = p.length;
    if (n < 2) p.push({ x, y });
    else {
      const prev = p[n - 2], dx = x - prev.x, dy = y - prev.y;
      if (dx * dx + dy * dy >= SP * SP) p.push({ x, y });
      else { p[n - 1].x = x; p[n - 1].y = y; }
    }
    trailTrim(s, len);
  }
  function trailTrim(s, len) {
    const p = s.pts;
    let total = 0, cut = -1;
    let minX = p[p.length - 1].x, maxX = minX, minY = p[p.length - 1].y, maxY = minY;
    for (let i = p.length - 1; i > 0; i--) {
      const a = p[i], b = p[i - 1];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (total + d > len) {
        const f = d > 0 ? (len - total) / d : 0;
        b.x = a.x + (b.x - a.x) * f;
        b.y = a.y + (b.y - a.y) * f;
        cut = i - 1;
      }
      if (b.x < minX) minX = b.x; if (b.x > maxX) maxX = b.x;
      if (b.y < minY) minY = b.y; if (b.y > maxY) maxY = b.y;
      if (cut >= 0) break;
      total += d;
    }
    if (cut > 0) p.splice(0, cut);
    s.minX = minX; s.maxX = maxX; s.minY = minY; s.maxY = maxY;
  }
  function prefill(s) {
    s.pts = [];
    const len = lengthOf(s.mass), n = Math.ceil(len / SP);
    for (let k = n; k >= 0; k--) s.pts.push({ x: s.x - Math.cos(s.a) * k * SP, y: s.y - Math.sin(s.a) * k * SP });
    trailTrim(s, len);
  }
  // 머리부터 꼬리 방향으로 일정 간격 점 샘플링
  function sampleTrail(p, sp) {
    const out = [];
    const n = p.length;
    if (!n) return out;
    let px = p[n - 1].x, py = p[n - 1].y, need = sp;
    out.push({ x: px, y: py });
    for (let i = n - 2; i >= 0; i--) {
      const qx = p[i].x, qy = p[i].y;
      let dx = qx - px, dy = qy - py, d = Math.hypot(dx, dy);
      while (d >= need && d > 0) {
        px += (dx / d) * need; py += (dy / d) * need;
        out.push({ x: px, y: py });
        dx = qx - px; dy = qy - py; d = Math.hypot(dx, dy);
        need = sp;
      }
      need -= d; px = qx; py = qy;
    }
    return out;
  }

  // ---------- 월드 연결 (연습 ↔ 게임방) ----------
  function attachWorld(newBase) {
    if (playersRef) { playersRef.off(); foodRef.off(); }
    base = newBase;
    remotes.clear();
    foods.clear();
    playersRef = db.ref(base + 'players');
    foodRef = db.ref(base + 'food');
    foodRef.on('child_added', (s) => {
      const v = s.val();
      if (!v || typeof v.x !== 'number') return;
      const val = +v.v || 1;
      foods.set(s.key, { x: v.x, y: v.y, v: val, h: +v.h || 0, r: foodRadius(val), pending: false });
    });
    foodRef.on('child_removed', (s) => { foods.delete(s.key); });
    playersRef.on('child_added', onPlayer);
    playersRef.on('child_changed', onPlayer);
    playersRef.on('child_removed', (s) => { remotes.delete(s.key); });
  }

  // ---------- 먹이 ----------

  function spawnFood(list) {
    if (!list.length) return;
    const upd = {};
    for (const f of list) {
      upd[foodRef.push().key] = {
        x: Math.round(clamp(f.x, 20, WORLD - 20)), y: Math.round(clamp(f.y, 20, WORLD - 20)),
        v: Math.round(f.v * 10) / 10, h: Math.round(f.h)
      };
    }
    foodRef.update(upd);
  }
  function eat(id, f) {
    f.pending = true;
    foodRef.child(id).transaction(
      (cur) => (cur === null ? undefined : null),
      (err, committed) => {
        if (!err && committed && me && me.alive) me.mass += f.v;
        else if (!committed) f.pending = false;
      },
      false
    );
  }
  // 살아있는 플레이어 중 학번이 가장 작은 사람이 먹이를 보충
  function isHost() {
    if (!me || !me.alive) return false;
    for (const r of remotes.values()) if (!r.stale && r.sid < me.sid) return false;
    return true;
  }
  function hostTick() {
    if (!isHost() || foods.size >= FOOD_TARGET) return;
    const n = Math.min(120, FOOD_TARGET - foods.size), list = [];
    for (let i = 0; i < n; i++) list.push({ x: rand(30, WORLD - 30), y: rand(30, WORLD - 30), v: 1, h: rand(0, 360) });
    spawnFood(list);
  }

  // ---------- 다른 플레이어 ----------
  function onPlayer(s) {
    const sid = s.key;
    if (sid === profile.sid) return;
    const v = s.val();
    if (!v || typeof v.x !== 'number') return;
    const snap = { t: +v.t || now(), x: v.x, y: v.y, a: +v.a || 0, b: !!v.b };
    let r = remotes.get(sid);
    if (!r) {
      r = { sid, name: String(v.n || sid).slice(0, 12), hue: v.h != null ? +v.h : hueOf(sid), mass: +v.m || START_MASS,
        snaps: [snap], x: snap.x, y: snap.y, a: snap.a, b: snap.b, pts: [], stale: false };
      prefill(r);
      remotes.set(sid, r);
      return;
    }
    r.mass = +v.m || r.mass;
    r.name = String(v.n || sid).slice(0, 12);
    const last = r.snaps[r.snaps.length - 1];
    if (snap.t <= last.t) return;
    if (Math.hypot(snap.x - last.x, snap.y - last.y) > 600) { // 순간이동(재시작) 처리
      r.snaps = [snap]; r.x = snap.x; r.y = snap.y; r.a = snap.a; r.hx = null; prefill(r);
      return;
    }
    r.snaps.push(snap);
    if (r.snaps.length > 20) r.snaps.shift();
  }
  attachWorld('');

  function updateRemote(r, t, dt) {
    const S = r.snaps, last = S[S.length - 1];
    r.stale = now() - last.t > STALE_MS;
    if (r.stale) return;
    let x, y, a, b;
    if (t >= last.t) {
      const e = Math.min(t - last.t, 300) / 1000, sp = last.b ? BOOST_SPEED : SPEED;
      x = last.x + Math.cos(last.a) * sp * e; y = last.y + Math.sin(last.a) * sp * e; a = last.a; b = last.b;
    } else if (t <= S[0].t) {
      x = S[0].x; y = S[0].y; a = S[0].a; b = S[0].b;
    } else {
      let i = S.length - 2;
      while (i > 0 && S[i].t > t) i--;
      const A = S[i], B = S[i + 1], f = (t - A.t) / (B.t - A.t || 1);
      x = A.x + (B.x - A.x) * f; y = A.y + (B.y - A.y) * f; a = A.a + angDiff(B.a, A.a) * f; b = B.b;
    }
    const k = Math.min(1, dt * 20);
    r.x += (x - r.x) * k; r.y += (y - r.y) * k;
    r.a += angDiff(a, r.a) * k; r.b = b;
    trailAdvance(r, r.x, r.y, lengthOf(r.mass));
    predictHead(r, k);
  }

  // 받은 위치는 (전송 주기 + 네트워크 지연 + 보간 지연)만큼 과거라서, 그대로 쓰면 상대 머리가 실제보다
  // 뒤에 있는 것처럼 보이고 판정됨 → 머리 앞을 지나가도 안 부딪힘. 마지막 위치에서 방향·속도·회전 속도로
  // 현재 시각의 머리를 예측해, 보간된 위치에서 예측 머리까지를 '목'으로 이어서 그리기/충돌에 함께 사용
  function predictHead(r, k) {
    const S = r.snaps, last = S[S.length - 1];
    const e = clamp(now() - last.t, 0, PREDICT_MAX) / 1000;
    let w = 0;
    if (S.length >= 2) {
      const P = S[S.length - 2], ds = (last.t - P.t) / 1000;
      if (ds > 0.02) w = clamp(angDiff(last.a, P.a) / ds, -5, 5);
    }
    const spd = last.b ? BOOST_SPEED : SPEED, steps = 4, h = e / steps;
    let px = last.x, py = last.y, pa = last.a;
    for (let i = 0; i < steps; i++) { pa += w * h; px += Math.cos(pa) * spd * h; py += Math.sin(pa) * spd * h; }
    if (r.hx == null) { r.hx = px; r.hy = py; r.ha = pa; }
    r.hx += (px - r.hx) * k; r.hy += (py - r.hy) * k; r.ha += angDiff(pa, r.ha) * k;
    const neck = [];
    const dx = r.hx - r.x, dy = r.hy - r.y, d = Math.hypot(dx, dy), n = Math.floor(d / SP);
    for (let i = 1; i <= n; i++) neck.push({ x: r.x + (dx * i * SP) / d, y: r.y + (dy * i * SP) / d });
    neck.push({ x: r.hx, y: r.hy });
    r.neck = neck;
  }

  function hitsSnake(x, y, rad, s) {
    const rr = radiusOf(s.mass), maxLim = (rad + rr) * HIT_RATIO;
    const near = (p, t) => {
      const lim = (rad + rr * taper(t)) * HIT_RATIO, dx = p.x - x, dy = p.y - y;
      return dx * dx + dy * dy < lim * lim;
    };
    if (s.neck && s.neck.some((p) => near(p, 0))) return true;
    if (x < s.minX - maxLim || x > s.maxX + maxLim || y < s.minY - maxLim || y > s.maxY + maxLim) return false;
    const p = s.pts, last = Math.max(1, p.length - 1);
    for (let i = p.length - 1; i >= 0; i--) if (near(p[i], (p.length - 1 - i) / last)) return true;
    return false;
  }

  // ---------- 내 뱀 ----------
  function spawn() {
    if (room) { if (!roundLive()) return false; }
    else if (locked) { deadErr = 'lockedShort'; renderTexts(); return false; }
    let x = WORLD / 2, y = WORLD / 2;
    for (let tries = 0; tries < 30; tries++) {
      x = rand(400, WORLD - 400); y = rand(400, WORLD - 400);
      let ok = true;
      for (const r of remotes.values()) {
        if (!r.stale && x > r.minX - 350 && x < r.maxX + 350 && y > r.minY - 350 && y < r.maxY + 350) { ok = false; break; }
      }
      if (ok) break;
    }
    me = { sid: profile.sid, name: profile.name, hue: hueOf(profile.sid), x, y, a: rand(-Math.PI, Math.PI),
      mass: START_MASS, b: false, tired: false, alive: true, spawnAt: now(), kills: 0, pts: [],
      peak: START_MASS, savedPeak: 0 };
    prefill(me);
    remotes.delete(me.sid);
    playersRef.child(me.sid).onDisconnect().remove();
    listenNotices();
    cam.x = me.x; cam.y = me.y;
    sendAcc = SEND_INTERVAL; boostDropAcc = 0; hostAcc = 0; saveAcc = 0;
    steerMode = 'mouse';
    $('login').classList.add('hidden');
    $('dead').classList.add('hidden');
    $('hud').classList.remove('hidden');
    if (room) roomView = null;
    deadErr = null;
    renderTexts();
    sendState();
    return true;
  }

  function sendState() {
    if (!me || !me.alive) return;
    playersRef.child(me.sid).set({
      n: me.name, x: Math.round(me.x), y: Math.round(me.y), a: Math.round(angDiff(me.a, 0) * 100) / 100,
      m: Math.round(me.mass * 10) / 10, b: me.b ? 1 : 0, h: me.hue, t: now()
    });
  }

  function updateMe(dt) {
    const m = me;
    const turn = turnRateOf(m.mass) * dt;
    if (steerMode === 'key') {
      if (keyLeft) m.a -= turn;
      if (keyRight) m.a += turn;
    } else {
      const tx = mouse.x - innerWidth / 2, ty = mouse.y - innerHeight / 2;
      if (tx * tx + ty * ty > 64) m.a += clamp(angDiff(Math.atan2(ty, tx), m.a), -turn, turn);
    }
    // 점수가 바닥(BOOST_FLOOR)까지 떨어지면 부스트가 꺼지고, BOOST_RESUME 이상 모여야 다시 켜짐 (깜빡임 방지)
    if (m.mass <= BOOST_FLOOR) m.tired = true;
    else if (m.tired && m.mass >= BOOST_RESUME) m.tired = false;
    m.b = (boostKey || boostMouse || boostTouch) && !m.tired;
    const sp = m.b ? BOOST_SPEED : SPEED;
    m.x += Math.cos(m.a) * sp * dt;
    m.y += Math.sin(m.a) * sp * dt;
    if (m.b) {
      m.mass = Math.max(BOOST_FLOOR, m.mass - BOOST_COST * dt);
      boostDropAcc += dt;
      if (boostDropAcc >= 0.5) {
        boostDropAcc = 0;
        const tail = m.pts[0];
        spawnFood([{ x: tail.x, y: tail.y, v: 1, h: m.hue }]);
      }
    } else boostDropAcc = 0;
    if (m.mass > m.peak) m.peak = m.mass;
    trailAdvance(m, m.x, m.y, lengthOf(m.mass));

    if (m.x < 0 || m.x > WORLD || m.y < 0 || m.y > WORLD) return die('deathWall', null, null);
    const rad = radiusOf(m.mass);
    if (now() - m.spawnAt > SPAWN_GRACE) {
      for (const r of remotes.values()) {
        if (!r.stale && hitsSnake(m.x, m.y, rad, r)) return die('deathBody', { name: r.name }, r);
      }
    }
    const er = rad + 14;
    for (const [id, f] of foods) {
      if (f.pending) continue;
      const dx = f.x - m.x, dy = f.y - m.y, lim = er + f.r;
      if (dx * dx + dy * dy < lim * lim) eat(id, f);
    }
  }

  function die(msgKey, params, killer) { endGame('gameOver', msgKey, params, killer, true); }

  function endGame(titleKey, msgKey, params, killer, dropFood) {
    if (!me || !me.alive) return;
    me.alive = false;
    clearTimeout(hiddenTimer);
    const score = Math.floor(me.peak);
    const upd = {};
    upd[base + 'players/' + me.sid] = null;
    if (dropFood) {
      const count = clamp(Math.floor(me.mass / 3), 3, 60), val = Math.max(0.5, (me.mass * 0.6) / count);
      for (let i = 0; i < count; i++) {
        const p = me.pts[Math.floor((i / count) * me.pts.length)];
        upd[base + 'food/' + foodRef.push().key] = {
          x: Math.round(clamp(p.x + rand(-10, 10), 20, WORLD - 20)), y: Math.round(clamp(p.y + rand(-10, 10), 20, WORLD - 20)),
          v: Math.round(val * 10) / 10, h: me.hue
        };
      }
    }
    db.ref().update(upd);
    recordScore(score, killer);

    deadMsg = { title: titleKey, key: msgKey, params };
    deadErr = null;
    renderTexts();
    $('deadScore').textContent = score;
    $('deadKills').textContent = me.kills;
    $('hud').classList.add('hidden');
    const label = $('deadBestLabel');
    label.dataset.i18n = room ? 'roundBestLabel' : 'bestLabel';
    label.textContent = t(label.dataset.i18n);
    $('homeBtn').classList.toggle('hidden', !!room);
    if (room) {
      $('deadBest').textContent = room.myBest;
      roomView = null; // 다음 프레임에 화면 다시 결정 (부활 대기 / 라운드 결과)
    } else {
      $('deadBest').textContent = '...';
      $('dead').classList.remove('hidden');
    }
  }

  // 게임 중에도 주기적으로 최고 점수 저장 (창을 닫거나 새로고침해도 기록이 남도록)
  function savePeak() {
    if (room) return saveRoundBest(null);
    const score = Math.floor(me.peak);
    if (score <= me.savedPeak) return;
    me.savedPeak = score;
    const sref = db.ref('scores/' + me.sid);
    sref.update({ sid: me.sid, name: me.name });
    sref.child('best').transaction((cur) => Math.max(+cur || 0, score));
  }

  function recordScore(score, killer) {
    if (room) return saveRoundBest(killer);
    const sref = db.ref('scores/' + me.sid);
    sref.update({ sid: me.sid, name: me.name, last: score, games: SV.increment(1), ts: SV.TIMESTAMP });
    sref.child('best').transaction((cur) => Math.max(+cur || 0, score), (err, committed, snap) => {
      $('deadBest').textContent = snap && snap.val() != null ? snap.val() : score;
    });
    if (killer) {
      db.ref('scores/' + killer.sid).update({ sid: killer.sid, name: killer.name, kills: SV.increment(1) });
      db.ref('notices/' + killer.sid).push({ by: me.name });
    }
  }

  function listenNotices() {
    const path = base + 'notices/' + me.sid;
    if (noticeSid === path) return;
    if (noticeSid) db.ref(noticeSid).off();
    noticeSid = path;
    const ref = db.ref(path);
    ref.remove().then(() => {
      ref.on('child_added', (s) => {
        const v = s.val() || {};
        s.ref.remove();
        if (me && me.alive) {
          me.kills++;
          toast(t('killToast', { name: String(v.by || '').slice(0, 12) }));
        }
      });
    });
  }

  let toastTimer = null;
  function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  // ---------- 대회 (게임방) ----------
  // room.state.phase: lobby(대기) → round(카운트다운·진행) → results(라운드 결과) → … → finished(최종)
  let room = null;
  let roomView = null; // 현재 보여주는 화면: play | dead | countdown | panel
  function roundLive() {
    const st = room && room.state;
    return !!st && st.phase === 'round' && now() >= st.startAt && now() < st.endAt;
  }

  async function joinRoom(code, sid, name) {
    const meta = (await db.ref(`rooms/${code}/meta`).get()).val();
    if (!meta) { setLoginError('errRoom'); return; }
    const pres = (await db.ref(`rooms/${code}/presence/${sid}`).get()).val();
    if (pres && now() - (+pres.t || 0) < 25000) { setLoginError('errDup'); return; }
    profile = { sid, name };
    me = null;
    room = { code, meta, state: null, standings: {}, results: {}, memberCount: 0, members: {}, presence: {}, ready: {},
      myBest: 0, savedBest: 0, bestKey: null, spawnedKey: null, refs: [] };
    attachWorld(`rooms/${code}/`);
    db.ref(`rooms/${code}/members/${sid}`).set({ name });
    const presRef = db.ref(`rooms/${code}/presence/${sid}`);
    presRef.onDisconnect().remove();
    presRef.set({ t: SV.TIMESTAMP });
    room.presRef = presRef;
    room.presTimer = setInterval(() => presRef.set({ t: SV.TIMESTAMP }), 10000);
    const R = (p) => { const ref = db.ref(`rooms/${code}/${p}`); room.refs.push(ref); return ref; };
    const cur = room;
    R('meta').on('value', (snap) => {
      if (room !== cur) return;
      if (!snap.val()) { leaveRoom(true); setLoginError('errRoomGone'); return; }
      room.meta = snap.val();
      renderRoom();
    });
    R('state').on('value', (snap) => {
      if (room !== cur || !snap.val()) return;
      room.state = snap.val();
      if (room.state.roundKey && room.bestKey !== room.state.roundKey) {
        room.bestKey = room.state.roundKey; room.myBest = 0; room.savedBest = 0;
      }
      roomView = null;
      renderRoom();
    });
    R('standings').on('value', (snap) => { if (room === cur) { room.standings = snap.val() || {}; renderRoom(); } });
    R('roundResults').on('value', (snap) => { if (room === cur) { room.results = snap.val() || {}; renderRoom(); } });
    R('members').on('value', (snap) => {
      if (room !== cur) return;
      room.members = snap.val() || {};
      room.memberCount = Object.keys(room.members).length;
      renderRoom();
    });
    R('presence').on('value', (snap) => { if (room === cur) { room.presence = snap.val() || {}; renderRoom(); maybeAdvance(); } });
    R('ready').on('value', (snap) => { if (room === cur) { room.ready = snap.val() || {}; renderRoom(); maybeAdvance(); } });
    setLoginError(null);
    $('login').classList.add('hidden');
    renderRoom();
  }

  function leaveRoom(roomGone) {
    if (!room) return;
    clearInterval(room.presTimer);
    room.refs.forEach((r) => r.off());
    room.presRef.onDisconnect().cancel();
    if (!roomGone) {
      if (me && me.alive) playersRef.child(me.sid).remove();
      room.presRef.remove();
    }
    if (me) me.alive = false;
    room = null;
    me = null;
    roomView = null;
    attachWorld('');
    for (const id of ['hud', 'dead', 'roomPanel', 'countdown', 'readyModal']) $(id).classList.add('hidden');
    $('login').classList.remove('hidden');
  }

  // 대회 점수: 라운드별 최고점(여러 번 부활해도 가장 큰 값) + 처치
  function saveRoundBest(killer) {
    const st = room.state;
    if (!st || st.phase !== 'round' || now() > st.endAt + 8000) return;
    const rk = st.roundKey, code = room.code;
    if (me) room.myBest = Math.max(room.myBest, Math.floor(me.peak));
    if (room.myBest > room.savedBest) {
      const best = room.savedBest = room.myBest;
      const ref = db.ref(`rooms/${code}/roundScores/${rk}/${profile.sid}`);
      ref.update({ name: profile.name });
      ref.child('best').transaction((cur) => Math.max(+cur || 0, best));
    }
    if (killer) {
      db.ref(`rooms/${code}/roundScores/${rk}/${killer.sid}`).update({ name: killer.name, kills: SV.increment(1) });
      db.ref(`${base}notices/${killer.sid}`).push({ by: profile.name });
    }
  }

  // ----- 라운드 사이: 접속 중인 학생이 모두 '준비'하면 자동으로 다음 라운드 -----
  const ONLINE_MS = 30000;
  function readyInfo() {
    const st = room.state || {}, rk = st.roundKey, tt = now();
    const r = (rk && room.ready[rk]) || {};
    const online = Object.entries(room.presence || {})
      .filter(([, v]) => v && tt - (+v.t || 0) < ONLINE_MS).map(([sid]) => sid);
    const ready = online.filter((sid) => r[sid] === true);
    const waiting = online.filter((sid) => r[sid] !== true)
      .map((sid) => (room.members[sid] && room.members[sid].name) || sid);
    return { rk, online, ready, waiting, mine: r[profile.sid] === true };
  }
  let advanceAt = 0;
  function maybeAdvance() {
    const st = room && room.state;
    if (!st || st.phase !== 'results' || (st.round || 0) >= ((room.meta || {}).rounds || 0)) return;
    const info = readyInfo();
    const timeUp = st.nextAt && now() >= st.nextAt;
    if (!timeUp && (!info.online.length || info.waiting.length)) return;
    if (Date.now() - advanceAt < 3000) return;
    advanceAt = Date.now();
    // 서버가 다시 한 번 모두 준비됐는지 확인한 뒤에만 시작함
    fetch('api/admin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'autoAdvance', code: room.code })
    }).catch(() => {});
  }
  function toggleReady() {
    if (!room || !room.state || room.state.phase !== 'results') return;
    const info = readyInfo();
    db.ref(`rooms/${room.code}/ready/${info.rk}/${profile.sid}`).set(info.mine ? null : true);
  }

  const fmtTime = (ms) => {
    const sec = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  };

  // 매 프레임: 라운드 시작/종료에 맞춰 내 뱀과 화면 전환
  function roomTick() {
    if (!room || !room.state) return;
    const st = room.state, tt = now();
    if (st.phase === 'round') {
      if (tt >= st.startAt && tt < st.endAt) {
        if (room.spawnedKey !== st.roundKey && !(me && me.alive)) { room.spawnedKey = st.roundKey; spawn(); }
      } else if (tt >= st.endAt && me && me.alive) {
        endGame('roundOver', 'roundTimeUp', null, null, false);
      }
    } else if (me && me.alive) {
      endGame('roundOver', 'roundEnded', null, null, false);
    }

    let view;
    if (me && me.alive) view = 'play';
    else if (roundLive()) view = 'dead';
    else if (st.phase === 'round' && tt < st.startAt) view = 'countdown';
    else view = 'panel';
    if (view !== roomView) {
      roomView = view;
      $('hud').classList.toggle('hidden', view !== 'play');
      $('dead').classList.toggle('hidden', view !== 'dead');
      $('countdown').classList.toggle('hidden', view !== 'countdown');
      $('roomPanel').classList.toggle('hidden', view !== 'panel');
      renderRoom();
    }
    if (view === 'countdown') {
      const n = String(Math.max(1, Math.ceil((st.startAt - tt) / 1000)));
      if ($('countdownNum').textContent !== n) $('countdownNum').textContent = n;
    }
    if (view === 'panel' && st.phase === 'round' && !room.tallyShown) { room.tallyShown = true; renderRoom(); }
    // 쉬는 시간 카운트다운 표시 + 시간이 다 되면 다음 라운드 요청
    if (st.phase === 'results' && st.nextAt) {
      const sec = Math.max(0, Math.ceil((st.nextAt - tt) / 1000));
      if (sec !== room.breakSec) { room.breakSec = sec; renderRoom(); }
      if (tt >= st.nextAt) maybeAdvance();
    }
    if (st.phase !== 'round') room.tallyShown = false;
  }

  // 동점이면 F1처럼 더 높은 라운드 성적(승점이 큰 라운드)이 많은 쪽이 앞
  function cmpStanding(a, b) {
    if (b.total !== a.total) return b.total - a.total;
    const pa = Object.values(a.r).sort((x, y) => y - x), pb = Object.values(b.r).sort((x, y) => y - x);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pb[i] || 0) !== (pa[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
    return a.name < b.name ? -1 : 1;
  }
  function sortedStandings() {
    return Object.entries(room.standings || {})
      .map(([sid, v]) => ({ sid, name: (v && v.name) || sid, total: +(v && v.total) || 0, r: (v && v.r) || {} }))
      .sort(cmpStanding);
  }

  function fillTable(id, head, rows, mineIdx) {
    const tb = $(id);
    tb.innerHTML = '';
    const tr = document.createElement('tr');
    head.forEach((h, j) => { const th = document.createElement('th'); th.textContent = h; if (j >= 2) th.className = 'num'; tr.appendChild(th); });
    tb.appendChild(tr);
    rows.forEach((r, i) => {
      const row = document.createElement('tr');
      if (i === mineIdx) row.className = 'me';
      r.forEach((c, j) => { const td = document.createElement('td'); td.textContent = c; if (j >= 2) td.className = 'num'; row.appendChild(td); });
      tb.appendChild(row);
    });
  }

  function renderRoom() {
    if (!room) return;
    const meta = room.meta || {}, st = room.state || { phase: 'lobby', round: 0 };
    const total = meta.rounds || 0;
    $('rpName').textContent = meta.name || '';
    $('rpCode').textContent = t('codeLabel', { code: room.code });
    $('countdownSub').textContent = t('roundOf', { r: st.round, n: total });

    const rk = st.roundKey;
    const results = (rk && room.results[rk]) ? Object.values(room.results[rk]) : [];
    const stand = sortedStandings();
    const myRes = results.find((e) => e.sid === profile.sid);
    const myStandIdx = stand.findIndex((e) => e.sid === profile.sid);
    const myStand = stand[myStandIdx];

    let title, sub;
    if (st.phase === 'lobby') {
      title = t('waitTitle');
      sub = t('waitSub', { n: room.memberCount, rounds: total });
    } else if (st.phase === 'round') {
      title = t('tallying');
      sub = t('roundOf', { r: st.round, n: total });
    } else if (st.phase === 'results') {
      title = t('roundResultTitle', { r: st.round });
      sub = t('nextWait', { r: st.round, n: total });
    } else {
      title = t('finalTitle');
      sub = myStand ? t('myFinal', { rank: t('rankN', { n: myStandIdx + 1 }), pts: myStand.total }) : t('thanks');
    }
    $('rpTitle').textContent = title;
    $('rpSub').textContent = sub;

    const canReady = st.phase === 'results' && st.round < total;
    $('readyBox').classList.toggle('hidden', !canReady);
    // 아직 준비 안 했으면 팝업으로 물어봄 ('결과 먼저 볼게요'를 누르면 그 라운드에는 다시 안 뜸)
    const info0 = canReady ? readyInfo() : null;
    const showModal = canReady && roomView === 'panel' && !info0.mine && room.modalDismissed !== st.roundKey;
    $('readyModal').classList.toggle('hidden', !showModal);
    if (showModal) {
      $('rmTitle').textContent = t('rmTitle', { r: st.round });
      $('rmMine').textContent = myRes
        ? t('rmMine', { rank: t('rankN', { n: myRes.rank }), pts: myRes.pts, total: myStand ? myStand.total : myRes.pts })
        : t('rmNoScore', { total: myStand ? myStand.total : 0 });
      let txt = (st.nextAt ? t('autoStartIn', { s: Math.max(0, Math.ceil((st.nextAt - now()) / 1000)) }) + ' · ' : '')
        + t('readyCount', { n: info0.ready.length, m: info0.online.length });
      if (info0.waiting.length && info0.waiting.length <= 8) txt += ' · ' + t('readyWaiting', { names: info0.waiting.join(', ') });
      $('rmText').textContent = txt;
    }
    if (canReady) {
      const info = readyInfo();
      const btn = $('readyBtn');
      btn.textContent = t(info.mine ? 'readyCancel' : 'readyBtn');
      btn.classList.toggle('is-ready', info.mine);
      let txt = (st.nextAt ? t('autoStartIn', { s: Math.max(0, Math.ceil((st.nextAt - now()) / 1000)) }) + ' · ' : '')
        + t('readyCount', { n: info.ready.length, m: info.online.length });
      if (info.waiting.length && info.waiting.length <= 8) txt += ' · ' + t('readyWaiting', { names: info.waiting.join(', ') });
      $('readyText').textContent = txt;
    }

    const showMine = st.phase === 'results' || st.phase === 'finished';
    $('rpMine').classList.toggle('hidden', !showMine);
    if (showMine) {
      $('rpMyRank').textContent = myRes ? t('rankN', { n: myRes.rank }) : '-';
      $('rpMyPts').textContent = myRes ? '+' + myRes.pts : '+0';
      $('rpMyTotal').textContent = myStand ? myStand.total : 0;
    }

    $('rpRoundBox').classList.toggle('hidden', !showMine || !results.length);
    if (showMine && results.length) {
      $('rpRoundTitle').textContent = t('roundResultTitle', { r: st.round });
      const top = results.slice(0, 10);
      fillTable('rpRound', ['#', t('colName'), t('colBest'), t('colPts')],
        top.map((e) => [e.rank, e.name, e.best, '+' + e.pts]), top.findIndex((e) => e.sid === profile.sid));
    }
    const showStand = st.round > 0 && stand.length > 0 && st.phase !== 'round';
    $('rpTotalBox').classList.toggle('hidden', !showStand);
    if (showStand) {
      const rows = stand.slice(0, 10).map((e, i) => [i + 1, e.name, e.total]);
      let mine = myStandIdx < 10 ? myStandIdx : -1;
      if (myStandIdx >= 10) { rows.push([myStandIdx + 1, myStand.name, myStand.total]); mine = rows.length - 1; }
      fillTable('rpTotal', ['#', t('colName'), t('colTotal')], rows, mine);
    }
  }

  // ---------- 로그인 ----------
  try {
    $('sidInput').value = localStorage.getItem('snake_sid') || '';
    $('nameInput').value = localStorage.getItem('snake_name') || '';
    $('codeInput').value = new URLSearchParams(location.search).get('room') || localStorage.getItem('snake_code') || '';
  } catch (e) { /* 저장소 사용 불가 */ }

  async function enter(mode) {
    const sid = $('sidInput').value.trim();
    const name = $('nameInput').value.trim();
    const code = $('codeInput').value.trim();
    if (mode === 'room' && !/^[0-9]{4}$/.test(code)) { setLoginError('errCode'); return; }
    if (!/^[0-9A-Za-z]{1,12}$/.test(sid)) { setLoginError('errSid'); return; }
    if (!name || name.length > 10) { setLoginError('errName'); return; }
    if (!connected) { setLoginError('errConnecting'); return; }
    if (mode === 'practice' && locked) { setLoginError('locked'); return; }
    $('joinBtn').disabled = $('practiceBtn').disabled = true;
    try {
      try {
        localStorage.setItem('snake_sid', sid); localStorage.setItem('snake_name', name);
        if (code) localStorage.setItem('snake_code', code);
      } catch (e2) { /* 무시 */ }
      if (mode === 'room') { await joinRoom(code, sid, name); return; }
      const snap = await db.ref('players/' + sid).get();
      const v = snap.val();
      if (v && now() - (+v.t || 0) < STALE_MS) { setLoginError('errDup'); return; }
      setLoginError(null);
      profile = { sid, name };
      spawn();
    } catch (ex) {
      setLoginError('errJoin', { msg: ex.message });
    } finally {
      $('joinBtn').disabled = $('practiceBtn').disabled = false;
    }
  }
  $('loginForm').addEventListener('submit', (e) => { e.preventDefault(); enter('room'); });
  $('practiceBtn').addEventListener('click', () => enter('practice'));

  $('retryBtn').addEventListener('click', () => { if (me && !me.alive) spawn(); });
  $('homeBtn').addEventListener('click', () => {
    $('dead').classList.add('hidden');
    $('login').classList.remove('hidden');
  });
  $('leaveBtn').addEventListener('click', () => leaveRoom(false));
  $('readyBtn').addEventListener('click', toggleReady);
  $('rmReady').addEventListener('click', toggleReady);
  $('rmLater').addEventListener('click', () => {
    if (room && room.state) { room.modalDismissed = room.state.roundKey; renderRoom(); }
  });

  // 명예의 전당
  let fame = [];
  db.ref('scores').orderByChild('best').limitToLast(10).on('value', (s) => {
    const list = [];
    s.forEach((c) => { const v = c.val() || {}; if (v.best) list.push(v); });
    list.sort((a, b) => b.best - a.best);
    fame = list;
    renderFame();
  });
  function renderFame() {
    const ol = $('fameList');
    ol.innerHTML = '';
    if (!fame.length) { const li = document.createElement('li'); li.className = 'muted'; li.textContent = t('noRecords'); ol.appendChild(li); }
    for (const v of fame) {
      const li = document.createElement('li');
      li.textContent = `${v.sid || ''} ${v.name || ''}`;
      const sp = document.createElement('span');
      sp.textContent = v.best;
      li.appendChild(sp);
      ol.appendChild(li);
    }
  }
  renderFame();

  // ---------- 입력 ----------
  // 마우스: 커서 방향으로 이동, 왼쪽 버튼 = 부스트
  // 터치: 손가락 위치 방향으로 이동, ⚡ 버튼 = 부스트 (두 손가락 동시 사용 가능)
  const boostBtn = $('boostBtn');
  if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
  function setBoostTouch(on, id) {
    boostTouch = on;
    boostId = on ? id : null;
    boostBtn.classList.toggle('active', on);
  }
  addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') { mouse.x = e.clientX; mouse.y = e.clientY; steerMode = 'mouse'; }
  });
  $('game').addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') {
      if (e.button === 0 && me && me.alive) boostMouse = true;
      return;
    }
    document.body.classList.add('touch');
    steerId = e.pointerId;
    mouse.x = e.clientX; mouse.y = e.clientY; steerMode = 'mouse';
  });
  $('game').addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' && e.pointerId === steerId) { mouse.x = e.clientX; mouse.y = e.clientY; }
  });
  boostBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (me && me.alive) setBoostTouch(true, e.pointerId);
  });
  const pointerEnd = (e) => {
    if (e.pointerType === 'mouse') boostMouse = false;
    if (e.pointerId === steerId) steerId = null;
    if (e.pointerId === boostId) setBoostTouch(false, null);
  };
  addEventListener('pointerup', pointerEnd);
  addEventListener('pointercancel', pointerEnd);
  addEventListener('blur', () => { boostMouse = boostKey = keyLeft = keyRight = false; setBoostTouch(false, null); });
  addEventListener('contextmenu', (e) => { if (me && me.alive) e.preventDefault(); });
  addEventListener('keydown', (e) => {
    if (!me || !me.alive) return;
    if (e.code === 'Space') { boostKey = true; e.preventDefault(); }
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') { keyLeft = true; steerMode = 'key'; }
    if (e.code === 'ArrowRight' || e.code === 'KeyD') { keyRight = true; steerMode = 'key'; }
    if (e.code === 'ArrowUp') boostKey = true;
  });
  addEventListener('keyup', (e) => {
    if (e.code === 'Space' || e.code === 'ArrowUp') boostKey = false;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') keyLeft = false;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') keyRight = false;
  });
  document.addEventListener('visibilitychange', () => {
    clearTimeout(hiddenTimer);
    if (document.hidden && me && me.alive) {
      hiddenTimer = setTimeout(() => die('deathHidden', null, null), HIDDEN_LIMIT);
    }
  });

  // ---------- 그리기 ----------
  const canvas = $('game'), ctx = canvas.getContext('2d');
  const mini = $('minimap'), mctx = mini.getContext('2d');
  let W = 0, H = 0, DPR = 1;
  let fontStack = 'sans-serif';
  function readFont() { fontStack = getComputedStyle(document.body).fontFamily || 'sans-serif'; }
  readFont();
  addEventListener('langchange', readFont);
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 1.5);
    W = innerWidth; H = innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  }
  addEventListener('resize', resize);
  resize();

  function drawSnake(s, isMe, vx0, vy0, vx1, vy1) {
    const r = radiusOf(s.mass), m = r + 150; // 150: 예측된 목 길이 여유
    if (s.maxX + m < vx0 || s.minX - m > vx1 || s.maxY + m < vy0 || s.minY - m > vy1) return;
    // 다른 플레이어는 충돌 판정과 똑같이 '몸통 + 예측된 목/머리'로 그림
    const pts = sampleTrail(s.neck ? s.pts.concat(s.neck) : s.pts, Math.max(4, r * 0.7));
    const n = pts.length, h = s.hue;
    if (s.b) {
      ctx.fillStyle = `hsla(${h},100%,65%,0.18)`;
      for (let i = 0; i < n; i += 2) { ctx.beginPath(); ctx.arc(pts[i].x, pts[i].y, r * 1.6, 0, Math.PI * 2); ctx.fill(); }
    }
    const c1 = `hsl(${h},85%,55%)`, c2 = `hsl(${h},80%,44%)`;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1.5;
    for (let i = n - 1; i >= 0; i--) {
      const t = i / Math.max(1, n - 1);
      const rr = r * taper(t);
      ctx.fillStyle = (i >> 1) % 2 ? c2 : c1;
      ctx.beginPath(); ctx.arc(pts[i].x, pts[i].y, rr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    // 눈
    const hx = s.neck ? s.hx : s.x, hy = s.neck ? s.hy : s.y, a = s.neck ? s.ha : s.a, ca = Math.cos(a), sa = Math.sin(a);
    for (const side of [-1, 1]) {
      const ex = hx + ca * r * 0.35 - sa * r * 0.45 * side, ey = hy + sa * r * 0.35 + ca * r * 0.45 * side;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(ex, ey, r * 0.32, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#111';
      ctx.beginPath(); ctx.arc(ex + ca * r * 0.12, ey + sa * r * 0.12, r * 0.17, 0, Math.PI * 2); ctx.fill();
    }
    // 이름
    ctx.font = `bold ${Math.round(14 / cam.scale)}px ${fontStack}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = isMe ? 'rgba(134,239,172,0.95)' : 'rgba(255,255,255,0.85)';
    ctx.fillText(s.name, hx, hy - r - 8 / cam.scale);
  }

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#05070c';
    ctx.fillRect(0, 0, W, H);
    const s = cam.scale;
    const vx0 = cam.x - W / 2 / s, vy0 = cam.y - H / 2 / s, vx1 = cam.x + W / 2 / s, vy1 = cam.y + H / 2 / s;
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(s, s);
    ctx.translate(-cam.x, -cam.y);

    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, WORLD, WORLD);
    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    ctx.lineWidth = 1 / s;
    ctx.beginPath();
    const g = 60;
    for (let x = Math.max(0, Math.floor(vx0 / g) * g); x <= Math.min(WORLD, vx1); x += g) { ctx.moveTo(x, Math.max(0, vy0)); ctx.lineTo(x, Math.min(WORLD, vy1)); }
    for (let y = Math.max(0, Math.floor(vy0 / g) * g); y <= Math.min(WORLD, vy1); y += g) { ctx.moveTo(Math.max(0, vx0), y); ctx.lineTo(Math.min(WORLD, vx1), y); }
    ctx.stroke();
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 8;
    ctx.strokeRect(-4, -4, WORLD + 8, WORLD + 8);

    for (const f of foods.values()) {
      if (f.pending || f.x < vx0 - 20 || f.x > vx1 + 20 || f.y < vy0 - 20 || f.y > vy1 + 20) continue;
      ctx.fillStyle = `hsla(${f.h},100%,60%,0.22)`;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r * 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `hsl(${f.h},100%,65%)`;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
    }
    for (const r of remotes.values()) if (!r.stale) drawSnake(r, false, vx0, vy0, vx1, vy1);
    if (me && me.alive) {
      if (now() - me.spawnAt < SPAWN_GRACE) ctx.globalAlpha = 0.5 + 0.3 * Math.sin(now() / 80);
      drawSnake(me, true, vx0, vy0, vx1, vy1);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function updateHud() {
    const alive = [];
    for (const r of remotes.values()) if (!r.stale) alive.push(r);
    if (me && me.alive) alive.push(me);
    alive.sort((a, b) => b.mass - a.mass);
    const ol = $('boardList');
    ol.innerHTML = '';
    alive.slice(0, 10).forEach((s) => {
      const li = document.createElement('li');
      li.textContent = s.name;
      const sp = document.createElement('span');
      sp.textContent = Math.floor(s.mass);
      li.appendChild(sp);
      if (me && s === me) li.className = 'me';
      ol.appendChild(li);
    });
    if (me && me.alive) {
      $('scoreText').textContent = t('score', { n: Math.floor(me.mass) });
      $('killText').textContent = t('kills', { n: me.kills });
      const bt = $('boostText');
      bt.textContent = t(me.tired ? 'boostOff' : 'boostOn');
      bt.className = me.tired ? 'off' : 'on';
    }
    $('onlineText').textContent = t('online', { n: alive.length });
    const rt = $('roundText');
    rt.classList.toggle('hidden', !room);
    if (room && room.state) rt.textContent = t('hudRound', { r: room.state.round, n: (room.meta || {}).rounds, time: fmtTime(room.state.endAt - now()) });
    $('help').textContent = t(document.body.classList.contains('touch') ? 'helpTouch' : 'helpMouse');

    const k = mini.width / WORLD;
    mctx.clearRect(0, 0, mini.width, mini.height);
    for (const s of alive) {
      mctx.fillStyle = s === me ? '#4ade80' : `hsl(${s.hue},80%,60%)`;
      const sz = s === me ? 5 : 3;
      mctx.fillRect(s.x * k - sz / 2, s.y * k - sz / 2, sz, sz);
    }
  }

  // ---------- 메인 루프 ----------
  let lastT = performance.now();
  function frame(t) {
    const dt = Math.min(0.033, (t - lastT) / 1000);
    lastT = t;
    const ms = dt * 1000;

    if (me && me.alive) {
      updateMe(dt);
      sendAcc += ms;
      if (sendAcc >= SEND_INTERVAL && me.alive) { sendAcc = 0; sendState(); }
      hostAcc += ms;
      if (hostAcc >= 1000) { hostAcc = 0; hostTick(); }
      saveAcc += ms;
      if (saveAcc >= SAVE_INTERVAL && me.alive) { saveAcc = 0; savePeak(); }
    }
    const rt = now() - INTERP_DELAY;
    for (const r of remotes.values()) updateRemote(r, rt, dt);
    roomTick();

    const screenK = clamp(Math.min(W, H) / 850, 0.7, 1.3);
    let target;
    if (me && me.alive) {
      cam.x = me.x; cam.y = me.y;
      target = screenK * clamp(1.05 - radiusOf(me.mass) * 0.011, 0.6, 1);
    } else if (!me) {
      if (room) { cam.x = WORLD / 2; cam.y = WORLD / 2; }
      target = screenK * 0.6;
    } else target = cam.scale;
    cam.scale += (target - cam.scale) * Math.min(1, dt * 3);

    render();
    hudAcc += ms;
    if (hudAcc >= 300) { hudAcc = 0; updateHud(); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
