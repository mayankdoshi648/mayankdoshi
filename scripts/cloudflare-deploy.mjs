#!/usr/bin/env node
/**
 * Cloudflare Workers Builds deploy entry.
 *
 * Dashboard (Workers → mayankdoshi → Settings → Builds):
 *   Build command:   npm ci && npm run build
 *   Deploy command:  npm run deploy
 *   Version command: npm run deploy:version
 *   Production branch: master
 *
 * Always rebuilds dist/worker.js, then uploads with --no-bundle
 * (esbuild already bundled; Wrangler re-bundle breaks on process.env.NODE_ENV).
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
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`ERROR: command failed with exit code ${result.status}`);
    process.exit(result.status || 1);
  }
}

console.log('==> PowerBull Cloudflare deploy');
console.log(`    mode=${mode}`);
console.log(`    pwd=${root}`);
console.log(`    WORKERS_CI=${process.env.WORKERS_CI || ''}`);
console.log(`    WRANGLER_CI_OVERRIDE_NAME=${process.env.WRANGLER_CI_OVERRIDE_NAME || ''}`);
console.log(`    CI=${process.env.CI || ''}`);
console.log(`    node=${process.version}`);

run('npm', ['run', 'build']);

if (!fs.existsSync(workerPath)) {
  console.error('ERROR: dist/worker.js missing after npm run build');
  try {
    console.error('dist listing:', fs.readdirSync(path.join(root, 'dist')));
  } catch {
    console.error('dist/ directory does not exist');
  }
  process.exit(1);
}
console.log(`==> dist/worker.js ready (${fs.statSync(workerPath).size} bytes)`);

const toml = fs.readFileSync(path.join(root, 'wrangler.toml'), 'utf8');
for (const line of toml.split('\n')) {
  if (/^\s*(name|main)\s*=/.test(line)) console.log(`    wrangler: ${line.trim()}`);
}

const wranglerBin = path.join(root, 'node_modules', '.bin', 'wrangler');
const useLocal = fs.existsSync(wranglerBin);
const cmd = useLocal ? wranglerBin : 'npx';
const prefix = useLocal ? [] : ['--yes', 'wrangler@4'];

// --no-bundle: upload our esbuild output as-is (avoids Wrangler define/NODE_ENV breakage)
const wranglerArgs = [
  ...prefix,
  ...(mode === 'version' ? ['versions', 'upload'] : ['deploy']),
  '--config',
  'wrangler.toml',
  '--no-bundle',
];

run(cmd, wranglerArgs);
console.log('==> Cloudflare deploy finished OK');
