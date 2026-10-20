// 관산 게임왕 참가자 등록 — 신청 흐름 + 선정 결과 확인
(function () {
  'use strict';

  const { PARTS, RUINS, initFirebase, partsOf, resultKey } = window.GWANSAN;
  const STUDENT_ID_RE = /^\d{5}$/;          // 학번 형식: 숫자 5자리 (예: 10203)
  const NAME_RE = /^[\p{L}][\p{L}\p{M}\s·.\-]{0,19}$/u;
  const TYPE_MS = 32;                        // 한 글자 출력 간격
  const NET_TIMEOUT_MS = 15000;

  const $ = s => document.querySelector(s);
  const params = new URLSearchParams(location.search);
  const DEMO = params.get('demo') === '1';   // ?demo=1 → 저장하지 않고 흐름만 체험
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  const state = { name: '', studentId: '', games: new Set(), lookupName: '', lookupId: '' };
  let current = null;                        // 언어를 바꾸면 지금 장면을 다시 그림

  // ---------- 공통 유틸 ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
  function withTimeout(p) {
    return Promise.race([p, wait(NET_TIMEOUT_MS).then(() => { throw Object.assign(new Error('timeout'), { code: 'timeout' }); })]);
  }
  function store(key, val) {
    try { if (val === undefined) return localStorage.getItem(key); localStorage.setItem(key, val); } catch (e) { return null; }
  }

  // ---------- 언어 ----------
  const LANG_CODES = window.LANGS.map(l => l[0]);
  function pickLang() {
    const q = params.get('lang');
    if (LANG_CODES.includes(q)) return q;
    const saved = store('gk-lang');
    if (LANG_CODES.includes(saved)) return saved;
    const nav = (navigator.language || 'ko').slice(0, 2).toLowerCase();
    return LANG_CODES.includes(nav) ? nav : 'ko';
  }
  let lang = pickLang();
  let T = window.I18N[lang];

  const placeTag = () => `<span class="place-tag">📍 ${T.place}</span>`;
  const partLabel = p => T.part(p);
  const timeRange = p => `${PARTS[p].start}~${PARTS[p].end}`;
  const g = r => T.games[r.id];

  function applyStatic() {
    document.documentElement.lang = T.htmlLang;
    document.title = T.appTitle;
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = T[el.dataset.i18n]; });
    document.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = T[el.dataset.i18nHtml]; });
    $('#bubble').setAttribute('aria-label', T.bubbleLabel);
    $('#fx').setAttribute('aria-label', T.fxLabel);
    $('#langSelect').value = lang;
    document.querySelectorAll('#langChips button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
    $('#progress').innerHTML = T.steps.map(s => `<li>${s}</li>`).join('');
    renderMute();
  }

  function saveDrafts() {
    const v = s => { const el = panel.querySelector(s); return el ? el.value : null; };
    if (v('#fName') !== null) { state.name = v('#fName').trim(); state.studentId = v('#fId').trim(); }
    if (v('#rName') !== null) { state.lookupName = v('#rName').trim(); state.lookupId = v('#rId').trim(); }
  }

  function setLang(code) {
    if (!LANG_CODES.includes(code) || code === lang) return;
    saveDrafts();
    lang = code;
    T = window.I18N[lang];
    store('gk-lang', lang);
    applyStatic();
    if (!$('#stage').hidden && current) current();
  }

  const SHORT = { ko: '한국어', en: 'EN', zh: '中文', ru: 'RU' };
  $('#langSelect').innerHTML = window.LANGS.map(([c, n]) => `<option value="${c}" aria-label="${n}">${SHORT[c]}</option>`).join('');
  $('#langSelect').addEventListener('change', e => setLang(e.target.value));
  $('#langChips').innerHTML = window.LANGS.map(([c, n]) => `<button type="button" data-lang="${c}" lang="${c}">${n}</button>`).join('');
  $('#langChips').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setLang(b.dataset.lang); });

  // ---------- 오범석 박사 (직접 그린 SVG) ----------
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

  // ---------- 배경음악 ----------
  const muteBtn = $('#muteBtn');
  let muted = store('gk-muted') === '1';
  function renderMute() {
    muteBtn.textContent = muted ? '🔇' : '🔊';
    muteBtn.setAttribute('aria-pressed', String(muted));
    muteBtn.setAttribute('aria-label', muted ? T.muteOn : T.muteOff);
  }
  muteBtn.addEventListener('click', () => {
    muted = !muted;
    store('gk-muted', muted ? '1' : '0');
    window.BGM.setMuted(muted);
    renderMute();
  });
  window.BGM.setMuted(muted);

  // ---------- 대사 엔진: 한 글자씩 출력, 말풍선 클릭/엔터로 넘김 ----------
  const lineEl = $('#line');
  const lineSr = $('#lineSr');
  const bubble = $('#bubble');
  const npc = $('#npc');
  const nextHint = $('#nextHint');
  const tapHint = $('#tapHint');
  const panel = $('#panel');

  const dlg = { lines: [], i: 0, typing: false, timer: null, resolve: null, token: 0 };

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
    nextHint.hidden = true;
    tapHint.hidden = true;
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
  // 대사를 보여주고, 다 읽으면 true로 끝나는 Promise. 도중에 다른 장면이 시작되면 false.
  function say(lines) {
    if (dlg.resolve) { const r = dlg.resolve; dlg.resolve = null; r(false); }
    const token = ++dlg.token;
    dlg.lines = lines;
    dlg.i = 0;
    panel.innerHTML = '';
    panel.hidden = true;
    tapHint.hidden = false;
    window.scrollTo(0, 0);
    typeLine(lines[0]);
    bubble.focus({ preventScroll: true });
    return new Promise(r => { dlg.resolve = ok => r(ok !== false && token === dlg.token); });
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

  function showPanel(html, focusSel) {
    panel.innerHTML = html;
    panel.hidden = false;
    const target = focusSel ? panel.querySelector(focusSel) : panel;
    (target || panel).focus({ preventScroll: true });
  }

  function setStep(n) {
    $('#progress').hidden = !n;
    document.querySelectorAll('#progress li').forEach((li, i) => {
      li.classList.toggle('done', i < n - 1);
      li.classList.toggle('current', i === n - 1);
      if (i === n - 1) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
  }

  // 장면 등록: 언어 변경 시 다시 그릴 수 있도록 기억
  function scene(fn) {
    return function run(...args) {
      current = () => fn(...args);
      return fn(...args);
    };
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
  const notConfigured = () => Object.assign(new Error('not-configured'), { code: 'not-configured' });

  function saveApplication() {
    if (DEMO) return wait(600);
    if (!db) return Promise.reject(notConfigured());
    const games = RUINS.filter(r => state.games.has(r.game)).map(r => r.game);
    return withTimeout(db.collection('applications').doc(state.studentId).set({
      name: state.name,
      studentId: state.studentId,
      games,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }));
  }

  function errorLines(err) {
    const code = err && err.code;
    if (code === 'permission-denied') return T.errDup(state.studentId);
    if (code === 'not-configured') return T.errConfig;
    return T.errNet;
  }

  // ---------- 화면 조각 ----------
  function nameFields(prefix, nameVal, idVal) {
    return `
      <label class="field">
        <span>${T.nameLabel}</span>
        <input id="${prefix}Name" autocomplete="name" maxlength="20" required value="${esc(nameVal)}" aria-describedby="${prefix}NameErr">
        <small class="err" id="${prefix}NameErr" role="alert"></small>
      </label>
      <label class="field">
        <span>${T.idLabel} <em>(${T.idHint})</em></span>
        <input id="${prefix}Id" inputmode="numeric" pattern="\\d{5}" maxlength="5" required value="${esc(idVal)}" aria-describedby="${prefix}IdErr">
        <small class="err" id="${prefix}IdErr" role="alert"></small>
      </label>`;
  }
  // 이름·학번 검사: 통과하면 {name, sid}, 아니면 null
  function readNameFields(prefix) {
    const nEl = $(`#${prefix}Name`), iEl = $(`#${prefix}Id`);
    const name = nEl.value.trim().replace(/\s+/g, ' ');
    const sid = iEl.value.trim();
    const okN = NAME_RE.test(name), okI = STUDENT_ID_RE.test(sid);
    $(`#${prefix}NameErr`).textContent = okN ? '' : T.errName;
    $(`#${prefix}IdErr`).textContent = okI ? '' : T.errId;
    nEl.setAttribute('aria-invalid', String(!okN));
    iEl.setAttribute('aria-invalid', String(!okI));
    if (!okN || !okI) { (okN ? iEl : nEl).focus(); return null; }
    return { name, sid };
  }

  function ruinCard(r) {
    return `
      <article class="ruin-card part-${r.part}">
        <div class="ruin-icon" aria-hidden="true">${r.icon}</div>
        <div class="ruin-body">
          <h3>${g(r).ruin}</h3>
          <p class="ruin-game">${g(r).name}</p>
          <p>${g(r).desc}</p>
          <p class="ruin-meta"><span class="time-tag">⏰ ${partLabel(r.part)} ${timeRange(r.part)}</span> ${placeTag()}</p>
          <p class="ruin-quote">“${g(r).quote}”</p>
        </div>
      </article>`;
  }

  function rulesBox() {
    return `
      <div class="card rules">
        <h3>${T.rulesTitle}</h3>
        <ol>${T.rules.map(r => `<li>${r}</li>`).join('')}</ol>
      </div>`;
  }

  function partBlock(part) {
    const list = RUINS.filter(r => r.part === part)
      .map(r => `<li>${r.icon} ${g(r).ruin} <small>${g(r).name}</small></li>`).join('');
    return `
      <div class="tl-part">
        <div class="tl-time"><b>${partLabel(part)}</b><span>${PARTS[part].start}<br>~${PARTS[part].end}</span></div>
        <div class="tl-body"><ul>${list}</ul>${placeTag()}</div>
      </div>`;
  }

  function overlapParts(games) {
    const byPart = partsOf(games);
    return [1, 2].filter(p => byPart[p].length > 1);
  }
  function overlapNote(games) {
    const parts = overlapParts(games);
    if (!parts.length) return '';
    return `<p class="warn" role="status">${T.overlap(parts.map(partLabel).join(', '))}</p>`;
  }

  // 부별 일정: 시간 → 종목들 → 장소
  function itinerary(games) {
    const byPart = partsOf(games);
    return `<ul class="itinerary">${[1, 2].filter(p => byPart[p].length).map(p => `
      <li>
        <div class="it-head"><span class="time-tag">⏰ ${partLabel(p)} ${timeRange(p)}</span>${placeTag()}</div>
        ${byPart[p].map(r => `<div class="it-game">${r.icon} <b>${g(r).ruin}</b> <small>${g(r).name}</small></div>`).join('')}
      </li>`).join('')}</ul>`;
  }

  function firstCall(name, games) {
    const byPart = partsOf(games);
    const first = byPart[1].length ? 1 : 2;
    return {
      call: T.call(name, partLabel(first), PARTS[first].start),
      sub: first === 1 && byPart[2].length ? T.callSub(partLabel(2), PARTS[2].start) : ''
    };
  }

  // ---------- 신청 장면들 ----------
  const sceneName = scene(async function () {
    setStep(1);
    if (!await say(T.intro)) return;
    showPanel(`
      <form class="card form" id="nameForm" novalidate>
        <h2 class="card-title">${T.formTitle}</h2>
        ${nameFields('f', state.name, state.studentId)}
        <p class="place-line">${T.placeLine}</p>
        <button class="btn btn-block" type="submit">${T.formSubmit}</button>
      </form>`, '#fName');

    $('#nameForm').addEventListener('submit', e => {
      e.preventDefault();
      const v = readNameFields('f');
      if (!v) return;
      state.name = v.name;
      state.studentId = v.sid;
      sceneRuins(true);
    });
  });

  const sceneRuins = scene(async function (fresh) {
    setStep(2);
    const lines = fresh ? [T.ruinsFresh(state.name), T.ruinsIntro] : [T.ruinsIntro];
    if (!await say(lines)) return;
    showPanel(`
      <div class="ruin-list">${RUINS.map(ruinCard).join('')}</div>
      <p class="prize-line">🏆 ${T.prize}</p>
      <div class="btn-row">
        <button class="btn btn-ghost" type="button" data-go="back">${T.back}</button>
        <button class="btn" type="button" data-go="next">${T.ruinsNext}</button>
      </div>`, '[data-go="next"]');
    panel.querySelector('[data-go="back"]').onclick = () => sceneName();
    panel.querySelector('[data-go="next"]').onclick = () => sceneMap();
  });

  const sceneMap = scene(async function () {
    setStep(3);
    if (!await say(T.map)) return;
    showPanel(`
      <div class="card map">
        <h2 class="card-title">${T.mapTitle}</h2>
        <div class="map-hq"><span class="map-pin" aria-hidden="true">📍</span><div><small>${T.meet}</small><b>${T.place}</b></div></div>
        <div class="timeline">
          ${partBlock(1)}
          <div class="tl-break">${T.mapBreak}</div>
          ${partBlock(2)}
        </div>
      </div>
      ${rulesBox()}
      <div class="btn-row">
        <button class="btn btn-ghost" type="button" data-go="back">${T.back}</button>
        <button class="btn" type="button" data-go="next">${T.mapNext}</button>
      </div>`, '[data-go="next"]');
    panel.querySelector('[data-go="back"]').onclick = () => sceneRuins(false);
    panel.querySelector('[data-go="next"]').onclick = () => sceneSelect();
  });

  const sceneSelect = scene(async function () {
    setStep(4);
    if (!await say(T.select)) return;
    const group = part => `
      <fieldset class="pick-group">
        <legend><span class="time-tag">⏰ ${partLabel(part)} ${timeRange(part)}</span> ${placeTag()}</legend>
        ${RUINS.filter(r => r.part === part).map(r => `
          <label class="pick">
            <input type="checkbox" name="game" value="${r.game}" ${state.games.has(r.game) ? 'checked' : ''}>
            <span class="pick-box">
              <span class="pick-icon" aria-hidden="true">${r.icon}</span>
              <span class="pick-text"><b>${g(r).ruin}</b><small>${g(r).name}</small></span>
              <span class="pick-check" aria-hidden="true">✔</span>
            </span>
          </label>`).join('')}
      </fieldset>`;
    showPanel(`
      <form class="card" id="pickForm" novalidate>
        <h2 class="card-title">${T.selectTitle}</h2>
        ${group(1)}${group(2)}
        <div id="pickWarn" aria-live="polite"></div>
        <small class="err" id="pickErr" role="alert"></small>
        <div class="btn-row">
          <button class="btn btn-ghost" type="button" data-go="back">${T.back}</button>
          <button class="btn" type="submit">${T.selectNext}</button>
        </div>
      </form>`, 'input[name="game"]');

    const form = $('#pickForm');
    const sync = () => {
      state.games = new Set([...form.querySelectorAll('input[name="game"]:checked')].map(i => i.value));
      $('#pickWarn').innerHTML = overlapNote([...state.games]);
      if (state.games.size) $('#pickErr').textContent = '';
    };
    form.addEventListener('change', sync);
    sync();
    panel.querySelector('[data-go="back"]').onclick = () => sceneMap();
    form.addEventListener('submit', e => {
      e.preventDefault();
      if (!state.games.size) { $('#pickErr').textContent = T.pickErr; return; }
      sceneConfirm();
    });
  });

  const sceneConfirm = scene(async function (err) {
    setStep(5);
    if (!await say(err ? errorLines(err) : T.confirm)) return;
    showPanel(`
      <div class="card confirm">
        <h2 class="card-title">${T.confirmTitle}</h2>
        <dl class="summary">
          <dt>${T.nameLabel}</dt><dd>${esc(state.name)}</dd>
          <dt>${T.idLabel}</dt><dd>${esc(state.studentId)}</dd>
          <dt>${T.meet}</dt><dd><b class="hl">📍 ${T.place}</b></dd>
        </dl>
        ${itinerary([...state.games])}
        ${overlapNote([...state.games])}
        ${DEMO ? `<p class="demo">${T.demo}</p>` : ''}
        <div class="btn-row">
          <button class="btn btn-ghost" type="button" data-go="back">${T.fix}</button>
          <button class="btn btn-danger" type="button" data-go="submit">${T.submit}</button>
        </div>
      </div>`, '[data-go="submit"]');
    panel.querySelector('[data-go="back"]').onclick = () => sceneSelect();
    panel.querySelector('[data-go="submit"]').onclick = submit;
  });

  // ---------- 신청: 바위 연출 + 저장 ----------
  const fx = $('#fx');
  const fxCaption = $('#fxCaption');
  const fxStamp = $('#fxStamp');

  async function playBoulder() {
    fx.hidden = false;
    fx.className = 'fx';
    fxStamp.hidden = true;
    fxCaption.textContent = T.fx[0];
    void fx.offsetWidth;                 // 애니메이션 재시작
    fx.classList.add('rolling');
    await wait(900);
    fxCaption.textContent = T.fx[1];
    await wait(1300);
    fxCaption.textContent = T.fx[2];
    await wait(900);
  }

  async function playStamp() {
    fx.classList.add('stamped');
    fxCaption.textContent = '';
    fxStamp.hidden = false;
    await wait(1400);
  }

  function hideFx() {
    fx.hidden = true;
    fx.className = 'fx';
  }

  let submitting = false;
  async function submit(e) {
    if (submitting) return;
    submitting = true;
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = T.saving;
    const animate = !reducedMotion.matches;

    const saving = saveApplication().then(() => null, err => err || new Error('unknown'));
    if (animate) {
      await playBoulder();
      fxCaption.textContent = T.fxSaving;
    }
    const err = await saving;
    submitting = false;
    if (err) {
      console.error(err);
      hideFx();
      sceneConfirm(err);
      return;
    }
    if (animate) await playStamp();
    hideFx();
    sceneDone();
  }

  const sceneDone = scene(async function () {
    setStep(6);
    const games = [...state.games];
    const { call, sub } = firstCall(state.name, games);
    if (!await say([T.done1, call])) return;
    showPanel(`
      <div class="card done">
        <div class="stamp done-stamp"><span>${T.stampHtml}</span></div>
        <p class="call" tabindex="-1">${esc(call)}</p>
        ${sub ? `<p class="call-sub">${esc(sub)}</p>` : ''}
        ${itinerary(games)}
        ${overlapNote(games)}
        ${rulesBox()}
        <p class="notice">${T.notice}</p>
        <p class="prize-line">🏆 ${T.prize}</p>
        ${DEMO ? `<p class="demo">${T.demo}</p>` : ''}
        ${fbMode === 'emulator' ? `<p class="demo">${T.emu}</p>` : ''}
        <button class="btn btn-ghost btn-block" type="button" data-go="again">${T.again}</button>
      </div>`, '.call');
    panel.querySelector('[data-go="again"]').onclick = goHome;
  });

  // ---------- 선정 결과 확인 ----------
  // 반환: {status:'notOpen'|'notFound'} 또는 {status:'ok', selected:[], applied:[]}
  async function lookup(name, sid) {
    if (DEMO) {
      await wait(500);
      return { status: 'ok', selected: ['끄투온라인', '오목'], applied: ['끄투온라인', '테트리스', '오목'] };
    }
    if (!db) throw notConfigured();
    const settings = await withTimeout(db.collection('settings').doc('results').get());
    if (!settings.exists || settings.data().open !== true) return { status: 'notOpen' };
    const key = await resultKey(sid, name);
    let snap;
    try {
      snap = await withTimeout(db.collection('results').doc(key).get());
    } catch (e) {
      if (e.code === 'permission-denied') return { status: 'notOpen' };   // 방금 발표가 취소된 경우
      throw e;
    }
    if (!snap.exists) return { status: 'notFound' };
    const d = snap.data();
    return { status: 'ok', selected: d.selected || [], applied: d.applied || [] };
  }

  const sceneLookup = scene(async function (errLines) {
    setStep(0);
    if (!await say(errLines || T.res)) return;
    showPanel(`
      <form class="card form" id="lookupForm" novalidate>
        <h2 class="card-title">${T.resTitle}</h2>
        ${nameFields('r', state.lookupName, state.lookupId)}
        <div class="btn-row">
          <button class="btn btn-ghost" type="button" data-go="home">${T.resHome}</button>
          <button class="btn" type="submit">${T.resSubmit}</button>
        </div>
      </form>`, '#rName');
    panel.querySelector('[data-go="home"]').onclick = goHome;

    $('#lookupForm').addEventListener('submit', async e => {
      e.preventDefault();
      const v = readNameFields('r');
      if (!v) return;
      state.lookupName = v.name;
      state.lookupId = v.sid;
      const btn = e.target.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = T.resChecking;
      let res;
      try {
        res = await lookup(v.name, v.sid);
      } catch (err) {
        console.error(err);
        sceneLookup(err.code === 'not-configured' ? T.errConfig : T.errNet);
        return;
      }
      if (res.status === 'notOpen') sceneLookup(T.resNotOpen);
      else if (res.status === 'notFound') sceneLookup(T.resNotFound);
      else sceneResult(res);
    });
  });

  const sceneResult = scene(async function (res) {
    setStep(0);
    const name = state.lookupName;
    const yes = res.selected.length > 0;
    if (!await say(yes ? T.resYes(name) : T.resNo(name))) return;
    const notPicked = RUINS.filter(r => res.applied.includes(r.game) && !res.selected.includes(r.game));
    let body;
    if (yes) {
      const { call, sub } = firstCall(name, res.selected);
      body = `
        <p class="call" tabindex="-1">${esc(call)}</p>
        ${sub ? `<p class="call-sub">${esc(sub)}</p>` : ''}
        <h3 class="res-sub">${T.resYesTitle}</h3>
        ${itinerary(res.selected)}
        ${notPicked.length ? `<p class="res-not">${T.resNotPicked}: ${notPicked.map(r => `${r.icon} ${g(r).name}`).join(', ')}</p>` : ''}
        <p class="warn">${T.resLate}</p>
        <p class="prize-line">🏆 ${T.prize}</p>`;
    } else {
      body = `<p class="call" tabindex="-1">${esc(T.resNo(name)[1])}</p>`;
    }
    showPanel(`
      <div class="card done ${yes ? 'res-yes' : 'res-no'}">
        <div class="stamp done-stamp ${yes ? '' : 'stamp-gray'}"><span>${yes ? T.resYesStamp : T.resNoStamp}</span></div>
        ${body}
        ${DEMO ? `<p class="demo">${T.demo}</p>` : ''}
        <div class="btn-row">
          <button class="btn btn-ghost" type="button" data-go="retry">${T.resRetry}</button>
          <button class="btn" type="button" data-go="home">${T.resHome}</button>
        </div>
      </div>`, '.call');
    panel.querySelector('[data-go="retry"]').onclick = () => sceneLookup();
    panel.querySelector('[data-go="home"]').onclick = goHome;
  });

  // ---------- 시작 화면 ----------
  function goHome() {
    if (dlg.resolve) { const r = dlg.resolve; dlg.resolve = null; r(false); }
    clearInterval(dlg.timer);
    current = null;
    state.games = new Set();
    $('#stage').hidden = true;
    $('#titleScreen').hidden = false;
    window.scrollTo(0, 0);
    $('#startBtn').focus({ preventScroll: true });
  }
  function enterStage(first) {
    window.BGM.start();
    $('#titleScreen').hidden = true;
    $('#stage').hidden = false;
    first();
  }
  $('#startBtn').addEventListener('click', () => enterStage(() => sceneName()));
  $('#resultBtn').addEventListener('click', () => enterStage(() => sceneLookup()));

  applyStatic();
})();
