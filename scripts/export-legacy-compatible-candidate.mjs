// Export/freeze a reviewed compatibility candidate. Never publishes.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];
const suffix = process.argv[3] === 'theme' ? '-theme' : '';
assert.ok(['1.0.5', '1.0.6', '1.0.7'].includes(version));
const dir = path.join(root, 'test-results/legacy-update-inventory'), target = path.join(dir, `candidate-${version}-lf`);
const prep = JSON.parse(await readFile(path.join(dir, `candidate-${version}-preparation.json`), 'utf8'));
const cli = process.env.LEGACY_INVENTORY_EAS_CLI;
assert.ok(cli);
const sha = value => createHash('sha256').update(value).digest('hex');
const headConfig = JSON.parse(spawnSync('git', ['show', `${prep.sourceCommit}:app.json`], { cwd: root, encoding: 'utf8' }).stdout);
const actualConfig = JSON.parse(await readFile(path.join(target, 'app.json'), 'utf8'));
headConfig.expo.version = version;
headConfig.expo.android.versionCode = prep.versionCode;
assert.deepEqual(actualConfig, headConfig, 'Native config may only restore the installed version/code');
assert.equal(actualConfig.expo.runtimeVersion.policy, 'appVersion');
assert.equal(sha(await readFile(path.join(target, 'package.json'))), prep.packageSha256);
assert.equal(sha(await readFile(path.join(target, 'package-lock.json'))), prep.lockSha256);
assert.deepEqual(await readdir(path.join(target, 'modules')), ['voice'], 'Candidate must not include desktop-pet module');
const listed = spawnSync('git', ['ls-tree', '-r', '--name-only', prep.sourceCommit, '--', 'app', 'src', 'modules', 'assets', 'babel.config.js', 'eas.json', 'package.json', 'package-lock.json'], { cwd: root, encoding: 'utf8' });
assert.equal(listed.status, 0);
const sourceFiles = [];
for (const file of listed.stdout.trim().split('\n')) {
  const bytes = await readFile(path.join(target, file));
  const intentional = prep.changes.find(change => change.path === file);
  if (intentional) assert.equal(sha(bytes), intentional.afterSha256, `Intentional edit changed after preparation: ${file}`);
  else {
    const original = spawnSync('git', ['show', `${prep.sourceCommit}:${file}`], { cwd: root });
    assert.equal(original.status, 0);
    assert.equal(sha(bytes), sha(original.stdout), `Unexpected baseline modification: ${file}`);
  }
  sourceFiles.push({ path: file, sha256: sha(bytes), kind: intentional ? 'updater-entry' : 'exact-committed-source' });
}
for (const file of ['AppUpdates.tsx', 'controller.ts', 'release.ts']) {
  const relative = `src/updates/${file}`;
  const bytes = await readFile(path.join(target, relative));
  assert.equal(sha(bytes), sha(await readFile(path.join(root, relative))), 'Updater changed; reprepare/review explicitly');
  sourceFiles.push({ path: relative, sha256: sha(bytes), kind: 'reviewed-updater' });
}
sourceFiles.push({ path: 'app.json', sha256: sha(await readFile(path.join(target, 'app.json'))), kind: 'installed-version-only' });
const listing = spawnSync(process.execPath, [cli, 'env:list', 'preview', '--format', 'short'], { cwd: target, encoding: 'utf8', windowsHide: true });
assert.equal(listing.status, 0, 'Could not read preview environment');
const env = { ...process.env, EXPO_NO_DOTENV: '1' };
for (const line of listing.stdout.split(/\r?\n/)) {
  const match = line.trim().match(/^(EXPO_PUBLIC_(?:SUPABASE_URL|SUPABASE_PUBLISHABLE_KEY|DEMO_MODE))=(.*)$/);
  if (match) env[match[1]] = match[2];
}
assert.equal(env.EXPO_PUBLIC_SUPABASE_URL, 'https://lthcucgggoevgcboouqw.supabase.co');
assert.equal(env.EXPO_PUBLIC_DEMO_MODE, 'false');
assert.ok(env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
let verified = false;
for (let attempt = 0; attempt < 3 && !verified; attempt++) {
  try { const response = await fetch(`${env.EXPO_PUBLIC_SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY }, signal: AbortSignal.timeout(15000) }); verified = response.ok; await response.arrayBuffer(); } catch {}
}
assert.ok(verified, 'Preview Auth verification failed');
const result = spawnSync(process.execPath, [path.join(target, 'node_modules/expo/bin/cli'), 'export', '--platform', 'android', '--source-maps', '--max-workers', '2', '--output-dir', '.expo/bridge-export'], { cwd: target, env, windowsHide: true, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
await writeFile(path.join(dir, `candidate-${version}-export${suffix}.log`), `${result.stdout ?? ''}\n${result.stderr ?? ''}`);
assert.equal(result.status, 0, 'Android export failed; see candidate log');
const bundleDir = path.join(target, '.expo/bridge-export/_expo/static/js/android');
const bundles = (await readdir(bundleDir)).filter(file => file.endsWith('.hbc'));
assert.equal(bundles.length, 1);
const bundle = await readFile(path.join(bundleDir, bundles[0]));
const map = JSON.parse(await readFile(path.join(bundleDir, bundles[0] + '.map'), 'utf8'));
for (let index = 0; index < map.sources.length; index++) {
  const source = map.sources[index];
  if (!source.startsWith('/supabase/functions/')) continue;
  const relative = source.slice(1);
  const original = spawnSync('git', ['show', `${prep.sourceCommit}:${relative}`], { cwd: root });
  assert.equal(original.status, 0);
  assert.equal(map.sourcesContent[index], original.stdout.toString('utf8'), `Shared business module changed: ${relative}`);
  const bytes = await readFile(path.join(target, relative));
  assert.equal(sha(bytes), sha(original.stdout));
  sourceFiles.push({ path: relative, sha256: sha(bytes), kind: 'exact-committed-shared-module' });
}
for (const file of ['AppUpdates.tsx', 'controller.ts', 'release.ts']) {
  const source = `/src/updates/${file}`, index = map.sources.indexOf(source);
  assert.ok(index >= 0, 'Updater missing from actual Android export');
  assert.equal(map.sourcesContent[index], await readFile(path.join(target, source.slice(1)), 'utf8'));
}
assert.ok(!map.sources.some(source => /\/modules\/desktop-pet\/|\/src\/desktopPet\/|\/src\/desktop-pet\//.test(source)), 'Desktop-pet source leaked into old native runtime');
const me = map.sourcesContent[map.sources.indexOf('/app/(tabs)/me.tsx')];
assert.ok(me.includes('installedApp.version') && me.includes('<AppUpdatePanel />'));
assert.ok(map.sourcesContent[map.sources.indexOf('/app/_layout.tsx')].includes('<AppUpdateNotice />'));
const report = { verifiedAt: new Date().toISOString(), passed: true, version, versionCode: prep.versionCode, runtime: version,
  sourceCommit: prep.sourceCommit, target, sourceFiles, bundlePath: path.relative(target, path.join(bundleDir, bundles[0])),
  bundleBytes: bundle.length, bundleSha256: sha(bundle), sourceMapSha256: sha(await readFile(path.join(bundleDir, bundles[0] + '.map'))),
  nativeConfigOnlyInstalledVersionChanges: true, dependenciesAndLockUnchanged: true, desktopPetAbsent: true,
  updateEntryAndInstalledFooterPresent: true, publicPreviewAuthVerified: true, published: false,
  scope: 'Committed compatible 1.0.7 business source plus update entry, not a byte-exact restoration of old APK source. Physical Android verification remains pending.' };
await writeFile(path.join(dir, `candidate-${version}-export-verification${suffix}.json`), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, sourceFiles: `${sourceFiles.length} frozen files` }, null, 2));
