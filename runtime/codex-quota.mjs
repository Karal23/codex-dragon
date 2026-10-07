import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';

export function normalizeQuota(result, observedAt = Date.now()) {
  const buckets = result?.rateLimitsByLimitId && Object.keys(result.rateLimitsByLimitId).length
    ? Object.entries(result.rateLimitsByLimitId)
    : [[result?.rateLimits?.limitId || 'codex', result?.rateLimits]];
  const windows = [];
  for (const [bucketId, bucket] of buckets) {
    for (const slot of ['primary', 'secondary']) {
      const value = bucket?.[slot];
      if (!value || !Number.isFinite(value.usedPercent) || value.usedPercent < 0 || value.usedPercent > 100 ||
          !Number.isFinite(value.windowDurationMins) || value.windowDurationMins <= 0) continue;
      const minutes = value.windowDurationMins;
      const duration = minutes === 10080 ? '每周' : minutes % 1440 === 0 ? `${minutes / 1440} 天`
        : minutes % 60 === 0 ? `${minutes / 60} 小时` : `${minutes} 分钟`;
      const resetsAt = Number.isFinite(value.resetsAt) ? value.resetsAt * 1000 : null;
      windows.push({ id: `${bucketId}:${slot}`, limitId: bucketId, windowDurationMins: minutes,
        label: `${bucket.limitName || (bucketId === 'codex' ? 'Codex' : bucketId)} · ${duration}`,
        usedPercent: value.usedPercent, remainingPercent: 100 - value.usedPercent,
        resetsAt, observedAt, stale: resetsAt === null || resetsAt <= observedAt, source: 'app-server' });
    }
  }
  return { available: windows.length > 0, windows, observedAt,
    reason: windows.length ? 'Codex 官方订阅额度' : '账号当前未返回可显示的额度窗口' };
}

// This process only issues account reads. Existing interactive sessions are
// observed separately through their local logs; no thread is started/resumed.
export class CodexQuota {
  constructor({ binary, codexHome, onSnapshot, spawnProcess = spawn, timeoutMs = 15000, refreshMs = 60000 }) {
    Object.assign(this, { binary, codexHome, onSnapshot, spawnProcess, timeoutMs, refreshMs });
    this.pending = new Map(); this.serial = 0; this.closed = false;
    this.snapshot = { available: false, windows: [], observedAt: null, reason: '正在读取订阅额度…' };
  }
  request(method, params) {
    return new Promise((resolve, reject) => {
      if (!this.child || this.child.exitCode !== null || this.closed) { reject(new Error('closed')); return; }
      const id = ++this.serial;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('timeout')); }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, ...(params === undefined ? {} : { params }) }) + '\n');
    });
  }
  failed(reason) {
    this.snapshot = { ...this.snapshot, windows: this.snapshot.windows.map(w => ({ ...w, stale: true })), stale: true, reason };
    if (!this.closed) this.onSnapshot(this.snapshot);
  }
  async start() {
    if (this.closed) return;
    clearTimeout(this.retryTimer); clearInterval(this.timer);
    this.child = this.spawnProcess(this.binary, ['app-server', '--listen', 'stdio://'], {
      stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...(this.codexHome ? { CODEX_HOME: this.codexHome } : {}) },
    });
    this.child.stderr.resume();
    this.child.stdin.on('error', () => {});
    const rejectPending = () => {
      for (const job of this.pending.values()) { clearTimeout(job.timer); job.reject(new Error('disconnected')); }
      this.pending.clear();
    };
    const retry = () => {
      this.ready = false; rejectPending();
      if (!this.closed && !this.retryTimer) this.retryTimer = setTimeout(() => { this.retryTimer = null; this.lines?.close(); void this.start(); }, 5000);
    };
    this.child.on('error', () => { this.failed('无法启动 Codex，5 秒后自动重试'); retry(); });
    this.child.on('exit', () => { this.failed('额度连接已断开，正在自动重连'); retry(); });
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', line => {
      let message; try { message = JSON.parse(line); } catch { return; }
      const job = this.pending.get(message.id);
      if (!job) return;
      clearTimeout(job.timer); this.pending.delete(message.id);
      if (message.error) job.reject(new Error('rpc-error'));
      else job.resolve(message.result);
    });
    try {
      await this.request('initialize', { clientInfo: { name: 'codex_dragon', title: 'Codex 龙娘', version: '0.2.0' } });
      this.child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
      this.ready = true;
      await this.refresh();
      if (!this.closed) this.timer = setInterval(() => void this.refresh(), this.refreshMs);
    } catch { this.failed('Codex 额度接口暂不可用，正在自动重试'); this.child?.kill(); }
  }
  async refresh() {
    if (!this.ready || this.closed) return;
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const { account } = await this.request('account/read', { refreshToken: false });
        const accountKey = createHash('sha256').update(JSON.stringify(account || null)).digest('hex');
        if (this.snapshot.accountKey !== accountKey) this.snapshot = { available: false, windows: [], observedAt: null, accountKey };
        if (!account || account.type !== 'chatgpt') {
          this.failed('请在所选 WSL 用户中使用 ChatGPT 账号登录 Codex'); return;
        }
        const result = await this.request('account/rateLimits/read');
        this.snapshot = { ...normalizeQuota(result), accountKey, planType: account.planType || null, stale: false };
        if (!this.closed) this.onSnapshot(this.snapshot);
      } catch { this.failed('额度刷新失败，保留上次结果；请稍后刷新'); }
    })().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }
  async close() {
    if (this.closed) return;
    this.closed = true; clearInterval(this.timer); clearTimeout(this.retryTimer); this.lines?.close();
    for (const job of this.pending.values()) { clearTimeout(job.timer); job.reject(new Error('closed')); }
    this.pending.clear();
    const child = this.child;
    if (child && child.exitCode === null && child.signalCode === null) {
      child.stdin.end(); child.kill('SIGTERM');
      await new Promise(resolve => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 1500);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    }
  }
}
