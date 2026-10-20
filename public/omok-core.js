// 오목 공용 (학생 화면, 관리자 페이지): 바둑판 그리기, 리그 순위 계산
(() => {
  'use strict';
  const SIZE = 15;
  const STARS = [[3, 3], [11, 3], [7, 7], [3, 11], [11, 11]];

  // 학번이 숫자(1, 2, 3…)면 Firebase 가 배열(빈 칸은 null)로 주므로 객체로 맞춤
  const obj = (v) => Object.fromEntries(Object.entries(v || {}).filter(([, x]) => x != null));
  const moves = (g) => (g ? (Array.isArray(g.mv) ? g.mv : Object.values(g.mv || {})).map(Number) : []);
  const turn = (g) => (moves(g).length % 2 === 0 ? 'b' : 'w');

  // 한 학생 기준 대국 결과: 'w'(승) 'd'(무) 'l'(패), 안 끝났으면 null
  function outcome(g, sid) {
    if (!g || !g.res) return null;
    if (g.res === 'd') return 'd';
    const mine = g.b === sid ? 'b' : 'w';
    return g.res === mine ? 'w' : 'l';
  }

  // 순위: 승점 → 승자승(동점자끼리 얻은 승점) → 다승 → 학번
  function standings(meta, members, games) {
    const pts = { w: num(meta && meta.win, 3), d: num(meta && meta.draw, 1), l: num(meta && meta.loss, 0) };
    const rows = {};
    const row = (sid) => rows[sid] || (rows[sid] = {
      sid, name: (members && members[sid] && members[sid].name) || sid, p: 0, w: 0, d: 0, l: 0, pts: 0, vs: {}
    });
    Object.keys(members || {}).forEach(row);
    for (const rk of Object.keys(games || {})) {
      for (const g of Object.values(games[rk] || {})) {
        if (!g || !g.res) continue;
        for (const [me, opp] of [[g.b, g.w], [g.w, g.b]]) {
          const r = row(me), o = outcome(g, me);
          r.p++; r[o]++; r.pts += pts[o];
          r.vs[opp] = (r.vs[opp] || 0) + pts[o];
        }
      }
    }
    const list = Object.values(rows);
    const groups = {};
    list.forEach((r) => { (groups[r.pts] = groups[r.pts] || []).push(r.sid); });
    list.forEach((r) => { r.h2h = groups[r.pts].reduce((s, o) => s + (r.vs[o] || 0), 0); });
    const key = (r) => [r.pts, r.h2h, r.w];
    list.sort((a, b) => b.pts - a.pts || b.h2h - a.h2h || b.w - a.w || (a.sid < b.sid ? -1 : 1));
    list.forEach((r, i) => {
      const prev = list[i - 1];
      r.rank = prev && key(prev).join() === key(r).join() ? prev.rank : i + 1;
    });
    return list;
  }

  function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }

  // 화면 크기에 맞춰 바둑판 그리기. o: { hover, hoverColor, pending, pendingColor }
  function drawBoard(cv, g, o) {
    o = o || {};
    const css = cv.clientWidth;
    if (!css) return;
    const dpr = window.devicePixelRatio || 1;
    const px = Math.round(css * dpr);
    if (cv.width !== px || cv.height !== px) { cv.width = px; cv.height = px; }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cell = css / (SIZE + 1);
    const at = (i) => cell * (i + 1);

    ctx.fillStyle = '#dcb06b';
    ctx.fillRect(0, 0, css, css);
    ctx.strokeStyle = '#5b4220';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < SIZE; i++) {
      ctx.moveTo(at(0), at(i)); ctx.lineTo(at(SIZE - 1), at(i));
      ctx.moveTo(at(i), at(0)); ctx.lineTo(at(i), at(SIZE - 1));
    }
    ctx.stroke();
    ctx.fillStyle = '#5b4220';
    for (const [x, y] of STARS) { ctx.beginPath(); ctx.arc(at(x), at(y), Math.max(2, cell * 0.1), 0, Math.PI * 2); ctx.fill(); }

    const stone = (pos, color, alpha) => {
      const x = at(pos % SIZE), y = at(Math.floor(pos / SIZE)), r = cell * 0.46;
      ctx.globalAlpha = alpha;
      const gr = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
      if (color === 'b') { gr.addColorStop(0, '#666'); gr.addColorStop(1, '#0a0a0a'); }
      else { gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#cfcfcf'); }
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      if (color === 'w') { ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.stroke(); }
      ctx.globalAlpha = 1;
    };

    const mv = moves(g);
    mv.forEach((p, i) => stone(p, i % 2 === 0 ? 'b' : 'w', 1));
    if (o.pending != null) stone(o.pending, o.pendingColor, 0.6);
    else if (o.hover != null && !mv.includes(o.hover)) stone(o.hover, o.hoverColor, 0.4);

    if (mv.length) {
      const last = mv[mv.length - 1];
      ctx.fillStyle = '#ef4444';
      ctx.beginPath(); ctx.arc(at(last % SIZE), at(Math.floor(last / SIZE)), cell * 0.13, 0, Math.PI * 2); ctx.fill();
    }
    const line = g && g.line ? Object.values(g.line).map(Number) : null;
    if (line && line.length) {
      ctx.strokeStyle = 'rgba(239, 68, 68, .85)';
      ctx.lineWidth = Math.max(3, cell * 0.14);
      ctx.lineCap = 'round';
      const a = line[0], b = line[line.length - 1];
      ctx.beginPath();
      ctx.moveTo(at(a % SIZE), at(Math.floor(a / SIZE)));
      ctx.lineTo(at(b % SIZE), at(Math.floor(b / SIZE)));
      ctx.stroke();
    }
  }

  // 마우스/터치 위치 → 칸 번호 (바둑판 밖이면 null)
  function posAt(cv, clientX, clientY) {
    const rect = cv.getBoundingClientRect();
    const cell = rect.width / (SIZE + 1);
    const x = Math.round((clientX - rect.left) / cell) - 1;
    const y = Math.round((clientY - rect.top) / cell) - 1;
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return null;
    return y * SIZE + x;
  }

  window.OmokCore = { SIZE, obj, moves, turn, outcome, standings, drawBoard, posAt };
})();
