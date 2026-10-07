import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const version = '44.3.0';
const runtime = path.join(root, 'desktop-runtime/windows');
const archiveName = `electron-v${version}-win32-x64.zip`;
const base = `https://github.com/electron/electron/releases/download/v${version}/`;
const out = path.join(root, 'dist/codex-dragon');
const product = JSON.parse(fs.readFileSync(path.join(root, 'dragon.json'), 'utf8'));

function check(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) check(file);
    else if (/\.(mjs|cjs|js)$/.test(item.name)) execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  }
}
for (const dir of ['runtime', 'desktop', 'lib']) check(path.join(root, dir));
execFileSync(process.execPath, ['--check', path.join(root, 'assets/whale-widget.js')]);
fs.mkdirSync(runtime, { recursive: true });
if (!fs.existsSync(path.join(runtime, 'electron/electron.exe'))) {
  const sums = await fetch(base + 'SHASUMS256.txt'); if (!sums.ok) throw new Error('Cannot download Electron checksums');
  const expected = (await sums.text()).split('\n').find(line => line.trim().split(/\s+/).at(-1)?.replace(/^\*/, '') === archiveName)?.split(/\s+/)[0];
  if (!expected) throw new Error('Pinned Electron artifact is missing');
  console.log(`Downloading Electron ${version} for Windows…`);
  const response = await fetch(base + archiveName); if (!response.ok) throw new Error('Cannot download Electron');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('Electron checksum mismatch');
  const archive = path.join(runtime, archiveName); fs.writeFileSync(archive, bytes);
  fs.mkdirSync(path.join(runtime, 'electron'), { recursive: true });
  if (process.platform === 'win32') {
    const literal = value => "'" + value.replace(/'/g, "''") + "'";
    execFileSync('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath ${literal(archive)} -DestinationPath ${literal(path.join(runtime, 'electron'))} -Force`]);
  }
  else execFileSync('unzip', ['-q', '-o', archive, '-d', path.join(runtime, 'electron')]);
  fs.unlinkSync(archive);
}
fs.mkdirSync(out, { recursive: true });
for (const name of ['runtime', 'desktop', 'lib', 'vendor', 'assets', '.codex-plugin']) fs.cpSync(path.join(root, name), path.join(out, name), { recursive: true });
fs.mkdirSync(path.join(out, 'scripts'), { recursive: true });
fs.copyFileSync(path.join(root, 'scripts/start-wsl.ps1'), path.join(out, 'scripts/start-wsl.ps1'));
fs.copyFileSync(path.join(root, 'scripts/install-dragon.ps1'), path.join(out, 'scripts/install-dragon.ps1'));
for (const name of ['package.json', 'dragon.json', 'LICENSE', 'PROVENANCE.md', 'THIRD_PARTY_NOTICES.md', 'Start-Dragon.cmd', 'Install-Dragon.cmd', 'README-WSL.md']) fs.copyFileSync(path.join(root, name), path.join(out, name));
fs.cpSync(runtime, path.join(out, 'desktop-runtime/windows'), { recursive: true });
console.log(`Windows build ready: ${out}`);
if (!process.argv.includes('--no-archive')) {
  const feedArg = process.argv.find(a => a.startsWith('--feed='))?.slice(7);
  const feed = path.resolve(feedArg || path.join(root, 'dist/releases'));
  fs.mkdirSync(feed, { recursive: true });
  const archiveName = `codex-dragon-${product.version}-windows.zip`, archive = path.join(feed, archiveName);
  const temp = path.join(feed, `.codex-dragon-${product.version}.tmp.zip`);
  fs.rmSync(temp, { force: true });
  if (process.platform === 'win32') {
    const literal = value => "'" + value.replaceAll("'", "''") + "'";
    execFileSync('powershell.exe', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory(${literal(out)}, ${literal(temp)})`]);
  } else execFileSync('python3', ['-c', `import os,sys,zipfile
with zipfile.ZipFile(sys.argv[1], 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=1) as archive:
    for directory, _, files in os.walk('.'):
        for name in files:
            filename=os.path.join(directory,name)
            archive.write(filename,os.path.relpath(filename,'.'))`, temp], { cwd: out });
  const hash = crypto.createHash('sha256');
  for await (const bytes of fs.createReadStream(temp)) hash.update(bytes);
  fs.renameSync(temp, archive);
  const manifest = { id: product.id, version: product.version, archive: archiveName, sha256: hash.digest('hex') };
  fs.writeFileSync(path.join(feed, 'release.json.tmp'), JSON.stringify(manifest, null, 2));
  fs.renameSync(path.join(feed, 'release.json.tmp'), path.join(feed, 'release.json'));
  console.log(`Local update channel ready: ${feed}`);
}
