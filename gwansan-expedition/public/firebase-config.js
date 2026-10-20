// Firebase 콘솔 → 프로젝트 설정 → 내 앱(웹) → "SDK 설정 및 구성"의 값을 그대로 붙여넣으세요.
// (이 값들은 공개되어도 괜찮습니다. 실제 보안은 firestore.rules가 담당합니다.)
window.FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// 관리자 페이지(admin.html)에 로그인할 내 Google 계정.
// firestore.rules 안의 이메일도 똑같이 바꿔야 실제로 읽을 수 있습니다.
window.ADMIN_EMAIL = "admin@example.com";
