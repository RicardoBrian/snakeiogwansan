// 관리자 페이지 — 신청 목록, 선정 체크, 결과 공개 (실제 차단은 firestore.rules가 담당)
(function () {
  'use strict';

  const { RUINS, partsOf, initFirebase, resultKey } = window.GWANSAN;
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const partLabel = p => `${p}부`;

  let fb = null;
  try { fb = initFirebase(['auth', 'firestore']); } catch (e) { console.error(e); }
  if (!fb) {
    $('#loginMsg').textContent = 'Firebase 설정이 비어 있습니다. firebase-config.js를 채워주세요.';
    $('#signIn').disabled = true;
    return;
  }

  const auth = firebase.auth();
  const db = firebase.firestore();
  const now = () => firebase.firestore.FieldValue.serverTimestamp();
  let apps = [];                 // 신청서
  const keys = new Map();        // 학번 → 결과 문서 키
  const results = new Map();     // 결과 문서 키 → { selected, applied }
  let open = false;
  let unsubs = [];

  RUINS.forEach(r => {
    const o = document.createElement('option');
    o.value = r.game;
    o.textContent = `${partLabel(r.part)} · ${r.game}`;
    $('#filter').appendChild(o);
  });

  $('#signIn').addEventListener('click', async () => {
    $('#loginMsg').textContent = '';
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await auth.signInWithPopup(provider);
    } catch (e) {
      if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
        auth.signInWithRedirect(provider);
      } else if (e.code === 'auth/unauthorized-domain') {
        $('#loginMsg').textContent = `이 주소(${location.hostname})가 Firebase 승인된 도메인에 없습니다. Authentication → 설정 → 승인된 도메인에 추가하세요.`;
      } else {
        $('#loginMsg').textContent = `로그인 실패: ${e.code || e.message}`;
      }
    }
  });
  $('#signOut').addEventListener('click', () => auth.signOut());

  const denied = err => err.code === 'permission-denied'
    ? '권한이 없습니다. firestore.rules의 관리자 이메일과 로그인한 계정이 같은지, 규칙을 게시했는지 확인하세요.'
    : `오류: ${err.message}`;

  auth.onAuthStateChanged(user => {
    unsubs.forEach(u => u());
    unsubs = [];
    if (!user) {
      $('#board').hidden = true;
      $('#loginBox').hidden = false;
      return;
    }
    const email = (user.email || '').toLowerCase();
    if (fb.mode === 'live' && email !== String(window.ADMIN_EMAIL).toLowerCase()) {
      $('#loginMsg').textContent = `${user.email} 계정은 관리자가 아닙니다.`;
      auth.signOut();
      return;
    }
    $('#loginBox').hidden = true;
    $('#board').hidden = false;
    $('#who').textContent = `👤 ${user.email}`;

    unsubs.push(db.collection('applications').orderBy('createdAt', 'desc').onSnapshot(async snap => {
      $('#boardMsg').textContent = '';
      apps = snap.docs.map(d => {
        const v = d.data();
        return {
          studentId: v.studentId || d.id,
          name: v.name || '',
          games: Array.isArray(v.games) ? v.games : [],
          createdAt: v.createdAt ? v.createdAt.toDate() : null
        };
      });
      await Promise.all(apps.map(async a => {
        if (!keys.has(a.studentId)) keys.set(a.studentId, await resultKey(a.studentId, a.name));
      }));
      render();
    }, err => { $('#boardMsg').textContent = denied(err); }));

    unsubs.push(db.collection('results').onSnapshot(snap => {
      results.clear();
      snap.docs.forEach(d => results.set(d.id, d.data()));
      render();
    }, err => { $('#publishMsg').textContent = denied(err); }));

    unsubs.push(db.collection('settings').doc('results').onSnapshot(snap => {
      open = snap.exists && snap.data().open === true;
      renderPublish();
    }, err => { $('#publishMsg').textContent = denied(err); }));
  });

  const selectedOf = a => {
    const r = results.get(keys.get(a.studentId));
    return r && Array.isArray(r.selected) ? r.selected.filter(g => a.games.includes(g)) : [];
  };
  const overlapOf = games => { const b = partsOf(games); return [1, 2].filter(p => b[p].length > 1); };

  function fmt(d) {
    if (!d) return '';
    const p = n => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  function visible() {
    const g = $('#filter').value;
    const q = $('#search').value.trim();
    const onlyOverlap = $('#onlyOverlap').checked;
    const onlySel = $('#onlySelected').checked;
    return apps.filter(a => (!g || a.games.includes(g))
      && (!onlyOverlap || overlapOf(a.games).length)
      && (!onlySel || selectedOf(a).length)
      && (!q || a.name.includes(q) || a.studentId.includes(q)));
  }

  function renderPublish() {
    const missing = apps.filter(a => !results.has(keys.get(a.studentId))).length;
    $('#openState').textContent = open ? '공개 중' : '비공개';
    $('#openState').className = `state-chip ${open ? 'on' : 'off'}`;
    $('#publishBtn').textContent = open ? '공개 중지' : '결과 공개하기';
    $('#publishHint').textContent = open
      ? `학생이 지금 결과를 조회할 수 있습니다. 체크를 바꾸면 바로 반영됩니다.${missing ? ` (결과 미생성 ${missing}명 → "공개 중지" 후 다시 공개하면 생성)` : ''}`
      : '표에서 종목별 선정을 체크한 뒤 공개하세요. 공개하면 학생이 첫 화면의 [선정 결과 확인]에서 이름+학번으로 조회할 수 있습니다.';
  }

  function render() {
    const stat = (label, n, cls = '') => `<div class="stat ${cls}"><small>${label}</small><b>${n}</b></div>`;
    $('#stats').innerHTML = stat('전체 신청자', apps.length)
      + RUINS.map(r => stat(`${partLabel(r.part)} ${r.game} 신청 / 선정`,
        `${apps.filter(a => a.games.includes(r.game)).length} / ${apps.filter(a => selectedOf(a).includes(r.game)).length}`)).join('')
      + stat('같은 부 중복 신청', apps.filter(a => overlapOf(a.games).length).length)
      + stat('선정된 학생', apps.filter(a => selectedOf(a).length).length, 'sel-stat');

    const list = visible();
    $('#rows').innerHTML = list.map((a, i) => {
      const sel = selectedOf(a);
      const boxes = RUINS.filter(r => a.games.includes(r.game)).map(r => `
        <label class="sel ${sel.includes(r.game) ? 'on' : ''}">
          <input type="checkbox" data-sid="${esc(a.studentId)}" data-game="${esc(r.game)}" ${sel.includes(r.game) ? 'checked' : ''}>
          <span class="chip p${r.part}">${partLabel(r.part)} ${esc(r.game)}</span>
        </label>`).join('');
      const warns = [];
      const oa = overlapOf(a.games), os = overlapOf(sel);
      if (oa.length) warns.push(`⚠ ${oa.map(partLabel).join('·')} 중복 신청`);
      if (os.length) warns.push(`⚠ ${os.map(partLabel).join('·')} 두 종목 모두 선정됨`);
      return `<tr><td>${list.length - i}</td><td>${esc(a.studentId)}</td><td>${esc(a.name)}</td><td>${boxes}${warns.map(w => `<div class="overlap">${w}</div>`).join('')}</td><td class="when">${fmt(a.createdAt)}</td></tr>`;
    }).join('') || '<tr><td colspan="5">신청자가 없습니다.</td></tr>';
    renderPublish();
  }

  // 선정 체크 → 결과 문서 바로 저장
  $('#rows').addEventListener('change', async e => {
    const box = e.target.closest('input[type="checkbox"][data-sid]');
    if (!box) return;
    const a = apps.find(x => x.studentId === box.dataset.sid);
    if (!a) return;
    const sel = new Set(selectedOf(a));
    if (box.checked) sel.add(box.dataset.game); else sel.delete(box.dataset.game);
    box.disabled = true;
    try {
      await db.collection('results').doc(keys.get(a.studentId)).set({
        selected: RUINS.map(r => r.game).filter(g => sel.has(g)),
        applied: a.games,
        updatedAt: now()
      });
      $('#boardMsg').textContent = '';
    } catch (err) {
      box.checked = !box.checked;
      $('#boardMsg').textContent = denied(err);
    } finally {
      box.disabled = false;
    }
  });

  // 공개: 결과 문서가 없는 신청자는 "미선정"으로 만든 뒤 공개 스위치를 켬
  $('#publishBtn').addEventListener('click', async () => {
    const btn = $('#publishBtn');
    $('#publishMsg').textContent = '';
    if (open) {
      if (!confirm('결과 공개를 중지할까요? 학생들이 더 이상 조회할 수 없게 됩니다.')) return;
    } else {
      const picked = apps.filter(a => selectedOf(a).length).length;
      if (!confirm(`선정된 학생 ${picked}명 / 전체 ${apps.length}명. 결과를 공개할까요?\n(체크하지 않은 학생은 "미선정"으로 표시됩니다)`)) return;
    }
    btn.disabled = true;
    try {
      if (!open) {
        const missing = apps.filter(a => !results.has(keys.get(a.studentId)));
        for (let i = 0; i < missing.length; i += 400) {
          const batch = db.batch();
          missing.slice(i, i + 400).forEach(a => batch.set(db.collection('results').doc(keys.get(a.studentId)),
            { selected: [], applied: a.games, updatedAt: now() }));
          await batch.commit();
        }
      }
      await db.collection('settings').doc('results').set({ open: !open, updatedAt: now() });
    } catch (err) {
      $('#publishMsg').textContent = denied(err);
    } finally {
      btn.disabled = false;
    }
  });

  ['#filter', '#search', '#onlyOverlap', '#onlySelected'].forEach(s => $(s).addEventListener('input', render));

  $('#csvBtn').addEventListener('click', () => {
    const cell = v => `"${String(v).replace(/"/g, '""')}"`;
    const head = ['학번', '이름',
      ...RUINS.map(r => `${partLabel(r.part)} ${r.game} 신청`),
      ...RUINS.map(r => `${partLabel(r.part)} ${r.game} 선정`),
      '같은 부 중복 신청', '신청 시각'];
    const body = [...apps].reverse().map(a => {
      const sel = selectedOf(a);
      return [
        a.studentId, a.name,
        ...RUINS.map(r => (a.games.includes(r.game) ? 'O' : '')),
        ...RUINS.map(r => (sel.includes(r.game) ? 'O' : '')),
        overlapOf(a.games).map(partLabel).join(' '),
        a.createdAt ? a.createdAt.toLocaleString('ko-KR') : ''
      ];
    });
    const csv = '﻿' + [head, ...body].map(row => row.map(cell).join(',')).join('\r\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = `관산게임왕_신청자_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });
})();
