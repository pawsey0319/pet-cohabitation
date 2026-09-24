// Read-only EAS inventory. Never publishes updates, modifies runtime, or prints env values.
import { spawn, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = process.env.LEGACY_INVENTORY_EAS_CLI;
if (!cli) throw new Error('Set LEGACY_INVENTORY_EAS_CLI to the existing eas-cli/bin/run path');
const out = path.join(root, 'test-results/legacy-update-inventory');
await mkdir(out, { recursive: true });
const readJson = async name => JSON.parse((await readFile(path.join(root, name), 'utf8')).replace(/^\uFEFF/, ''));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function run(args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve(JSON.parse(stdout.slice(stdout.search(/[\[{]/)))) : reject(new Error(`EAS ${args[0]} failed (${code}); diagnostic retained only in process memory`)));
  });
}
const [updates, builds, channel] = await Promise.all([
  run(['update:list', '--branch', 'preview', '--limit', '50', '--json', '--non-interactive']),
  run(['build:list', '--platform', 'android', '--build-profile', 'preview', '--limit', '50', '--json', '--non-interactive']),
  run(['channel:view', 'preview', '--json']),
]);
const groups = updates.currentPage.filter(group => ['1.0.4', '1.0.5', '1.0.6', '1.0.7'].includes(group.runtimeVersion));
const newestByRuntime = Object.fromEntries(['1.0.4', '1.0.5', '1.0.6', '1.0.7'].map(runtime => [runtime, groups.find(group => group.runtimeVersion === runtime) ?? null]));
const details = {};
for (const [runtime, group] of Object.entries(newestByRuntime)) {
  details[runtime] = group ? (await run(['update:view', group.group, '--json'])).map(item => ({
    id: item.id, createdAt: item.createdAt, group: item.group, branch: item.branch,
    runtimeVersion: item.runtimeVersion, platform: item.platform, message: item.message,
    isRollBackToEmbedded: item.isRollBackToEmbedded, gitCommitHash: item.gitCommitHash,
  })) : [];
}
const summary = {
  checkedAt: new Date().toISOString(), readOnly: true, branch: updates.name,
  channel: { id: channel.currentPage.id, name: channel.currentPage.name, isPaused: channel.currentPage.isPaused,
    branches: channel.currentPage.updateBranches.map(branch => ({ id: branch.id, name: branch.name })) },
  updateGroupsReturned: updates.currentPage.length, latestUpdates: details,
  builds: builds.filter(build => ['1.0.4', '1.0.5', '1.0.6', '1.0.7'].includes(build.appVersion)).map(build => ({
    id: build.id, status: build.status, appVersion: build.appVersion, appBuildVersion: build.appBuildVersion,
    runtimeVersion: build.runtime?.version ?? build.runtimeVersion, channel: build.channel, distribution: build.distribution,
    createdAt: build.createdAt, completedAt: build.completedAt, gitCommitHash: build.gitCommitHash,
    buildProfile: build.buildProfile,
  })),
  runtimeEndpoints: [],
};
const { expo } = await readJson('app.json');
for (const runtime of Object.keys(newestByRuntime)) {
  const response = await fetch(expo.updates.url, { headers: { 'expo-platform': 'android', 'expo-runtime-version': runtime,
    'expo-channel-name': 'preview', 'expo-protocol-version': '1', accept: 'multipart/mixed,application/expo+json,application/json' }, signal: AbortSignal.timeout(30000) });
  const item = { runtimeVersion: runtime, status: response.status };
  if (response.status === 200) {
    const body = await response.text();
    const type = response.headers.get('content-type') ?? '';
    let manifest;
    if (type.startsWith('multipart/')) {
      const boundary = type.match(/boundary="?([^";]+)"?/)?.[1];
      for (const part of body.split('--' + boundary)) {
        const separator = part.indexOf('\r\n\r\n');
        if (separator >= 0 && part.slice(0, separator).includes('name="manifest"')) manifest = JSON.parse(part.slice(separator + 4).trim());
      }
    } else manifest = JSON.parse(body);
    if (manifest) Object.assign(item, { updateId: manifest.id, createdAt: manifest.createdAt, servedRuntime: manifest.runtimeVersion,
      launchHash: manifest.launchAsset?.hash, launchKey: manifest.launchAsset?.key });
  } else await response.arrayBuffer();
  summary.runtimeEndpoints.push(item);
}
const receipt = await readJson('test-results/background-release/android-update-verification.json');
const manifest = await readJson('test-results/background-release/source-manifest.json');
const bundleRelative = 'dist/_expo/static/js/android/entry-441e807ceb0a508aebd4189760a16e26.hbc';
const bundle = await readFile(path.join(out, 'published-1.0.4.hbc')).catch(() => readFile(path.join(root, bundleRelative)));
const mapBytes = await readFile(path.join(out, 'published-1.0.4.hbc.map')).catch(() => readFile(path.join(root, bundleRelative + '.map')));
const map = JSON.parse(mapBytes);
if (hash(bundle) !== receipt.assets.find(asset => asset.launch).sha256) throw new Error('Preserved legacy bundle does not match its published receipt');
await writeFile(path.join(out, 'published-1.0.4.hbc'), bundle);
await writeFile(path.join(out, 'published-1.0.4.hbc.map'), mapBytes);
const sourceFiles = [];
const recovered = path.join(out, 'sources-1.0.4');
for (let index = 0; index < map.sources.length; index += 1) {
  const relative = map.sources[index].replace(/^\//, '');
  if (!/^(app\/|src\/|index\.js$)/.test(relative)) continue;
  if (typeof map.sourcesContent[index] !== 'string') continue;
  const target = path.resolve(recovered, relative);
  if (!target.startsWith(recovered + path.sep)) throw new Error('Unexpected source path');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, map.sourcesContent[index]);
  const sha = hash(Buffer.from(map.sourcesContent[index]));
  const recorded = manifest.entries.find(item => item.path === relative);
  sourceFiles.push({ path: relative, sha256: sha, matchesFrozenSourceManifest: recorded ? recorded.sha256 === sha : null });
}
summary.preserved104 = { updateId: receipt.updateId, runtime: receipt.runtimeVersion, launchSha256: hash(bundle),
  sourceMapSha256: hash(mapBytes), sourceManifestCreatedAt: manifest.createdAt,
  sourceManifestBaselineCommit: manifest.baselineCommit, dirtyWorkspace: manifest.dirtyWorkspace,
  recoveredAppSources: sourceFiles.length, sourceFiles,
  sourceMapLimit: 'Source map recovers bundled source contents only; original build config/lock/assets require independent matching before publish.' };
