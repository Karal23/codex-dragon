import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { listWslDistributions, validateWslConnection } from './wsl-source.mjs';

const run = promisify(execFile);
const quote = text => "'" + text.replaceAll("'", "'\\''") + "'";
export async function detectWslConnection({ root, distribution = '' }) {
  const distributions = distribution ? [distribution] : await listWslDistributions();
  if (!distributions.length) throw new Error('未发现 WSL 发行版，请先安装并启动 WSL');
  const probe = `const fs=require('node:fs'),os=require('node:os');
    if(process.platform!=='linux'||Number(process.versions.node.split('.')[0])<24)process.exit(2);
    const [codexBin,codexHome]=process.argv.slice(1);if(!codexBin||!fs.existsSync(codexHome))process.exit(3);
    console.log(JSON.stringify({user:os.userInfo().username,nodePath:process.execPath,codexBin,codexHome}));`;
  const script = `export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"
    dragon_node=$(command -v node || true)
    if [ -z "$dragon_node" ]; then for dragon_candidate in "$HOME"/.nvm/versions/node/*/bin/node; do if [ -x "$dragon_candidate" ]; then dragon_node="$dragon_candidate"; fi; done; fi
    dragon_codex=$(command -v codex || true)
    if [ -z "$dragon_codex" ] && [ -n "$dragon_node" ]; then dragon_codex="$(dirname "$dragon_node")/codex"; fi
    [ -x "$dragon_node" ] && [ -x "$dragon_codex" ] || exit 4
    "$dragon_node" -e ${quote(probe)} "$dragon_codex" "\${CODEX_HOME:-$HOME/.codex}"`;
  for (const name of distributions) {
    try {
      const options = { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 };
      const { stdout } = await run('wsl.exe', ['--distribution', name, '--exec', '/bin/sh', '-lc', script], options);
      const info = JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
      const agent = await run('wsl.exe', ['--distribution', name, '--user', info.user, '--exec', 'wslpath', '-u', path.join(root, 'runtime', 'wsl-agent.mjs')], options);
      return validateWslConnection({ ...info, distribution: name, agentPath: agent.stdout.trim() });
    } catch { /* Try the next installed distribution; advanced fields remain available. */ }
  }
  throw new Error('未找到可用的 Codex 和 Node 24，请在高级连接设置中指定路径');
}
