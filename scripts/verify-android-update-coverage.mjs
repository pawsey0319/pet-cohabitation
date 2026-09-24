// Check all supported native runtimes after publishing several updates to one channel.
// Each argument is a prior full asset-verification receipt, not an inferred latest ID.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const files = process.argv.slice(2);
assert.ok(files.length, 'Pass full verification receipt JSON files');
const { expo } = JSON.parse(await readFile('app.json', 'utf8'));
const receipts = await Promise.all(files.map(async file => ({ file, ...JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')) })));
assert.equal(new Set(receipts.map(row => row.runtimeVersion)).size, receipts.length, 'Duplicate runtime');
const checks = await Promise.all(receipts.map(async receipt => {
  assert.ok(receipt.updateId && receipt.runtimeVersion && receipt.assets?.length, 'A full verified receipt is required');
  const response = await fetch(expo.updates.url, {
    headers: { 'expo-platform': 'android', 'expo-runtime-version': receipt.runtimeVersion, 'expo-channel-name': 'preview', 'expo-protocol-version': '1', accept: 'multipart/mixed,application/expo+json,application/json' },
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 200, receipt.runtimeVersion);
  const type = response.headers.get('content-type') ?? '', body = await response.text();
  let manifest;
  if (type.startsWith('multipart/')) {
    const boundary = type.match(/boundary="?([^";]+)"?/)?.[1];
    assert.ok(boundary);
    for (const part of body.split('--' + boundary)) {
      const split = part.indexOf('\r\n\r\n');
      if (split >= 0 && part.slice(0, split).includes('name="manifest"')) manifest = JSON.parse(part.slice(split + 4).trim());
    }
  } else manifest = JSON.parse(body);
  assert.equal(manifest?.id, receipt.updateId, `Wrong update for ${receipt.runtimeVersion}`);
  assert.equal(manifest.runtimeVersion, receipt.runtimeVersion);
  const launch = receipt.assets.find(asset => asset.launch);
  assert.ok(launch?.sha256);
  assert.equal(Buffer.from(manifest.launchAsset.hash, 'base64url').toString('hex'), launch.sha256, 'Launch bytes changed');
  return { runtime: receipt.runtimeVersion, updateId: manifest.id, launchSha256: launch.sha256, fullAssetEvidence: receipt.file, passed: true };
}));
const report = { checkedAt: new Date().toISOString(), channel: 'preview', checks, physicalAndroid: 'pending manual verification' };
await writeFile('test-results/android-update-runtime-coverage.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
