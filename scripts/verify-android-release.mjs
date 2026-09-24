#!/usr/bin/env node
// Static public release metadata contains no credentials. Reports are bound to APK bytes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const mode = args[0] && !args[0].startsWith('--') ? args.shift() : 'local';
const options = {};
for (let index = 0; index < args.length; index += 1) {
  const key = args[index];
  if (key === '--no-network') options.noNetwork = true;
  else if (['--manifest', '--apk', '--inspection', '--signature', '--build', '--report', '--url', '--export-dir'].includes(key)) {
    assert.ok(args[index + 1] && !args[index + 1].startsWith('--'), `Missing value for ${key}`);
    options[key.slice(2)] = args[++index];
  } else throw new Error(`Unknown argument: ${key}`);
}
assert.ok(['local', 'remote', 'self-test'].includes(mode), 'Use local, remote or self-test');
assert.ok(mode !== 'remote' || !options.noNetwork, 'Remote verification requires network');
const resolve = value => path.resolve(root, value);
const readJson = async file => JSON.parse((await readFile(resolve(file), 'utf8')).replace(/^\uFEFF/, ''));

function validateManifest(manifest) {
  assert.equal(manifest.schemaVersion, 1, 'Unsupported schema version');
  assert.equal(manifest.platform, 'android');
  assert.equal(manifest.channel, 'preview');
  assert.equal(manifest.applicationId, 'com.pawsey.petcohabitation');
  const latest = manifest.latest;
  assert.ok(latest && typeof latest === 'object', 'Missing latest release');
  assert.match(latest.version, /^\d+\.\d+\.\d+$/);
  assert.ok(Number.isSafeInteger(latest.versionCode) && latest.versionCode > 0, 'Invalid versionCode');
  assert.ok(typeof latest.runtimeVersion === 'string' && latest.runtimeVersion.length > 0 && latest.runtimeVersion.length <= 100);
  const download = new URL(latest.url);
  assert.equal(download.protocol, 'https:');
  assert.equal(download.hostname, 'expo.dev', 'Only the approved EAS artifact host is allowed');
  assert.equal(download.port, '');
  assert.equal(download.username + download.password + download.search + download.hash, '');
  assert.match(download.pathname, /^\/artifacts\/eas\/[A-Za-z0-9_-]+\.apk$/);
  assert.match(latest.sha256, /^[a-f0-9]{64}$/);
  assert.ok(Number.isSafeInteger(latest.bytes) && latest.bytes > 0);
  assert.ok(Array.isArray(latest.notes) && latest.notes.length >= 1 && latest.notes.length <= 12);
  assert.ok(latest.notes.every(note => typeof note === 'string' && note.trim().length > 0 && note.length <= 240));
  assert.ok(typeof latest.publishedAt === 'string' && Number.isFinite(Date.parse(latest.publishedAt)));
  assert.ok(Date.parse(latest.publishedAt) <= Date.now(), 'Release date cannot be in the future');
}

const manifest = await readJson(options.manifest ?? 'public/releases/android-preview.json');
if (mode === 'self-test') {
  validateManifest(manifest);
  const mutations = [
    m => { m.schemaVersion = 2; },
    m => { m.applicationId = 'someone.else'; },
    m => { m.latest.versionCode = '10'; },
    m => { m.latest.url = m.latest.url.replace('expo.dev', 'expo.dev.attacker.example'); },
    m => { m.latest.url = m.latest.url.replace('https:', 'http:'); },
    m => { m.latest.url += '?download=other'; },
    m => { m.latest.sha256 = 'not-a-hash'; },
    m => { m.latest.bytes = -1; },
    m => { m.latest.publishedAt = '2999-01-01T00:00:00.000Z'; },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(manifest);
    mutate(copy);
    assert.throws(() => validateManifest(copy));
  }
  console.log(JSON.stringify({ passed: true, invalid_manifests_rejected: mutations.length }));
  process.exit(0);
}

const report = { checkedAt: new Date().toISOString(), mode, passed: false, checks: [], limitations: [
  'Package availability and static metadata do not prove an Android device downloaded or installed it.',
  'This script does not deliver an OTA update or validate runtime compatibility of a new JavaScript bundle.',
] };
function checked(name, details = {}) { report.checks.push({ name, passed: true, ...details }); }
async function downloadHead(latest) {
  const response = await fetch(latest.url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(30000), headers: { 'Cache-Control': 'no-cache' } });
  assert.equal(response.status, 200, 'APK download endpoint did not return 200');
  assert.equal(new URL(response.url).protocol, 'https:', 'APK download redirected to non-HTTPS');
  assert.equal(Number(response.headers.get('content-length')), latest.bytes, 'Remote APK length mismatch');
  assert.ok(!/text\/html/i.test(response.headers.get('content-type') ?? ''), 'Download endpoint returned HTML');
  checked('public_apk_available', { status: response.status, bytes: latest.bytes });
}

