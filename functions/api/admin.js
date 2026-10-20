// POST /api/admin — 관리자 작업 (오류는 code 로 돌려주고, 화면 문구는 브라우저에서 언어별로 표시)
// 비밀번호(ADMIN_PASSWORD)는 서버에서만 확인하고, 실제 쓰기는 Firebase 비밀키(FIREBASE_DB_SECRET)로 수행합니다.
// 보안 규칙상 settings, 게임방 설정/진행 상태/순위, 오목 리그, 전체 삭제는 비밀키로만 가능합니다.

import { ApiError, envReady, fb, int, json, roomCode, sameText } from '../../server/firebase.js';
import { OMOK_ADMIN } from '../../server/omok.js';

const COUNTDOWN_MS = 4000;      // 라운드 시작 전 카운트다운
const FINISH_GRACE_MS = 2000;   // 라운드 종료 후 마지막 점수가 도착할 때까지 기다리는 시간
const F1_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

async function loadRoom(env, code) {
  const [meta, state] = await Promise.all([fb(env, 'GET', `rooms/${code}/meta`), fb(env, 'GET', `rooms/${code}/state`)]);
  if (!meta || !state) throw new ApiError('room_not_found', 404);
  return { meta, state };
}

// 라운드 순위 → F1 승점 (+ 처치 보너스), 누적 순위 갱신
function scoreRound(meta, state, scores, members, standings) {
  const rk = state.roundKey;
  const list = Object.entries(scores || {})
    .map(([sid, v]) => ({
      sid,
      name: String((v && v.name) || (members[sid] && members[sid].name) || sid).slice(0, 20),
      best: Math.floor(Number(v && v.best) || 0),
      kills: Math.floor(Number(v && v.kills) || 0)
    }))
    .filter((e) => e.best > 0 || e.kills > 0)
    .sort((a, b) => b.best - a.best || b.kills - a.kills || (a.sid < b.sid ? -1 : 1));
  const points = Array.isArray(meta.points) ? meta.points : F1_POINTS;
  const killBonus = Number(meta.killBonus) || 0;
  list.forEach((e, i) => {
    e.rank = i + 1;
    e.pts = (Number(points[i]) || 0) + e.kills * killBonus;
  });

  const next = {};
  const ids = new Set([...Object.keys(standings || {}), ...Object.keys(members || {}), ...list.map((e) => e.sid)]);
  for (const sid of ids) {
    const prev = (standings && standings[sid]) || {};
    const row = list.find((e) => e.sid === sid);
    const name = (row && row.name) || prev.name || (members[sid] && members[sid].name) || sid;
    const r = Object.assign({}, prev.r || {});
    r[rk] = row ? row.pts : 0;
    next[sid] = {
      name: String(name).slice(0, 20),
      total: (Number(prev.total) || 0) + (row ? row.pts : 0),
      r
    };
  }
  return { results: list, standings: next };
}

