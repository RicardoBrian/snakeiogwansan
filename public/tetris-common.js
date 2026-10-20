// 테트리스 공통: 블록 색, 보드 그리기(썸네일), 판별 순위·누적 점수 계산 — 게임 화면과 관리자 화면이 함께 씀
(() => {
  'use strict';
  // 칸 번호: 1 I, 2 J, 3 L, 4 O, 5 S, 6 T, 7 Z, 8 방해 줄
  const COLORS = ['', '#22d3ee', '#3b82f6', '#f97316', '#facc15', '#22c55e', '#a855f7', '#ef4444', '#6b7280'];
  const BW = 10, VIS = 20;
  const PLACE_POINTS = [10, 7, 5, 3, 2, 2]; // 7위 이하는 1점
  const placePoints = (place) => PLACE_POINTS[place - 1] || 1;

  function drawCell(ctx, x, y, s, c, alpha) {
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.fillStyle = COLORS[c];
    ctx.fillRect(x, y, s, s);
    if (s >= 8) {
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(x, y, s, Math.max(1, s * 0.15));
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(x, y + s - Math.max(1, s * 0.15), s, Math.max(1, s * 0.15));
    }
    ctx.globalAlpha = 1;
  }

  // b: 보이는 20줄을 위에서부터 한 칸에 한 글자('0'~'8')로 이어 붙인 문자열
  function drawThumb(canvas, b, cell) {
    const w = BW * cell, h = VIS * cell, dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0a0e16';
    ctx.fillRect(0, 0, w, h);
    if (cell >= 6) {
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 1; x < BW; x++) { ctx.moveTo(x * cell + 0.5, 0); ctx.lineTo(x * cell + 0.5, h); }
      for (let y = 1; y < VIS; y++) { ctx.moveTo(0, y * cell + 0.5); ctx.lineTo(w, y * cell + 0.5); }
      ctx.stroke();
    }
    if (typeof b !== 'string') return;
    for (let i = 0; i < b.length && i < BW * VIS; i++) {
      const c = b.charCodeAt(i) - 48;
      if (c > 0 && c < COLORS.length) drawCell(ctx, (i % BW) * cell, Math.floor(i / BW) * cell, cell, c);
    }
  }

  // 한 판의 순위
  // entries: { 학번: { n } } (그 판에 참가한 학생), results: { 학번: { t, win?, stop?, sent?, lines? } }
  // 살아남은 학생(결과 없음/1위/강제 종료)이 앞, 그 안에서는 1위 → 공격량 → 지운 줄 순
  // 탈락한 학생은 늦게 탈락할수록 앞
  function placements(entries, results) {
    entries = entries || {}; results = results || {};
    const list = Object.keys(entries).map((sid) => {
      const r = results[sid] || null;
      return { sid, name: String((entries[sid] && entries[sid].n) || sid), r,
        dead: !!r && !r.win && !r.stop, win: !!(r && r.win), sent: +(r && r.sent) || 0, lines: +(r && r.lines) || 0 };
    });
    list.sort((a, b) => {
      if (a.dead !== b.dead) return a.dead ? 1 : -1;
      if (a.dead) return (b.r.t - a.r.t) || (a.sid < b.sid ? -1 : 1);
      if (a.win !== b.win) return a.win ? -1 : 1;
      return (b.sent - a.sent) || (b.lines - a.lines) || (a.sid < b.sid ? -1 : 1);
    });
    list.forEach((p, i) => { p.place = i + 1; });
    return list;
  }

  // 판 id 는 'g1', 'g2' … (숫자만 쓰면 Firebase 가 배열로 바꿔버림)
  const gameNo = (gid) => +String(gid).replace(/^g/, '') || 0;

  const aliveCount = (entries, results) =>
    Object.keys(entries || {}).filter((sid) => { const r = (results || {})[sid]; return !r || r.win || r.stop; }).length;

  // 판이 끝났는지: 지난 판이거나, 관리자가 종료했거나, 생존자가 1명 이하(혼자면 0명)
  // 아무도 참가하지 않은 판은 참가 마감(시작 3초 뒤)이 지나면 끝난 것으로 봄 (nowMs 를 넘긴 경우)
  function isFinished(gid, game, entries, results, nowMs) {
    if (!game || String(game.id) !== String(gid) || game.over) return true;
    const n = Object.keys(entries || {}).length;
    if (!n) return nowMs != null && nowMs > +game.start + 3000;
    return aliveCount(entries, results) <= (n >= 2 ? 1 : 0);
  }

  // 누적 순위: 끝난 판(2명 이상 참가)만 점수 계산
  function standings(allEntries, allResults, game) {
    allEntries = allEntries || {}; allResults = allResults || {};
    const rows = new Map();
    const gids = Object.keys(allEntries).sort((a, b) => gameNo(a) - gameNo(b));
    for (const gid of gids) {
      const entries = allEntries[gid] || {}, results = allResults[gid] || {};
      for (const sid of Object.keys(entries)) {
        const row = rows.get(sid) || { sid, name: '', pts: 0, wins: 0, games: 0, sent: 0 };
        row.name = String(entries[sid].n || sid);
        rows.set(sid, row);
      }
      if (Object.keys(entries).length < 2 || !isFinished(gid, game, entries, results)) continue;
      for (const p of placements(entries, results)) {
        const row = rows.get(p.sid);
        row.pts += placePoints(p.place);
        row.games++;
        row.sent += p.sent;
        if (p.place === 1) row.wins++;
      }
    }
    return Array.from(rows.values())
      .filter((r) => r.games > 0)
      .sort((a, b) => (b.pts - a.pts) || (b.wins - a.wins) || (b.sent - a.sent) || (a.sid < b.sid ? -1 : 1));
  }

  window.TCOMMON = { COLORS, BW, VIS, drawCell, drawThumb, placements, aliveCount, isFinished, standings, placePoints, gameNo };
})();
