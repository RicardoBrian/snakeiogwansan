// 오목 리그 (모두가 서로 한 번씩 대국하는 리그전)
// 데이터 위치: omok/{code}/...   목록: omokIndex/{code}
//   meta     { name, moveTime(초), win, draw, loss, rounds, createdAt }
//   state    { phase: register → ready → round ⇄ results → finished, round, startAt }
//   members  { [학번]: { name, th(로그인 토큰 해시), at } }
//   games    { r1: { m1: { b(흑 학번), w(백 학번), mv[수 목록, y*15+x], at(지금 차례 시작 시각), res(b|w|d), why, line } } }
//   byes     { r1: 학번 }  (인원이 홀수일 때 그 라운드에 쉬는 학생)
// 수 두기/기권/시간초과는 서버(여기)만 기록합니다. 학생 브라우저는 읽기만 가능합니다.

import { ApiError, fb, fbTx, int, roomCode, sha256Hex } from './firebase.js';

export const SIZE = 15;
const COUNTDOWN_MS = 3000;  // 라운드 시작 전 카운트다운
const GRACE_MS = 1500;      // 제한 시간이 지나도 이만큼은 네트워크 지연으로 보고 수를 받아 줌
const SID_RE = /^[0-9A-Za-z]{1,12}$/;

const sidOf = (v) => {
  const s = String(v || '');
  if (!SID_RE.test(s)) throw new ApiError('bad_request');
  return s;
};

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 흑/백 고르게: 모두가 서로 한 번씩 두는 대국을 한붓그리기(오일러 회로) 방향대로 흑→백으로 정하면
// 각 학생의 흑 횟수와 백 횟수가 같아짐 (인원이 짝수면 최대 1번 차이)
function blackOf(sids) {
  const v = sids.slice();
  if (v.length % 2 === 0) v.push(null); // 가상의 학생을 넣어 모든 학생의 대국 수를 짝수로
  const used = new Set();
  const adj = v.map((_, i) => shuffle(v.map((_, j) => j).filter((j) => j !== i)));
  const stack = [0], path = [];
  while (stack.length) {
    const u = stack[stack.length - 1];
    let next = -1;
    while (adj[u].length) {
      const w = adj[u].pop();
      const k = Math.min(u, w) + '-' + Math.max(u, w);
      if (!used.has(k)) { used.add(k); next = w; break; }
    }
    if (next >= 0) stack.push(next); else path.push(stack.pop());
  }
  const black = {};
  for (let i = 0; i + 1 < path.length; i++) {
    const a = v[path[i]], b = v[path[i + 1]];
    if (a !== null && b !== null) black[[a, b].sort().join('|')] = a;
  }
  return black;
}

// 원형 방식 리그 대진: n명이 짝수면 n-1 라운드, 홀수면 n 라운드(라운드마다 1명 쉼)
export function makeSchedule(sids) {
  const black = blackOf(sids);
  const p = shuffle(sids.slice());
  if (p.length % 2) p.push(null);
  const n = p.length, rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const games = [];
    let bye = null;
    for (let i = 0; i < n / 2; i++) {
      const a = p[i], b = p[n - 1 - i];
      if (a === null || b === null) { bye = a === null ? b : a; continue; }
      const bk = black[[a, b].sort().join('|')];
      games.push({ b: bk, w: bk === a ? b : a });
    }
    rounds.push({ games: shuffle(games), bye });
    p.splice(1, 0, p.pop()); // 첫 자리는 고정하고 나머지를 한 칸씩 돌림
  }
  return shuffle(rounds);
}

// 방금 둔 돌로 5개 이상 이어졌는지 (자유 규칙: 6목 이상도 승리)
export function fiveFrom(board, pos) {
  const color = board[pos];
  const x0 = pos % SIZE, y0 = Math.floor(pos / SIZE);
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    const line = [pos];
    for (const s of [1, -1]) {
      let x = x0 + dx * s, y = y0 + dy * s;
      while (x >= 0 && y >= 0 && x < SIZE && y < SIZE && board[y * SIZE + x] === color) {
        line.push(y * SIZE + x);
        x += dx * s; y += dy * s;
      }
    }
    if (line.length >= 5) return line.sort((a, b) => a - b);
  }
  return null;
}

