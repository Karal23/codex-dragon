import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { parentPort, workerData } from 'node:worker_threads';

const keys = ['input_tokens', 'output_tokens', 'cached_input_tokens', 'reasoning_output_tokens'];
const count = n => Number.isSafeInteger(n) && n >= 0 ? n : 0;
const hash = value => createHash('sha256').update(value).digest('hex');
const day = at => { const d = new Date(at); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// The database contains only file cursors, session identifiers and usage counters.
// Prompt text, responses and account credentials are never stored or forwarded.
export class DragonHistory {
  constructor({ codexHome, cacheDir }) {
    this.codexHome = codexHome;
    fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
    const file = path.join(cacheDir, `history-${hash(path.resolve(codexHome)).slice(0, 20)}.sqlite`);
    this.db = new DatabaseSync(file); fs.chmodSync(file, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, identity TEXT, offset INTEGER, mtime REAL, state TEXT);
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, at INTEGER, input INTEGER, output INTEGER, cached INTEGER, reasoning INTEGER);
      CREATE INDEX IF NOT EXISTS events_time ON events(at);`);
    this.insert = this.db.prepare('INSERT OR IGNORE INTO events VALUES (?, ?, ?, ?, ?, ?)');
  }
  files() {
    const files = []; let unreadable = false;
    const walk = dir => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
      catch (e) { if (e.code !== 'ENOENT') unreadable = true; return; }
      for (const entry of entries) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (entry.isFile() && /^rollout-.*\.jsonl$/.test(entry.name)) files.push(file);
      }
    };
    walk(path.join(this.codexHome, 'sessions')); walk(path.join(this.codexHome, 'archived_sessions'));
    return { files: files.sort(), unreadable };
  }
  accept(d, s, now) {
    const p = d?.payload;
    if (!p) return;
    if (d.type === 'session_meta' && !s.id) {
      s.id = p.id || p.session_id; s.skip = count(p.subagent_history_start_ordinal);
      s.created = Date.parse(p.timestamp) || 0; s.forked = !!p.forked_from_id; return;
    }
    if (d.type !== 'event_msg' || p.type !== 'token_count' || !p.info?.total_token_usage) return;
    const at = Date.parse(d.timestamp);
    if (!Number.isFinite(at) || at > now + 60000 || s.forked && at < s.created) return;
    const next = keys.map(k => count(p.info.total_token_usage[k]));
    const reset = s.last && (next[0] < s.last[0] || next[1] < s.last[1]);
    if ((!s.last || reset) && !p.info.last_token_usage) s.partial = true;
    const delta = s.last && !reset ? next.map((n, i) => Math.max(0, n - s.last[i])) : keys.map(k => count(p.info.last_token_usage?.[k]));
    s.last = next;
    if (!delta[0] && !delta[1]) return;
    const id = hash(JSON.stringify([s.id || s.file, at, next]));
    this.insert.run(id, at, ...delta);
  }
  scanFile(file, now) {
    const stat = fs.statSync(file), identity = `${stat.dev}:${stat.ino}`;
    const old = this.db.prepare('SELECT * FROM files WHERE path = ?').get(file);
    if (old && old.identity === identity && old.offset === stat.size && old.mtime === stat.mtimeMs) return { ...JSON.parse(old.state), bytes: 0 };
    const resume = old && old.identity === identity && stat.size >= old.offset && !(stat.size === old.offset && old.mtime !== stat.mtimeMs);
    const s = resume ? JSON.parse(old.state) : { file, id: null, last: null, skip: 0, partial: false };
    let offset = resume ? old.offset : 0, cursor = offset, pending = Buffer.alloc(0), discarded = false;
    const buffer = Buffer.alloc(256 * 1024), fd = fs.openSync(file, 'r');
    this.db.exec('BEGIN');
    try {
      while (cursor < stat.size) {
        const n = fs.readSync(fd, buffer, 0, Math.min(buffer.length, stat.size - cursor), cursor);
        if (!n) break;
        cursor += n;
        pending = Buffer.concat([pending, buffer.subarray(0, n)]);
        let end;
        while ((end = pending.indexOf(10)) >= 0) {
          const line = pending.subarray(0, end); pending = pending.subarray(end + 1);
          offset = cursor - pending.length;
          if (s.skip > 0) { s.skip--; discarded = false; continue; }
          if (discarded) { discarded = false; continue; }
          const text = line.toString('utf8');
          if (!/"(?:session_meta|token_count)"/.test(text)) continue;
          try { this.accept(JSON.parse(text), s, now); } catch { s.partial = true; }
        }
        // Large conversation lines are irrelevant; do not retain their contents.
        if (pending.length > 8 * 1024 * 1024) { pending = Buffer.alloc(0); discarded = true; }
      }
      this.db.prepare('INSERT OR REPLACE INTO files VALUES (?, ?, ?, ?, ?)').run(file, identity, offset, stat.mtimeMs, JSON.stringify(s));
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    finally { fs.closeSync(fd); }
    return { ...s, bytes: cursor - (resume ? old.offset : 0) };
  }
  scan({ now = Date.now(), progress = () => {} } = {}) {
    const { files, unreadable } = this.files(); let complete = !unreadable, scannedBytes = 0, scannedFiles = 0, lastProgress = 0;
    for (const file of files) {
      try { const result = this.scanFile(file, now); scannedBytes += result.bytes; if (result.partial) complete = false; }
      catch { complete = false; }
      scannedFiles++;
      if (Date.now() - lastProgress > 500) { progress({ scanning: true, scannedFiles, totalFiles: files.length }); lastProgress = Date.now(); }
    }
    const total = this.db.prepare(`SELECT coalesce(sum(input),0) input, coalesce(sum(output),0) output,
      coalesce(sum(cached),0) cachedInput, coalesce(sum(reasoning),0) reasoningOutput FROM events WHERE at >= ? AND at <= ?`);
    const recent = total.get(now - 7 * 86400000, now), all = total.get(0, now);
    const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
    const sum = since => { const r = total.get(since, now); return r.input + r.output; };
    const days = new Map();
    for (const row of this.db.prepare('SELECT at, input, output, cached, reasoning FROM events WHERE at <= ? ORDER BY at').iterate(now)) {
      const date = day(row.at), item = days.get(date) || { date, input: 0, output: 0, cachedInput: 0, reasoningOutput: 0, total: 0 };
      item.input += row.input; item.output += row.output; item.cachedInput += row.cached; item.reasoningOutput += row.reasoning; item.total += row.input + row.output; days.set(date, item);
    }
    return { ...recent, total: recent.input + recent.output, last7Days: recent.input + recent.output, last5Hours: sum(now - 5 * 3600000), today: sum(midnight.getTime()),
      allTime: { ...all, total: all.input + all.output }, days: [...days.values()], period: 'rolling-7-days', complete, scanning: false, scannedFiles, totalFiles: files.length, scannedBytes, updatedAt: now,
      note: complete ? '本机全部现存会话与归档已建立索引；缓存与推理 Token 已含在输入/输出中。' : '索引已完成，但部分日志缺失基线或无法读取；只统计可确认的 Token。' };
  }
  close() { this.db.close(); }
}

if (parentPort) {
  let history;
  try {
    history = new DragonHistory(workerData);
    const tokens = history.scan({ progress: data => parentPort.postMessage({ progress: data }) });
    parentPort.postMessage({ tokens });
  } catch { parentPort.postMessage({ error: '历史索引暂不可用，请检查数据目录权限或 Node 版本（需要 24 及以上）' }); }
  finally { history?.close(); }
}
