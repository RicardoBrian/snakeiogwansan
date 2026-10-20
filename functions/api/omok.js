// POST /api/omok — 오목 리그 학생 작업 (등록/다시 접속, 수 두기, 기권, 시간초과 처리)
// 학생은 등록할 때 받은 토큰(이 기기에만 저장)으로 본인임을 확인합니다. 대국 기록은 서버만 씁니다.

import { ApiError, envReady, json } from '../../server/firebase.js';
import { OMOK_PLAYER } from '../../server/omok.js';

export async function onRequestPost({ request, env }) {
  if (!envReady(env)) return json({ ok: false, code: 'env_missing' }, 500);
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, code: 'bad_request' }, 400); }
  const fn = Object.prototype.hasOwnProperty.call(OMOK_PLAYER, body.action) ? OMOK_PLAYER[body.action] : null;
  if (!fn) return json({ ok: false, code: 'unknown_action' }, 400);

  try {
    const out = await fn(env, body);
    return json(Object.assign({ ok: true }, out));
  } catch (e) {
    if (e instanceof ApiError) return json({ ok: false, code: e.code, detail: e.detail }, e.status);
    return json({ ok: false, code: 'server', detail: String(e && e.message) }, 500);
  }
}
