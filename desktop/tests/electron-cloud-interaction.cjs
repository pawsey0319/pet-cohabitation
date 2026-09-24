// Explicit, synthetic-account cloud acceptance. Not included in npm test or builds.
const { _electron: electron } = require("@playwright/test");
const { createClient } = require("@supabase/supabase-js");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "../..");
const expectedUrl = "https://lthcucgggoevgcboouqw.supabase.co";
const output = path.join(root, "test-results/desktop-cloud-interaction");
const checks = [], shots = [];
const ok = result => { if (result.error) throw Error(result.error.message); return result.data; };
const check = (value, label) => { assert.ok(value, label); checks.push(label); };
let app, owner, service, profilePath;
async function launch(profile) {
  const env = { ...process.env, PET_DESKTOP_TEST_DATA: profile };
  for (const key of ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY", "SUPABASE_URL"]) delete env[key];
  const running = await electron.launch({ executablePath: require("electron"), args: [path.join(__dirname, "interaction-bootstrap.cjs"), "--smoke-test"], env, timeout: 45000 });
  const page = await running.firstWindow(); await page.waitForSelector("#controls:not([hidden])");
  return { running, page };
}
async function capture(page, name) {
  await app.evaluate(({BrowserWindow})=>{for(const window of BrowserWindow.getAllWindows())window.webContents.setBackgroundThrottling(false);});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const image = await app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(item => new URL(item.webContents.getURL()).searchParams.get("mode") === "controls");
    return (await window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString("base64");
  });
  const filename = path.join(output, name); await fs.writeFile(filename, Buffer.from(image, "base64")); shots.push(name);
}
async function state(page) { const result = await page.evaluate(() => window.petDesktop.state()); assert.equal(result.ok, true); return result.value; }
async function closeFromWindow() {
  const running = app, child = running.process();
  const closed = running.waitForEvent("close", { timeout: 20000 });
  await running.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.close()); }).catch(error => { if (!/closed|exited|destroyed/i.test(error.message)) throw error; });
  await closed;
  if (child.exitCode === null) await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error("electron_process_did_not_exit")), 10000); child.once("exit", () => { clearTimeout(timer); resolve(); }); });
  check(child.exitCode === 0, "closing-last-disabled-window-exits-process"); app = null;
}
(async () => {
  assert.equal(process.env.SUPABASE_URL, expectedUrl, "fixed_cloud_project_required");
  assert.ok(process.env.SUPABASE_SERVICE_ROLE_KEY, "admin_fixture_credential_required");
  const config = JSON.parse(await fs.readFile(path.join(root, "desktop/config.production.json"), "utf8"));
  assert.equal(config.supabaseUrl, expectedUrl, "application_and_fixture_project_must_match");
  service = createClient(expectedUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  await fs.mkdir(output, { recursive: true });
  const profile = path.join(output, `profile-${randomUUID()}`), email = `desktop-acceptance-${randomUUID()}@example.test`, password = `Test-${randomUUID()}-a1!`;
  profilePath=profile;
  owner = ok(await service.auth.admin.createUser({ email, password, email_confirm: true })).user.id;
  ok(await service.from("profiles").insert({ id: owner, email, nickname: "桌宠合成验收" }));
  let page; ({ running: app, page } = await launch(profile));
  await page.waitForSelector("#login:not([hidden])");
  const initial = await state(page);
  check(!initial.signedIn && !initial.enabled && initial.hidden, "fresh-profile-is-signed-out-and-pet-disabled");
  const isolation = await app.evaluate(({ BrowserWindow, safeStorage, app }) => {
    const window = BrowserWindow.getAllWindows()[0], prefs = window.webContents.getLastWebPreferences();
    return { hidden: !window.isVisible(), sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration, encryption: safeStorage.isEncryptionAvailable(), profile: app.getPath("userData"), startupWrites: global.__desktopInteraction.startupWrites.length };
  });
  check(isolation.hidden && isolation.sandbox && isolation.contextIsolation && !isolation.nodeIntegration && isolation.encryption && isolation.profile === profile, "actual-hidden-window-uses-sandbox-and-isolated-encrypted-profile");
  check(isolation.startupWrites === 1, "startup-setting-write-intercepted-without-changing-system");
  await page.locator("#email").fill(email); await page.locator("#password").fill(password); await page.locator("#login button").click();
  await page.waitForSelector("#settings:not([hidden])", { timeout: 45000 });
  await page.waitForFunction(() => document.getElementById("password").value === "");
  check((await state(page)).signedIn && !(await state(page)).enabled, "real-cloud-login-does-not-auto-enable-pet");
  check(await page.locator("#password").inputValue() === "", "successful-login-clears-password-input");
  await capture(page, "01-signed-in-disabled.png");
  const menu = await app.evaluate(() => global.__desktopInteraction.trayMenu.items.map(item => ({ label: item.label, enabled: item.enabled })));
  check(menu.find(item => item.label === "和异宠聊天")?.enabled === false && menu.find(item => item.label === "显示桌宠")?.enabled === false && menu.find(item => item.label === "退出程序")?.enabled, "real-tray-menu-disables-pet-actions-until-enabled");
  const rejected = await page.evaluate(async () => ({ send: await window.petDesktop.send({ id: "bad", content: "test" }), drag: await window.petDesktop.drag({ x: 0, y: 0 }), menu: await window.petDesktop.menu(), resize: await window.petDesktop.resize({ size: 1000 }), exposed: typeof window.require, token: typeof window.petDesktop.access_token }));
  check(!rejected.send.ok && !rejected.drag.ok && !rejected.menu.ok && !rejected.resize.ok && rejected.exposed === "undefined" && rejected.token === "undefined", "renderer-ipc-validates-payload-and-surface-without-node-or-token-api");
  const foreign = await app.evaluate(async ({ BrowserWindow }, files) => {
    const window = new BrowserWindow({ show: false, webPreferences: { preload: files.preload, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    await window.loadFile(files.html, { query: { mode: "controls" } });
    const result = await window.webContents.executeJavaScript("window.petDesktop.state()"); window.destroy(); return result;
  }, { preload: path.join(root, "desktop/preload.cjs"), html: path.join(root, "desktop/index.html") });
  check(!foreign.ok && foreign.error === "untrusted_window", "actual-unregistered-window-is-rejected-by-main-ipc");
  const blocked = await page.evaluate(() => window.petDesktop.start());
  check(!blocked.ok && !(await state(page)).enabled, "unconfirmed-synthetic-account-cannot-bypass-pet-asset-gate");
  await page.evaluate(async () => { await window.petDesktop.hide(); await window.petDesktop.show(); await window.petDesktop.chat(); });
  check(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length) === 1 && !(await state(page)).enabled, "disabled-pet-cannot-open-overlay-or-chat-window");
  await closeFromWindow();
  ({ running: app, page } = await launch(profile));
  await page.waitForSelector("#settings:not([hidden])", { timeout: 45000 });
  check((await state(page)).signedIn && !(await state(page)).enabled, "encrypted-login-restores-after-real-process-restart-with-pet-disabled");
  await page.locator("#logout").click(); await page.waitForSelector("#login:not([hidden])", { timeout: 45000 });
  const loggedOut = await state(page);
  check(!loggedOut.signedIn && !loggedOut.enabled && !loggedOut.lines.length && !loggedOut.pending.length, "real-logout-clears-account-conversation-and-pending-state");
  await capture(page, "02-signed-out.png");
  await closeFromWindow();
  ({ running: app, page } = await launch(profile));
  await page.waitForSelector("#login:not([hidden])", { timeout: 45000 });
  check(!(await state(page)).signedIn, "logout-persists-across-next-process-restart");
  await page.locator("#email").fill(email);await page.locator("#password").fill(password);await page.locator("#login button").click();
  await page.waitForSelector("#settings:not([hidden])",{timeout:45000});
  await app.evaluate(()=>{global.__desktopInteraction.logoutDelayMs=1200;});
  await page.locator("#logout").click();
  await page.waitForFunction(async()=>{const result=await window.petDesktop.state();return result.value.closing;});
  check((await state(page)).signedIn,"in-flight-logout-does-not-prematurely-declare-signed-out");
  await closeFromWindow();
  ({running:app,page}=await launch(profile));
  await page.waitForSelector("#login:not([hidden])",{timeout:45000});
  check(!(await state(page)).signedIn,"closing-during-real-delayed-logout-waits-for-durable-cleanup");
  await closeFromWindow();
  // Only this exact generated profile is removed, never a user's real app data.
  assert.equal(path.dirname(profile), output); assert.ok(path.basename(profile).startsWith("profile-"));
  await fs.rm(profile, { recursive: true, force: true });
})().catch(error => { process.exitCode = 1; checks.push(`FAILED: ${String(error.message).slice(0, 300)}`); }).finally(async () => {
  if (app) await app.close().catch(() => {});
  if(profilePath){assert.equal(path.dirname(profilePath),output);assert.ok(path.basename(profilePath).startsWith("profile-"));await fs.rm(profilePath,{recursive:true,force:true});}
  let cleanup = !owner;
  if (owner && service) { const deleted = await service.auth.admin.deleteUser(owner); cleanup = !deleted.error; if (!cleanup) process.exitCode = 1; }
  const report = { ok: !process.exitCode, cloud: expectedUrl, checks, screenshots: shots, syntheticAccountRemoved: cleanup,
    boundaries: { startupSettings: "intercepted; no registry/system startup validation", transparentPet: "not tested: no approved synthetic asset", visibleOverlayAndMiniChat: "not tested: asset gate intentionally preserved", tray: "real menu objects and enabled states, no visible OS tray clicks", hideRestore: "disabled-state gate only; active pet not tested", modelChat: "not tested: avoiding parallel model requests" } };
  await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
});
