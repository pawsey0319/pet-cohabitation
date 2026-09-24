const { _electron: electron } = require("@playwright/test");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
(async () => {
  const output = path.resolve(__dirname, "../../test-results/desktop-electron-smoke"); await fs.mkdir(output, { recursive: true });
  const app = await electron.launch({ executablePath: require("electron"), args: [path.resolve(__dirname, ".."), "--smoke-test"], env: { ...process.env, PET_DESKTOP_TEST_DATA: path.join(output, `profile-${Date.now()}`) }, timeout: 45000 });
  try {
    const page = await app.firstWindow(); await page.waitForSelector("#login:not([hidden])");
    const info = await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0], prefs = window.webContents.getLastWebPreferences();
      return { visible: window.isVisible(), sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration };
    });
    assert.deepEqual(info, { visible: false, sandbox: true, contextIsolation: true, nodeIntegration: false });
    const result = await page.evaluate(async () => ({ nodeExposed: typeof window.require, token: typeof window.petDesktop.access_token, api: Object.keys(window.petDesktop), state: await window.petDesktop.state(), bad: await window.petDesktop.send({ id: "malformed", content: "hello" }) }));
    assert.equal(result.nodeExposed, "undefined"); assert.equal(result.token, "undefined");
    assert.equal(result.state.ok, true); assert.equal(result.state.value.enabled, false); assert.equal(result.state.value.signedIn, false); assert.equal(result.bad.ok, false);
    await fs.writeFile(path.join(output, "report.json"), JSON.stringify({ checks: info, privateRendererIsolation: true, malformedRequestRejected: true, defaultDisabled: true, liveChat: "not tested", windowsOverlay: "not visually accepted" }, null, 2));
    console.log("PASS: hidden Electron startup, renderer sandbox, disabled default, IPC rejection. Report saved; no visible-window acceptance claimed.");
  } finally { await app.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
