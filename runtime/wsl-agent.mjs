import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { Worker } from 'node:worker_threads';
import { SessionReader } from './session-monitor.mjs';
import { safeTurn } from './turn-journal.mjs';
import { CodexQuota } from './codex-quota.mjs';

export async function runAgent({ input = process.stdin, output = process.stdout, codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
  codexBin = path.join(os.homedir(), '.local/bin/codex'), intervalMs = 750, discoverMs = 3000 } = {}) {
  let reader, timer, insightTimer, worker, closed = false, started = false;
  const observedAfter = {};
  const send = data => { if (!closed && !output.destroyed) output.write(JSON.stringify(data) + '\n'); };
  const quota = new CodexQuota({ binary: codexBin, codexHome, onSnapshot: data => send({ type: 'quota', data }) });
  function insights() {
    if (worker || closed) return;
    worker = new Worker(new URL('./dragon-history.mjs', import.meta.url), { workerData: { codexHome, cacheDir: process.env.CODEX_DRAGON_HISTORY_DIR || path.join(os.homedir(), '.local/share/codex-dragon') } });
    const current = worker;
    current.on('message', data => send({ type: 'insights', data }));
    current.once('error', () => send({ type: 'insights', data: { error: '本机会话统计暂不可用' } }));
    current.once('exit', () => { if (worker === current) worker = null; });
  }
  function event(type, meta) {
    if (type === 'start' && meta.partial && !observedAfter[meta.id]) observedAfter[meta.id] = Date.now();
    send({ type: 'turn', event: type, meta: { ...safeTurn({ ...meta, observedAfter: observedAfter[meta.id], partial: meta.partial || !!observedAfter[meta.id] }), recoverable: !!meta.recoverable,
      historical: !!meta.historical, notify: !!meta.notify, statusNotify: !!meta.statusNotify, statusCorrection: !!meta.statusCorrection } });
  }
  const lines = createInterface({ input });
  lines.on('line', line => {
    let message; try { message = JSON.parse(line); } catch { return; }
    if (message.type === 'initialize' && !started) {
      started = true;
      if (!path.isAbsolute(codexHome) || !fs.existsSync(codexHome)) { send({ type: 'error', error: '所选 Codex 数据目录不存在' }); return; }
      for (const [id, at] of Object.entries(message.observedAfter || {})) if (Number.isFinite(at) && at > 0) observedAfter[id] = at;
      reader = new SessionReader({ root: path.join(codexHome, 'sessions'), discoverMs, observedAfter, preferRequestUsage: true,
        recoverIds: Array.isArray(message.recoverIds) ? message.recoverIds.filter(id => typeof id === 'string') : [],
        onStart: meta => event('start', meta), onUpdate: meta => event('update', meta), onEnd: meta => event('end', meta) });
      reader.tick(true);
      send({ type: 'ready', status: reader.status() });
      send({ type: 'recovery', seenIds: reader.status().recoverySeen });
      timer = setInterval(() => {
        try { reader.tick(); send({ type: 'status', status: reader.status() }); }
        catch { send({ type: 'error', error: 'WSL 会话读取失败，请检查数据目录' }); }
      }, intervalMs);
      insights(); insightTimer = setInterval(insights, 30000);
      void quota.start();
    } else if (message.type === 'refresh') { void quota.refresh(); insights(); }
  });
  async function close() {
    if (closed) return;
    closed = true; clearInterval(timer); clearInterval(insightTimer); lines.close();
    await Promise.allSettled([worker?.terminate(), quota.close()]);
  }
  lines.once('close', () => { void close(); });
  output.on('error', () => { void close(); });
  return { close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const agent = await runAgent({ codexHome: option('--codex-home'), codexBin: option('--codex-bin') });
  process.once('SIGTERM', () => { void agent.close(); });
  process.once('SIGINT', () => { void agent.close(); });
}
