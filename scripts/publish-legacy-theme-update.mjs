// Final theme follow-up. Keeps earlier publications/exports/receipts intact.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2], mode = process.argv[3];
assert.ok(['1.0.4', '1.0.5', '1.0.6', '1.0.7'].includes(version));
assert.ok(['--publish-approved', '--verify-only'].includes(mode));
const dir = path.join(root, 'test-results/legacy-update-inventory');
const stem = version === '1.0.4' ? 'bridge-1.0.4' : `candidate-${version}`;
const target = path.join(dir, version === '1.0.4' ? stem : `${stem}-lf`);
const cli = process.env.LEGACY_INVENTORY_EAS_CLI;
assert.ok(cli);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
if (version === '1.0.4') {
  const verified = spawnSync(process.execPath, [path.join(root, 'scripts/verify-legacy-104-bridge.mjs'), 'theme'], { cwd: root, encoding: 'utf8' });
  assert.equal(verified.status, 0, 'Original 1.0.4 source preservation check failed');
}
const proof = JSON.parse(await readFile(path.join(dir, `${stem}-export-verification-theme.json`), 'utf8'));
assert.equal(proof.passed, true);
for (const file of proof.sourceFiles ?? []) assert.equal(hash(await readFile(path.join(target, file.path))), file.sha256);
const config = JSON.parse(await readFile(path.join(target, 'app.json'), 'utf8'));
assert.equal(config.expo.version, version);
assert.equal(config.expo.android.versionCode, { '1.0.4': 5, '1.0.5': 6, '1.0.6': 7, '1.0.7': 8 }[version]);
assert.equal(config.expo.runtimeVersion.policy, 'appVersion');
const exported = path.join(target, '.expo/bridge-export/_expo/static/js/android');
const names = (await readdir(exported)).filter(name => name.endsWith('.hbc'));
assert.equal(names.length, 1);
assert.equal(hash(await readFile(path.join(exported, names[0]))), proof.bundleSha256);
const map = JSON.parse(await readFile(path.join(exported, names[0] + '.map'), 'utf8'));
const updater = map.sourcesContent[map.sources.indexOf('/src/updates/AppUpdates.tsx')];
assert.equal(updater, await readFile(path.join(root, 'src/updates/AppUpdates.tsx'), 'utf8'));
assert.ok(updater.includes('useAppTheme') && !updater.includes('useColorScheme'));
const receiptPath = path.join(dir, `${stem}-published-theme.json`);
let receipt;
if (mode === '--publish-approved') {
  try { await stat(receiptPath); throw Error('Theme release already recorded; use --verify-only'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const result = spawnSync(process.execPath, [cli, 'update', '--channel', 'preview', '--platform', 'android', '--environment', 'preview', '--input-dir', '.expo/bridge-export', '--skip-bundler', '--message', `Android ${version}: in-app cloud updater follows selected app theme`, '--json', '--non-interactive'], { cwd: target, env: { ...process.env, EXPO_NO_DOTENV: '1' }, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  await writeFile(path.join(dir, `${stem}-publish-theme.stderr.log`), result.stderr ?? '');
  await writeFile(path.join(dir, `${stem}-publish-theme.stdout.log`), result.stdout ?? '');
  assert.equal(result.status, 0, 'EAS publish failed; inspect logs before any retry');
  const updates = JSON.parse(result.stdout.slice(result.stdout.search(/^\s*\[/m)));
  assert.ok(Array.isArray(updates) && updates.length === 1);
  assert.equal(updates[0].platform, 'android');
  assert.equal(updates[0].runtimeVersion, version);
  receipt = { recordedAt: new Date().toISOString(), runtime: version, bundleSha256: proof.bundleSha256, bundleBytes: proof.bundleBytes,
    source: version === '1.0.4' ? `preserved update ${proof.sourceUpdateId}` : `compatible committed source ${proof.sourceCommit}`,
    updates: updates.map(update => ({ id: update.id, group: update.group, createdAt: update.createdAt, runtimeVersion: update.runtimeVersion, platform: update.platform, message: update.message })),
    skipBundler: true, followsSelectedAppTheme: true, physicalDevice: 'pending manual acceptance' };
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
} else receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
const updateId = receipt.updates[0].id;
const verify = spawnSync(process.execPath, [path.join(root, 'scripts/verify-android-preview-resilient.mjs'), updateId, version], { cwd: target, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true });
await writeFile(path.join(dir, `${stem}-cloud-verification-theme.log`), `${verify.stdout ?? ''}\n${verify.stderr ?? ''}`);
assert.equal(verify.status, 0, 'Publication saved; read-only verification failed. Use --verify-only, never repeat publication.');
const cloud = JSON.parse(await readFile(path.join(target, 'test-results/background-release/android-update-verification.json'), 'utf8'));
assert.equal(cloud.runtimeVersion, version);
assert.equal(cloud.assets.find(asset => asset.launch).sha256, proof.bundleSha256);
await writeFile(path.join(dir, `${stem}-cloud-verification-theme.json`), JSON.stringify({ ...cloud, launchMatchesFinalThemeExport: true, nativeConfigurationAndLockUnchanged: true }, null, 2) + '\n');
console.log(JSON.stringify({ published: true, cloudVerified: true, runtime: version, updateId, groupId: receipt.updates[0].group, assets: cloud.assets.length, bundleSha256: proof.bundleSha256, followsSelectedAppTheme: true, physicalDevice: 'pending manual acceptance' }, null, 2));
