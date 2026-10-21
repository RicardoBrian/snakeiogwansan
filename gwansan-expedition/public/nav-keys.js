// 0 = 전광판, 1 = 1부 안내, 2 = 2부 안내
// /screen 안에 들어 있으면 부모에게 알려서 전체 화면을 유지한 채 전환, 단독으로 열었으면 페이지 이동
(function () {
  'use strict';
  const VIEWS = { '0': 'board', '1': 'part1', '2': 'part2' };
  const embedded = window.parent !== window;
  if (embedded) document.body.classList.add('embedded');
  document.addEventListener('keydown', e => {
    const v = VIEWS[e.key];
    if (!v || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    if (embedded) window.parent.postMessage({ gkView: e.key }, location.origin);
    else location.href = v + location.search;
  });
})();
