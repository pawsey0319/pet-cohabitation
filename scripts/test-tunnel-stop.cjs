// Exercise the real Windows stop script with isolated state and a harmless process.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

if (process.platform !== 'win32') {
  console.log('Windows-only tunnel stop test skipped.');
  process.exit(0);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-tunnel-stop-test-'));
const scriptDir = path.join(root, 'scripts');
const stateDir = path.join(root, 'supabase', '.temp');
fs.mkdirSync(scriptDir, { recursive: true });
fs.mkdirSync(stateDir, { recursive: true });
const script = path.join(scriptDir, 'stop-demo-model-tunnel.ps1');
fs.copyFileSync(path.join(__dirname, 'stop-demo-model-tunnel.ps1'), script);
const stateFile = path.join(stateDir, 'model-tunnel.json');
const harmless = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
  windowsHide: true, stdio: 'ignore',
});
const run = (shell = 'powershell.exe') => spawnSync(shell, [
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
], { encoding: 'utf8', windowsHide: true, timeout: 10000 });

try {
  const empty = run();
  assert.equal(empty.status, 0, 'No state should be a safe no-op');
  // An old/reused PID must never kill an unrelated live process.
  fs.writeFileSync(stateFile, JSON.stringify({
    process_id: harmless.pid, process_started_at: '2000-01-01T00:00:00.0000000Z',
  }));
  const refused = run();
  assert.notEqual(refused.status, 0, 'Mismatched process identity must be rejected');
  assert.ok(fs.existsSync(stateFile), 'Rejected state must remain for diagnosis');
  assert.doesNotThrow(() => process.kill(harmless.pid, 0), 'Unrelated process must survive');
  // A harmless local fixture named cloudflared also covers the allowed path,
  // including PS 7's automatic JSON date parsing (PS 5 returns a string).
  const fixtureExecutable = path.join(root, 'cloudflared.exe');
  fs.copyFileSync(process.execPath, fixtureExecutable);
  for (const shell of ['powershell.exe', 'pwsh.exe']) {
    const available = spawnSync(shell, ['-NoProfile', '-Command', 'exit 0'], { windowsHide: true });
    if (available.error?.code === 'ENOENT') continue;
    const fixture = spawn(fixtureExecutable, ['-e', 'setInterval(() => {}, 1000)'], {
      windowsHide: true, stdio: 'ignore',
    });
    try {
      const stamp = spawnSync(shell, ['-NoProfile', '-Command',
        `(Get-Process -Id ${fixture.pid}).StartTime.ToUniversalTime().ToString('o')`,
      ], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
      assert.equal(stamp.status, 0);
      fs.writeFileSync(stateFile, JSON.stringify({
        process_id: fixture.pid, process_started_at: stamp.stdout.trim(),
      }));
      const stopped = run(shell);
      assert.equal(stopped.status, 0, `${shell}: matching tunnel should stop: ${stopped.stderr}`);
      assert.equal(fs.existsSync(stateFile), false, `${shell}: stopped state should be removed`);
    } finally { fixture.kill(); }
  }
  console.log('PASS: no-state no-op; reused PID protection; matched stop on Windows PowerShell and available PowerShell 7.');
} finally {
  harmless.kill();
  // Only remove this test's explicitly created temporary directory.
  if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('pet-tunnel-stop-test-')) {
    throw new Error('Unsafe test cleanup target');
  }
  fs.rmSync(root, { recursive: true });
}
