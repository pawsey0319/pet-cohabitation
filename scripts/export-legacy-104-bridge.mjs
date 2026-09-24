// Build the isolated bridge with only the already configured public preview env.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, copyFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = path.join(root, 'test-results/legacy-update-inventory');
const bridge = path.join(evidence, 'bridge-1.0.4');
const suffix = process.argv[2] === 'theme' ? '-theme' : '';
const cli = process.env.LEGACY_INVENTORY_EAS_CLI;
assert.ok(cli, 'Set LEGACY_INVENTORY_EAS_CLI to the existing eas-cli/bin/run');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const preparation = JSON.parse(await readFile(path.join(evidence, 'bridge-1.0.4-preparation.json'), 'utf8'));
for (const filename of ['AppUpdates.tsx', 'controller.ts', 'release.ts']) {
  const relative = `src/updates/${filename}`;
  await copyFile(path.join(root, relative), path.join(bridge, relative));
  const item = preparation.changes.find(change => change.path === relative);
  item.sha256 = hash(await readFile(path.join(root, relative)));
}
preparation.updaterSyncedAt = new Date().toISOString();
await writeFile(path.join(evidence, `bridge-1.0.4-preparation${suffix}.json`), JSON.stringify(preparation, null, 2) + '\n');
const listing = spawnSync(process.execPath, [cli, 'env:list', 'preview', '--format', 'short'], { cwd: bridge, encoding: 'utf8', windowsHide: true });
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
for (let attempt = 0; attempt < 3 && !verified; attempt += 1) {
  try {
    const response = await fetch(`${env.EXPO_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY }, signal: AbortSignal.timeout(15000),
    });
    verified = response.ok;
    await response.arrayBuffer();
  } catch { /* Retry public metadata probe without logging headers or credentials. */ }
}
assert.ok(verified, 'Preview Auth verification failed');
const result = spawnSync(process.execPath, [path.join(bridge, 'node_modules/expo/bin/cli'), 'export', '--platform', 'android', '--source-maps', '--output-dir', '.expo/bridge-export'], {
  cwd: bridge, env, windowsHide: true, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
});
await writeFile(path.join(evidence, `bridge-1.0.4-export${suffix}.log`), `${result.stdout ?? ''}\n${result.stderr ?? ''}`);
assert.equal(result.status, 0, 'Android export failed; see scoped export log');
console.log(JSON.stringify({ exported: true, runtime: '1.0.4', publicPreviewAuthVerified: true, dotenvDisabled: true, published: false }));
