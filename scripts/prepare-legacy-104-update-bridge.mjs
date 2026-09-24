// Creates a NEW isolated source tree from the exact published 1.0.4 source map.
// Does not publish, checkout, reset, or modify current app/native configuration.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inventoryDir = path.join(root, 'test-results/legacy-update-inventory');
const target = path.join(inventoryDir, 'bridge-1.0.4');
try { await stat(target); throw new Error('Bridge target already exists; review it instead of overwriting'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const json = async file => JSON.parse((await readFile(path.join(root, file), 'utf8')).replace(/^\uFEFF/, ''));
const sha = value => createHash('sha256').update(value).digest('hex');
const inventory = await json('test-results/legacy-update-inventory.json');
const frozen = await json('test-results/background-release/source-manifest.json');
const mapBytes = await readFile(path.join(inventoryDir, 'published-1.0.4.hbc.map'));
assert.equal(sha(mapBytes), inventory.preserved104.sourceMapSha256);
assert.equal(sha(await readFile(path.join(inventoryDir, 'published-1.0.4.hbc'))), inventory.preserved104.launchSha256);
const map = JSON.parse(mapBytes);
const preserved = [], changes = [];
async function put(relative, bytes) {
  const file = path.resolve(target, relative);
  assert.ok(file.startsWith(target + path.sep));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
}
for (let index = 0; index < map.sources.length; index++) {
  const relative = map.sources[index].replace(/^\//, '');
  if (!/^(app\/|src\/|supabase\/functions\/|index\.js$)/.test(relative)) continue;
  assert.equal(typeof map.sourcesContent[index], 'string');
  const bytes = Buffer.from(map.sourcesContent[index]);
  const previous = frozen.entries.find(file => file.path === relative);
  assert.ok(previous, `Missing frozen source entry: ${relative}`);
  assert.equal(sha(bytes), previous.sha256, `Source map differs from frozen release: ${relative}`);
  await put(relative, bytes);
  preserved.push({ path: relative, sha256: sha(bytes), source: 'published-source-map' });
}
for (const relative of ['app.json', 'package.json', 'package-lock.json', 'eas.json', 'babel.config.js']) {
  const result = spawnSync('git', ['show', `b812a0e:${relative}`], { cwd: root });
  assert.equal(result.status, 0);
  const previous = frozen.entries.find(file => file.path === relative);
  assert.ok(previous);
  const candidates = [result.stdout, Buffer.from(result.stdout.toString('utf8').replace(/\r?\n/g, '\r\n'))];
  const bytes = candidates.find(value => sha(value) === previous.sha256);
  assert.ok(bytes, `Configuration does not match frozen release: ${relative}`);
  await put(relative, bytes);
  preserved.push({ path: relative, sha256: sha(bytes), source: 'git-b812a0e-exact-frozen-hash' });
}
const app = JSON.parse(await readFile(path.join(target, 'app.json'), 'utf8'));
assert.equal(app.expo.version, '1.0.4');
assert.equal(app.expo.runtimeVersion.policy, 'appVersion');
assert.equal(app.expo.android.versionCode, 5);
for (const file of ['AppUpdates.tsx', 'controller.ts', 'release.ts']) {
  const relative = `src/updates/${file}`;
  const bytes = await readFile(path.join(root, relative));
  await put(relative, bytes);
  changes.push({ path: relative, kind: 'new-update-module', sha256: sha(bytes) });
}
const layoutPath = 'app/_layout.tsx';
let layout = await readFile(path.join(target, layoutPath), 'utf8');
assert.ok(layout.includes('<NotificationBootstrap /><AppStack />'));
layout = 'import { AppUpdateNotice } from "../src/updates/AppUpdates";\n' + layout.replace('<NotificationBootstrap /><AppStack />', '<NotificationBootstrap /><AppStack /><AppUpdateNotice />');
await put(layoutPath, layout);
changes.push({ path: layoutPath, kind: 'only-import-and-startup-notice', sha256: sha(layout) });
const mePath = 'app/(tabs)/me.tsx';
let me = await readFile(path.join(target, mePath), 'utf8');
assert.ok(me.includes('</KeyboardScrollView>'), 'Expected existing settings scroll body');
me = 'import { AppUpdatePanel } from "../../src/updates/AppUpdates";\n' + me.replace('</KeyboardScrollView>', '<AppUpdatePanel />\n</KeyboardScrollView>');
await put(mePath, me);
changes.push({ path: mePath, kind: 'only-import-and-settings-panel', sha256: sha(me) });
const report = { preparedAt: new Date().toISOString(), runtime: '1.0.4', sourceUpdateId: inventory.preserved104.updateId,
  sourceLaunchSha256: inventory.preserved104.launchSha256, preserved, changes, nativeConfigurationUnchanged: true,
  published: false, limitations: ['Needs isolated npm ci/export and review before publish.', 'Only bundled runtime modules are restored. Type-only files and tests not present in source map are not recovered.', 'No physical device load/install is verified.'] };
await writeFile(path.join(inventoryDir, 'bridge-1.0.4-preparation.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ target, preserved: preserved.length, changes, published: false }, null, 2));
