// POST /api/admin — 관리자 작업 (오류는 code 로 돌려주고, 화면 문구는 브라우저에서 언어별로 표시)
// 비밀번호(ADMIN_PASSWORD)는 서버에서만 확인하고, 실제 쓰기는 Firebase 비밀키(FIREBASE_DB_SECRET)로 수행합니다.
// 보안 규칙상 settings, 전체 scores/food 삭제는 비밀키로만 가능합니다.
const ACTIONS = {
  check: [['settings', 'GET']],
  lock: [['settings/locked', 'PUT', true]],
  unlock: [['settings/locked', 'PUT', false]],
  clearFood: [['food', 'DELETE']],
  resetScores: [['scores', 'DELETE'], ['notices', 'DELETE']]
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

async function sameText(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b))
  ]);
  const p = new Uint8Array(x), q = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < p.length; i++) diff |= p[i] ^ q[i];
  return diff === 0;
}

function dbUrl(env, path) {
  const u = new URL(env.FIREBASE_DATABASE_URL);
  u.pathname = u.pathname.replace(/\/$/, '') + '/' + path + '.json';
  u.searchParams.set('auth', env.FIREBASE_DB_SECRET);
  return u.toString();
}

export async function onRequestPost({ request, env }) {
  if (!env.ADMIN_PASSWORD || !env.FIREBASE_DB_SECRET || !env.FIREBASE_DATABASE_URL) {
    return json({ ok: false, code: 'env_missing' }, 500);
  }
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, code: 'bad_request' }, 400); }

  if (!(await sameText(String(body.password || ''), String(env.ADMIN_PASSWORD)))) {
    await new Promise((r) => setTimeout(r, 700)); // 무작위 대입 속도 늦추기
    return json({ ok: false, code: 'bad_password' }, 401);
  }
  const ops = ACTIONS[body.action];
  if (!ops) return json({ ok: false, code: 'unknown_action' }, 400);

  for (const [path, method, value] of ops) {
    const res = await fetch(dbUrl(env, path), {
      method,
      body: value === undefined ? undefined : JSON.stringify(value)
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 200);
      return json({ ok: false, code: 'firebase', detail: `${res.status} ${text}` }, 502);
    }
  }
  return json({ ok: true });
}