const ACTIONS = {
  // ----- 연습 모드 -----
  async check(env) { await fb(env, 'GET', 'settings'); return {}; },
  async lock(env) { await fb(env, 'PUT', 'settings/locked', true); return {}; },
  async unlock(env) { await fb(env, 'PUT', 'settings/locked', false); return {}; },
  async clearFood(env) { await fb(env, 'DELETE', 'food'); return {}; },
  async resetScores(env) { await fb(env, 'DELETE', 'scores'); await fb(env, 'DELETE', 'notices'); return {}; },

  // ----- 대회 (게임방) -----
  async createRoom(env, body) {
    const name = String(body.name || '').trim().slice(0, 30);
    if (!name) throw new ApiError('bad_request');
    const rounds = int(body.rounds, 1, 20);
    const duration = int(body.duration, 30, 1800);
    const killBonus = int(body.killBonus || 0, 0, 10);
    let points = Array.isArray(body.points) ? body.points : F1_POINTS;
    points = points.slice(0, 30).map((p) => int(p, 0, 100));
    if (!points.length) throw new ApiError('bad_request');

    let code = null;
    for (let i = 0; i < 30 && !code; i++) {
      const c = String(1000 + Math.floor(Math.random() * 9000));
      if ((await fb(env, 'GET', `rooms/${c}/meta`)) === null) code = c;
    }
    if (!code) throw new ApiError('server', 500, 'no free code');
    const createdAt = Date.now();
    await fb(env, 'PUT', `rooms/${code}`, {
      meta: { name, rounds, duration, points, killBonus, createdAt },
      state: { phase: 'lobby', round: 0 }
    });
    await fb(env, 'PUT', `roomIndex/${code}`, { name, createdAt, rounds });
    return { code };
  },

  async startRound(env, body) {
    const code = roomCode(body.code);
    const { meta, state } = await loadRoom(env, code);
    if (state.phase !== 'lobby' && state.phase !== 'results') throw new ApiError('bad_phase', 409);
    const round = (Number(state.round) || 0) + 1;
    if (round > meta.rounds) throw new ApiError('bad_phase', 409);
    const startAt = Date.now() + COUNTDOWN_MS;
    await fb(env, 'PATCH', `rooms/${code}`, {
      players: null,
      food: null,
      notices: null,
      state: { phase: 'round', round, roundKey: 'r' + round, startAt, endAt: startAt + meta.duration * 1000 }
    });
    return {};
  },

  async endRoundNow(env, body) {
    const code = roomCode(body.code);
    const { state } = await loadRoom(env, code);
    if (state.phase !== 'round') throw new ApiError('bad_phase', 409);
    const t = Date.now();
    if (t < state.endAt) {
      await fb(env, 'PATCH', `rooms/${code}/state`, { endAt: t, startAt: Math.min(state.startAt, t) });
    }
    return {};
  },

  async finishRound(env, body) {
    const code = roomCode(body.code);
    const { meta, state } = await loadRoom(env, code);
    if (state.phase !== 'round') return { already: true };
    if (Date.now() < state.endAt + FINISH_GRACE_MS) throw new ApiError('round_not_over', 409);
    const [scores, members, standings] = await Promise.all([
      fb(env, 'GET', `rooms/${code}/roundScores/${state.roundKey}`),
      fb(env, 'GET', `rooms/${code}/members`),
      fb(env, 'GET', `rooms/${code}/standings`)
    ]);
    const out = scoreRound(meta, state, scores, members || {}, standings || {});
    const finished = state.round >= meta.rounds;
    await fb(env, 'PATCH', `rooms/${code}`, {
      [`roundResults/${state.roundKey}`]: out.results.length ? out.results : null,
      standings: out.standings,
      players: null,
      state: { phase: finished ? 'finished' : 'results', round: state.round, roundKey: state.roundKey }
    });
    return { finished };
  },

  async deleteRoom(env, body) {
    const code = roomCode(body.code);
    await fb(env, 'DELETE', `rooms/${code}`);
    await fb(env, 'DELETE', `roomIndex/${code}`);
    return {};
  },

  // ----- 오목 리그 -----
  ...OMOK_ADMIN
};

export async function onRequestPost({ request, env }) {
  if (!env.ADMIN_PASSWORD || !envReady(env)) {
    return json({ ok: false, code: 'env_missing' }, 500);
  }
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, code: 'bad_request' }, 400); }

  if (!(await sameText(String(body.password || ''), String(env.ADMIN_PASSWORD)))) {
    await new Promise((r) => setTimeout(r, 700)); // 무작위 대입 속도 늦추기
    return json({ ok: false, code: 'bad_password' }, 401);
  }
  const fn = Object.prototype.hasOwnProperty.call(ACTIONS, body.action) ? ACTIONS[body.action] : null;
  if (!fn) return json({ ok: false, code: 'unknown_action' }, 400);

  try {
    const out = await fn(env, body);
    return json(Object.assign({ ok: true }, out));
  } catch (e) {
    if (e instanceof ApiError) return json({ ok: false, code: e.code, detail: e.detail }, e.status);
    return json({ ok: false, code: 'server', detail: String(e && e.message) }, 500);
  }
}