summary.sourceCandidates = [];
for (const [runtime, manifestPath, commit] of [
  ['1.0.4', 'test-results/background-release/source-manifest.json', 'b812a0e'],
  ['1.0.5', 'test-results/android-reviewfix-build-20260914/source-manifest.json', '88aaeb0'],
  ['1.0.6', 'test-results/mobile-feedback-20260914/apk/source-manifest.json', '88aaeb0'],
  ['1.0.7', 'test-results/companion-group-timeout-20260914/apk/source-manifest.json', '88aaeb0'],
]) {
  const frozen = await readJson(manifestPath), matchedSources = [], missing = [];
  for (const file of frozen.files ?? frozen.entries) {
    const git = spawnSync('git', ['show', `${commit}:${file.path}`], { cwd: root });
    const candidates = [];
    if (git.status === 0) {
      candidates.push([`git:${commit}`, git.stdout]);
      candidates.push([`git:${commit}:CRLF`, Buffer.from(git.stdout.toString('utf8').replace(/\r?\n/g, '\r\n'))]);
    }
    try { candidates.push(['current', await readFile(path.join(root, file.path))]); } catch {}
    if (runtime === '1.0.4') {
      try { candidates.push(['published-source-map', await readFile(path.join(recovered, file.path))]); } catch {}
    }
    for (const name of ['android-native-1.0.5-1789121325193', 'android-native-1.0.5-1789121622551', 'android-native-1.0.5-1789122002299', 'android-native-1.0.5-1789356064674']) {
      try { candidates.push([name, await readFile(path.join(root, 'test-results', name, file.path))]); } catch {}
    }
    const match = candidates.find(([_origin, bytes]) => hash(bytes) === file.sha256);
    if (match) matchedSources.push({ path: file.path, source: match[0], sha256: file.sha256 });
    else missing.push({ path: file.path, sha256: file.sha256 });
  }
  summary.sourceCandidates.push({ runtime, manifest: manifestPath, commit,
    capturedFiles: (frozen.files ?? frozen.entries).length, matched: matchedSources.length, missing, matchedSources });
}
await writeFile(path.join(root, 'test-results/legacy-update-inventory.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ checkedAt: summary.checkedAt, latestUpdates: summary.latestUpdates,
  builds: summary.builds, runtimeEndpoints: summary.runtimeEndpoints,
  preserved104: { ...summary.preserved104, sourceFiles: undefined } }, null, 2));
