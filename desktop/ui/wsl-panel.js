(() => {
  'use strict';
  const compact = value => Number.isFinite(value) ? new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value) : '—';
  const el = (tag, text, className) => { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; };
  let panel, body, status, totals, windows, footer, lastState, busy = false, lastPulse = null, lastCompletion = null, effect, float;
  const pulseQueue = []; let pulseTimer = null;
  async function api(route, method = 'GET', value) {
    const response = await fetch(route, { method, cache: 'no-store', headers: { 'Content-Type': 'application/json' }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || '暂时无法连接，请重试');
    return result;
  }
  function button(label, run) { const b = el('button', label); b.type = 'button'; b.onclick = run; return b; }
  function position() {
    if (!panel) return;
    const image = document.querySelector('.dshwv-img'); if (!image) return;
    // Leave the menu's controls unobstructed; preserve the body's collapsed state.
    panel.hidden = !!document.querySelector('.dshwv-menu-open, .whale-account-card:not(.whale-wsl-panel)');
    if (panel.hidden) return;
    const r = image.getBoundingClientRect(), gap = 8;
    const x = Math.max(gap, Math.min(innerWidth - panel.offsetWidth - gap, r.right - panel.offsetWidth));
    const above = r.top - panel.offsetHeight - gap;
    const y = Math.max(gap, Math.min(innerHeight - panel.offsetHeight - gap, above >= gap ? above : r.bottom + gap));
    const left = `${Math.round(x)}px`, top = `${Math.round(y)}px`;
    if (panel.style.left !== left) panel.style.left = left;
    if (panel.style.top !== top) panel.style.top = top;
  }
  // Pulse keyframes adapted from dsh-damage-pulse's BalanceWidget (MIT).
  // The quantity is observed token usage, never an invented subscription fee.
  function pulse(text, kind = 'usage') {
    pulseQueue.push({ text, kind });
    if (pulseTimer === null) nextPulse();
  }
  function nextPulse() {
    const item = pulseQueue.shift();
    if (!item) { pulseTimer = null; return; }
    showPulse(item.text, item.kind);
    pulseTimer = setTimeout(nextPulse, 1200);
  }
  function showPulse(text, kind) {
    const image = document.querySelector('.dshwv-img'); if (!image) return;
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      effect?.cancel();
      effect = image.animate([
        { transform: 'translate3d(0,0,0) scale(1)' },
        { transform: 'translate3d(-2px,3px,0) scale(.955)', offset: .22 },
        { transform: 'translate3d(2px,-1px,0) scale(1.025)', offset: .55 },
        { transform: 'translate3d(0,0,0) scale(1)' },
      ], { duration: kind === 'usage' ? 620 : 440, easing: 'cubic-bezier(.2,.86,.25,1)' });
      window.WhaleRendering?.presentFor?.(900);
    }
    float?.remove(); const label = el('span', text, `whale-wsl-float ${kind}`); float = label; panel.append(label);
    setTimeout(() => { label.remove(); if (float === label) float = null; }, 1200);
  }
  function countdown(at) {
    if (!Number.isFinite(at)) return '重置时间未知';
    const mins = Math.ceil((at - Date.now()) / 60000);
    if (mins <= 0) return '等待额度刷新';
    if (mins >= 1440) return `${Math.floor(mins / 1440)} 天 ${Math.floor(mins % 1440 / 60)} 小时后重置`;
    return mins >= 60 ? `${Math.floor(mins / 60)} 小时 ${mins % 60} 分钟后重置` : `${mins} 分钟后重置`;
  }
  function render(data) {
    const s = data.status, sub = data.subscription;
    status.textContent = s.connected ? s.activeTurns ? `正在工作 · ${s.activeTurns} 个任务` : '待机 · WSL 已连接' : s.initializing ? '正在连接 WSL…' : 'WSL 未连接';
    panel.dataset.state = s.connected ? s.activeTurns ? 'working' : 'idle' : 'offline';
    totals.replaceChildren(el('span', `本轮 ${compact(s.activeTokens)}${s.partial ? ' *' : ''}`), el('span', `今日 ${compact(data.tokens?.today)}`));
    totals.title = '本机已观测 Token；缓存输入和推理输出已包含在总数中。* 表示从挂件启动后开始观察。';
    windows.replaceChildren();
    for (const w of sub.windows || []) {
      const row = el('div', null, 'whale-wsl-quota');
      const heading = el('div', null, 'whale-wsl-quota-heading');
      heading.append(el('span', w.label), el('strong', `${w.remainingPercent.toFixed(0)}%`));
      const bar = el('progress'); bar.max = 100; bar.value = w.remainingPercent;
      bar.setAttribute('aria-label', `${w.label}剩余额度`);
      row.dataset.low = String(!w.stale && w.remainingPercent <= (data.preferences?.threshold || 20)); row.dataset.stale = String(!!w.stale);
      row.append(heading, bar, el('small', w.stale ? '上次结果 · 等待刷新' : countdown(w.resetsAt)));
      windows.append(row);
    }
    if (!sub.windows.length) windows.append(el('p', sub.reason || '等待订阅额度…', 'whale-wsl-empty'));
    const observed = sub.observedAt ? new Date(sub.observedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : null;
    footer.textContent = s.error || (sub.stale ? sub.reason : `Codex ${sub.planType || '订阅'}${observed ? ' · ' + observed + ' 更新' : ''}`);
    if (data.tokens?.scanning) footer.textContent += ` · 历史索引 ${data.tokens.scannedFiles}/${data.tokens.totalFiles}`;
    else if (data.tokens?.complete === false) footer.textContent += ' · 部分日志不完整';
    if (!s.connected && s.retryAt) status.textContent = `连接中断 · ${Math.max(1, Math.ceil((s.retryAt - Date.now()) / 1000))} 秒后重试`;
    if (data.error) footer.textContent += ' · ' + data.error;
    if (lastPulse !== null && s.connected) {
      for (const p of s.pulses) if (p.seq > lastPulse && Date.now() - p.at < 4000) pulse(`+${compact(p.tokens)} Token`);
    }
    lastPulse = s.pulse.seq;
    const completed = data.lastTurn; let expression = null;
    if (lastCompletion !== null && completed?.seq > lastCompletion && completed.notify && Date.now() - (completed.notificationAt || completed.ts) < 6000) {
      expression = completed.completionKind;
      pulse(completed.completionKind === 'success' ? '完成啦' : completed.completionKind === 'cancelled' ? '已取消' : '任务未完成', completed.completionKind === 'success' ? 'done' : 'failed');
    }
    lastCompletion = completed?.seq || 0;
    window.DragonAvatar?.update(data, expression);
    if (lastState?.subscription.accountKey && lastState.subscription.accountKey === sub.accountKey && !sub.stale) {
      for (const w of sub.windows || []) {
        const old = lastState.subscription.windows.find(p => p.id === w.id);
        if (old && !w.stale && w.observedAt > old.observedAt && w.remainingPercent > old.remainingPercent) { pulse('额度恢复', 'done'); break; }
      }
    }
    document.documentElement.dataset.wslWorking = String(s.connected && s.activeTurns > 0);
    lastState = data; position();
  }
  async function poll() {
    if (busy) return;
    busy = true;
    try { render(await api('/api/wsl')); }
    catch { status.textContent = '挂件服务暂不可用'; panel.dataset.state = 'offline'; }
    finally { busy = false; }
  }
  function openHistory() {
    document.querySelector('#dragon-history')?.remove();
    const dialog = el('dialog'); dialog.id = 'dragon-history';
    const heading = el('header'); heading.append(el('h2', '龙娘 · Token 历史'), button('关闭', () => dialog.close()));
    const info = el('p'), summary = el('p'), rows = el('div'), select = el('select'); select.setAttribute('aria-label', '历史时间范围');
    for (const [value, label] of [['7', '最近 7 天'], ['30', '最近 30 天'], ['all', '全部历史']]) { const o = el('option', label); o.value = value; select.append(o); }
    function draw() {
      const tokens = lastState?.tokens;
      info.textContent = tokens?.scanning ? `正在建立索引：${tokens.scannedFiles}/${tokens.totalFiles} 个日志` : tokens?.note || '正在读取本机历史…';
      summary.textContent = `累计 ${compact(tokens?.allTime?.total)} Token · 输入 ${compact(tokens?.allTime?.input)} · 输出 ${compact(tokens?.allTime?.output)}`;
      const cutoff = new Date(); cutoff.setHours(0, 0, 0, 0); cutoff.setDate(cutoff.getDate() - Number(select.value) + 1);
      const days = (tokens?.days || []).filter(d => select.value === 'all' || new Date(d.date + 'T00:00:00') >= cutoff).reverse();
      const max = Math.max(1, ...days.map(d => d.total)); rows.replaceChildren();
      for (const d of days) {
        const row = el('div', null, 'dragon-history-row'), bar = el('meter'); bar.min = 0; bar.max = max; bar.value = d.total;
        bar.setAttribute('aria-label', `${d.date}，${d.total} Token`);
        row.title = `输入 ${d.input.toLocaleString()} · 输出 ${d.output.toLocaleString()} · 缓存输入 ${d.cachedInput.toLocaleString()} · 推理输出 ${d.reasoningOutput.toLocaleString()}`;
        row.append(el('span', d.date), bar, el('strong', compact(d.total))); rows.append(row);
      }
      if (!days.length) rows.append(el('p', '所选时间范围内暂无已记录用量。'));
    }
    select.onchange = draw; dialog.append(heading, info, summary, select, rows); document.body.append(dialog); dialog.showModal(); draw();
    const timer = setInterval(draw, 3000); dialog.addEventListener('close', () => { clearInterval(timer); dialog.remove(); }, { once: true });
  }
  async function openSettings() {
    document.querySelector('#wsl-settings')?.remove();
    const dialog = el('dialog'); dialog.id = 'wsl-settings';
    const form = el('form'), heading = el('header'); heading.append(el('h2', '龙娘设置'), button('关闭', () => dialog.close())); form.append(heading);
    const current = lastState?.connection || {}, prefs = lastState?.preferences || {};
    const error = el('p', '', 'whale-wsl-error'); error.setAttribute('role', 'alert');
    const connection = el('details'); connection.open = !lastState?.connection;
    connection.append(el('summary', 'WSL 连接与高级路径'));
    const fields = [['distribution', 'WSL 发行版', 'Ubuntu'], ['user', 'Linux 用户', ''], ['codexHome', 'Codex 数据目录', '/home/用户名/.codex'],
      ['codexBin', 'Codex 程序', '/home/用户名/.local/bin/codex'], ['nodePath', 'Node 程序（24 或更新）', '/usr/bin/node'], ['agentPath', '挂件采集程序', '自动识别安装位置']];
    const inputs = {};
    for (const [name, label, placeholder] of fields) {
      const wrap = el('label', label), input = el('input'); input.name = name; input.value = current[name] || ''; input.placeholder = placeholder; input.autocomplete = 'off';
      if (name === 'distribution') input.setAttribute('list', 'wsl-distributions');
      inputs[name] = input; wrap.append(input); connection.append(wrap);
    }
    const detect = button('自动识别 WSL', async () => {
      detect.disabled = true; error.textContent = '正在查找 Codex…';
      try { const data = await api('/api/wsl/detect', 'POST', { distribution: inputs.distribution.value }); for (const [key, value] of Object.entries(data.connection)) inputs[key].value = value; error.textContent = '已识别，保存后连接。'; }
      catch (e) { error.textContent = e.message; } finally { detect.disabled = false; }
    });
    form.append(el('p', lastState?.status.connected ? `已连接 ${current.distribution} · ${current.user}` : '自动识别后即可连接 WSL 中的 Codex。'), detect, connection);
    const choices = el('datalist'); choices.id = 'wsl-distributions'; form.append(choices);
    api('/api/wsl/distributions').then(data => { for (const name of data.distributions) { const o = el('option'); o.value = name; choices.append(o); } }).catch(() => {});
    const controls = {};
    for (const [name, label] of [['notifications', '启用 Windows 额度提醒'], ['autostart', '登录 Windows 时启动龙娘'], ['autoUpdate', '自动检查并在空闲时安装本机新版本']]) {
      const wrap = el('label', null, 'dragon-check'), input = el('input'); input.type = 'checkbox'; input.checked = !!prefs[name]; input.name = name; controls[name] = input;
      wrap.append(input, el('span', label)); form.append(wrap);
    }
    const thresholdWrap = el('label', '剩余额度提醒阈值（%）'), threshold = el('input'); threshold.type = 'number'; threshold.name = 'threshold'; threshold.min = '1'; threshold.max = '99'; threshold.step = '1'; threshold.required = true; threshold.value = prefs.threshold || 20; thresholdWrap.append(threshold); form.append(thresholdWrap);
    form.append(button('测试通知', async () => { try { await api('/api/wsl/notification-test', 'POST'); error.textContent = '测试通知已发送，请查看 Windows 通知中心。'; } catch (e) { error.textContent = e.message; } }));
    const updateWrap = el('label', '本机新版本包目录'), updateDir = el('input'); updateDir.name = 'updateDir'; updateDir.value = prefs.updateDir || ''; updateWrap.append(updateDir); form.append(updateWrap);
    const updateInfo = el('p', `当前版本 ${lastState?.desktop.version || '—'} · ${lastState?.desktop.update || ''}`);
    const install = button('立即安装新版本', async () => { try { await api('/api/wsl/update/install', 'POST'); updateInfo.textContent = '正在安装，龙娘稍后会重新启动…'; } catch (e) { error.textContent = e.message; } });
    install.hidden = !lastState?.desktop.availableVersion;
    form.append(button('检查更新', async () => {
      error.textContent = ''; updateInfo.textContent = '正在检查…';
      try { await api('/api/wsl/preferences', 'PUT', { updateDir: updateDir.value }); const result = await api('/api/wsl/update/check', 'POST'); updateInfo.textContent = result.desktop.update; install.hidden = !result.desktop.availableVersion; }
      catch (e) { error.textContent = e.message; }
    }), install, updateInfo, error);
    const save = el('button', '保存设置'); save.type = 'submit'; form.append(save);
    form.onsubmit = async event => {
      event.preventDefault(); save.disabled = true; error.textContent = '';
      try {
        const next = Object.fromEntries(fields.map(([name]) => [name, inputs[name].value]));
        if (Object.keys(next).some(key => next[key] !== (current[key] || ''))) await api('/api/wsl/connection', 'PUT', next);
        await api('/api/wsl/preferences', 'PUT', { ...Object.fromEntries(Object.entries(controls).map(([key, input]) => [key, input.checked])), threshold: Number(threshold.value), updateDir: updateDir.value });
        dialog.close(); await poll();
      } catch (e) { error.textContent = e.message; } finally { save.disabled = false; }
    };
    dialog.append(form); document.body.append(dialog); dialog.showModal(); dialog.addEventListener('close', () => dialog.remove(), { once: true });
  }
  async function init() {
    let data; try { data = await api('/api/wsl'); } catch { return; }
    if (!data.enabled) return;
    window.WhaleWSL = { openSettings, openHistory, refresh: poll }; document.documentElement.dataset.wsl = 'true';
    window.addEventListener('whale-open-usage', openHistory);
    document.title = 'Codex 龙娘';
    panel = el('section', null, 'whale-account-card whale-wsl-panel'); panel.setAttribute('aria-label', 'Codex WSL 状态');
    const title = el('header', null, 'whale-wsl-heading');
    title.append(el('strong', '龙娘 · Codex'), button('设置', openSettings), button('−', () => { body.hidden = !body.hidden; position(); }));
    status = el('p', '', 'whale-wsl-status'); status.setAttribute('role', 'status');
    body = el('div'); totals = el('div', null, 'whale-wsl-totals'); windows = el('div'); footer = el('small', '', 'whale-wsl-footer');
    const actions = el('div', null, 'whale-wsl-actions');
    actions.append(button('历史统计', openHistory), button('刷新额度', async () => { try { await api('/api/wsl/refresh', 'POST'); footer.textContent = '正在刷新…'; } catch (e) { footer.textContent = e.message; } }),
      button('重新连接', async () => { try { await api('/api/wsl/reconnect', 'POST'); await poll(); } catch (e) { footer.textContent = e.message; } }));
    body.append(totals, windows, footer, actions); panel.append(title, status, body); document.body.append(panel);
    render(data); setInterval(poll, 500);
    const follow = () => { position(); requestAnimationFrame(follow); }; requestAnimationFrame(follow);
    if (!data.connection) setTimeout(() => { if (!lastState?.connection) openSettings(); }, 5000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
