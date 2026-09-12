#!/usr/bin/env node
/**
 * Cloudflare Workers Builds deploy entry.
 * Dashboard Deploy command: npm run deploy
 * Dashboard Version command: npm run deploy:version
 *
 * Always rebuilds dist/worker.js first so Deploy never fails with a missing entry point
 * (Workers Builds sometimes runs `npm run build` which previously was a no-op).
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const workerPath = path.join(root, 'dist', 'worker.js');
const mode = process.argv[2] === 'version' ? 'version' : 'deploy';

function run(command, args) {
  console.log(`==> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log('==> PowerBull Cloudflare deploy');
console.log(`    mode=${mode}`);
console.log(`    pwd=${root}`);
console.log(`    WORKERS_CI=${process.env.WORKERS_CI || ''}`);
console.log(`    CI=${process.env.CI || ''}`);
console.log(`    node=${process.version}`);

run('npm', ['run', 'build:cloudflare']);

if (!fs.existsSync(workerPath)) {
  console.error('ERROR: dist/worker.js missing after build:cloudflare');
  process.exit(1);
}
console.log(`==> dist/worker.js ready (${fs.statSync(workerPath).size} bytes)`);
console.log('==> wrangler.toml name/main:');
const toml = fs.readFileSync(path.join(root, 'wrangler.toml'), 'utf8');
for (const line of toml.split('\n')) {
  if (/^\s*(name|main)\s*=/.test(line)) console.log(`    ${line.trim()}`);
}

const wranglerBin = path.join(root, 'node_modules', '.bin', 'wrangler');
const wranglerCmd = fs.existsSync(wranglerBin) ? wranglerBin : 'npx';
const wranglerArgs = fs.existsSync(wranglerBin)
  ? []
  : ['--yes', 'wrangler@4'];

if (mode === 'version') {
  run(wranglerCmd, [...wranglerArgs, 'versions', 'upload', '--config', 'wrangler.toml']);
} else {
  run(wranglerCmd, [...wranglerArgs, 'deploy', '--config', 'wrangler.toml']);
}

console.log('==> Cloudflare deploy finished OK');
