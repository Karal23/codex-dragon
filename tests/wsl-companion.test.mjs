import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDispatcher } from '../runtime/dispatcher.mjs';
import { normalizeQuota } from '../runtime/codex-quota.mjs';
import { validateWslConnection, wslCommand } from '../runtime/wsl-source.mjs';
import { SessionParser } from '../runtime/session-monitor.mjs';

const waitFor = async (read, timeout = 12000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) { const result = await read(); if (result) return result; await new Promise(r => setTimeout(r, 60)); }
  assert.fail('Timed out waiting for the WSL companion');
};

test('official quota preserves dynamic windows, separate buckets, and missing/reset data', () => {
  const now = Date.now();
  const result = normalizeQuota({ rateLimitsByLimitId: {
    codex: { primary: { usedPercent: 25, windowDurationMins: 15, resetsAt: (now + 900000) / 1000 }, secondary: null },
    other: { limitName: 'Other model', primary: { usedPercent: 0, windowDurationMins: 10080, resetsAt: null } },
  } }, now);
  assert.equal(result.windows.length, 2);
  assert.equal(result.windows[0].remainingPercent, 75);
  assert.equal(result.windows[0].windowDurationMins, 15);
  assert.equal(result.windows[0].resetsAt, now + 900000);
  assert.equal(result.windows[1].stale, true);
  assert.equal(normalizeQuota({}).available, false);
  assert.equal(normalizeQuota({ rateLimits: { primary: { usedPercent: -1, windowDurationMins: 300 } } }).windows.length, 0);
});

test('WSL commands retain paths containing spaces as individual arguments', () => {
  const c = validateWslConnection({ distribution: 'Ubuntu', user: 'me', agentPath: '/home/me/whale project/runtime/wsl-agent.mjs',
    nodePath: '/usr/bin/node', codexBin: '/home/me/.local/bin/codex', codexHome: '/home/me/.codex' });
  assert.equal(wslCommand(c)[6], c.agentPath);
  assert.throws(() => validateWslConnection({ ...c, codexBin: 'codex' }), /绝对路径/);
});

test('request records count before tool completion and ignore duplicate or delayed snapshots', () => {
  const updates = [], ends = [];
  const parser = new SessionParser({ id: 'request-session', defaultModel: 'model', preferRequestUsage: true,
    onUpdate: meta => updates.push(structuredClone(meta)), onEnd: meta => ends.push(structuredClone(meta)) });
  const event = (type, turn_id = 'turn') => ({ type: 'event_msg', payload: { type, turn_id } });
  const request = (id, input, output, total, turn_id = 'turn') => ({ type: 'token_usage_record', payload: {
    turn_id, response_id: id, usage: { input_tokens: input, output_tokens: output },
    thread_token_usage: { input_tokens: total, output_tokens: 20 } } });
  parser.accept(event('task_started'));
  const first = request('r1', 100, 20, 100), second = request('r2', 10, 0, 110);
  parser.accept(JSON.stringify(first)); parser.accept(JSON.stringify(second)); parser.accept(first);
  parser.accept({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, output_tokens: 20 }, last_token_usage: { input_tokens: 100, output_tokens: 20 } } } });
  assert.deepEqual(updates.map(m => m.byModel.model.input_tokens + m.byModel.model.output_tokens), [120, 130]);
  parser.accept(event('task_complete'));
  assert.equal(ends[0].byModel.model.input_tokens, 110);
  parser.accept(event('task_started', 'next'));
  parser.accept(first); // A late response from the preceding turn cannot enter this turn.
  parser.accept(request('r3', 7, 1, 117, 'next'));
  assert.equal(parser.active.byModel.model.input_tokens, 7);
  assert.equal(updates.length, 3);
});

