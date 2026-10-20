// 신청 페이지와 관리자 페이지가 함께 쓰는 대회 정보와 Firebase 초기화
(function () {
  'use strict';

  const PLACE = '컴퓨터실';

  const PARTS = {
    1: { label: '1부', start: '9:40', end: '10:20' },
    2: { label: '2부', start: '10:30', end: '11:15' }
  };

  // game 값이 그대로 Firestore games[]에 저장됩니다 (firestore.rules의 목록과 같아야 함)
  const RUINS = [
    {
      id: 'kkutu', game: '끄투온라인', ruin: '말의 신전', icon: '📜', part: 1,
      desc: '온라인 끝말잇기 대결! 앞 단어의 마지막 글자로 시작하는 단어를 말하라.',
      quote: "이 유적에 들어간 자 중... '륨'을 받고 살아 돌아온 자는 없었다네."
    },
    {
      id: 'tetris', game: '테트리스', ruin: '무너지는 탑', icon: '🧱', part: 1,
      desc: '떨어지는 블록을 쌓아 줄을 지워라. 끝까지 살아남는 자가 승리!',
      quote: '탑이 천장에 닿는 순간... 자네도 블록 한 칸이 되는 걸세.'
    },
    {
      id: 'omok', game: '오목', ruin: '돌의 미궁', icon: '⚫', part: 2,
      desc: '돌 5개를 한 줄로 먼저 놓는 자가 승리!',
      quote: '돌 다섯 개가 일렬로 서는 순간 미궁의 문이 열린다네. 상대 돌이면... 닫히고.'
    },
    {
      id: 'snake', game: '지렁이 게임', ruin: '뱀의 동굴', icon: '🐍', part: 2,
      desc: '먹이를 먹고 길어져라. 내 머리가 다른 지렁이 몸에 닿으면 탈락!',
      quote: '동굴의 지렁이들은 굶주렸다네. 머리를 조심하게. 특히 자네 머리를.'
    }
  ];

  const RULES = [
    '신청한 학생만 참여할 수 있어요.',
    '선정 결과는 축제 당일 아침에 공지됩니다.',
    `게임 시작 후 5분 안에 ${PLACE}에 오지 않으면 탈락입니다.`
  ];

  const PRIZE = '게임에서 승리하고 상품을 받아가세요!';

  function isLocalHost() {
    return ['localhost', '127.0.0.1'].includes(location.hostname);
  }

  function configReady(cfg) {
    return !!cfg && !!cfg.projectId && !String(cfg.projectId).startsWith('YOUR_');
  }

  // 로컬(localhost)에서 설정값이 비어 있으면 에뮬레이터용 데모 프로젝트로 접속합니다.
  // 반환값: { app, mode: 'live' | 'emulator' } 또는 null(설정 안 됨 / SDK 로드 실패)
  function initFirebase(services) {
    if (typeof window.firebase === 'undefined') return null;
    const local = isLocalHost();
    let cfg = window.FIREBASE_CONFIG;
    if (!configReady(cfg)) {
      if (!local) return null;
      cfg = { apiKey: 'demo-key', projectId: 'demo-gwansan', authDomain: 'demo-gwansan.firebaseapp.com' };
    }
    const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(cfg);
    const useEmu = local && new URLSearchParams(location.search).get('emu') !== '0';
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

  window.GWANSAN = { PLACE, PARTS, RUINS, RULES, PRIZE, initFirebase, partsOf };
})();
