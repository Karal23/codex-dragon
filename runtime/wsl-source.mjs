import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import { readJson, writeJson } from './paths.mjs';

export function validateWslConnection(value) {
  const result = {};
  for (const key of ['distribution', 'user', 'agentPath', 'nodePath', 'codexBin', 'codexHome']) {
    const text = value?.[key];
    if (typeof text !== 'string' || !text.trim() || text.length > 2048 || /[\x00-\x1f]/.test(text)) throw new Error('请完整填写 WSL 连接信息');
    if (['agentPath', 'nodePath', 'codexBin', 'codexHome'].includes(key) && !text.startsWith('/')) throw new Error('程序和数据目录须填写 WSL 内的绝对路径');
    result[key] = text.trim();
  }
  return result;
}

export function wslCommand(c) {
  return ['--distribution', c.distribution, '--user', c.user, '--exec', c.nodePath,
    c.agentPath, '--codex-bin', c.codexBin, '--codex-home', c.codexHome];
}

export class WslSource {
  constructor(service, { dataDir, spawnProcess = spawn, wslBinary = 'wsl.exe', retryMs = 2000, onQuota = () => {} } = {}) {
    Object.assign(this, { service, dataDir, spawnProcess, wslBinary, retryMs, onQuota });
    this.attempt = 0;
    this.file = path.join(dataDir, 'wsl-connection.json'); this.pending = new Set(); this.generation = 0;
    this.connection = null; this.connected = false; this.error = ''; this.closed = false;
    this.quota = { available: false, windows: [], observedAt: null, reason: '尚未连接 WSL' };
    this.tokens = null; this.monitor = { watching: 0, initializing: true }; this.pulse = { seq: 0, tokens: 0 }; this.pulses = [];
  }
  start() {
    try { this.connection = validateWslConnection(readJson(this.file, {})); }
    catch { this.error = '请设置 WSL 连接'; return; }
    this.connect();
  }
  connect() {
    clearTimeout(this.retryTimer); this.retryAt = null;
    this.closed = false; this.error = ''; this.monitor = { watching: 0, initializing: true };
    const generation = ++this.generation;
    const child = this.spawnProcess(this.wslBinary, wslCommand(this.connection), { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.child = child; child.stderr.resume(); child.stdin.on('error', () => {});
    this.lines = createInterface({ input: child.stdout });
    const fail = message => {
      if (generation !== this.generation || this.closed) return;
      this.connected = false; this.error = message; this.monitor.initializing = false;
      this.scheduleRetry();
    };
    child.on('error', () => fail('无法启动 WSL，请检查发行版和程序路径'));
    child.on('exit', () => fail('WSL 连接已断开，正在自动重连'));
    this.lines.on('line', line => {
      if (generation !== this.generation || this.closed) return;
      let message; try { message = JSON.parse(line); } catch { return; }
      this.receive(message);
    });
    child.once('spawn', () => {
      this.service.prepareRecovery();
      const active = this.service.journal.list().filter(row => row.stage === 'active');
      const recoverIds = active.map(row => row.meta.id);
      this.service.recoveryActive = new Set(recoverIds);
      this.send({ type: 'initialize', recoverIds, observedAfter: Object.fromEntries(active.filter(row => Number.isFinite(row.meta.observedAfter)).map(row => [row.meta.id, row.meta.observedAfter])) });
    });
    this.startTimer = setTimeout(() => {
      if (!this.connected && generation === this.generation) fail('WSL 启动超时，正在自动重试');
    }, 45000);
    this.healthTimer = setInterval(() => {
      if (generation === this.generation && this.connected && Date.now() - this.lastSeen > 15000) fail('WSL 暂无响应，正在自动重连');
    }, 5000);
  }
  scheduleRetry() {
    if (this.closed || this.retryTimer) return;
    const delay = Math.min(this.retryMs * 2 ** Math.min(this.attempt++, 5), 60000);
    this.retryAt = Date.now() + delay;
    this.retryTimer = setTimeout(async () => {
      this.retryTimer = null;
      const closing = this.disconnect(), generation = this.generation;
      await closing;
      if (!this.closed && generation === this.generation) this.connect();
    }, delay);
  }
  receive(message) {
    if (['ready', 'status'].includes(message.type)) {
      clearTimeout(this.startTimer); clearTimeout(this.retryTimer); this.retryTimer = null; this.retryAt = null; this.attempt = 0; this.connected = true; this.error = '';
      this.monitor = { ...message.status, initializing: false }; this.lastSeen = Date.now();
    } else if (message.type === 'quota') { this.quota = message.data; this.onQuota(this.quota); }
    else if (message.type === 'insights') {
      if (message.data.tokens) this.tokens = message.data.tokens;
      if (message.data.progress) this.tokens = { ...this.tokens, ...message.data.progress };
      this.insightsError = message.data.error;
    }
    else if (message.type === 'error') { this.error = message.error; this.monitor.initializing = false; if (!this.connected) this.scheduleRetry(); }
    else if (message.type === 'recovery') this.service.finishMissingRecovery(message.seenIds);
    else if (message.type === 'turn') {
      const meta = message.meta;
      if (!meta?.id || !meta.turnId) return;
      const total = usage => Object.values(usage || {}).reduce((sum, row) => sum + (row.input_tokens || 0) + (row.output_tokens || 0), 0);
      const previous = total(this.service.turns.get(meta.id)?.byModel);
      if (message.event === 'start') this.service.beginTurn(meta);
      else if (message.event === 'update') {
        this.service.updateTurn(meta);
        const delta = Math.max(0, total(meta.byModel) - previous);
        if (delta) {
          this.pulse = { seq: this.pulse.seq + 1, tokens: delta, at: Date.now() };
          this.pulses.push(this.pulse);
          if (this.pulses.length > 64) this.pulses.shift();
        }
      } else if (message.event === 'end') {
        const job = this.service.finishTurn(meta).catch(() => { this.error = '一条用量记录暂时未能保存'; }).finally(() => this.pending.delete(job));
        this.pending.add(job);
      }
    }
  }
  send(message) { if (this.child?.stdin.writable) this.child.stdin.write(JSON.stringify(message) + '\n'); }
  async configure(input) {
    const next = validateWslConnection(input);
    const stopping = this.stop(), generation = this.generation;
    await stopping;
    if (generation !== this.generation) return;
    writeJson(this.file, next); this.connection = next; this.tokens = null;
    this.quota = { available: false, windows: [], observedAt: null, reason: '正在读取订阅额度…' };
    this.connect();
  }
  refresh() { this.send({ type: 'refresh' }); }
  async reconnect() {
    if (!this.connection) throw new Error('请先设置 WSL 连接');
    const stopping = this.stop(), generation = this.generation;
    await stopping;
    if (generation === this.generation) { this.attempt = 0; this.connect(); }
  }
  getInsights() {
    const stale = !this.connected || this.quota.stale || Date.now() - this.quota.observedAt > 900000;
    return { ok: true, tokens: this.tokens, subscription: { ...this.quota,
      windows: this.quota.windows.map(w => ({ ...w, stale: stale || w.stale || w.resetsAt <= Date.now() })),
      stale, reason: this.error || this.quota.reason }, error: this.insightsError || null };
  }
  status() {
    const turns = [...this.service.turns.values()].filter(t => !t.isSubagent);
    return { ...this.monitor, activeTurns: this.connected ? turns.length : 0, connected: this.connected, error: this.error,
      activeTokens: this.connected ? turns.reduce((sum, t) => sum + Object.values(t.byModel || {}).reduce((n, u) => n + (u.input_tokens || 0) + (u.output_tokens || 0), 0), 0) : null,
      partial: turns.some(t => t.partial), pulse: this.pulse, pulses: this.pulses, lastSeen: this.lastSeen || null, retryAt: this.retryAt || null };
  }
  state() { return { ok: true, enabled: true, connection: this.connection, status: this.status(), ...this.getInsights(), lastTurn: this.service.lastTurn() }; }
  disconnect() {
    ++this.generation; clearTimeout(this.startTimer); clearInterval(this.healthTimer); this.lines?.close(); this.connected = false;
    const child = this.child; this.child = null;
    // Closing stdin lets the Linux agent terminate its own app-server child.
    if (child && child.exitCode === null && child.signalCode === null) {
      child.stdin.end();
      return new Promise(resolve => {
        const timer = setTimeout(() => { if (child.exitCode === null) child.kill(); resolve(); }, 2500);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    }
  }
  async stop() { this.closed = true; clearTimeout(this.retryTimer); this.retryTimer = null; this.retryAt = null; await this.disconnect(); await Promise.allSettled([...this.pending]); }
}

export async function listWslDistributions() {
  const { stdout } = await promisify(execFile)('wsl.exe', ['--list', '--quiet'], { encoding: 'buffer', windowsHide: true, timeout: 10000 });
  return stdout.toString('utf16le').replace(/^\uFEFF/, '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}
