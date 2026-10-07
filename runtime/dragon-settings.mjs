import path from 'node:path';
import { readJson, writeJson } from './paths.mjs';

export class DragonSettings {
  constructor({ dataDir, notify = () => false, defaultUpdateDir = '' }) {
    this.file = path.join(dataDir, 'dragon-settings.json');
    this.alertFile = path.join(dataDir, 'dragon-alerts.json'); this.notify = notify;
    this.value = { notifications: true, threshold: 20, autostart: false, autoUpdate: true, updateDir: defaultUpdateDir, ...readJson(this.file, {}) };
    this.alerts = readJson(this.alertFile, {});
  }
  validate(input) {
    const next = { ...this.value };
    for (const key of ['notifications', 'autostart', 'autoUpdate']) {
      if (key in input) { if (typeof input[key] !== 'boolean') throw new Error('开关设置无效'); next[key] = input[key]; }
    }
    if ('threshold' in input) {
      if (!Number.isInteger(input.threshold) || input.threshold < 1 || input.threshold > 99) throw new Error('提醒阈值须为 1 到 99 的整数');
      next.threshold = input.threshold;
    }
    if ('updateDir' in input) {
      if (typeof input.updateDir !== 'string' || /[\x00-\x1f]/.test(input.updateDir) || input.updateDir.length > 2048) throw new Error('更新目录无效');
      next.updateDir = input.updateDir.trim();
    }
    return next;
  }
  save(value) { writeJson(this.file, value); this.value = value; return value; }
  quota(snapshot, now = Date.now()) {
    if (!this.value.notifications || !snapshot.available || snapshot.stale || !snapshot.accountKey || now - snapshot.observedAt > 900000) return;
    for (const [key, expires] of Object.entries(this.alerts)) if (expires <= now) delete this.alerts[key];
    const low = snapshot.windows.filter(w => !w.stale && w.resetsAt > now && w.remainingPercent <= this.value.threshold);
    for (const w of low) {
      const key = `${snapshot.accountKey}:${w.id}:${w.resetsAt}:${this.value.threshold}`;
      if (this.alerts[key]) continue;
      if (this.notify({ title: 'Codex 龙娘 · 额度提醒', body: `${w.label}剩余 ${Math.round(w.remainingPercent)}%，低于提醒阈值 ${this.value.threshold}%。`, kind: 'quota' }) !== false) {
        this.alerts[key] = w.resetsAt; writeJson(this.alertFile, this.alerts);
      }
    }
  }
}
