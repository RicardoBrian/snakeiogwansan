// 오목 연습 모드 (관리자·코드 없이, 들어온 학생끼리 자유 대국)
// 데이터 위치: omokPractice/...
//   players/{학번}  { name, th(로그인 토큰 해시), at }
//   online/{학번}   { t }   로비에 있다는 신호 (학생 브라우저가 3초마다 갱신)
//   tables/{id}     { b, w, bn, wn (자리·이름, 비어 있으면 없음), mv[수 목록], at(지금 차례 시작 시각), moveTime,
//                     res(b|w|d), why, line, created, rematch(다음 판 테이블 id) }
// 수 두기/기권/시간초과/한 판 더는 서버(여기)만 기록합니다. 학생 브라우저는 읽기만 가능합니다.

import { ApiError, fb, fbTx, int, sha256Hex } from './firebase.js';
import { SIZE, fiveFrom, movesOf, turnOf } from './omok.js';

const SID_RE = /^[0-9A-Za-z]{1,12}$/;
const MOVE_TIME = 60;        // 연습은 한 수 60초
const GRACE_MS = 1500;
const ONLINE_MS = 8000;      // 이 안에 신호가 있으면 접속 중
const KEEP_DONE_MS = 15 * 60 * 1000;
const KEEP_IDLE_MS = 30 * 60 * 1000;

const sidOf = (v) => {
  const s = String(v || '');
  if (!SID_RE.test(s)) throw new ApiError('bad_request');
  return s;
};
const tidOf = (v) => {
  const s = String(v || '');
  if (!/^t[0-9a-z]{4,20}$/.test(s)) throw new ApiError('bad_request');
  return s;
};
const newTid = () => 't' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36).padStart(2, '0');
const deadline = (g) => (Number(g.at) || 0) + (Number(g.moveTime) || MOVE_TIME) * 1000;
const seated = (g) => !!(g.b && g.w);
const colorOf = (g, sid) => (g.b === sid ? 'b' : g.w === sid ? 'w' : null);
const other = (c) => (c === 'b' ? 'w' : 'b');

async function auth(env, body) {
  const sid = sidOf(body.sid);
  const token = String(body.token || '');
  const p = await fb(env, 'GET', `omokPractice/players/${sid}`);
  if (!p || !p.th || !token || (await sha256Hex(token)) !== p.th) throw new ApiError('bad_token', 403);
  return { sid, name: p.name };
}

// 이 학생이 아직 안 끝난 대국(상대를 기다리는 테이블 포함)에 앉아 있는지
function activeTableOf(tables, sid) {
  for (const [id, g] of Object.entries(tables || {})) {
    if (g && !g.res && colorOf(g, sid)) return id;
  }
  return null;
}

// 오래 방치된 테이블 정리
function staleIds(tables, t) {
  const out = [];
  for (const [id, g] of Object.entries(tables || {})) {
    if (!g) { out.push(id); continue; }
    const last = Number(g.at) || Number(g.created) || 0;
    if (g.res ? t - last > KEEP_DONE_MS : t - last > KEEP_IDLE_MS) out.push(id);
  }
  return out;
}

async function updateTable(env, body, fn) {
  const me = await auth(env, body);
  const tid = tidOf(body.tid);
  const t = Date.now();
  const out = {};
  await fbTx(env, `omokPractice/tables/${tid}`, (g) => {
    if (!g) throw new ApiError('not_found', 404);
    return fn(g, me, t, out);
  });
  return out;
}

