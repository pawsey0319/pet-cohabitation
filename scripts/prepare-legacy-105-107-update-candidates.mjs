// Prepare only. Candidates need a separate review and authorization before publish.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = path.join(root, 'test-results/legacy-update-inventory');
const commit = '88aaeb0b2937fbde84dda8aeb1addca409ce0195';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const archive = path.join(evidence, 'baseline-88aaeb0.tar');
const archived = spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'archive', '--format=tar', '--output', archive, commit], { cwd: root });
assert.equal(archived.status, 0);
const reports = [];
for (const [version, code] of [['1.0.5', 6], ['1.0.6', 7], ['1.0.7', 8]]) {
  const target = path.join(evidence, `candidate-${version}-lf`);
  try { await stat(target); throw new Error(`Candidate exists; refusing to overwrite ${version}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(target, { recursive: true });
  const extracted = spawnSync('tar', ['-xf', archive, '-C', target], { cwd: root });
  assert.equal(extracted.status, 0);
  const originalConfig = await readFile(path.join(target, 'app.json'));
  const config = JSON.parse(originalConfig);
  assert.equal(config.expo.version, '1.0.7');
  assert.equal(config.expo.runtimeVersion.policy, 'appVersion');
  config.expo.version = version;
  config.expo.android.versionCode = code;
  await writeFile(path.join(target, 'app.json'), JSON.stringify(config, null, 2) + '\n');
  const changes = [{ path: 'app.json', reason: 'Exact installed version/code; native settings unchanged', beforeSha256: sha(originalConfig), afterSha256: sha(await readFile(path.join(target, 'app.json'))) }];
  for (const name of ['AppUpdates.tsx', 'controller.ts', 'release.ts']) {
    const relative = `src/updates/${name}`;
    const bytes = await readFile(path.join(root, relative));
    await mkdir(path.join(target, 'src/updates'), { recursive: true });
    await writeFile(path.join(target, relative), bytes);
    changes.push({ path: relative, reason: 'Reviewed update module', afterSha256: sha(bytes) });
  }
  const layoutPath = 'app/_layout.tsx';
  const layout = await readFile(path.join(target, layoutPath), 'utf8');
  assert.ok(layout.includes('<NotificationBootstrap /><AppStack />'));
  const changedLayout = 'import { AppUpdateNotice } from "../src/updates/AppUpdates";\n' + layout.replace('<NotificationBootstrap /><AppStack />', '<NotificationBootstrap /><AppStack /><AppUpdateNotice />');
  await writeFile(path.join(target, layoutPath), changedLayout);
  changes.push({ path: layoutPath, reason: 'Only updater import and startup notice', beforeSha256: sha(layout), afterSha256: sha(changedLayout) });
  const mePath = 'app/(tabs)/me.tsx';
  const me = await readFile(path.join(target, mePath), 'utf8');
  assert.ok(me.includes('</KeyboardScrollView>') && me.includes('异宠 · 1.0.5'));
  const changedMe = 'import { AppUpdatePanel, installedApp } from "../../src/updates/AppUpdates";\n' + me
    .replace('</KeyboardScrollView>', '<AppUpdatePanel />\n</KeyboardScrollView>')
    .replace('异宠 · 1.0.5', '异宠 · {installedApp.version ?? "未识别"}');
  await writeFile(path.join(target, mePath), changedMe);
  changes.push({ path: mePath, reason: 'Only updater import/panel and installed-version footer', beforeSha256: sha(me), afterSha256: sha(changedMe) });
  const packageSha = sha(await readFile(path.join(target, 'package.json'))), lockSha = sha(await readFile(path.join(target, 'package-lock.json')));
  assert.equal(packageSha, '097eff4c81aedc453da59731100c7b2854bce2659656d0fa7201e28770fa1736');
  assert.equal(lockSha, '65e35b2129aa64ff859e6a12fe0e742a70fd68d2c18fd67f114f6d1035eca3fa');
  const report = { preparedAt: new Date().toISOString(), version, versionCode: code, runtime: version, sourceCommit: commit, target,
    packageSha256: packageSha, lockSha256: lockSha, changes, published: false,
    scope: 'Compatibility candidate from committed 1.0.7 business source. Native contract matched; legacy source proof and final review still required before publish.' };
  await writeFile(path.join(evidence, `candidate-${version}-preparation.json`), JSON.stringify(report, null, 2) + '\n');
  reports.push({ version, versionCode: code, target, changes: changes.length, published: false });
}
console.log(JSON.stringify(reports, null, 2));
