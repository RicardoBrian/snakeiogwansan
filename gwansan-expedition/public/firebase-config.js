// Firebase 콘솔 → 프로젝트 설정 → 내 앱(웹) → "SDK 설정 및 구성"의 값
// (이 값들은 공개되어도 괜찮습니다. 실제 보안은 firestore.rules가 담당합니다.)
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCHTgNysSrpuo9y3zYjp3lRJf_3Wmfe-H0",
  authDomain: "gwansanjae.firebaseapp.com",
  projectId: "gwansanjae",
  storageBucket: "gwansanjae.firebasestorage.app",
  messagingSenderId: "844510395302",
  appId: "1:844510395302:web:44242718d45c58cdfe2d67"
};

// 관리자 페이지(admin.html)에 로그인할 Google 계정.
// firestore.rules 안의 이메일도 똑같아야 실제로 읽을 수 있습니다.
window.ADMIN_EMAIL = "qjatjr7575@gmail.com";
