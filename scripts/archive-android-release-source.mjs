// Preserve source and exported bytes for a verified dirty-workspace OTA release.
// Deliberately excludes environment files, credentials and native build caches.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
const [receiptPath, folder] = process.argv.slice(2);
assert.ok(receiptPath && folder, 'Usage: node scripts/archive-android-release-source.mjs <verified-receipt> <new-folder-name>');
assert.match(folder, /^[a-z0-9][a-z0-9.-]+$/i);
const root = process.cwd(), output = path.join(root, 'test-results', folder);
await mkdir(output); // Never overwrite an earlier release archive.
const receipt = JSON.parse((await readFile(receiptPath, 'utf8')).replace(/^\uFEFF/, ''));
assert.ok(receipt.updateId && receipt.runtimeVersion);
const files = [];
async function copy(relative) {
  const source = path.join(root, relative), info = await stat(source);
  if (info.isDirectory()) {
    for (const name of await readdir(source)) if (!['node_modules', 'build', '.gradle', '__pycache__'].includes(name) && !name.startsWith('.env') && !/\.(?:jks|keystore|p12)$/i.test(name)) await copy(path.join(relative, name));
    return;
  }
  const bytes = await readFile(source), target = path.join(output, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
  files.push({ path: relative.replaceAll('\\', '/'), sha256: createHash('sha256').update(bytes).digest('hex') });
}
for (const name of ['app', 'src', 'modules', 'assets', 'supabase/functions/_shared', 'app.json', 'package.json', 'package-lock.json', 'eas.json', 'babel.config.js', 'tsconfig.json', 'jest.config.js', 'index.js', 'public/releases', 'dist']) {
  try { await stat(name); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  await copy(name);
}
const launch = receipt.assets.find(asset => asset.launch);
assert.ok(launch?.sha256 && files.some(file => file.path.startsWith('dist/') && file.sha256 === launch.sha256), 'Export differs from verified cloud launch bytes');
await writeFile(path.join(output, 'source-manifest.json'), JSON.stringify({ savedAt: new Date().toISOString(), updateId: receipt.updateId, runtimeVersion: receipt.runtimeVersion, launchSha256: launch.sha256, files }, null, 2));
console.log(JSON.stringify({ output, files: files.length, updateId: receipt.updateId, launchMatches: true }));
