// 컴퓨터실 전광판: 실시간 시계 + 현재 진행 상황 + 남은 시간 + 입장 마감(5분) + 박사 대사
// 리허설: board?time=09:42 처럼 시작 시각을 주면 그 시각부터 흘러가는 시계로 표시 (&speed=10 이면 10배속)
(function () {
  'use strict';

  const { RUINS, initFirebase } = window.GWANSAN;
  const ART = window.BOARD_ART;
  const $ = s => document.querySelector(s);
  const params = new URLSearchParams(location.search);
  const LATE_MIN = 5;

  const hm = s => { const [h, m, sec] = s.split(':').map(Number); return h * 3600 + m * 60 + (sec || 0); };
  const P1 = { part: 1, start: hm('9:40'), end: hm('10:20') };
  const P2 = { part: 2, start: hm('10:30'), end: hm('11:15') };
  const GAME_NAMES = { kkutu: ['끄투온라인', '말의 신전'], tetris: ['테트리스', '무너지는 탑'], omok: ['오목', '돌의 미궁'], snake: ['지렁이 게임', '뱀의 동굴'] };
  const gamesOf = part => RUINS.filter(r => r.part === part);

  // ---------- 시계 (리허설 모드 지원) ----------
  const realStart = Date.now();
  let simBase = null;
  const speed = Math.max(1, Number(params.get('speed')) || 1);
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(params.get('time') || '')) {
    const d = new Date();
    const t = hm(params.get('time'));
    d.setHours(Math.floor(t / 3600), Math.floor(t / 60) % 60, t % 60, 0);
    simBase = d.getTime();
    $('#sim').hidden = false;
    $('#sim').textContent = `리허설 모드 (${params.get('time')} 부터${speed > 1 ? `, ${speed}배속` : ''})`;
  }
  const now = () => new Date(simBase === null ? Date.now() : simBase + (Date.now() - realStart) * speed);

  const pad = n => String(n).padStart(2, '0');
  function dur(sec) {
    sec = Math.max(0, Math.ceil(sec));
    const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  // ---------- 그림 ----------
  $('#npc').innerHTML = ART.npc;
  document.querySelectorAll('.slot-games').forEach(el => {
    el.innerHTML = gamesOf(Number(el.dataset.part))
      .map(r => `<div class="sg">${ART[r.id]}<b>${GAME_NAMES[r.id][0]}</b></div>`).join('');
  });
  const bigGames = part => gamesOf(part)
    .map(r => `<div class="ng">${ART[r.id]}<div><b>${GAME_NAMES[r.id][0]}</b><small>${GAME_NAMES[r.id][1]}</small></div></div>`).join('');

  // ---------- 상황 판단 ----------
  function phaseAt(t) {
    if (t < P1.start) return { id: 'before', next: P1 };
    if (t < P1.end) return { id: 'live', cur: P1 };
    if (t < P2.start) return { id: 'break', next: P2 };
    if (t < P2.end) return { id: 'live', cur: P2 };
    return { id: 'end' };
  }

  const TALK = {
    before: ['탐험가들이여, 곧 1부가 시작된다네!', '신청한 학생만 유적에 들어올 수 있다네. 명심하게.', '시작 후 5분 안에 오지 않으면... 함정이 작동하네. 실격이라는 함정이.', '끄투온라인과 테트리스 참가자는 컴퓨터실에서 대기하게!'],
    early: ['시작했다네! 아직 안 온 탐험가는 서두르게!', '5분이 지나면 문이 닫힌다네. 진짜로.', '자리에 앉았으면 화면을 보게. 유적이 열린다!'],
    p1: ["말의 신전에서 '륨'을 받은 자는... 살아 돌아오지 못한다네.", '무너지는 탑! 천장에 닿기 전에 줄을 지우게!', '게임에서 승리하고 상품을 받아가게!'],
    break: ['잠시 숨 돌리게. 2부는 10:30에 시작이라네!', '오목과 지렁이 게임 참가자는 컴퓨터실로 모이게!', '물 한 모금 마시고 오게. 2부도 5분 안에 와야 하네.'],
    p2: ['돌 다섯 개를 한 줄로! 미궁의 문을 열게!', '뱀의 동굴... 머리를 조심하게. 특히 자네 머리를.', '게임에서 승리하고 상품을 받아가게!'],
    end: ['오늘의 탐사는 여기까지! 모두 수고했네.', '상품을 받은 탐험가에게 박수를!', '탐험가 여러분, 다음 축제에서 또 만나세!']
  };
  let talkKey = null, talkIdx = 0, talkAt = 0;
  function setTalk(key) {
    const p = $('#talk');
    if (key !== talkKey) {
      talkKey = key; talkIdx = 0; talkAt = Date.now();
      p.textContent = TALK[key][0];
      return;
    }
    if (Date.now() - talkAt < 8000) return;
    talkAt = Date.now();
    talkIdx = (talkIdx + 1) % TALK[key].length;
    p.classList.add('fade');
    setTimeout(() => { p.textContent = TALK[talkKey][talkIdx]; p.classList.remove('fade'); }, 400);
  }

  let lastPhaseKey = '';
  function render() {
    const d = now();
    const t = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000;
    $('#clock').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    $('#date').textContent = d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });

    const ph = phaseAt(t);
    const key = ph.id + (ph.cur ? ph.cur.part : '') + (ph.next ? ph.next.part : '');
    if (key !== lastPhaseKey) {
      lastPhaseKey = key;
      const partNo = (ph.cur || ph.next || {}).part;
      $('#now').classList.toggle('live', ph.id === 'live');
      $('#nowLabel').textContent = { before: '다음 순서', live: '지금 진행 중', break: '쉬는 시간 · 다음 순서', end: '대회 종료' }[ph.id];
      $('#nowTitle').textContent = ph.id === 'end' ? '모두 수고했어요!' : `${partNo}부 ${ph.id === 'live' ? '진행 중' : '곧 시작'}`;
      $('#nowGames').innerHTML = partNo && ph.id !== 'end' ? bigGames(partNo) : '<div class="ng"><div><b>🏆 승리한 탐험가는 상품을!</b><small>오늘 함께해 줘서 고마워요</small></div></div>';
      $('#countLabel').textContent = { before: '시작까지', live: '종료까지', break: '2부 시작까지', end: '' }[ph.id];
    }
    $('#count').textContent = ph.id === 'live' ? dur(ph.cur.end - t) : ph.next ? dur(ph.next.start - t) : '';

    // 입장 마감 (시작 후 5분)
    const lateLeft = ph.id === 'live' ? ph.cur.start + LATE_MIN * 60 - t : -1;
    $('#late').hidden = !(lateLeft > 0);
    $('#lateClosed').hidden = !(ph.id === 'live' && lateLeft <= 0);
    if (lateLeft > 0) $('#lateCount').textContent = dur(lateLeft);

    // 일정 막대
    [[P1, '#slot1'], [{ start: P1.end, end: P2.start }, '#slotB'], [P2, '#slot2']].forEach(([p, sel]) => {
      const el = $(sel);
      const ratio = Math.min(1, Math.max(0, (t - p.start) / (p.end - p.start)));
      el.querySelector('.bar i').style.width = `${ratio * 100}%`;
      const state = t >= p.end ? 'done' : t >= p.start ? 'live' : (ph.next && ph.next.start === p.start) ? 'next' : '';
      el.classList.toggle('done', state === 'done');
      el.classList.toggle('live', state === 'live');
      el.classList.toggle('next', state === 'next');
      const tag = el.querySelector('.slot-state');
      if (tag) tag.textContent = { done: '종료', live: '진행 중', next: '다음', '': '' }[state];
    });

    setTalk(ph.id === 'live' ? (lateLeft > 0 ? 'early' : `p${ph.cur.part}`) : ph.id);
  }

  // ---------- 선정 결과 공개 여부 (실시간) ----------
  try {
    const fb = initFirebase(['firestore']);
    if (fb) {
      firebase.firestore().collection('settings').doc('results').onSnapshot(snap => {
        const open = snap.exists && snap.data().open === true;
        $('#result').classList.toggle('open', open);
        $('#result').textContent = open ? '📜 선정 결과 공개 중! gwansanjae.pages.dev 에서 확인' : '📜 선정 결과는 축제 당일 아침 공지';
      }, () => {});
    }
  } catch (e) { /* 표시만 안 함 */ }

  // ---------- 4:3 화면 맞춤 ----------
  const stage = $('#stage');
  function fit() {
    const w = window.innerWidth, h = window.innerHeight;
    const s = Math.min(w / 1600, h / 1200);
    stage.style.transform = `translate(${(w - 1600 * s) / 2}px, ${(h - 1200 * s) / 2}px) scale(${s})`;
  }
  window.addEventListener('resize', fit);
  fit();

  // ---------- 전체 화면 + 마우스 숨기기 ----------
  $('#fsBtn').addEventListener('click', () => {
    const el = document.documentElement;
    if (document.fullscreenElement) document.exitFullscreen();
    else if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
  });
  let idleTimer = 0;
  const wake = () => { document.body.classList.remove('idle'); clearTimeout(idleTimer); idleTimer = setTimeout(() => document.body.classList.add('idle'), 3000); };
  ['mousemove', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, wake));
  wake();

  render();
  setInterval(render, simBase !== null && speed > 1 ? 100 : 250);
})();
