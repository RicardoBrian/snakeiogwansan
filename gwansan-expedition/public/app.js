// 관산 유적 탐험대 — 신청 흐름
(function () {
  'use strict';

  const { PLACE, PARTS, RUINS, RULES, PRIZE, initFirebase, partsOf } = window.GWANSAN;
  const STUDENT_ID_RE = /^\d{5}$/;          // 학번 형식: 숫자 5자리 (예: 10203)
  const NAME_RE = /^[\p{L}][\p{L}\s·.\-]{0,19}$/u;
  const TYPE_MS = 32;                        // 한 글자 출력 간격
  const SAVE_TIMEOUT_MS = 15000;

  const $ = s => document.querySelector(s);
  const params = new URLSearchParams(location.search);
  const DEMO = params.get('demo') === '1';   // ?demo=1 → 저장하지 않고 흐름만 체험
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  const state = { name: '', studentId: '', games: new Set() };

  // ---------- 공통 유틸 ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
  function store(key, val) {
    try { if (val === undefined) return localStorage.getItem(key); localStorage.setItem(key, val); } catch (e) { return null; }
  }
  const placeTag = `<span class="place-tag">📍 ${PLACE}</span>`;
  const timeOf = part => `${PARTS[part].label} ${PARTS[part].start}~${PARTS[part].end}`;

  // ---------- 관산 박사 (직접 그린 SVG) ----------
  const NPC_SVG = `
<svg viewBox="0 0 120 130" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="60" cy="124" rx="36" ry="5" fill="rgba(0,0,0,.25)"/>
  <path d="M24 124 Q26 88 60 86 Q94 88 96 124Z" fill="#9b7442"/>
  <path d="M48 88 L60 104 L72 88Z" fill="#efe3c8"/>
  <path d="M44 90 Q60 100 76 90 L80 98 Q60 108 40 98Z" fill="#c8402f"/>
  <rect x="34" y="104" width="12" height="16" rx="2" fill="#7a5a32"/>
  <rect x="74" y="104" width="12" height="16" rx="2" fill="#7a5a32"/>
  <circle cx="60" cy="62" r="25" fill="#f3c99d"/>
  <circle cx="35" cy="64" r="5" fill="#eab887"/><circle cx="85" cy="64" r="5" fill="#eab887"/>
  <ellipse cx="60" cy="42" rx="44" ry="9" fill="#5e4026"/>
  <path d="M36 43 Q36 14 60 16 Q84 14 84 43Z" fill="#7a5530"/>
  <path d="M60 17 Q57 26 60 30" stroke="#5e4026" stroke-width="3" fill="none"/>
  <rect x="36.5" y="34" width="47" height="7" fill="#33241a"/>
  <path d="M43 52 L54 54 M66 54 L77 52" stroke="#4a3322" stroke-width="3" stroke-linecap="round"/>
  <circle cx="50" cy="61" r="3.2" fill="#2a1d14"/>
  <circle cx="71" cy="61" r="8" fill="rgba(200,230,255,.35)" stroke="#c9a227" stroke-width="2.5"/>
  <circle cx="71" cy="61" r="3.2" fill="#2a1d14"/>
  <path d="M79 64 Q86 78 82 92" stroke="#c9a227" stroke-width="1.2" fill="none"/>
  <path d="M60 66 Q58 71 61 72" stroke="#c99470" stroke-width="2" fill="none" stroke-linecap="round"/>
  <path d="M60 75 Q50 71 40 77 Q44 81 50 79 Q56 79 60 76 Q64 79 70 79 Q76 81 80 77 Q70 71 60 75Z" fill="#4a3322"/>
  <ellipse class="npc-mouth" cx="60" cy="82" rx="5" ry="2" fill="#7a2e22"/>
</svg>`;
  document.querySelectorAll('.npc, .title-npc').forEach(el => { el.innerHTML = NPC_SVG; });

  // ---------- BGM (assets/bgm.mp3, 없어도 조용히 넘어감) ----------
  const bgm = $('#bgm');
  const muteBtn = $('#muteBtn');
  let bgmStarted = false;
  let muted = store('gx-muted') === '1';

  function renderMute() {
    bgm.muted = muted;
    muteBtn.textContent = muted ? '🔇' : '🔊';
    muteBtn.setAttribute('aria-pressed', String(muted));
    muteBtn.setAttribute('aria-label', muted ? '배경음악 켜기' : '배경음악 끄기');
  }
  function playBgm() {
    bgmStarted = true;
    bgm.volume = 0.45;
    try {
      const p = bgm.play();
      if (p && p.catch) p.catch(() => {});   // 파일이 없거나 재생이 막혀도 무시
    } catch (e) { /* 무시 */ }
  }
  bgm.addEventListener('error', () => {}); // 404여도 앱은 계속 동작
  muteBtn.addEventListener('click', () => {
    muted = !muted;
    store('gx-muted', muted ? '1' : '0');
    renderMute();
    if (!muted && bgmStarted && bgm.paused) playBgm();
  });
  renderMute();

  // ---------- 대사 엔진: 한 글자씩 출력, 클릭/엔터로 넘김, 건너뛰기 ----------
  const lineEl = $('#line');
  const lineSr = $('#lineSr');
  const bubble = $('#bubble');
  const npc = $('#npc');
  const nextHint = $('#nextHint');
  const dialogTools = $('#dialogTools');
  const panel = $('#panel');

  const dlg = { lines: [], i: 0, typing: false, timer: null, resolve: null };

  function typeLine(text) {
    clearInterval(dlg.timer);
    lineSr.textContent = text;           // 화면 낭독기는 한 번에 전체 문장
    if (reducedMotion.matches) {
      lineEl.textContent = text;
      dlg.typing = false;
      npc.classList.remove('talking');
      nextHint.hidden = false;
      return;
    }
    const chars = Array.from(text);
    let n = 0;
    lineEl.textContent = '';
    dlg.typing = true;
    nextHint.hidden = true;
    npc.classList.add('talking');
    dlg.timer = setInterval(() => {
      n++;
      lineEl.textContent = chars.slice(0, n).join('');
      if (n >= chars.length) finishTyping();
    }, TYPE_MS);
  }
  function finishTyping() {
    clearInterval(dlg.timer);
    lineEl.textContent = dlg.lines[dlg.i];
    dlg.typing = false;
    npc.classList.remove('talking');
    nextHint.hidden = false;
  }
  function endDialog() {
    clearInterval(dlg.timer);
    dlg.typing = false;
    npc.classList.remove('talking');
    if (dlg.lines.length) lineEl.textContent = dlg.lines[dlg.lines.length - 1];
    nextHint.hidden = true;
    dialogTools.hidden = true;
    const r = dlg.resolve;
    dlg.resolve = null;
    if (r) r();
  }
  function advance() {
    if (!dlg.resolve) return;
    if (dlg.typing) { finishTyping(); return; }
    if (dlg.i < dlg.lines.length - 1) { dlg.i++; typeLine(dlg.lines[dlg.i]); }
    else endDialog();
  }
  // 대사들을 보여주고, 다 읽으면(또는 건너뛰면) 끝나는 Promise
  function say(lines) {
    if (dlg.resolve) endDialog();
    dlg.lines = lines;
    dlg.i = 0;
    panel.innerHTML = '';
    panel.hidden = true;
    dialogTools.hidden = false;
    typeLine(lines[0]);
    bubble.focus({ preventScroll: true });
    return new Promise(r => { dlg.resolve = r; });
  }

  bubble.addEventListener('click', advance);
  bubble.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); advance(); }
  });
  document.addEventListener('keydown', e => {
    if (!dlg.resolve || e.target === bubble) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.target.closest && e.target.closest('input, textarea, select, button, a')) return;
    e.preventDefault();
    advance();
  });
  $('#skipLines').addEventListener('click', endDialog);

  function showPanel(html, focusSel) {
    panel.innerHTML = html;
    panel.hidden = false;
    const target = focusSel ? panel.querySelector(focusSel) : panel;
    (target || panel).focus({ preventScroll: true });
    panel.scrollIntoView({ block: 'nearest', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  }

  function setStep(n) {
    document.querySelectorAll('.progress li').forEach((li, i) => {
      li.classList.toggle('done', i < n - 1);
      li.classList.toggle('current', i === n - 1);
      if (i === n - 1) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
  }

  // ---------- Firebase ----------
  let db = null;
  let fbMode = null;
  if (!DEMO) {
    try {
      const fb = initFirebase(['firestore']);
      if (fb) { db = firebase.firestore(); fbMode = fb.mode; }
    } catch (e) { console.error(e); }
  }

  function saveApplication() {
    if (DEMO) return wait(600);
    if (!db) return Promise.reject(Object.assign(new Error('not-configured'), { code: 'not-configured' }));
    const games = RUINS.filter(r => state.games.has(r.game)).map(r => r.game);
    const write = db.collection('applications').doc(state.studentId).set({
      name: state.name,
      studentId: state.studentId,
      games,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    const timeout = wait(SAVE_TIMEOUT_MS).then(() => { throw Object.assign(new Error('timeout'), { code: 'timeout' }); });
    return Promise.race([write, timeout]);
  }

  function errorLines(err) {
    const code = err && err.code;
    if (code === 'permission-denied') {
      return [`학번 ${state.studentId}... 이 이름은 이미 탐사대 장부에 새겨져 있다네!`,
        '같은 학번으로는 한 번만 신청할 수 있네. 고쳐야 한다면 담당 선생님께 말하게.'];
    }
    if (code === 'not-configured') {
      return ['이런! 탐사 장부(서버)가 아직 준비되지 않았다네.', '담당 선생님께 알려주게. (Firebase 설정 필요)'];
    }
    return ['으악! 통신 마법이 끊겼다네...', '인터넷 연결을 확인하고 다시 신청 버튼을 눌러주게.'];
  }

  // ---------- 장면들 ----------
  async function sceneName() {
    setStep(1);
    await say([
      '어서 오게, 젊은 탐험가! 나는 이 학교 유적 연구의 일인자... 관산 박사일세.',
      `이번 축제, ${PLACE} 깊은 곳에 잠든 네 개의 유적을 탐사할 대원을 모집 중이라네.`,
      '이름부터 알려주겠나?'
    ]);
    showPanel(`
      <form class="card form" id="nameForm" novalidate>
        <h2 class="card-title">📝 탐험가 등록증</h2>
        <label class="field">
          <span>이름</span>
          <input id="fName" name="name" autocomplete="name" maxlength="20" required value="${esc(state.name)}" aria-describedby="fNameErr">
          <small class="err" id="fNameErr" role="alert"></small>
        </label>
        <label class="field">
          <span>학번 <em>(숫자 5자리, 예: 10203)</em></span>
          <input id="fId" name="studentId" inputmode="numeric" pattern="\\d{5}" maxlength="5" required value="${esc(state.studentId)}" aria-describedby="fIdErr">
          <small class="err" id="fIdErr" role="alert"></small>
        </label>
        <p class="place-line">📍 모든 탐사의 집결지는 <b>${PLACE}</b></p>
        <button class="btn" type="submit">등록증 제출 →</button>
      </form>`, '#fName');

    $('#nameForm').addEventListener('submit', e => {
      e.preventDefault();
      const name = $('#fName').value.trim().replace(/\s+/g, ' ');
      const sid = $('#fId').value.trim();
      let ok = true;
      $('#fNameErr').textContent = '';
      $('#fIdErr').textContent = '';
      if (!NAME_RE.test(name)) { $('#fNameErr').textContent = '이름을 정확히 적어주게! (글자만, 20자 이내)'; ok = false; }
      if (!STUDENT_ID_RE.test(sid)) { $('#fIdErr').textContent = '학번은 숫자 5자리일세! (예: 10203)'; ok = false; }
      $('#fName').setAttribute('aria-invalid', String(!NAME_RE.test(name)));
      $('#fId').setAttribute('aria-invalid', String(!STUDENT_ID_RE.test(sid)));
      if (!ok) { (NAME_RE.test(name) ? $('#fId') : $('#fName')).focus(); return; }
      state.name = name;
      state.studentId = sid;
      sceneRuins(true);
    });
  }

  function ruinCard(r) {
    return `
      <article class="ruin-card part-${r.part}">
        <div class="ruin-icon" aria-hidden="true">${r.icon}</div>
        <div class="ruin-body">
          <h3>${r.ruin} <small>= ${r.game}</small></h3>
          <p>${r.desc}</p>
          <p class="ruin-meta"><span class="time-tag">⏰ ${timeOf(r.part)}</span> ${placeTag}</p>
          <p class="ruin-quote">“${r.quote}”</p>
        </div>
      </article>`;
  }

  async function sceneRuins(fresh) {
    setStep(2);
    const lines = fresh ? [`${state.name}... 전설 속 그 이름이...! (아님)`] : [];
    lines.push('이번 탐사에서 공략할 유적은 네 곳이라네. 모두 컴퓨터실에 있지. 잘 보게.');
    await say(lines);
    showPanel(`
      <div class="ruin-list">${RUINS.map(ruinCard).join('')}</div>
      <p class="prize-line">🏆 ${PRIZE}</p>
      <div class="btn-row">
        <button class="btn btn-ghost" type="button" data-go="back">← 이전</button>
        <button class="btn" type="button" data-go="next">탐사 지도 펼치기 →</button>
      </div>`, '[data-go="next"]');
    panel.querySelector('[data-go="back"]').onclick = sceneName;
    panel.querySelector('[data-go="next"]').onclick = sceneMap;
  }

  function rulesBox() {
    return `
      <div class="card rules">
        <h3>⚠️ 탐사 수칙 (꼭 읽게!)</h3>
        <ol>${RULES.map(r => `<li>${r}</li>`).join('')}</ol>
      </div>`;
  }

  function partBlock(part) {
    const list = RUINS.filter(r => r.part === part)
      .map(r => `<li>${r.icon} ${r.ruin} <small>(${r.game})</small></li>`).join('');
    return `
      <div class="tl-part">
        <div class="tl-time"><b>${PARTS[part].label}</b><span>${PARTS[part].start}<br>~${PARTS[part].end}</span></div>
        <div class="tl-body"><ul>${list}</ul>${placeTag}</div>
      </div>`;
  }

  async function sceneMap() {
    setStep(3);
    await say([
      '이제 탐사 일정을 알려주겠네. 숨을 죽이고 듣게...',
      `탐사 집결지는 바로... ${PLACE}일세!`,
      `시작 5분 안에 ${PLACE}에 오지 않으면 함정이 작동하네. 실격이라는 함정이.`
    ]);
    showPanel(`
      <div class="card map">
        <h2 class="card-title">🗺️ 탐사 일정 지도</h2>
        <div class="map-hq"><span class="map-pin" aria-hidden="true">📍</span><div><small>집결지</small><b>${PLACE}</b></div></div>
        <div class="timeline">
          ${partBlock(1)}
          <div class="tl-break">☕ 10:20~10:30 숨 돌리기 (다음 유적 준비)</div>
          ${partBlock(2)}
        </div>
      </div>
      ${rulesBox()}
      <div class="btn-row">
        <button class="btn btn-ghost" type="button" data-go="back">← 이전</button>
        <button class="btn" type="button" data-go="next">유적 고르기 →</button>
      </div>`, '[data-go="next"]');
    panel.querySelector('[data-go="back"]').onclick = () => sceneRuins(false);
    panel.querySelector('[data-go="next"]').onclick = sceneSelect;
  }

  function overlapParts() {
    const byPart = partsOf([...state.games]);
    return [1, 2].filter(p => byPart[p].length > 1);
  }
  function overlapNote(parts) {
    if (!parts.length) return '';
    const names = parts.map(p => PARTS[p].label).join('·');
    return `<p class="warn" role="status">⚠️ ${names}의 두 종목을 모두 골랐네! 같은 시간대라 <b>한 종목만 선정될 수도 있다네.</b></p>`;
  }

  async function sceneSelect() {
    setStep(4);
    await say([
      '자, 어느 유적에 도전하겠나? 여러 곳을 골라도 좋네.',
      '단! 같은 시간대(같은 부)의 유적 두 곳을 모두 고르면... 한 곳만 선정될 수도 있네. 몸은 하나뿐이니까.'
    ]);
    const group = part => `
      <fieldset class="pick-group">
        <legend>${timeOf(part)} · ${placeTag}</legend>
        ${RUINS.filter(r => r.part === part).map(r => `
          <label class="pick">
            <input type="checkbox" name="game" value="${r.game}" ${state.games.has(r.game) ? 'checked' : ''}>
            <span class="pick-box">
              <span class="pick-icon" aria-hidden="true">${r.icon}</span>
              <span><b>${r.ruin}</b><small>${r.game}</small></span>
              <span class="pick-check" aria-hidden="true">✔</span>
            </span>
          </label>`).join('')}
      </fieldset>`;
    showPanel(`
      <form class="card" id="pickForm" novalidate>
        <h2 class="card-title">⛏ 도전할 유적 선택</h2>
        ${group(1)}${group(2)}
        <div id="pickWarn" aria-live="polite"></div>
        <small class="err" id="pickErr" role="alert"></small>
        <div class="btn-row">
          <button class="btn btn-ghost" type="button" data-go="back">← 이전</button>
          <button class="btn" type="submit">확인하기 →</button>
        </div>
      </form>`, 'input[name="game"]');

    const form = $('#pickForm');
    const sync = () => {
      state.games = new Set([...form.querySelectorAll('input[name="game"]:checked')].map(i => i.value));
      $('#pickWarn').innerHTML = overlapNote(overlapParts());
      if (state.games.size) $('#pickErr').textContent = '';
    };
    form.addEventListener('change', sync);
    sync();
    panel.querySelector('[data-go="back"]').onclick = sceneMap;
    form.addEventListener('submit', e => {
      e.preventDefault();
      if (!state.games.size) { $('#pickErr').textContent = '유적을 하나 이상 골라야 탐사를 떠날 수 있다네!'; return; }
      sceneConfirm();
    });
  }

  function itinerary() {
    const byPart = partsOf([...state.games]);
    return [1, 2].filter(p => byPart[p].length).map(p => `
      <li><span class="time-tag">⏰ ${timeOf(p)}</span>
        ${byPart[p].map(r => `<b>${r.icon} ${r.ruin}</b> <small>(${r.game})</small>`).join(', ')}
        ${placeTag}</li>`).join('');
  }

  async function sceneConfirm(errLines) {
    setStep(5);
    await say(errLines || [
      '마지막 확인일세. 탐사 장부에 이대로 적어도 되겠나?',
      '한 번 적으면 바위에 새겨지는 거라... 고칠 수 없다네. (진짜로)'
    ]);
    showPanel(`
      <div class="card confirm">
        <h2 class="card-title">📜 탐사대 신청서</h2>
        <dl class="summary">
          <dt>이름</dt><dd>${esc(state.name)}</dd>
          <dt>학번</dt><dd>${esc(state.studentId)}</dd>
          <dt>집결지</dt><dd><b class="hl">📍 ${PLACE}</b></dd>
        </dl>
        <ul class="itinerary">${itinerary()}</ul>
        ${overlapNote(overlapParts())}
        ${DEMO ? '<p class="demo">🧪 체험 모드(?demo=1): 실제로 저장되지 않습니다.</p>' : ''}
        <div class="btn-row">
          <button class="btn btn-ghost" type="button" data-go="back">← 고치기</button>
          <button class="btn btn-danger" type="button" data-go="submit">⛏ 탐사대 신청!</button>
        </div>
      </div>`, '[data-go="submit"]');
    panel.querySelector('[data-go="back"]').onclick = sceneSelect;
    panel.querySelector('[data-go="submit"]').onclick = submit;
  }

  // ---------- 신청: 바위 연출 + 저장 ----------
  const fx = $('#fx');
  const fxCaption = $('#fxCaption');
  const fxStamp = $('#fxStamp');
  let fxSkip = null;

  $('#fxSkip').addEventListener('click', () => { if (fxSkip) fxSkip(); });

  // 건너뛰기를 누르면 즉시 끝나는 대기
  function fxWait(ms) {
    return new Promise(r => {
      const t = setTimeout(() => { fxSkip = null; r(false); }, ms);
      fxSkip = () => { clearTimeout(t); fxSkip = null; r(true); };
    });
  }

  async function playBoulder() {
    fx.hidden = false;
    fx.className = 'fx';
    fxStamp.hidden = true;
    $('#fxSkip').focus({ preventScroll: true });
    fxCaption.textContent = '...! 이 진동은?!';
    void fx.offsetWidth;                 // 애니메이션 재시작
    fx.classList.add('rolling');
    if (await fxWait(900)) return;
    fxCaption.textContent = '바위다!!! 피하게!!!';
    if (await fxWait(1300)) return;
    fxCaption.textContent = '휴... 간신히 살았군.';
    await fxWait(900);
  }

  async function playStamp() {
    fx.classList.add('stamped');
    fxCaption.textContent = '';
    fxStamp.hidden = false;
    await fxWait(1400);
  }

  function hideFx() {
    fx.hidden = true;
    fx.className = 'fx';
    fxSkip = null;
  }

  async function submit(e) {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = '장부에 기록 중...';
    const animate = !reducedMotion.matches;

    const saving = saveApplication().then(() => null, err => err || new Error('unknown'));
    if (animate) {
      await playBoulder();
      fxCaption.textContent = '탐사 장부에 기록하는 중...';
    }
    const err = await saving;
    if (err) {
      console.error(err);
      hideFx();
      sceneConfirm(errorLines(err));
      return;
    }
    if (animate) await playStamp();
    hideFx();
    sceneDone();
  }

  async function sceneDone() {
    setStep(6);
    const byPart = partsOf([...state.games]);
    const first = byPart[1].length ? 1 : 2;
    const call = `${state.name} 탐험가, ${PARTS[first].label} ${PARTS[first].start}까지 ${PLACE}로 집결하게!`;
    const extra = first === 1 && byPart[2].length
      ? `<p class="call-sub">그리고 ${PARTS[2].label} ${PARTS[2].start}까지 다시 ${PLACE}로!</p>` : '';
    const overlap = overlapParts();

    await say([
      '크하하! 바위를 피하다니, 역시 내 눈은 틀리지 않았어!',
      call
    ]);
    showPanel(`
      <div class="card done">
        <div class="stamp done-stamp"><span>탐사대<br>등록 완료!</span></div>
        <p class="call" tabindex="-1">${esc(call)}</p>
        ${extra}
        <ul class="itinerary">${itinerary()}</ul>
        ${overlapNote(overlap)}
        ${rulesBox()}
        <p class="notice">📣 선정 결과는 <b>축제 당일 아침</b>에 공지됩니다.</p>
        <p class="prize-line">🏆 ${PRIZE}</p>
        ${DEMO ? '<p class="demo">🧪 체험 모드: 실제로 저장되지 않았습니다.</p>' : ''}
        ${fbMode === 'emulator' ? '<p class="demo">🧪 에뮬레이터에 저장됨 (실제 서버 아님)</p>' : ''}
        <button class="btn btn-ghost" type="button" data-go="again">처음 화면으로</button>
      </div>`, '.call');
    panel.querySelector('[data-go="again"]').onclick = () => { location.href = location.pathname + location.search; };
  }

  // ---------- 시작 ----------
  $('#startBtn').addEventListener('click', () => {
    playBgm();
    $('#titleScreen').hidden = true;
    $('#stage').hidden = false;
    sceneName();
  });
})();
