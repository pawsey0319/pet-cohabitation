"use strict";
const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, screen, shell, safeStorage, powerMonitor } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createHash } = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");
const { DesktopCompanion } = require("./companion.cjs");
const { validate, clampBounds, validatePublicConfig } = require("./contracts.cjs");
const localPage = pathToFileURL(path.join(__dirname, "index.html")).href;
const smokeTest = !app.isPackaged && process.argv.includes("--smoke-test");
if (smokeTest && process.env.PET_DESKTOP_TEST_DATA) app.setPath("userData", process.env.PET_DESKTOP_TEST_DATA);
let controls, pet, chat, tray, companion, config, store, quitting = false, enabled = false, hidden = true, locked = false, image = null, size = 128, placement = null, placementTimer, statusError = null, startGeneration = 0;
const windows = new Set();
let logoutTask = null, waitingForLogout = false;

class EncryptedStore {
  constructor(root) { this.root = root; this.pending = Promise.resolve(); }
  file(key) { return path.join(this.root, `${createHash("sha256").update(key).digest("hex")}.bin`); }
  async getItem(key) {
    await this.pending.catch(() => {});
    try { const bytes = await fs.readFile(this.file(key)); if (!safeStorage.isEncryptionAvailable()) throw Error("系统安全存储不可用。"); return safeStorage.decryptString(bytes); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }
  setItem(key, value) {
    if (!safeStorage.isEncryptionAvailable()) return Promise.reject(Error("系统安全存储不可用，无法安全保存登录。"));
    const ciphertext = safeStorage.encryptString(value);
    const write = this.pending.catch(() => {}).then(async () => {
      await fs.mkdir(this.root, { recursive: true }); const filename = this.file(key);
      await fs.writeFile(`${filename}.tmp`, ciphertext, { mode: 0o600 }); await fs.rename(`${filename}.tmp`, filename);
    }); this.pending = write; return write;
  }
  removeItem(key) {
    const pending = this.pending.catch(() => {}).then(() => fs.rm(this.file(key), { force: true })); this.pending = pending; return pending;
  }
}

function snapshot() {
  return { ...companion?.snapshot(), enabled, hidden, locked, image: enabled ? image : null, size, error: statusError || companion?.error || null, platform: process.platform };
}
function publish() { for (const window of windows) if (!window.isDestroyed()) window.webContents.send("desktop-state", snapshot()); refreshTray(); }
function createWindow(mode, options = {}) {
  const window = new BrowserWindow({ width: 390, height: 570, show: false, backgroundColor: "#fafaf7", title: "异宠桌面伙伴", ...options,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, devTools: !app.isPackaged } });
  // Electron's Windows "floating" level reorders behind the taskbar HWND,
  // which can remove WS_EX_TOPMOST. Keep the normal topmost flag; bounds
  // already stay inside the display work area, clear of the taskbar.
  if (options.alwaysOnTop) window.setAlwaysOnTop(true, process.platform === "win32" ? "normal" : "floating");
  windows.add(window); window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_content, _permission, callback) => callback(false));
  window.on("closed", () => windows.delete(window));
  void window.loadFile(path.join(__dirname, "index.html"), { query: { mode } });
  window.webContents.on("did-finish-load", publish);
  return window;
}
function openControls() {
  if (!controls || controls.isDestroyed()) {
    controls = createWindow("controls");
    controls.on("close", event => { if (!quitting && enabled) { event.preventDefault(); controls.hide(); } });
    controls.once("ready-to-show", () => { if (!smokeTest) controls.show(); });
  } else { controls.show(); controls.focus(); }
}
function recreatePet() {
  if (pet && !pet.isDestroyed()) pet.destroy(); pet = null;
  if (!enabled || hidden || locked || !image) return;
  const bounds = clampBounds(placement, screen.getAllDisplays(), size);
  pet = createWindow("pet", { ...bounds, frame: false, transparent: true, backgroundColor: "#00000000", resizable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, focusable: false });
  pet.once("ready-to-show", () => { if (enabled && !hidden && !locked) pet?.showInactive(); });
  // Canvas dragging uses setBounds, which emits move rather than moved on Windows.
  pet.on("move", persistPlacement);
}
function persistPlacement() {
  if (!pet || pet.isDestroyed() || !companion.owner) return;
  const bounds = pet.getBounds(); placement = { x: bounds.x, y: bounds.y };
  const owner = companion.owner, saved = { ...placement, size };
  clearTimeout(placementTimer); placementTimer = setTimeout(() => {
    if (companion.owner === owner) void store.setItem(`placement:${owner}`, JSON.stringify(saved)).catch(() => {});
  }, 250);
}
function closeChat() { if (chat && !chat.isDestroyed()) chat.destroy(); chat = null; }
function hidePet() { hidden = true; pet?.hide(); closeChat(); publish(); }
function stopPet() { startGeneration++; enabled = false; hidden = true; image = null; pet?.destroy(); pet = null; closeChat(); publish(); }
function showPet() { if (!enabled) return; hidden = false; if (!locked) { if (pet && !pet.isDestroyed()) pet.showInactive(); else recreatePet(); } publish(); }
function openChat() {
  if (!companion.owner || locked || hidden || !enabled) return;
  if (chat && !chat.isDestroyed()) { chat.show(); chat.focus(); return; }
  const display = pet ? screen.getDisplayMatching(pet.getBounds()) : screen.getPrimaryDisplay();
  const area = display.workArea;
  chat = createWindow("chat", { width: Math.min(400, area.width), height: Math.min(540, area.height), x: Math.max(area.x, Math.min((pet?.getBounds().x || area.x) - 360, area.x + area.width - 400)), y: Math.max(area.y, Math.min(pet?.getBounds().y || area.y, area.y + area.height - 540)), alwaysOnTop: true });
  chat.once("ready-to-show", () => { if (!locked && !hidden) chat?.show(); });
  void companion.refresh().catch(error => { statusError = error.message; publish(); });
}
function petMenu() {
  Menu.buildFromTemplate([
    { label: "和异宠聊天", click: openChat }, { label: "隐藏桌宠", click: hidePet },
    { label: "缩小", enabled: size > 72, click: () => { size = Math.max(72, size - 20); persistPlacement(); recreatePet(); } },
    { label: "放大", enabled: size < 240, click: () => { size = Math.min(240, size + 20); persistPlacement(); recreatePet(); } },
    { label: "桌宠设置", click: openControls }, { label: "停止桌宠", click: stopPet },
  ]).popup({ window: pet });
}
async function enablePet() {
  statusError = null; const generation = ++startGeneration;
  const selected = await companion.loadPet();
  const response = await fetch(selected.imageUrl, { redirect: "error", signal: AbortSignal.timeout(25_000) });
  if (!response.ok || Number(response.headers.get("content-length") || 0) > 8 * 1024 * 1024) throw Error("透明形象下载失败。");
  const reader = response.body.getReader(); let total = 0; const chunks = [];
  try { for (;;) { const next = await reader.read(); if (next.done) break; total += next.value.length; if (total > 8 * 1024 * 1024) throw Error("透明形象文件过大。"); chunks.push(Buffer.from(next.value)); } }
  finally { await reader.cancel().catch(() => {}); }
  await companion.guard(selected.epoch, selected.owner); if (generation !== startGeneration) return;
  const asset = nativeImage.createFromBuffer(Buffer.concat(chunks));
  if (asset.isEmpty()) throw Error("透明形象无法读取。");
  const dimensions = asset.getSize(); if (dimensions.width > 4096 || dimensions.height > 4096) throw Error("形象尺寸过大。");
  const pixels = asset.resize({ width: 64, height: 64 }).toBitmap(); let transparent = 0, opaque = 0;
  for (let index = 3; index < pixels.length; index += 4) { if (pixels[index] < 10) transparent++; if (pixels[index] > 220) opaque++; }
  if (transparent < 10 || opaque < 10) throw Error("图片没有通过真实透明检查，请在 App 中重新确认本体。");
  const saved = await store.getItem(`placement:${companion.owner}`); await companion.guard(selected.epoch, selected.owner);
  if (generation !== startGeneration) return;
  try { placement = saved ? JSON.parse(saved) : null; } catch { placement = null; }
  size = Math.max(72, Math.min(240, Number(placement?.size) || 128));
  image = asset.toDataURL(); enabled = true; hidden = false; recreatePet(); publish(); void companion.drain();
}
function refreshTray() {
  if (!tray || tray.isDestroyed()) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "打开桌宠设置", click: openControls },
    { label: hidden ? "显示桌宠" : "隐藏桌宠", enabled, click: hidden ? showPet : hidePet },
    { label: "和异宠聊天", enabled: enabled && !hidden, click: openChat },
    { label: "停止桌宠", enabled, click: stopPet },
    { type: "separator" }, { label: "退出程序", click: () => { quitting = true; app.quit(); } },
  ]));
}
function verifySender(event) {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || !windows.has(window) || event.senderFrame !== window.webContents.mainFrame) throw Error("untrusted_window");
  const location = new URL(event.senderFrame.url); location.search = ""; location.hash = "";
  if (location.href !== localPage) throw Error("untrusted_origin");
  return window;
}
async function dispatch(event, method, body) {
  const source = verifySender(event); validate(method, body);
  // Only the controls window can receive login/password input or change account state.
  if (["login", "logout", "start"].includes(method) && source !== controls) throw Error("untrusted_surface");
  switch (method) {
    case "state": return snapshot();
    case "login": statusError = null; return companion.login(body.email, body.password);
    case "logout":
      stopPet();
      if(!logoutTask)logoutTask=companion.logout().finally(()=>{logoutTask=null;});
      await logoutTask;return snapshot();
    case "start": await enablePet(); return snapshot();
    case "hide": hidePet(); return snapshot();
    case "show": showPet(); return snapshot();
    case "stop": stopPet(); return snapshot();
    case "resize": size = Math.round(body.size); persistPlacement(); recreatePet(); publish(); return snapshot();
    case "openApp": await shell.openExternal(config.publicAppUrl); return { opened: true };
    case "send": return companion.send(body);
    case "retry": return companion.retry(body.id);
    case "stopReply": return companion.stopReply(body.id);
    case "chat": openChat(); return { opened: true };
    case "closeChat": closeChat(); return {};
    case "menu": if (source !== pet) throw Error("untrusted_surface"); petMenu(); return {};
    case "drag": if (source !== pet) throw Error("untrusted_surface"); pet.setBounds(clampBounds({ x: body.x, y: body.y }, screen.getAllDisplays(), size)); return {};
    case "hit": if (source !== pet) throw Error("untrusted_surface"); pet.setIgnoreMouseEvents(!body.opaque, { forward: true }); return {};
    default: throw Error("desktop_request_invalid");
  }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", openControls);
  app.on("window-all-closed", () => { if (!enabled) app.quit(); });
  app.on("before-quit", event => {
    quitting=true;
    if(logoutTask){
      event.preventDefault();
      if(!waitingForLogout){waitingForLogout=true;void logoutTask.catch(()=>{}).finally(()=>{waitingForLogout=false;app.quit();});}
      return;
    }
    clearTimeout(placementTimer);companion?.reset();
  });
  app.whenReady().then(async () => {
    // Login retention is allowed; enabling the pet is always a separate explicit action.
    app.setLoginItemSettings({ openAtLogin: false });
    config = JSON.parse(await fs.readFile(path.join(__dirname, "config.production.json"), "utf8"));
    validatePublicConfig(config);
    store = new EncryptedStore(path.join(app.getPath("userData"), "secure"));
    const client = createClient(config.supabaseUrl, config.publishableKey, { auth: { storage: store, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }, realtime: { params: { eventsPerSecond: 5 } } });
    companion = new DesktopCompanion(client, config, store); companion.on("state", publish); companion.on("account-cleared", stopPet);
    companion.on("asset-invalidated", () => { stopPet(); statusError = "形象或透明审批已更新，请确认后重新开启桌宠。"; publish(); });
    const icon = nativeImage.createFromPath(path.join(__dirname, "assets", "tray.png"));
    tray = new Tray(icon.isEmpty() ? nativeImage.createFromDataURL("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==") : icon); tray.setToolTip("异宠桌面伙伴"); tray.on("double-click", openControls);
    ipcMain.handle("desktop-pet", async (event, method, body) => {
      try { return { ok: true, value: await dispatch(event, method, body) }; }
      catch (error) { return { ok: false, error: String(error.message || "暂时未完成。").slice(0, 300) }; }
    });
    powerMonitor.on("lock-screen", () => { locked = true; pet?.hide(); closeChat(); publish(); });
    powerMonitor.on("unlock-screen", () => { locked = false; if (enabled && !hidden) recreatePet(); publish(); });
    powerMonitor.on("suspend", () => { locked = true; pet?.hide(); closeChat(); publish(); });
    // A suspended/locked computer must receive unlock-screen before showing private windows.
    powerMonitor.on("resume", () => { publish(); });
    for (const event of ["display-removed", "display-metrics-changed"]) screen.on(event, () => { if (enabled && !hidden) recreatePet(); });
    await companion.init().catch(error => { statusError = "无法恢复登录，请重新登录。"; });
    refreshTray(); openControls();
  }).catch(error => {
    // Configuration failures contain no auth payloads. Give the operator a actionable dialog.
    require("electron").dialog.showErrorBox("桌宠暂时无法启动", String(error.message).slice(0, 300)); app.quit();
  });
}
