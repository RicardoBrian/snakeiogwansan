// Cloudflare Functions 공용: Firebase REST 호출, 오류, 응답 도우미
// 실제 쓰기는 Firebase 비밀키(FIREBASE_DB_SECRET)로 수행합니다.

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

export class ApiError extends Error {
  constructor(code, status = 400, detail) { super(code); this.code = code; this.status = status; this.detail = detail; }
}

export function envReady(env) {
  return !!(env.FIREBASE_DB_SECRET && env.FIREBASE_DATABASE_URL);
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

function dbUrl(env, path) {
  const u = new URL(env.FIREBASE_DATABASE_URL);
  u.pathname = u.pathname.replace(/\/$/, '') + '/' + path + '.json';
  u.searchParams.set('auth', env.FIREBASE_DB_SECRET);
  return u.toString();
}

async function fail(res) {
  const text = (await res.text()).slice(0, 200);
  return new ApiError('firebase', 502, `${res.status} ${text}`);
}

export async function fb(env, method, path, value) {
  const res = await fetch(dbUrl(env, path), {
    method,
    body: value === undefined ? undefined : JSON.stringify(value)
  });
  if (!res.ok) throw await fail(res);
  return res.json();
}

// 읽고-고쳐-쓰기를 ETag 로 안전하게 (동시에 두 요청이 와도 하나만 반영, 나머지는 다시 시도)
// update(현재값) 이 undefined 를 돌려주면 쓰지 않음
export async function fbTx(env, path, update, tries = 6) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(dbUrl(env, path), { headers: { 'X-Firebase-ETag': 'true' } });
    if (!res.ok) throw await fail(res);
    const etag = res.headers.get('ETag');
    const cur = await res.json();
    const next = update(cur);
    if (next === undefined) return cur;
    const put = await fetch(dbUrl(env, path), {
      method: 'PUT',
      headers: { 'if-match': etag },
      body: JSON.stringify(next)
    });
    if (put.status === 412) continue;
    if (!put.ok) throw await fail(put);
    return next;
  }
  throw new ApiError('busy', 409);
}

export const int = (v, min, max) => {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < min || n > max) throw new ApiError('bad_request');
  return n;
};

export const roomCode = (v) => {
  const c = String(v || '');
  if (!/^[0-9]{4}$/.test(c)) throw new ApiError('bad_request');
  return c;
};
