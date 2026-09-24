// N01: preserve the dirty workspace without staging files or copying credentials.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';

const label = process.argv[2];
assert.match(label ?? '', /^[a-z0-9][a-z0-9-]{1,70}$/);
const root = process.cwd(), output = path.join(root, 'test-results', label);
await mkdir(output); // A prior record must never be overwritten.
const files = [], excluded = [], missing = [];
const skip = /^(?:node_modules|build|release|dist|\.gradle|\.temp|\.branches|__pycache__|\.venv|venv|\.env.*|google-services\.json|credentials.*)$|\.(?:jks|keystore|p12|credential|pem|pyc|log)$/i;
async function copy(relative) {
  const full = path.join(root, relative);
  let info;
  try { info = await lstat(full); } catch (e) { if (e.code === 'ENOENT') { missing.push(relative); return; } throw e; }
  if (skip.test(path.basename(relative)) || info.isSymbolicLink()) { excluded.push(relative); return; }
  if (info.isDirectory()) {
    for (const child of (await readdir(full)).sort()) await copy(path.join(relative, child));
    return;
  }
  const bytes = await readFile(full), target = path.join(output, 'source', relative);
  await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes);
  files.push({ path: relative.replaceAll('\\', '/'), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
for (const item of ['app', 'src', 'modules', 'assets', 'supabase/functions', 'supabase/migrations', 'supabase/config.toml', 'docs', 'scripts', 'desktop', 'public', 'e2e', '.github', 'app.json', 'package.json', 'package-lock.json', 'eas.json', 'babel.config.js', 'tsconfig.json', 'jest.config.js', 'playwright.config.ts', 'index.js', 'App.tsx', '.gitignore', '.easignore', '.vercelignore', 'vercel.json']) await copy(item);
const receipts = {};
for (const name of ['android-update-runtime-coverage.json', 'android-1.0.8-build10-signature.json', 'next-version-deployed-functions.json', 'next-version-migration-manifest.json', 'personality-migration-parity.json']) {
  const relative = path.join('test-results', name);
  try { const bytes = await readFile(relative); await writeFile(path.join(output, name), bytes); receipts[name] = createHash('sha256').update(bytes).digest('hex'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; missing.push(relative); }
}
const apkPath = 'artifacts/pet-cohabitation-preview-1.0.8-build10.apk';
const apkBytes = await readFile(apkPath), config = JSON.parse(await readFile('app.json', 'utf8'));
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
await writeFile(path.join(output, 'git-status.txt'), git(['status', '--short', '--untracked-files=all']));
const manifest = { savedAt: new Date().toISOString(), root, gitHead: git(['rev-parse', 'HEAD']).trim(), branch: git(['branch', '--show-current']).trim(), dirtyWorkspace: true,
  native: { version: config.expo.version, versionCode: config.expo.android.versionCode, runtimePolicy: config.expo.runtimeVersion, package: config.expo.android.package },
  apk: { path: apkPath, bytes: apkBytes.length, sha256: createHash('sha256').update(apkBytes).digest('hex') },
  cloudEvidence: 'Existing receipts only; this snapshot does not re-verify deployed functions or device state.', receipts, files, excluded, missing };
await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ output, files: files.length, apk: manifest.apk, native: manifest.native }));