try {
  validateManifest(manifest);
  checked('manifest_contract', { version: manifest.latest.version, versionCode: manifest.latest.versionCode, runtimeVersion: manifest.latest.runtimeVersion });
  const latest = manifest.latest;
  if (mode === 'local') {
    const apk = resolve(options.apk ?? `artifacts/pet-cohabitation-preview-${latest.version}-build${latest.versionCode}.apk`);
    const info = await stat(apk);
    assert.ok(info.isFile());
    assert.equal(info.size, latest.bytes, 'Local APK length mismatch');
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(apk)) digest.update(chunk);
    assert.equal(digest.digest('hex'), latest.sha256, 'Local APK SHA256 mismatch');
    checked('actual_apk_hash_and_length', { bytes: info.size, sha256: latest.sha256 });
    const prefix = `test-results/android-${latest.version}-build${latest.versionCode}`;
    const inspection = await readJson(options.inspection ?? `${prefix}-inspection.json`);
    assert.equal(inspection.inspection_succeeded, true);
    assert.equal(inspection.candidate_accepted_by_this_static_check, true);
    assert.equal(inspection.apk_sha256, latest.sha256, 'Inspection belongs to different APK');
    assert.equal(inspection.apk_bytes, latest.bytes);
    assert.equal(inspection.actual.package, manifest.applicationId);
    assert.equal(inspection.actual.version_name, latest.version);
    assert.equal(inspection.actual.version_code, latest.versionCode);
    assert.equal(inspection.actual.runtime_version, latest.runtimeVersion);
    assert.equal(inspection.actual.updates_channel, manifest.channel);
    checked('actual_android_manifest_bound_to_apk');
    const signature = await readJson(options.signature ?? `${prefix}-signature.json`);
    assert.equal(signature.apk_sha256, latest.sha256, 'Signature verification belongs to different APK');
    assert.equal(signature.cryptographic_verification_passed, true);
    assert.equal(signature.expected_signing_certificate_matched, true);
    assert.equal(signature.apksigner_exit_code, 0);
    assert.deepEqual(signature.signing_certificate_sha256, inspection.actual.signing_certificate_sha256);
    checked('apksigner_evidence_bound_to_apk');
    const build = await readJson(options.build ?? `${prefix}-public-build.json`);
    assert.equal(build.status, 'FINISHED');
    assert.equal(build.version, latest.version);
    assert.equal(Number(build.versionCode), latest.versionCode);
    assert.equal(build.buildUrl, latest.url);
    assert.equal(build.completedAt, latest.publishedAt);
    checked('eas_artifact_metadata', { buildId: build.id });
    const vercel = await readJson('vercel.json');
    const releaseHeaders = vercel.headers.find(item => item.source === '/releases/android-preview.json')?.headers;
    assert.ok(releaseHeaders?.some(header => header.key.toLowerCase() === 'cache-control' && header.value === 'no-store'));
    for (const rewrite of vercel.rewrites) {
      if (rewrite.destination === '/index.html') assert.ok(!new RegExp(`^${rewrite.source}$`).test('/releases/android-preview.json'), 'SPA rewrite shadows manifest');
    }
    checked('release_route_excluded_from_spa_and_not_cached');
    if (options['export-dir']) {
      const exported = await readJson(path.join(options['export-dir'], 'releases', 'android-preview.json'));
      assert.deepEqual(exported, manifest, 'Expo export does not contain current release manifest');
      checked('expo_export_contains_manifest');
    }
    if (!options.noNetwork) await downloadHead(latest);
    else report.limitations.push('Network explicitly skipped; public download availability was not checked.');
  } else {
    const url = new URL(options.url ?? 'https://pet-cohabitation-public.vercel.app/releases/android-preview.json');
    assert.equal(url.protocol, 'https:', 'Public manifest must use HTTPS');
    assert.equal(url.username + url.password, '');
    const response = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'error', headers: { 'Cache-Control': 'no-cache' } });
    assert.equal(response.status, 200, 'Public manifest did not return 200');
    assert.match(response.headers.get('content-type') ?? '', /^application\/json\b/i, 'Public endpoint returned non-JSON/SPA');
    assert.match(response.headers.get('cache-control') ?? '', /(?:^|[,\s])no-store(?:$|[,\s])/i, 'Public manifest may be cached');
    const body = await response.json();
    validateManifest(body);
    assert.deepEqual(body, manifest, 'Published release differs from approved local release');
    checked('public_manifest_json_matches_approved_release', { url: url.href, status: response.status });
    checked('public_manifest_no_store');
    await downloadHead(body.latest);
  }
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  const file = resolve(options.report ?? `test-results/android-release-${mode}-verification.json`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
