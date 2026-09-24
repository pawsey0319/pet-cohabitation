// Diagnostic real-window probe, no account, cloud request or OS settings write.
const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
(async () => {
  const out = path.resolve(__dirname, '../../test-results/desktop-window-layer-probe');
  const profile = path.join(out, `profile-${Date.now()}`);
  await fs.mkdir(out, { recursive: true });
  const app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, 'interaction-bootstrap.cjs'), '--smoke-test'], env: { ...process.env, PET_DESKTOP_TEST_DATA: profile } });
  try {
    await (await app.firstWindow()).waitForSelector('#login:not([hidden])');
    const result = await app.evaluate(async ({ BrowserWindow }) => {
      const rows = [];
      for (const level of ['floating', 'normal', 'pop-up-menu']) {
        const w = new BrowserWindow({ width: 128, height: 128, show: false, frame: false, transparent: true, backgroundColor: '#00000000', resizable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, focusable: false, webPreferences: { sandbox: true } });
        w.setAlwaysOnTop(true, level);
        const row = { level, before: w.isAlwaysOnTop() };
        row.events = { move: 0, moved: 0 };
        w.on('move', () => row.events.move++); w.on('moved', () => row.events.moved++);
        await w.loadURL('data:text/html,<style>html,body{margin:0;background:transparent}div{margin:40px;width:48px;height:48px;background:green;border-radius:50%}</style><div></div>');
        w.showInactive();
        await new Promise(resolve => setTimeout(resolve, 300));
        row.shown = w.isAlwaysOnTop(); row.focused = w.isFocused(); row.visible = w.isVisible();
        w.hide(); w.showInactive();
        await new Promise(resolve => setTimeout(resolve, 300));
        row.restored = w.isAlwaysOnTop();
        const b = w.getBounds(); w.setBounds({ ...b, x: b.x - 40, y: b.y - 20 });
        await new Promise(resolve => setTimeout(resolve, 350));
        rows.push(row); w.destroy();
      }
      return rows;
    });
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally { await app.close(); await fs.rm(profile, { recursive: true, force: true }); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
