// Reuse existing rolled-back SQL contracts with the existing WSL fixture.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
assert.equal(process.platform, 'win32', 'This adapter targets the existing Windows/WSL fixture');
const output = path.resolve('test-results', `next-release-sql-${Date.now()}`);
await mkdir(output);
const report = { scope: 'Existing isolated PostgreSQL fixture; synthetic transactions rolled back; no real model/device checks', results: [] };
for (const name of ['test-memory-evolution-sql.mjs', 'test-semantic-search-sql.mjs', 'test-reminder-sql.mjs']) {
  const original = await readFile(path.join('scripts', name), 'utf8');
  const before = 'import { spawnSync } from "node:child_process";';
  assert.ok(original.includes(before) && original.includes('rollback;') && original.includes('supabase_db_android-companion-validation'));
  const shim = `import { spawnSync as spawn } from "node:child_process";
const spawnSync = (binary, args, options) => {
  if (binary !== "docker") throw new Error("Only the existing fixture Docker commands are permitted");
  return spawn("wsl.exe", ["-d", "Ubuntu", "-u", "root", "--", "env", "DOCKER_HOST=unix:///var/run/docker.sock", "docker", ...args], { ...options, timeout: 60000, windowsHide: true });
};`;
  const adapted = path.join(output, name);
  await writeFile(adapted, original.replace(before, shim));
  const result = spawnSync(process.execPath, [adapted], { cwd: process.cwd(), env: { ...process.env, SUPABASE_TEST_DB_CONTAINER: 'supabase_db_android-companion-validation' }, encoding: 'utf8', windowsHide: true, timeout: 180000 });
  await writeFile(path.join(output, `${name}.log`), (result.stdout ?? '') + (result.stderr ?? ''));
  report.results.push({ name, source_sha256: createHash('sha256').update(original).digest('hex'), exitCode: result.status, passed: result.status === 0 });
  if (result.status !== 0) process.exitCode = 1;
  console.log(JSON.stringify({ name, passed: result.status === 0, output: result.stdout?.trim(), error: result.status === 0 ? null : result.stderr?.slice(-1500) }));
}
await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output, passed: report.results.every(row => row.passed) }));
