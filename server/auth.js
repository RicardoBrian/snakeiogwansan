// 관리자 구글 로그인 확인: 브라우저가 Firebase Authentication(구글)으로 받은 ID 토큰을 서버에서 검증
// - 서명: 구글 공개키(RS256), 대상(aud)/발급자(iss): 이 Firebase 프로젝트, 만료 확인
// - 구글 계정으로 로그인했고 이메일이 확인된 경우만, ADMIN_EMAILS 에 있는 이메일만 관리자

import { ApiError } from './firebase.js';

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let keyCache = { keys: null, until: 0 };

async function googleKeys() {
  if (keyCache.keys && Date.now() < keyCache.until) return keyCache.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new ApiError('server', 502, 'jwks ' + res.status);
  const { keys } = await res.json();
  const age = /max-age=(\d+)/.exec(res.headers.get('cache-control') || '');
  keyCache = { keys, until: Date.now() + (age ? Number(age[1]) : 3600) * 1000 };
  return keys;
}

const b64url = (s) => {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(t + '='.repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0));
};
const part = (s) => JSON.parse(new TextDecoder().decode(b64url(s)));

// 통과하면 토큰 내용(payload), 아니면 ApiError('bad_login')
export async function verifyIdToken(token, projectId, getKeys = googleKeys) {
  const bad = () => new ApiError('bad_login', 401);
  const bits = String(token || '').split('.');
  if (bits.length !== 3 || !projectId) throw bad();
  let head, body;
  try { head = part(bits[0]); body = part(bits[1]); } catch (e) { throw bad(); }
  if (head.alg !== 'RS256' || !head.kid) throw bad();
  const jwk = (await getKeys()).find((k) => k.kid === head.kid);
  if (!jwk) throw bad();
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(bits[2]), new TextEncoder().encode(bits[0] + '.' + bits[1]));
  if (!ok) throw bad();
  const t = Date.now() / 1000;
  if (body.aud !== projectId || body.iss !== `https://securetoken.google.com/${projectId}`) throw bad();
  if (!(body.exp > t) || !(body.iat < t + 300) || !body.sub) throw bad();
  if (!body.email || body.email_verified !== true) throw bad();
  if (!body.firebase || body.firebase.sign_in_provider !== 'google.com') throw bad();
  return body;
}

// ADMIN_EMAILS: "a@gmail.com, b@school.kr" 처럼 쉼표로 구분, "@school.kr" 처럼 쓰면 그 도메인 전체 허용
export function isAdminEmail(email, list) {
  const e = String(email || '').toLowerCase();
  return String(list || '').split(/[,\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean)
    .some((a) => (a.startsWith('@') ? e.endsWith(a) : e === a));
}