// 학번이 숫자(1, 2, 3…)면 Firebase 가 객체 대신 배열(빈 칸은 null)로 돌려주므로 객체로 맞춤
const objOf = (v) => Object.fromEntries(Object.entries(v || {}).filter(([, x]) => x != null));
const movesOf = (g) => (Array.isArray(g.mv) ? g.mv : Object.values(g.mv || {})).map(Number);
const turnOf = (g) => (movesOf(g).length % 2 === 0 ? 'b' : 'w');
const deadline = (g, meta) => (Number(g.at) || 0) + (Number(meta.moveTime) || 30) * 1000;

async function loadLeague(env, code) {
  const [meta, state] = await Promise.all([fb(env, 'GET', `omok/${code}/meta`), fb(env, 'GET', `omok/${code}/state`)]);
  if (!meta || !state) throw new ApiError('room_not_found', 404);
  return { meta, state };
}

// 라운드를 끝낼 때 남은 대국 정리: 차례인 학생의 시간이 이미 지났으면 시간패, 아니면 무승부
function closeGame(g, meta, t) {
  if (!g || g.res) return undefined;
  if (t > deadline(g, meta) + GRACE_MS) return Object.assign({}, g, { res: turnOf(g) === 'b' ? 'w' : 'b', why: 'timeout' });
  return Object.assign({}, g, { res: 'd', why: 'end' });
}

