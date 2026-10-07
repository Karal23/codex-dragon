import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readJson } from './paths.mjs';

export function newerVersion(next, current) {
  if (!/^\d+\.\d+\.\d+$/.test(next) || !/^\d+\.\d+\.\d+$/.test(current)) return false;
  const a = next.split('.').map(Number), b = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
export async function verifyRelease(directory, currentVersion) {
  const manifest = readJson(path.join(directory, 'release.json'), null);
  if (!manifest || manifest.id !== 'codex-dragon' || !newerVersion(manifest.version, currentVersion)) return null;
  if (typeof manifest.archive !== 'string' || !/^codex-dragon-\d+\.\d+\.\d+-windows\.zip$/.test(manifest.archive) || !/^[a-f0-9]{64}$/.test(manifest.sha256)) throw new Error('更新包清单无效');
  const archive = path.join(directory, manifest.archive), hash = createHash('sha256');
  for await (const bytes of fs.createReadStream(archive)) hash.update(bytes);
  if (hash.digest('hex') !== manifest.sha256) throw new Error('更新包校验失败，请重新生成完整版本包');
  return { version: manifest.version, archive, sha256: manifest.sha256 };
}