test('request usage respects partial observation and restart recovery without replaying pulses', () => {
  for (const recover of [false, true]) {
    const updates = [], starts = [];
    const parser = new SessionParser({ id: 'main', defaultModel: 'model', preferRequestUsage: true,
      recoverIds: recover ? ['main:turn'] : [], observedAfter: { 'main:turn': 2000 },
      onStart: meta => starts.push(structuredClone(meta)), onUpdate: meta => updates.push(structuredClone(meta)) });
    const record = (id, at) => ({ type: 'token_usage_record', timestamp: at, payload: { turn_id: 'turn', response_id: id,
      usage: { input_tokens: 10, output_tokens: 2 }, thread_token_usage: { input_tokens: 20, output_tokens: 4 } } });
    const observed = record('observed', '1970-01-01T00:00:03Z');
    parser.prime([{ type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn' } }, record('before', '1970-01-01T00:00:01Z'), observed]);
    assert.equal(updates.length, 0);
    assert.equal(starts[0].byModel.model?.input_tokens || 0, recover ? 10 : 0);
    parser.accept(observed);
    assert.equal(updates.length, 0);
    parser.accept(record('new', '1970-01-01T00:00:04Z'));
    assert.equal(updates.length, 1);
    assert.equal(updates[0].byModel.model.input_tokens, recover ? 20 : 10);
  }
});

test('real agent and dispatcher cover quota, partial JSONL, dedupe, reconnect and shutdown without forwarding conversation content', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-wsl-'));
  const codexHome = path.join(dir, 'codex'), dataDir = path.join(dir, 'widget'), sessions = path.join(codexHome, 'sessions');
  fs.mkdirSync(sessions, { recursive: true }); fs.mkdirSync(dataDir);
  const preexisting = path.join(sessions, 'rollout-preexisting.jsonl');
  const oldEvent = (type, extra = {}) => ({ type: 'event_msg', timestamp: new Date().toISOString(), payload: { type, ...extra } });
  const oldUsage = n => ({ input_tokens: n, output_tokens: 100 });
  const oldTokens = n => oldEvent('token_count', { info: { total_token_usage: oldUsage(n), last_token_usage: oldUsage(n) } });
  fs.writeFileSync(preexisting, [{ type: 'session_meta', payload: { id: 'old' } }, oldEvent('task_started', { turn_id: 'old-turn' }),
    { type: 'turn_context', payload: { turn_id: 'old-turn', model: 'test-model' } }, oldTokens(1000)].map(JSON.stringify).join('\n') + '\n');
  const fake = path.join(dir, 'codex-stub');
  fs.writeFileSync(fake, `#!${process.execPath}\nimport('node:readline').then(({createInterface})=>{const r=createInterface({input:process.stdin});r.on('line',s=>{const m=JSON.parse(s);let result;if(m.method==='initialize')result={};else if(m.method==='account/read')result={account:{type:'chatgpt',planType:'pro',email:'PRIVATE-EMAIL'}};else if(m.method==='account/rateLimits/read')result={rateLimits:{limitId:'codex',primary:{usedPercent:23,windowDurationMins:10080,resetsAt:Math.floor(Date.now()/1000)+86400}}};if(result)console.log(JSON.stringify({id:m.id,result}));});});\n`, { mode: 0o700 });
  fs.writeFileSync(fake, fs.readFileSync(fake, 'utf8').replace("import('node:readline')", `if(process.env.CODEX_HOME!==${JSON.stringify(codexHome)})process.exit(5);import('node:readline')`));
  const connection = { distribution: 'test', user: 'test', agentPath: fileURLToPath(new URL('../runtime/wsl-agent.mjs', import.meta.url)),
    nodePath: process.execPath, codexBin: fake, codexHome };
  fs.writeFileSync(path.join(dataDir, 'wsl-connection.json'), JSON.stringify(connection));
  const children = [];
  const options = { dataDir, wsl: true, autoRefresh: false,
    wslOptions: { spawnProcess: (_binary, args, spawnOptions) => { const p = spawn(args[5], args.slice(6), { ...spawnOptions, env: { ...process.env, CODEX_DRAGON_HISTORY_DIR: path.join(dir, 'history') } }); children.push(p); return p; } } };
  let dispatcher = createDispatcher(options);
  t.after(async () => { await dispatcher.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const state = async () => JSON.parse((await dispatcher.dispatch('/api/wsl')).body);
  let current = await waitFor(async () => { const s = await state(); return s.status.connected && s.subscription.available && s; });
  assert.equal(current.subscription.windows[0].remainingPercent, 77);
  assert.equal(JSON.stringify(current).includes('PRIVATE-EMAIL'), false);
  assert.equal(JSON.parse((await dispatcher.dispatch('/api/display-mode')).body).mode, 'subscription');
  assert.equal((await dispatcher.dispatch('/api/display-mode', { method: 'POST', body: { mode: 'api' } })).status, 400);
  assert.equal(current.status.activeTokens, 0);
  assert.equal(current.status.partial, true);
  fs.appendFileSync(preexisting, JSON.stringify(oldTokens(1010)) + '\n');
  await waitFor(async () => (await state()).status.activeTokens === 10);
  await dispatcher.dispatch('/api/wsl/reconnect', { method: 'POST' });
  await waitFor(async () => { const s = await state(); return s.status.connected && s.status.activeTokens === 10; });
  await dispatcher.close(); dispatcher = createDispatcher(options);
  await waitFor(async () => { const s = await state(); return s.status.connected && s.status.activeTokens === 10; });
  assert.equal((await state()).status.partial, true);
  assert.equal((await state()).status.pulse.seq, 0);
  fs.appendFileSync(preexisting, JSON.stringify(oldEvent('task_complete', { turn_id: 'old-turn' })) + '\n');
  await waitFor(async () => (await state()).status.activeTurns === 0);
  const at = new Date().toISOString();
  const entry = (type, extra = {}) => ({ type: 'event_msg', timestamp: new Date().toISOString(), payload: { type, ...extra } });
  const log = path.join(sessions, 'rollout-test.jsonl');
  const append = rows => fs.appendFileSync(log, rows.map(JSON.stringify).join('\n') + '\n');
  append([{ type: 'session_meta', payload: { id: 'main', timestamp: at } }, entry('task_started', { turn_id: 'turn' }),
    { type: 'turn_context', payload: { turn_id: 'turn', model: 'test-model' } },
    { type: 'response_item', payload: { content: 'PRIVATE-CONVERSATION' } }]);
  await waitFor(async () => (await state()).status.activeTurns === 1);
  const counts = n => ({ input_tokens: n, output_tokens: 10, cached_input_tokens: Math.floor(n / 2), reasoning_output_tokens: 4 });
  const tokenEvent = n => entry('token_count', { info: { total_token_usage: counts(n), last_token_usage: counts(n) } });
  const encoded = JSON.stringify(tokenEvent(100));
  fs.appendFileSync(log, encoded.slice(0, 40));
  await new Promise(r => setTimeout(r, 900));
  assert.equal((await state()).status.activeTokens, 0);
  fs.appendFileSync(log, encoded.slice(40) + '\n');
  current = await waitFor(async () => { const s = await state(); return s.status.activeTokens === 110 && s; });
  assert.equal(current.status.pulse.tokens, 110);
  append([tokenEvent(100)]); await new Promise(r => setTimeout(r, 900));
  assert.equal((await state()).status.activeTokens, 110);
  const previousPulse = (await state()).status.pulse.seq;
  await dispatcher.dispatch('/api/wsl/reconnect', { method: 'POST' });
  await waitFor(async () => { const s = await state(); return s.status.connected && s.status.activeTokens === 110; });
  assert.equal((await state()).status.pulse.seq, previousPulse);
  const requestRecord = (response_id, amount, total) => ({ type: 'token_usage_record', timestamp: new Date().toISOString(), payload: {
    turn_id: 'turn', response_id, usage: { input_tokens: amount, output_tokens: 0 }, thread_token_usage: counts(total) } });
  const firstRequest = requestRecord('request-one', 10, 110), secondRequest = requestRecord('request-two', 30, 140);
  append([firstRequest, secondRequest, firstRequest]);
  current = await waitFor(async () => { const s = await state(); return s.status.activeTokens === 150 && s; });
  assert.equal(current.status.pulse.seq, previousPulse + 2);
  assert.deepEqual(current.status.pulses.slice(-2).map(p => p.tokens), [10, 30]);
  await dispatcher.dispatch('/api/wsl/reconnect', { method: 'POST' });
  await waitFor(async () => { const s = await state(); return s.status.connected && s.status.activeTokens === 150; });
  assert.equal((await state()).status.pulse.seq, previousPulse + 2);
  append([tokenEvent(140), entry('task_complete', { turn_id: 'turn' })]);
  current = await waitFor(async () => { const s = await state(); return s.lastTurn.tokens === 150 && s; });
  assert.equal(current.status.pulse.seq, previousPulse + 2);
  assert.equal(current.status.activeTurns, 0);
  assert.equal(current.lastTurn.amount, null);
  assert.equal(JSON.stringify(current).includes('PRIVATE-CONVERSATION'), false);
  const seq = current.lastTurn.seq;
  append([entry('task_complete', { turn_id: 'turn' })]);
  await dispatcher.dispatch('/api/wsl/reconnect', { method: 'POST' });
  await waitFor(async () => (await state()).status.connected);
  assert.equal((await state()).lastTurn.seq, seq);
  await dispatcher.dispatch('/api/wsl/refresh', { method: 'POST' });
  await waitFor(async () => (await state()).tokens?.today === 1260);
  children.at(-1).kill('SIGTERM');
  current = await waitFor(async () => { const s = await state(); return !s.status.connected && s; });
  assert.equal(current.subscription.stale, true);
  assert.ok(current.subscription.windows.every(w => w.stale));
  const countBeforeRecovery = children.length;
  await waitFor(async () => children.length > countBeforeRecovery && (await state()).status.connected);
  assert.equal((await state()).lastTurn.seq, seq);
  assert.equal((await state()).status.activeTurns, 0);
  await dispatcher.close();
  assert.ok(children.every(child => child.exitCode !== null || child.signalCode !== null));
});