export const OMOK_PRACTICE = {
  // 입장: 이 기기의 토큰으로 다시 들어오거나 새로 등록. 다른 기기에서 접속 중인 학번이면 거절
  async pRegister(env, body) {
    const sid = sidOf(body.sid);
    const name = String(body.name || '').trim().slice(0, 10);
    if (!name) throw new ApiError('bad_request');
    const token = String(body.token || '');
    const p = await fb(env, 'GET', `omokPractice/players/${sid}`);
    if (p && p.th && token && (await sha256Hex(token)) === p.th) {
      if (p.name !== name) await fb(env, 'PATCH', `omokPractice/players/${sid}`, { name });
      return { token, name };
    }
    if (p && p.th) {
      const on = await fb(env, 'GET', `omokPractice/online/${sid}`);
      if (on && Date.now() - (Number(on.t) || 0) < ONLINE_MS) throw new ApiError('already_registered', 409);
    }
    const fresh = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    await fb(env, 'PUT', `omokPractice/players/${sid}`, { name, th: await sha256Hex(fresh), at: Date.now() });
    return { token: fresh, name };
  },

  // 새 대국 만들기: 내가 앉고(흑/백 무작위) 상대를 기다림
  async pCreate(env, body) {
    const me = await auth(env, body);
    const tables = (await fb(env, 'GET', 'omokPractice/tables')) || {};
    const t = Date.now();
    const mine = activeTableOf(tables, me.sid);
    if (mine) return { tid: mine, existing: true };
    await Promise.all(staleIds(tables, t).map((id) => fb(env, 'DELETE', `omokPractice/tables/${id}`)));
    const tid = newTid();
    const black = Math.random() < 0.5;
    await fb(env, 'PUT', `omokPractice/tables/${tid}`, Object.assign(
      { created: t, at: 0, moveTime: MOVE_TIME },
      black ? { b: me.sid, bn: me.name } : { w: me.sid, wn: me.name }));
    return { tid };
  },

  // 열린 대국에 앉기 → 바로 시작
  async pJoin(env, body) {
    const me = await auth(env, body);
    const tid = tidOf(body.tid);
    const tables = (await fb(env, 'GET', 'omokPractice/tables')) || {};
    const mine = activeTableOf(tables, me.sid);
    if (mine && mine !== tid) throw new ApiError('in_table', 409, mine);
    await updateTable(env, body, (g, who, t) => {
      if (colorOf(g, who.sid)) return undefined;     // 이미 앉아 있음
      if (g.res) throw new ApiError('game_over', 409);
      if (seated(g)) throw new ApiError('table_full', 409);
      const seat = g.b ? 'w' : 'b';
      return Object.assign({}, g, { [seat]: who.sid, [seat + 'n']: who.name, at: t });
    });
    return { tid };
  },

  async pMove(env, body) {
    const pos = int(body.pos, 0, SIZE * SIZE - 1);
    return updateTable(env, body, (g, me, t, out) => {
      const color = colorOf(g, me.sid);
      if (!color) throw new ApiError('not_your_game', 403);
      if (g.res) throw new ApiError('game_over', 409);
      if (!seated(g)) throw new ApiError('waiting', 409);
      const mv = movesOf(g);
      if (turnOf(g) !== color) throw new ApiError('not_your_turn', 409);
      if (t > deadline(g) + GRACE_MS) {
        out.timeout = true;
        return Object.assign({}, g, { res: other(color), why: 'timeout' });
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

  // 나가기: 혼자 기다리던 테이블이면 없애고, 대국 중이면 기권, 끝난 대국이면 아무 일 없음
  async pLeave(env, body) {
    const me = await auth(env, body);
    const tid = tidOf(body.tid);
    const g = await fb(env, 'GET', `omokPractice/tables/${tid}`);
    if (!g || !colorOf(g, me.sid)) return {};
    if (!seated(g) && !g.res) {
      // 기다리는 동안 상대가 앉았을 수 있으니 아직 혼자일 때만 지움
      await fbTx(env, `omokPractice/tables/${tid}`, (cur) => (cur && !seated(cur) && !cur.res ? null : undefined));
      return {};
    }
    await updateTable(env, body, (cur, who) => {
      if (cur.res || !seated(cur)) return undefined;
      return Object.assign({}, cur, { res: other(colorOf(cur, who.sid)), why: 'resign' });
    });
    return {};
  },

  // 차례인 쪽의 제한 시간이 지났을 때 시간패 (양쪽 모두 요청 가능)
  async pTimeout(env, body) {
    return updateTable(env, body, (g, me, t) => {
      if (!colorOf(g, me.sid)) throw new ApiError('not_your_game', 403);
      if (g.res || !seated(g)) return undefined;
      if (t <= deadline(g) + GRACE_MS) throw new ApiError('not_yet', 409);
      return Object.assign({}, g, { res: other(turnOf(g)), why: 'timeout' });
    });
  },

  // 한 판 더: 같은 두 사람이 흑백을 바꿔 새 테이블에 앉음 (먼저 누른 쪽이 만들고, 상대는 그 테이블로 들어옴)
  async pRematch(env, body) {
    const tid2 = newTid();
    let made = null;
    const out = await updateTable(env, body, (g, me, t, o) => {
      made = null; // 다시 시도되는 경우를 위해 매번 초기화
      if (!colorOf(g, me.sid)) throw new ApiError('not_your_game', 403);
      if (!g.res || !seated(g)) throw new ApiError('bad_phase', 409);
      if (g.rematch) { o.tid = g.rematch; return undefined; }
      made = { created: t, at: t, moveTime: MOVE_TIME, b: g.w, bn: g.wn, w: g.b, wn: g.bn };
      o.tid = tid2;
      return Object.assign({}, g, { rematch: tid2 });
    });
    if (made) await fb(env, 'PUT', `omokPractice/tables/${tid2}`, made);
    return { tid: out.tid };
  }
};
