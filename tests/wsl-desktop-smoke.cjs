// Run with Windows Electron, --wsl, --whale-data, --app-root and --qa-dir.
// Optional --fixture-log points at an isolated WSL session log via its UNC path.
// Without it this only reads the configured account and tests the desktop UI.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const option = name => process.argv.find(a => a.startsWith(name + '='))?.slice(name.length + 1);
const output = option('--qa-dir'), fixtureLog = option('--fixture-log');
fs.mkdirSync(output, { recursive: true });
require(path.join(option('--app-root'), 'desktop/main.cjs'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [], errors = [];
let window;
const ev = code => window.webContents.executeJavaScript(code);
async function wait(read, label, ms = 45000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await read()) return; await delay(100); }
  throw new Error('Timed out: ' + label);
}
const state = () => ev("fetch('/api/wsl').then(r=>r.json())");
const rect = selector => ev(`(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}; })()`);
const petPoint = () => ev(`(() => {const img=document.querySelector('.dshwv-img'),root=document.querySelector('.dshwv-root'),r=img.getBoundingClientRect();for(let y=r.y+r.height*.3;y<r.bottom;y+=5)for(let x=r.x+r.width*.3;x<r.right;x+=5)if(WhaleRendering.petInteraction.hit(img,root,x,y))return{x,y};throw Error('No opaque pixel');})()`);
function move(x, y) {
  x = Math.round(x); y = Math.round(y);
  window.webContents.send('whale-cursor', { x, y, buttons: 0, sampledAt: 0 });
  window.webContents.sendInputEvent({ type: 'mouseMove', x, y });
}
async function click(selector) {
  const r = await rect(selector), x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2);
  window.focus(); move(x, y); await delay(100);
  window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x, y });
  await delay(40);
  window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x, y });
  await delay(250);
}
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (_event, details) => { if (details.level === 'error') errors.push(details.message); });
});
app.whenReady().then(async () => {
  try {
    await wait(() => { window = BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Codex 龙娘'); return window; }, 'window');
    await wait(async () => window.isVisible() && await ev("!!window.WhaleWSL && document.querySelector('.dshwv-img')?.naturalWidth > 0"), 'visible desktop');
    await wait(async () => { const s = await state(); return s.status.connected && s.subscription.available; }, 'WSL and quota');
    const quota = await state();
    await wait(async () => (await ev("document.querySelector('.whale-wsl-panel progress')?.value")) === quota.subscription.windows[0].remainingPercent, 'quota rendered');
    const native = await ev("fetch('/api/status').then(r=>r.json()).then(s=>({mode:s.desktopMode,shape:s.windowShape,shapeError:s.windowShapeError}))");
    assert.equal(native.mode, 'standalone'); assert.equal(native.shapeError, null); assert.ok(native.shape.length > 1);
    assert.equal(await ev("getComputedStyle(document.querySelector('[data-desktop-command=follow]')).display"), 'none');
    checks.push('Windows transparent standalone window, native shape, real WSL bridge and quota rendering');
    await click('.whale-wsl-heading button');
    assert.equal(await ev("document.querySelector('#wsl-settings')?.open"), true);
    assert.equal(await ev("document.querySelector('#wsl-settings input[name=distribution]').value"), quota.connection.distribution);
    await click('#wsl-settings header button');
    assert.equal(await ev("!!document.querySelector('#wsl-settings')"), false);
    checks.push('WSL settings open and close through Electron pointer input');
    await click('.whale-wsl-actions button:nth-child(1)');
    assert.equal(await ev("document.querySelector('#dragon-history')?.open"), true);
    await click('#dragon-history header button');
    checks.push('Persistent history dialog opens through pointer input');
    const before = await rect('.dshwv-root');
    const target = await petPoint();
    window.focus(); move(target.x, target.y); await delay(100);
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: Math.round(target.x), y: Math.round(target.y) });
    // Move beyond the original character's edge-snap zone.
    const dx = before.x > 600 ? -500 : 200, dy = before.y > 400 ? -280 : 100;
    for (let i = 1; i <= 10; i++) { move(target.x + dx * i / 10, target.y + dy * i / 10); await delay(35); }
    window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: Math.round(target.x + dx), y: Math.round(target.y + dy) });
    await delay(600);
    const dragged = await rect('.dshwv-root'); assert.ok(Math.abs(dragged.x - before.x) > 50);
    checks.push('Character drag moves the widget and companion card');
    for (const collapsed of [false, true]) {
      if (collapsed) await click('.whale-wsl-heading button:last-child');
      const hover = await petPoint(); move(hover.x, hover.y); await delay(100);
      await click('.dshwv-menu-btn');
      await wait(() => ev("document.querySelector('.dshwv-menu').classList.contains('dshwv-menu-open')"), 'menu opened', 3000);
      assert.equal(await ev("document.querySelector('.whale-wsl-panel').checkVisibility()"), false, 'Status card must not cover the open menu');
      for (const page of ['usage', 'settings', 'overview']) {
        const tab = '#whale-tab-' + page;
        assert.equal(await ev(`(() => {const tab=document.querySelector(${JSON.stringify(tab)}),r=tab.getBoundingClientRect();return tab.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()`), true, 'Menu tab receives pointer input');
        await click(tab);
        assert.equal(await ev('window.WhaleDashboard.page'), page);
      }
      if (!collapsed) fs.writeFileSync(path.join(output, 'menu.png'), (await window.webContents.capturePage()).toPNG());
      await click('.dshwv-menu-btn');
      await wait(() => ev("!document.querySelector('.dshwv-menu').classList.contains('dshwv-menu-open') && document.querySelector('.whale-wsl-panel').checkVisibility()"), 'status card restored', 3000);
      assert.equal(await ev("document.querySelector('.whale-wsl-panel > div').hidden"), collapsed, 'Menu preserves the collapsed state');
      if (collapsed) await click('.whale-wsl-heading button:last-child');
    }
    checks.push('Menu hides the status card, all tabs receive clicks, and closing restores its expanded or collapsed state');
    if (fixtureLog) {
      await ev(`window.__qaPulses=[]; new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1&&node.matches('.whale-wsl-float'))window.__qaPulses.push(node.textContent);}).observe(document.querySelector('.whale-wsl-panel'),{childList:true});`);
      const append = rows => fs.appendFileSync(fixtureLog, rows.map(JSON.stringify).join('\n') + '\n');
      const event = (type, rest = {}) => ({ type: 'event_msg', timestamp: new Date().toISOString(), payload: { type, ...rest } });
      const id = 'desktop-' + Date.now();
      append([{ type: 'session_meta', payload: { id } }, event('task_started', { turn_id: id }), { type: 'turn_context', payload: { turn_id: id, model: 'fixture' } }]);
      await wait(async () => (await state()).status.activeTurns === 1, 'active task');
      await wait(async () => await ev("document.querySelector('.dshwv-img').dataset.dragonState === 'working'"), 'working expression');
      append([event('token_count', { info: { total_token_usage: { input_tokens: 100, output_tokens: 20 }, last_token_usage: { input_tokens: 100, output_tokens: 20 } } })]);
      await wait(async () => await ev("document.querySelector('.whale-wsl-float')?.textContent.includes('120')"), 'token pulse');
      await delay(150);
      fs.writeFileSync(path.join(output, 'pulse.png'), (await window.webContents.capturePage()).toPNG());
      const request = (response_id, input, output, totalInput, totalOutput) => ({ type: 'token_usage_record', timestamp: new Date().toISOString(), payload: {
        turn_id: id, response_id, usage: { input_tokens: input, output_tokens: output },
        thread_token_usage: { input_tokens: totalInput, output_tokens: totalOutput } } });
      const first = request('request-1', 10, 1, 110, 21);
      append([first]);
      await wait(() => ev("window.__qaPulses.includes('+11 Token')"), 'request pulse before any tool result or token_count', 4000);
      assert.equal((await state()).status.activeTokens, 131);
      append([request('request-2', 20, 2, 130, 23), request('request-3', 30, 3, 160, 26), first,
        event('token_count', { info: { total_token_usage: { input_tokens: 160, output_tokens: 26 }, last_token_usage: { input_tokens: 30, output_tokens: 3 } } }),
        event('task_complete', { turn_id: id })]);
      await wait(() => ev("window.__qaPulses.includes('完成啦')"), 'queued request and completion pulses', 7000);
      assert.deepEqual(await ev('window.__qaPulses'), ['+120 Token', '+11 Token', '+22 Token', '+33 Token', '完成啦']);
      assert.equal((await state()).lastTurn.tokens, 186);
      assert.equal(await ev("document.querySelector('.dshwv-img').dataset.dragonState"), 'success');
      checks.push('Each model response pulses before tool completion; bursts play in order without duplicates or losing the final pulse');
    }
    await click('.whale-wsl-actions button:nth-child(3)');
    await wait(async () => (await state()).status.connected, 'reconnected');
    checks.push('Reconnect from the desktop');
    await wait(async () => (await state()).tokens?.allTime?.total >= 0, 'complete local history');
    const saved = await ev("fetch('/api/wsl/preferences',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({threshold:15,autoUpdate:false})}).then(r=>r.json())");
    assert.equal(saved.preferences.threshold, 15);
    checks.push('Quota notification preferences persist through production dispatcher');
    await delay(1200);
    fs.writeFileSync(path.join(output, 'desktop.png'), (await window.webContents.capturePage()).toPNG());
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ ok: true, checks, errors }, null, 2));
  } catch (error) {
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ ok: false, checks, error: error.stack, errors }, null, 2));
    if (window && !window.isDestroyed()) fs.writeFileSync(path.join(output, 'failure.png'), (await window.webContents.capturePage()).toPNG());
    process.exitCode = 1;
  } finally { app.quit(); }
});
