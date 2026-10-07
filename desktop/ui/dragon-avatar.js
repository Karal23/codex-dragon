(() => {
  'use strict';
  const sources = { idle: '/dsh-whale/image.png' };
  const ready = new Set(['idle']);
  for (const state of ['blink', 'working', 'success', 'failed']) {
    sources[state] = `/assets/codex-dragon-${state}.png`;
    const image = new Image(); image.src = sources[state];
    image.decode().then(() => ready.add(state)).catch(() => {});
  }
  let state = 'idle', base = 'idle', expressionUntil = 0, blinkUntil = 0, nextBlink = Date.now() + 3500;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  function paint(next) {
    const image = document.querySelector('.dshwv-img');
    if (!image || (localStorage.getItem('dshw-role') || 'default') !== 'default') return;
    if (!ready.has(next)) next = 'idle';
    if (image.getAttribute('src') !== sources[next]) {
      image.src = sources[next]; image.alt = `Codex 龙娘 · ${{ idle: '待机', blink: '眨眼', working: '专注', success: '完成', failed: '受挫' }[next]}`;
      window.WhaleRendering?.presentFor?.(250);
    }
    state = next; image.dataset.dragonState = next;
  }
  window.DragonAvatar = {
    update(data, completion) {
      base = data.status.connected && data.status.activeTurns ? 'working' : 'idle';
      if (completion) { expressionUntil = Date.now() + 4200; paint(completion === 'success' ? 'success' : completion === 'cancelled' ? 'idle' : 'failed'); }
      else if (Date.now() >= expressionUntil) paint(base);
    },
  };
  setInterval(() => {
    if (document.documentElement.dataset.wsl !== 'true') return;
    const now = Date.now();
    if (now < expressionUntil) return;
    if (blinkUntil) { if (now >= blinkUntil) { blinkUntil = 0; paint(base); } return; }
    if (now >= nextBlink) {
      nextBlink = now + 4000 + Math.random() * 3500;
      if (base === 'idle' && !reduced.matches) { blinkUntil = now + 180; paint('blink'); return; }
    }
    if (state !== base) paint(base);
  }, 90);
})();
