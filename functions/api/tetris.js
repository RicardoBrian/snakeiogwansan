// POST /api/tetris — 테트리스 오픈 방(연습) 학생 작업: 방 만들어 두기, 다음 판 시작 요청
// 판이 끝났는지는 서버가 다시 확인하므로, 아무 때나 요청해도 판이 겹치지 않습니다.

import { ApiError, cleanEnv, envReady, json } from '../../server/firebase.js';
import { TETRIS_PLAYER } from '../../server/tetris.js';

export async function onRequestPost({ request, env: rawEnv }) {
  const env = cleanEnv(rawEnv);
  if (!envReady(env)) return json({ ok: false, code: 'env_missing' }, 500);
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, code: 'bad_request' }, 400); }
  const fn = Object.prototype.hasOwnProperty.call(TETRIS_PLAYER, body.action) ? TETRIS_PLAYER[body.action] : null;
  if (!fn) return json({ ok: false, code: 'unknown_action' }, 400);
  try {
    return json(Object.assign({ ok: true }, await fn(env, body)));
  } catch (e) {
    if (e instanceof ApiError) return json({ ok: false, code: e.code, detail: e.detail }, e.status);
    return json({ ok: false, code: 'server', detail: String(e && e.message) }, 500);
  }
}
