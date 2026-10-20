// 신청 페이지와 관리자 페이지가 함께 쓰는 대회 정보와 Firebase 초기화
(function () {
  'use strict';

  const PARTS = {
    1: { start: '9:40', end: '10:20' },
    2: { start: '10:30', end: '11:15' }
  };

  // game 값(한국어)이 그대로 Firestore games[]에 저장됩니다 (firestore.rules의 목록과 같아야 함)
  // 화면에 보이는 이름·설명은 i18n.js에 언어별로 있습니다.
  const RUINS = [
    { id: 'kkutu', game: '끄투온라인', icon: '📜', part: 1 },
    { id: 'tetris', game: '테트리스', icon: '🧱', part: 1 },
    { id: 'omok', game: '오목', icon: '⚫', part: 2 },
    { id: 'snake', game: '지렁이 게임', icon: '🐍', part: 2 }
  ];

  function isLocalHost() {
    return ['localhost', '127.0.0.1'].includes(location.hostname);
  }

  function configReady(cfg) {
    return !!cfg && !!cfg.projectId && !String(cfg.projectId).startsWith('YOUR_');
  }

  // localhost에서는 기본으로 에뮬레이터에 접속합니다 (?emu=0 이면 실제 서버).
  // 반환값: { app, mode: 'live' | 'emulator' } 또는 null(설정 안 됨 / SDK 로드 실패)
  function initFirebase(services) {
    if (typeof window.firebase === 'undefined') return null;
    const local = isLocalHost();
    const useEmu = local && new URLSearchParams(location.search).get('emu') !== '0';
    let cfg = window.FIREBASE_CONFIG;
    if (useEmu) cfg = { apiKey: 'demo-key', projectId: 'demo-gwansan', authDomain: 'demo-gwansan.firebaseapp.com' };
    else if (!configReady(cfg)) return null;
    const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(cfg);
    if (useEmu) {
      if (services.includes('firestore')) firebase.firestore().useEmulator('127.0.0.1', 8080);
      if (services.includes('auth')) firebase.auth().useEmulator('http://127.0.0.1:9099');
    }
    return { app, mode: useEmu ? 'emulator' : 'live' };
  }

  function partsOf(games) {
    const byPart = { 1: [], 2: [] };
    RUINS.forEach(r => { if (games.includes(r.game)) byPart[r.part].push(r); });
    return byPart;
  }

  // 이름 비교용: 공백·점·하이픈 무시, 대소문자 무시
  function normName(name) {
    return String(name).normalize('NFC').toLowerCase().replace(/[\s·.\-]/g, '');
  }

  // 선정 결과 문서 ID = SHA-256(학번 + 이름). 이름과 학번을 모두 알아야만 결과를 열 수 있습니다.
  async function resultKey(studentId, name) {
    const data = new TextEncoder().encode(`gwansan-game-king|${studentId}|${normName(name)}`);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  window.GWANSAN = { PARTS, RUINS, initFirebase, partsOf, normName, resultKey };
})();