// ===================== 관리자 작업 (비밀번호 확인 후 호출) =====================
export const OMOK_ADMIN = {
  async omokCreate(env, body) {
    const name = String(body.name || '').trim().slice(0, 30);
    if (!name) throw new ApiError('bad_request');
    const moveTime = int(body.moveTime, 5, 600);
    const win = int(body.win, 0, 100), draw = int(body.draw, 0, 100), loss = int(body.loss, 0, 100);

    let code = null;
    for (let i = 0; i < 30 && !code; i++) {
      const c = String(1000 + Math.floor(Math.random() * 9000));
      if ((await fb(env, 'GET', `omokIndex/${c}`)) === null) code = c;
    }
    if (!code) throw new ApiError('server', 500, 'no free code');
    const createdAt = Date.now();
    await fb(env, 'PUT', `omok/${code}`, {
      meta: { name, moveTime, win, draw, loss, rounds: 0, createdAt },
      state: { phase: 'register', round: 0 }
    });
    await fb(env, 'PUT', `omokIndex/${code}`, { name, createdAt });
    return { code };
  },

  // 등록 기간에만: 잘못 등록한 학생 빼기
  async omokRemoveMember(env, body) {
    const code = roomCode(body.code), sid = sidOf(body.sid);
    const { state } = await loadLeague(env, code);
    if (state.phase !== 'register') throw new ApiError('bad_phase', 409);
    await fb(env, 'DELETE', `omok/${code}/members/${sid}`);
    return {};
  },

  // 다른 컴퓨터로 옮긴 학생이 다시 들어올 수 있게 로그인 풀기 (다음에 처음 들어오는 기기가 주인이 됨)
  async omokResetLogin(env, body) {
    const code = roomCode(body.code), sid = sidOf(body.sid);
    await loadLeague(env, code);
    if ((await fb(env, 'GET', `omok/${code}/members/${sid}/name`)) === null) throw new ApiError('not_member', 404);
    await fb(env, 'DELETE', `omok/${code}/members/${sid}/th`);
    return {};
  },

  // 등록 마감 + 무작위 대진 생성 (첫 라운드 시작 전이면 다시 섞기 가능)
  async omokSchedule(env, body) {
    const code = roomCode(body.code);
    const { state } = await loadLeague(env, code);
    if (state.phase !== 'register' && state.phase !== 'ready') throw new ApiError('bad_phase', 409);
    const members = objOf(await fb(env, 'GET', `omok/${code}/members`));
    const sids = Object.keys(members);
    if (sids.length < 2) throw new ApiError('too_few', 409);
    const rounds = makeSchedule(sids);
    const games = {}, byes = {};
    rounds.forEach((r, i) => {
      const rk = 'r' + (i + 1);
      games[rk] = {};
      r.games.forEach((g, j) => { games[rk]['m' + (j + 1)] = g; });
      if (r.bye) byes[rk] = r.bye;
    });
    await fb(env, 'PATCH', `omok/${code}`, {
      games, byes: Object.keys(byes).length ? byes : null,
      'meta/rounds': rounds.length,
      state: { phase: 'ready', round: 0 }
    });
    return { rounds: rounds.length };
  },

  // 대진을 지우고 등록을 다시 받기 (첫 라운드 시작 전만)
  async omokReopen(env, body) {
    const code = roomCode(body.code);
    const { state } = await loadLeague(env, code);
    if (state.phase !== 'ready') throw new ApiError('bad_phase', 409);
    await fb(env, 'PATCH', `omok/${code}`, { games: null, byes: null, 'meta/rounds': 0, state: { phase: 'register', round: 0 } });
    return {};
  },

  async omokStartRound(env, body) {
    const code = roomCode(body.code);
    const { meta, state } = await loadLeague(env, code);
    if (state.phase !== 'ready' && state.phase !== 'results') throw new ApiError('bad_phase', 409);
    const round = (Number(state.round) || 0) + 1;
    if (round > (Number(meta.rounds) || 0)) throw new ApiError('bad_phase', 409);
    const rk = 'r' + round;
    const games = (await fb(env, 'GET', `omok/${code}/games/${rk}`)) || {};
    const startAt = Date.now() + COUNTDOWN_MS;
    const patch = { state: { phase: 'round', round, startAt } };
    // 관리자가 미리 결과를 정해 둔 대국은 그대로 두고, 나머지는 첫 수(흑) 시계를 시작
    for (const [mid, g] of Object.entries(games)) if (!g.res) patch[`games/${rk}/${mid}/at`] = startAt;
    await fb(env, 'PATCH', `omok/${code}`, patch);
    return {};
  },

  // 라운드 종료: 아직 안 끝난 대국은 시간패(차례인 학생의 시간이 이미 지난 경우) 또는 무승부
  async omokEndRound(env, body) {
    const code = roomCode(body.code);
    const { meta, state } = await loadLeague(env, code);
    if (state.phase !== 'round') throw new ApiError('bad_phase', 409);
    const rk = 'r' + state.round;
    const games = (await fb(env, 'GET', `omok/${code}/games/${rk}`)) || {};
    const t = Date.now();
    await Promise.all(Object.keys(games).map((mid) =>
      fbTx(env, `omok/${code}/games/${rk}/${mid}`, (g) => closeGame(g, meta, t))));
    const finished = state.round >= meta.rounds;
    await fb(env, 'PUT', `omok/${code}/state`, { phase: finished ? 'finished' : 'results', round: state.round });
    return { finished };
  },

  // 결과 직접 정하기/고치기 (접속 문제, 이의 제기 등). res: b(흑승) w(백승) d(무승부)
  async omokSetResult(env, body) {
    const code = roomCode(body.code);
    const round = int(body.round, 1, 200);
    const mid = String(body.mid || '');
    if (!/^m[0-9]{1,3}$/.test(mid)) throw new ApiError('bad_request');
    const res = String(body.res || '');
    if (!['b', 'w', 'd'].includes(res)) throw new ApiError('bad_request');
    await loadLeague(env, code);
    await fbTx(env, `omok/${code}/games/r${round}/${mid}`, (g) => {
      if (!g) throw new ApiError('not_found', 404);
      const out = Object.assign({}, g, { res, why: 'admin' });
      delete out.line;
      return out;
    });
    return {};
  },

  async omokDelete(env, body) {
    const code = roomCode(body.code);
    await fb(env, 'DELETE', `omok/${code}`);
    await fb(env, 'DELETE', `omokIndex/${code}`);
    return {};
  }
};

