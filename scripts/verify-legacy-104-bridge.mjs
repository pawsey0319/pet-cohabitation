// Verify a real Android export against the exact published legacy source map.
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = path.join(root, 'test-results/legacy-update-inventory');
const suffix = process.argv[2] === 'theme' ? '-theme' : '';
const bridge = path.join(evidence, 'bridge-1.0.4');
const exported = path.join(bridge, '.expo/bridge-export/_expo/static/js/android');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const baseline = JSON.parse(await readFile(path.join(evidence, 'published-1.0.4.hbc.map'), 'utf8'));
const preparation = JSON.parse(await readFile(path.join(evidence, `bridge-1.0.4-preparation${suffix}.json`), 'utf8'));
const mapFile = (await readdir(exported)).filter(file => file.endsWith('.hbc.map'));
assert.equal(mapFile.length, 1);
const fresh = JSON.parse(await readFile(path.join(exported, mapFile[0]), 'utf8'));
const old = new Map(baseline.sources.map((source, index) => [source, baseline.sourcesContent[index]]));
const next = new Map(fresh.sources.map((source, index) => [source, fresh.sourcesContent[index]]));
const unchanged = [], plannedChanges = [], added = [];
for (const [source, content] of old) {
  assert.ok(next.has(source), `Published module removed: ${source}`);
  const actual = next.get(source);
  if (actual === content) { unchanged.push(source); continue; }
  let expected;
  if (source.startsWith('/app?ctx=')) {
    expected = content.replaceAll(JSON.stringify(root).slice(1, -1), JSON.stringify(bridge).slice(1, -1));
  } else if (source === '/app/_layout.tsx') {
    expected = 'import { AppUpdateNotice } from "../src/updates/AppUpdates";\n' + content.replace('<NotificationBootstrap /><AppStack />', '<NotificationBootstrap /><AppStack /><AppUpdateNotice />');
  } else if (source === '/app/(tabs)/me.tsx') {
    expected = 'import { AppUpdatePanel } from "../../src/updates/AppUpdates";\n' + content.replace('</KeyboardScrollView>', '<AppUpdatePanel />\n</KeyboardScrollView>');
  }
  assert.equal(actual, expected, `Unexpected change to published module: ${source}`);
  plannedChanges.push({ path: source, reason: source.startsWith('/app?ctx=') ? 'Only absolute build-directory prefix changed; all routes identical' : 'Only updater import and component insertion' });
}
for (const [source, content] of next) {
  if (old.has(source)) continue;
  if (source.startsWith('/src/updates/')) {
    assert.ok(['/src/updates/AppUpdates.tsx', '/src/updates/controller.ts', '/src/updates/release.ts'].includes(source));
    assert.equal(content, await readFile(path.join(root, source.slice(1)), 'utf8'), 'Bridge updater differs from reviewed current updater');
  } else {
    assert.ok(source.startsWith('/node_modules/expo-updates/build/'), `Unexpected dependency: ${source}`);
    assert.equal(content, await readFile(path.join(bridge, source.slice(1)), 'utf8'));
  }
  added.push(source);
}
for (const config of preparation.preserved.filter(file => file.source !== 'published-source-map')) {
  assert.equal(sha(await readFile(path.join(bridge, config.path))), config.sha256, `Legacy build configuration changed: ${config.path}`);
}
const bytes = await readFile(path.join(exported, mapFile[0].slice(0, -4)));
const report = { checkedAt: new Date().toISOString(), passed: true, sourceUpdateId: preparation.sourceUpdateId,
  sourceLaunchSha256: preparation.sourceLaunchSha256, oldModules: old.size, newModules: next.size,
  unchangedModuleCount: unchanged.length, plannedChanges, added,
  nativeConfigurationAndLockUnchanged: true, bundleBytes: bytes.length, bundleSha256: sha(bytes),
  scope: 'Actual Hermes export with exact old module source comparison and reviewed bridge-only changes. Does not prove physical-device loading or APK installation.' };
await writeFile(path.join(evidence, `bridge-1.0.4-export-verification${suffix}.json`), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
