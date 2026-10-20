// 탐사대 장부 — 관리자만 신청 목록 열람 (실제 차단은 firestore.rules가 담당)
(function () {
  'use strict';

  const { PARTS, RUINS, partsOf, initFirebase } = window.GWANSAN;
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let fb = null;
  try { fb = initFirebase(['auth', 'firestore']); } catch (e) { console.error(e); }
  if (!fb) {
    $('#loginMsg').textContent = 'Firebase 설정이 비어 있습니다. firebase-config.js를 채워주세요.';
    $('#signIn').disabled = true;
    return;
  }

  const auth = firebase.auth();
  const db = firebase.firestore();
  let rows = [];
  let unsub = null;

  RUINS.forEach(r => {
    const o = document.createElement('option');
    o.value = r.game;
    o.textContent = `${PARTS[r.part].label} · ${r.game}`;
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
      } else {
        $('#loginMsg').textContent = `로그인 실패: ${e.code || e.message}`;
      }
    }
  });
  $('#signOut').addEventListener('click', () => auth.signOut());

  auth.onAuthStateChanged(user => {
    if (unsub) { unsub(); unsub = null; }
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
    unsub = db.collection('applications').orderBy('createdAt', 'desc').onSnapshot(snap => {
      $('#boardMsg').textContent = '';
      rows = snap.docs.map(d => {
        const v = d.data();
        const games = Array.isArray(v.games) ? v.games : [];
        const byPart = partsOf(games);
        return {
          studentId: v.studentId || d.id,
          name: v.name || '',
          games,
          overlap: [1, 2].filter(p => byPart[p].length > 1),
          createdAt: v.createdAt ? v.createdAt.toDate() : null
        };
      });
      render();
    }, err => {
      $('#boardMsg').textContent = err.code === 'permission-denied'
        ? '읽기 권한이 없습니다. firestore.rules의 관리자 이메일과 로그인한 계정이 같은지 확인하세요.'
        : `불러오기 실패: ${err.message}`;
    });
  });

  function fmt(d) {
    if (!d) return '';
    const p = n => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  function visible() {
    const g = $('#filter').value;
    const q = $('#search').value.trim();
    const only = $('#onlyOverlap').checked;
    return rows.filter(r => (!g || r.games.includes(g))
      && (!only || r.overlap.length)
      && (!q || r.name.includes(q) || r.studentId.includes(q)));
  }

  function render() {
    const stat = (label, n) => `<div class="stat"><small>${label}</small><b>${n}</b></div>`;
    $('#stats').innerHTML = stat('전체 신청자', rows.length)
      + RUINS.map(r => stat(`${PARTS[r.part].label} ${r.game}`, rows.filter(x => x.games.includes(r.game)).length)).join('')
      + stat('같은 부 중복', rows.filter(x => x.overlap.length).length);

    const list = visible();
    $('#rows').innerHTML = list.map((r, i) => {
      const chips = RUINS.filter(x => r.games.includes(x.game))
        .map(x => `<span class="chip p${x.part}">${PARTS[x.part].label} ${esc(x.game)}</span>`).join('');
      const warn = r.overlap.length ? `<div class="overlap">⚠ ${r.overlap.map(p => PARTS[p].label).join('·')} 중복</div>` : '';
      return `<tr><td>${list.length - i}</td><td>${esc(r.studentId)}</td><td>${esc(r.name)}</td><td>${chips}${warn}</td><td class="when">${fmt(r.createdAt)}</td></tr>`;
    }).join('') || '<tr><td colspan="5">신청자가 없습니다.</td></tr>';
  }

  ['#filter', '#search', '#onlyOverlap'].forEach(s => $(s).addEventListener('input', render));

  $('#csvBtn').addEventListener('click', () => {
    const cell = v => `"${String(v).replace(/"/g, '""')}"`;
    const head = ['학번', '이름', ...RUINS.map(r => `${PARTS[r.part].label} ${r.game}`), '같은 부 중복', '신청 시각'];
    const body = [...rows].reverse().map(r => [
      r.studentId, r.name,
      ...RUINS.map(x => (r.games.includes(x.game) ? 'O' : '')),
      r.overlap.map(p => PARTS[p].label).join(' '),
      r.createdAt ? r.createdAt.toLocaleString('ko-KR') : ''
    ]);
    const csv = '﻿' + [head, ...body].map(row => row.map(cell).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `관산게임왕_신청자_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
})();