// ===================== 학생 작업 (/api/omok, 비밀번호 없음) =====================
async function auth(env, code, body) {
  const sid = sidOf(body.sid);
  const token = String(body.token || '');
  const member = await fb(env, 'GET', `omok/${code}/members/${sid}`);
  if (!member) throw new ApiError('not_member', 403);
  if (!member.th || !token || (await sha256Hex(token)) !== member.th) throw new ApiError('bad_token', 403);
  return sid;
}

// 지금 라운드에서 이 학생의 대국을 찾아 고침
async function updateMyGame(env, body, fn) {
  const code = roomCode(body.code);
  const sid = await auth(env, code, body);
  const { meta, state } = await loadLeague(env, code);
  if (state.phase !== 'round') throw new ApiError('bad_phase', 409);
  const mid = String(body.mid || '');
  if (!/^m[0-9]{1,3}$/.test(mid)) throw new ApiError('bad_request');
  const t = Date.now();
  if (t < Number(state.startAt) - 300) throw new ApiError('not_started', 409);
  const out = {};
  await fbTx(env, `omok/${code}/games/r${state.round}/${mid}`, (g) => {
    if (!g) throw new ApiError('not_found', 404);
    const color = g.b === sid ? 'b' : g.w === sid ? 'w' : null;
    if (!color) throw new ApiError('not_your_game', 403);
    if (g.res) throw new ApiError('game_over', 409);
    return fn(g, color, meta, t, out);
  });
  return out;
}

export const OMOK_PLAYER = {
  // 등록(등록 기간) 또는 다시 접속(이 기기에 받은 토큰으로)
  async register(env, body) {
    const code = roomCode(body.code), sid = sidOf(body.sid);
    const name = String(body.name || '').trim().slice(0, 10);
    const { state } = await loadLeague(env, code);
    const member = await fb(env, 'GET', `omok/${code}/members/${sid}`);
    const token = String(body.token || '');
    if (member && member.th) {
      if (token && (await sha256Hex(token)) === member.th) return { token, name: member.name };
      throw new ApiError('already_registered', 409);
    }
    const fresh = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    const th = await sha256Hex(fresh);
    if (member) {
      // 관리자가 로그인을 풀어 준 학생: 이름은 등록 때 그대로
      await fb(env, 'PATCH', `omok/${code}/members/${sid}`, { th });
      return { token: fresh, name: member.name };
    }
    if (state.phase !== 'register') throw new ApiError('closed', 409);
    if (!name) throw new ApiError('bad_request');
    await fb(env, 'PUT', `omok/${code}/members/${sid}`, { name, th, at: Date.now() });
    return { token: fresh, name };
  },

  async move(env, body) {
    const pos = int(body.pos, 0, SIZE * SIZE - 1);
    return updateMyGame(env, body, (g, color, meta, t, out) => {
      const mv = movesOf(g);
      if (turnOf(g) !== color) throw new ApiError('not_your_turn', 409);
      if (t > deadline(g, meta) + GRACE_MS) {
        out.timeout = true;
        return Object.assign({}, g, { res: color === 'b' ? 'w' : 'b', why: 'timeout' });
      }
      if (mv.includes(pos)) throw new ApiError('occupied', 409);
      const board = new Array(SIZE * SIZE).fill(null);
      mv.forEach((p, i) => { board[p] = i % 2 === 0 ? 'b' : 'w'; });
      board[pos] = color;
      const next = Object.assign({}, g, { mv: mv.concat(pos), at: t });
      const line = fiveFrom(board, pos);
      if (line) Object.assign(next, { res: color, why: 'five', line });
      else if (next.mv.length >= SIZE * SIZE) Object.assign(next, { res: 'd', why: 'full' });
      return next;
    });
  },

  async resign(env, body) {
    return updateMyGame(env, body, (g, color) => Object.assign({}, g, { res: color === 'b' ? 'w' : 'b', why: 'resign' }));
  },

  // 상대(또는 본인)의 제한 시간이 지났을 때 시간패 처리
  async timeout(env, body) {
    return updateMyGame(env, body, (g, color, meta, t) => {
      if (t <= deadline(g, meta) + GRACE_MS) throw new ApiError('not_yet', 409);
      return Object.assign({}, g, { res: turnOf(g) === 'b' ? 'w' : 'b', why: 'timeout' });
    });
  }
};
