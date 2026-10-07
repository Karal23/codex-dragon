// Windows Electron acceptance for OS integration, using an isolated installed app.
const { app, BrowserWindow, powerMonitor } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const option = name => process.argv.find(a => a.startsWith(name + '='))?.slice(name.length + 1);
const root = option('--app-root'), output = option('--qa-dir'), dataDir = option('--whale-data');
fs.mkdirSync(output, { recursive: true }); require(path.join(root, 'desktop/main.cjs'));
let window; const checks = [], ev = code => window.webContents.executeJavaScript(code);
async function wait(read, label) { const end = Date.now() + 45000; while (Date.now() < end) { if (await read()) return; await new Promise(r => setTimeout(r, 150)); } throw Error('Timed out: ' + label); }
const api = (route, body) => ev(`fetch(${JSON.stringify(route)},{method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(JSON.stringify(body || {}))}}).then(r=>r.json())`);
const prefs = value => ev(`fetch('/api/wsl/preferences',{method:'PUT',headers:{'Content-Type':'application/json'},body:${JSON.stringify(JSON.stringify(value))}}).then(r=>r.json())`);
const state = () => ev("fetch('/api/wsl').then(r=>r.json())");
app.whenReady().then(async () => {
  let previous;
  try {
    await wait(() => { window = BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Codex 龙娘'); return window; }, 'window');
    await wait(async () => (await state()).status.connected, 'connected'); previous = (await state()).preferences;
    const detected = await api('/api/wsl/detect', { distribution: 'Ubuntu' });
    assert.equal(detected.ok, true); assert.equal(detected.connection.user, 'qyh');
    assert.ok(detected.connection.agentPath.includes('/CodexDragonQA/app/runtime/wsl-agent.mjs'));
    checks.push('Actual Windows-to-WSL autodetection resolves user, Node, Codex and installed helper');
    const args = [path.join(root, 'desktop/main.cjs'), '--wsl', `--whale-data=${dataDir}`].map(a => '"' + a + '"');
    assert.equal((await prefs({ autostart: true })).ok, true);
    assert.equal(app.getLoginItemSettings({ path: process.execPath, args }).openAtLogin, true);
    assert.equal((await prefs({ autostart: false })).ok, true);
    assert.equal(app.getLoginItemSettings({ path: process.execPath, args }).openAtLogin, false);
    checks.push('Windows login item is registered and removed through production settings');
    powerMonitor.emit('suspend'); await wait(async () => !(await state()).status.connected, 'suspended');
    powerMonitor.emit('resume'); await wait(async () => (await state()).status.connected, 'resumed');
    checks.push('Suspend and resume handlers close and reconnect the WSL bridge');
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ ok: true, checks }, null, 2));
  } catch (error) { fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ ok: false, checks, error: error.stack }, null, 2)); }
  finally { if (previous && window && !window.isDestroyed()) await prefs({ autostart: previous.autostart }).catch(() => {}); app.quit(); }
});
