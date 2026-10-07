const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

async function createDragonSystem({ app, Notification, shell, root, dataDir, show, quit }) {
  const { verifyRelease } = await import(pathToFileURL(path.join(root, 'runtime/dragon-update.mjs')));
  const { detectWslConnection } = await import(pathToFileURL(path.join(root, 'runtime/wsl-detect.mjs')));
  const product = JSON.parse(fs.readFileSync(path.join(root, 'dragon.json'), 'utf8'));
  const installRoot = path.dirname(root), marker = path.join(installRoot, 'dragon-installation.json');
  const installation = fs.existsSync(marker) ? JSON.parse(fs.readFileSync(marker, 'utf8').replace(/^\uFEFF/, '')) : {};
  const installed = installation.id === product.id;
  const args = [path.join(root, 'desktop/main.cjs'), '--wsl', `--whale-data=${dataDir}`];
  const loginArgs = args.map(a => '"' + a + '"');
  const notifications = new Set();
  let preferences, timer, checking = null, available = null, applying = false, closed = false;
  let failedUpdate = null;
  try { failedUpdate = JSON.parse(fs.readFileSync(path.join(dataDir, 'last-update.json'), 'utf8').replace(/^\uFEFF/, '')); } catch {}
  const status = { version: product.version, installed, update: '尚未检查', checkedAt: null, availableVersion: null, notification: '' };
  const defaultUpdateDir = path.join(installRoot, 'updates');
  function notify(options) {
    if (!Notification.isSupported()) { status.notification = '当前系统不支持桌面通知'; return false; }
    const notification = new Notification({ ...options, icon: path.join(root, 'assets/codex-dragon.png') });
    notifications.add(notification);
    notification.on('click', show);
    notification.on('show', () => { status.notification = '通知已交给 Windows 显示'; });
    notification.on('failed', () => { status.notification = 'Windows 通知不可用，请检查系统通知设置'; notifications.delete(notification); });
    notification.on('close', () => notifications.delete(notification));
    notification.show(); return true;
  }
  async function configure(next) {
    if (next.updateDir && !path.isAbsolute(next.updateDir)) throw new Error('请选择 Windows 中的绝对更新目录');
    if (next.autostart && !installed) throw new Error('请先安装龙娘，再开启登录启动');
    if ((!preferences || preferences.autostart !== next.autostart) && (next.autostart || app.getLoginItemSettings({ path: process.execPath, args: loginArgs }).openAtLogin)) {
      app.setLoginItemSettings({ openAtLogin: next.autostart, path: process.execPath, args: loginArgs });
    }
    preferences = next;
  }
  async function checkUpdate() {
    if (checking) return checking;
    checking = (async () => {
      status.update = '正在检查本机版本包…';
      try {
        available = preferences?.updateDir ? await verifyRelease(preferences.updateDir, product.version) : null;
        status.availableVersion = available?.version || null;
        status.update = available ? `发现 ${available.version}，空闲时自动安装` : '当前已是目录中的最新版本';
        if (available && failedUpdate?.ok === false && failedUpdate.version === available.version && failedUpdate.sha256 === available.sha256) status.update = '上次更新失败已回退，请手动重试';
      } catch (e) {
        available = null; status.availableVersion = null;
        status.update = e.code === 'ENOENT' ? '目录内尚无版本包' : '版本包无效或校验失败';
      }
      status.checkedAt = Date.now(); return { ...status };
    })().finally(() => { checking = null; });
    return checking;
  }
  async function installUpdate() {
    if (applying || closed) return { ...status };
    if (!installed) throw new Error('请先使用安装入口安装龙娘');
    if (!available) await checkUpdate();
    if (!available) throw new Error('没有可安装的新版本');
    const candidate = await verifyRelease(preferences.updateDir, product.version);
    if (!candidate) throw new Error('新版本包已被移动，请重新检查');
    // Keep the installer outside the app directory that it will replace.
    const runner = path.join(dataDir, 'install-dragon.ps1');
    fs.copyFileSync(path.join(root, 'scripts/install-dragon.ps1'), runner);
    const readyFile = path.join(dataDir, 'update-ready.json'); fs.rmSync(readyFile, { force: true });
    const literal = value => "'" + String(value).replaceAll("'", "''") + "'";
    const installScript = `& ${literal(runner)} -InstallRoot ${literal(installRoot)} -DataDir ${literal(dataDir)} -Archive ${literal(candidate.archive)} -Sha256 ${literal(candidate.sha256)} -ExpectedVersion ${literal(candidate.version)} -ParentPid ${process.pid} -ReadyFile ${literal(readyFile)} *>> ${literal(path.join(dataDir, 'update-worker.log'))}`;
    const encoded = Buffer.from(installScript, 'utf16le').toString('base64');
    const bootstrap = `Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',${literal(encoded)})`;
    const log = fs.openSync(path.join(dataDir, 'update-launcher.log'), 'a');
    let child;
    // Start-Process creates an independent Windows process. DETACHED_PROCESS
    // makes PowerShell 5 exit silently; a direct child dies with this GUI.
    try { child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', bootstrap], { stdio: ['ignore', log, log], windowsHide: true, cwd: dataDir }); }
    finally { fs.closeSync(log); }
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref(); applying = true; status.update = '正在准备新版本…';
    try {
      const deadline = Date.now() + 120000;
      while (!fs.existsSync(readyFile)) {
        if (child.exitCode !== null && child.exitCode !== 0 || child.signalCode !== null || Date.now() >= deadline) throw new Error('安装程序未准备就绪，请查看更新日志');
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    } catch (error) { applying = false; status.update = error.message; throw error; }
    status.update = '正在安装，龙娘即将重新启动';
    setTimeout(quit, 300); return { ...status };
  }
  function start(getSource) {
    if (installed && installation.shortcut !== false) {
      const programs = path.join(app.getPath('appData'), 'Microsoft/Windows/Start Menu/Programs');
      fs.mkdirSync(programs, { recursive: true });
      for (const directory of [app.getPath('desktop'), programs]) {
        shell.writeShortcutLink(path.join(directory, 'Codex 龙娘.lnk'), 'create', { target: process.execPath, args: args.map(a => '"' + a + '"').join(' '), cwd: root,
          description: 'Codex 龙娘 · WSL 桌面伙伴', appUserModelId: 'Codex.Dragon', icon: process.execPath, iconIndex: 0 });
      }
    }
    const tick = async () => {
      if (!preferences?.autoUpdate || applying || closed) return;
      if (!status.checkedAt || Date.now() - status.checkedAt >= 15 * 60000) await checkUpdate();
      const source = getSource();
      if (!closed && available && !(failedUpdate?.ok === false && failedUpdate.version === available.version && failedUpdate.sha256 === available.sha256) && source?.status().connected && source.status().activeTurns === 0) {
        try { await installUpdate(); } catch { status.update = '自动安装失败，可在设置中重试'; }
      }
    };
    timer = setInterval(() => void tick(), 30000); void tick();
  }
  return { defaultUpdateDir, notify, configure, checkUpdate, installUpdate, start, status: () => ({ ...status }),
    detect: distribution => detectWslConnection({ root, distribution }), close: () => { closed = true; clearInterval(timer); for (const n of notifications) n.close(); } };
}
module.exports = { createDragonSystem };
