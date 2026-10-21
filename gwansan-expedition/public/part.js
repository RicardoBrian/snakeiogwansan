// 1부·2부 경기 안내 화면 (4:3). <body data-part="1|2">
(function () {
  'use strict';

  const ART = window.BOARD_ART;
  const CFG = window.PART_CONFIG || { links: {} };
  const $ = s => document.querySelector(s);
  const params = new URLSearchParams(location.search);
  const PART = Number(document.body.dataset.part);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const pick = (q, key) => String(params.get(q) || CFG[key] || '').trim();
  const code = v => (v ? `<b class="room">${esc(v)}</b>` : '<b class="room tbd">추후 공지</b>');
  const room = pick('room', 'kkutuRoom');
  const SITE = esc(CFG.gameSite || 'game.kakainfo.com');

  const hm = s => { const [h, m] = s.split(':').map(Number); return h * 3600 + m * 60; };
  const TIME = { 1: ['9:40', '10:20'], 2: ['10:30', '11:15'] }[PART];
  const START = hm(TIME[0]), END = hm(TIME[1]);

  const PRIZE = '<div class="podium"><div class="p2"><b>2등</b><span>관산쿠폰</span><em>3장</em></div><div class="p1"><b>1등</b><span>관산쿠폰</span><em>5장</em></div><div class="p3"><b>3등</b><span>관산쿠폰</span><em>1장</em></div></div>';

  const GAMES = {
    1: [
      {
        id: 'kkutu', name: '끄투온라인', ruin: '말의 신전',
        how: `<ol class="steps">
            <li><b>kkutu.kr</b> 접속</li>
            <li><b>[게임 시작]</b> 버튼</li>
            <li><b>[친선전]</b> 선택</li>
            <li>방 번호 ${code(room)} 입장</li>
          </ol>`,
        rule: ['<b>3라운드 = 1세트</b>, 총 <b>3세트</b> 진행', '세트마다 <b>순위의 역순</b>으로 승점', '3세트 <b>승점 합계</b>로 1·2·3등']
      },
      {
        id: 'tetris', name: '테트리스', ruin: '무너지는 탑',
        how: `<ol class="steps">
            <li><b>${SITE}/tetris</b> 접속</li>
            <li><b>학번·이름</b> 입력</li>
            <li>방 ${code(pick('tetris', 'tetrisRoom'))} 선택</li>
            <li><b>[입장하기]</b> → 판 시작 기다리기</li>
          </ol>`,
        rule: ['<b>5라운드</b> 진행', '라운드마다 승점', '<b>최종 승점</b>이 높은 순서로 1·2·3등']
      }
    ],
    2: [
      {
        id: 'omok', name: '오목', ruin: '돌의 미궁',
        how: `<ol class="steps">
            <li><b>${SITE}/omok</b> 접속</li>
            <li>게임 코드 ${code(pick('omok', 'omokCode'))}</li>
            <li><b>학번·이름</b> 입력</li>
            <li><b>[등록 / 입장]</b> → 대진표 기다리기</li>
          </ol>`,
        rule: ['<b>리그 방식</b> (모든 참가자와 대결)', '경기 결과로 승점', '<b>승점 순</b>으로 1·2·3등']
      },
      {
        id: 'snake', name: '지렁이 게임', ruin: '뱀의 동굴',
        how: `<ol class="steps">
            <li><b>${SITE}/snake</b> 접속</li>
            <li>게임 코드 ${code(pick('snake', 'snakeCode'))}</li>
            <li><b>학번·이름</b> 입력</li>
            <li><b>[대회 입장]</b> → 대기실에서 기다리기</li>
          </ol>`,
        rule: ['<b>5라운드</b> 진행', '라운드마다 승점', '<b>최종 승점</b>이 높은 순서로 1·2·3등']
      }
    ]
  }[PART];

  $('#partNo').textContent = `${PART}부`;
  $('#partTime').textContent = `${TIME[0]} ~ ${TIME[1]}`;
  $('#games').innerHTML = GAMES.map(g => `
    <article class="game">
      <header class="g-head">
        <div class="g-icon">${ART[g.id]}</div>
        <div><h2>${g.name}</h2><small>${g.ruin}</small></div>
      </header>
      ${g.how ? `<section class="box"><h3>🔑 참가 방법</h3>${g.how}</section>` : ''}
      <section class="box"><h3>⚔️ 진행 방식</h3><ul class="rules">${g.rule.map(r => `<li>${r}</li>`).join('')}</ul></section>
      <section class="box prize"><h3>🏆 상품</h3>${PRIZE}</section>
    </article>`).join('');

  // 시계 + 진행 상태
  const pad = n => String(n).padStart(2, '0');
  const dur = s => { s = Math.max(0, Math.ceil(s)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`; };
  function tick() {
    const d = new Date();
    const t = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
    $('#clock').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    const st = $('#status');
    if (t < START) { st.textContent = `시작까지 ${dur(START - t)}`; st.className = 'status'; }
    else if (t < START + 300) { st.textContent = `입장 마감까지 ${dur(START + 300 - t)}`; st.className = 'status hot'; }
    else if (t < END) { st.textContent = `종료까지 ${dur(END - t)}`; st.className = 'status live'; }
    else { st.textContent = `${PART}부 종료`; st.className = 'status done'; }
  }
  tick();
  setInterval(tick, 500);

  // 4:3 맞춤 + 전체 화면
  const stage = $('#stage');
  function fit() {
    const w = innerWidth, h = innerHeight, s = Math.min(w / 1600, h / 1200);
    stage.style.transform = `translate(${(w - 1600 * s) / 2}px, ${(h - 1200 * s) / 2}px) scale(${s})`;
  }
  addEventListener('resize', fit);
  fit();
  $('#fsBtn').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  });
  let idle = 0;
  const wake = () => { document.body.classList.remove('idle'); clearTimeout(idle); idle = setTimeout(() => document.body.classList.add('idle'), 3000); };
  ['mousemove', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, wake));
  wake();
})();
