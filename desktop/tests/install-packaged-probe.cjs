"use strict";
const { _electron: electron } = require("@playwright/test");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");

(async () => {
  const [executablePath, out] = process.argv.slice(2);
  assert(executablePath && out, "installed executable and isolated report directory required");
  const profile = path.join(path.resolve(out), "profile");
  const report = { startedAt: new Date().toISOString(), checks: [], errors: [], boundaries: ["No account login or private data used", "Packaged application, not source Electron", "No lock-screen or multiple-monitor acceptance implied"] };
  let app;
  const check = (ok, name) => { assert(ok, name); report.checks.push(name); };
  try {
    app = await electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], timeout: 45000 });
    const page = await app.firstWindow();
    page.on("pageerror", error => report.errors.push(error.message));
    await page.waitForSelector("#login:not([hidden])", { timeout: 30000 });
    const visibleDeadline = Date.now() + 10000;
    while (Date.now() < visibleDeadline && !await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    report.runtime = await app.evaluate(({ app, BrowserWindow, safeStorage }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const prefs = win.webContents.getLastWebPreferences();
      return { packaged: app.isPackaged, version: app.getVersion(), executable: process.execPath, userData: app.getPath("userData"), visible: win.isVisible(), title: win.getTitle(), sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration, devToolsOpen: win.webContents.isDevToolsOpened(), encryptionAvailable: safeStorage.isEncryptionAvailable(), windows: BrowserWindow.getAllWindows().length };
    });
    check(report.runtime.packaged && report.runtime.version === "1.1.1", "real_installed_packaged_version_1_1_1");
    check(path.resolve(report.runtime.executable).toLowerCase() === path.resolve(executablePath).toLowerCase(), "process_executable_is_installed_binary");
    check(path.resolve(report.runtime.userData).toLowerCase() === profile.toLowerCase(), "user_data_is_isolated_from_existing_accounts");
    check(report.runtime.visible && report.runtime.windows === 1, "actual_visible_login_window_without_overlay");
    check(report.runtime.sandbox && report.runtime.contextIsolation && !report.runtime.nodeIntegration, "packaged_renderer_sandbox_and_context_isolation");
    check(report.runtime.encryptionAvailable, "windows_secure_storage_available");
    const state = await page.evaluate(async () => ({ nodeExposed: typeof window.require, tokenExposed: typeof window.petDesktop.access_token, state: await window.petDesktop.state(), invalid: await window.petDesktop.send({ id: "invalid", content: "synthetic invalid input" }) }));
    check(state.nodeExposed === "undefined" && state.tokenExposed === "undefined", "no_node_or_session_token_on_renderer_api");
    check(state.state.ok && !state.state.value.enabled && !state.state.value.signedIn, "new_install_starts_signed_out_and_pet_disabled");
    check(!state.invalid.ok, "malformed_ipc_request_rejected_without_login");
    await page.screenshot({ path: path.join(out, "installed-login.png") });
    check(report.errors.length === 0, "no_renderer_page_errors_during_installed_startup");
    // Closing the sole controls window when disabled must terminate the real app.
    await Promise.all([app.waitForEvent("close", { timeout: 15000 }), page.close()]);
    app = null;
    check(true, "disabled_installed_app_exits_when_controls_close");
    report.passed = true;
  } catch (error) {
    report.failure = error.message; process.exitCode = 1;
  } finally {
    if (app) await app.close().catch(() => {});
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(out, "packaged-startup.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: !!report.passed, checks: report.checks.length, failure: report.failure || null }));
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
