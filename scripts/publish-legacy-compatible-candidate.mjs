// Explicit approved publication, or read-only cloud verification of an existing receipt.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2], mode = process.argv[3];
assert.ok(['1.0.5', '1.0.6', '1.0.7'].includes(version));
assert.ok(['--publish-approved', '--verify-only'].includes(mode));
const cli = process.env.LEGACY_INVENTORY_EAS_CLI;
assert.ok(cli);
const dir = path.join(root, 'test-results/legacy-update-inventory'), target = path.join(dir, `candidate-${version}-lf`);
const proof = JSON.parse(await readFile(path.join(dir, `candidate-${version}-export-verification.json`), 'utf8'));
assert.equal(proof.passed, true);
assert.equal(proof.runtime, version);
const sha = value => createHash('sha256').update(value).digest('hex');
for (const file of proof.sourceFiles) assert.equal(sha(await readFile(path.join(target, file.path))), file.sha256, `Frozen source changed: ${file.path}`);
assert.equal(sha(await readFile(path.join(target, proof.bundlePath))), proof.bundleSha256, 'Reviewed export changed');
const receiptFile = path.join(dir, `candidate-${version}-published.json`);
let receipt;
if (mode === '--publish-approved') {
  try { await stat(receiptFile); throw new Error('Publication receipt exists; use --verify-only rather than republish'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const result = spawnSync(process.execPath, [cli, 'update', '--channel', 'preview', '--platform', 'android', '--environment', 'preview', '--input-dir', '.expo/bridge-export', '--skip-bundler', '--message', `Android ${version}: compatible committed companion experience with in-app cloud updates`, '--json', '--non-interactive'], {
    cwd: target, env: { ...process.env, EXPO_NO_DOTENV: '1' }, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true,
  });
  await writeFile(path.join(dir, `candidate-${version}-publish.stderr.log`), result.stderr ?? '');
  await writeFile(path.join(dir, `candidate-${version}-publish.stdout.log`), result.stdout ?? '');
  assert.equal(result.status, 0, 'EAS publication failed; check scoped logs before any retry');
  const updates = JSON.parse(result.stdout.slice(result.stdout.search(/^\s*\[/m)));
  assert.ok(Array.isArray(updates) && updates.length === 1);
  assert.ok(updates.every(update => update.platform === 'android' && update.runtimeVersion === version));
  receipt = { recordedAt: new Date().toISOString(), sourceCommit: proof.sourceCommit,
    runtime: version, bundleSha256: proof.bundleSha256, bundleBytes: proof.bundleBytes, skipBundler: true,
    updates: updates.map(update => ({ id: update.id, group: update.group, createdAt: update.createdAt, runtimeVersion: update.runtimeVersion, platform: update.platform, gitCommitHash: update.gitCommitHash, message: update.message })),
    scope: 'Compatible committed 1.0.7 source plus update entry. Not a byte-exact reconstruction of the old APK.', physicalDevice: 'pending manual acceptance' };
  await writeFile(receiptFile, JSON.stringify(receipt, null, 2) + '\n');
} else receipt = JSON.parse(await readFile(receiptFile, 'utf8'));
const updateId = receipt.updates[0].id;
const verified = spawnSync(process.execPath, [path.join(root, 'scripts/verify-android-preview.mjs'), updateId, version], { cwd: target, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true });
await writeFile(path.join(dir, `candidate-${version}-cloud-verification.log`), `${verified.stdout ?? ''}\n${verified.stderr ?? ''}`);
assert.equal(verified.status, 0, 'Published receipt saved, cloud verification failed; rerun --verify-only, do not republish');
const cloud = JSON.parse(await readFile(path.join(target, 'test-results/background-release/android-update-verification.json'), 'utf8'));
assert.equal(cloud.runtimeVersion, version);
assert.equal(cloud.assets.find(asset => asset.launch).sha256, proof.bundleSha256);
await writeFile(path.join(dir, `candidate-${version}-cloud-verification.json`), JSON.stringify({ ...cloud, launchMatchesFrozenCompatibleExport: true, sourceCommit: proof.sourceCommit }, null, 2) + '\n');
console.log(JSON.stringify({ published: true, cloudVerified: true, runtime: version, updateId, groupId: receipt.updates[0].group, assets: cloud.assets.length, bundleSha256: proof.bundleSha256, physicalDevice: 'pending manual acceptance' }, null, 2));
