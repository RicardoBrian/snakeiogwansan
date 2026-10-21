// 1부·2부 안내 화면 설정 — 여기만 고치면 됩니다.
// 당일 급하면 주소 뒤에 붙여도 됩니다: /screen?room=1234&tetris=1모둠&omok=5678&snake=9012
// 비워두면 화면에 "추후 공지"로 표시됩니다.
window.PART_CONFIG = {
  kkutuRoom: '',   // 끄투온라인 친선전 방 번호            (?room=)
  tetrisRoom: '',  // 테트리스 대전 방 이름 (관리자 화면에서 만든 방) (?tetris=)
  omokCode: '',    // 오목 리그 4자리 게임 코드              (?omok=)
  snakeCode: '',   // 지렁이(뱀) 게임 4자리 게임 코드        (?snake=)

  // 테트리스·오목·지렁이 게임 사이트 주소
  gameSite: 'game.kakainfo.com'
};
