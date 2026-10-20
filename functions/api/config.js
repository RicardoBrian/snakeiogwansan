// GET /api/config — Cloudflare 환경변수에서 Firebase 접속 정보를 읽어 브라우저에 전달
// (databaseURL 등은 공개돼도 되는 값입니다. 비밀번호/비밀키는 여기서 내보내지 않습니다.)
export function onRequestGet({ env }) {
  const cfg = { databaseURL: env.FIREBASE_DATABASE_URL || '' };
  if (env.FIREBASE_API_KEY) cfg.apiKey = env.FIREBASE_API_KEY;
  if (env.FIREBASE_PROJECT_ID) cfg.projectId = env.FIREBASE_PROJECT_ID;
  // 관리자 구글 로그인용 (Firebase Authentication)
  if (env.FIREBASE_AUTH_DOMAIN || env.FIREBASE_PROJECT_ID) cfg.authDomain = env.FIREBASE_AUTH_DOMAIN || `${env.FIREBASE_PROJECT_ID}.firebaseapp.com`;
  return new Response(`window.FIREBASE_CONFIG = ${JSON.stringify(cfg)};\n`, {
    headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store' }
  });
}
