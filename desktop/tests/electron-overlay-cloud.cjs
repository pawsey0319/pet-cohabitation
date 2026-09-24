// Explicit synthetic-account cloud + real Windows overlay acceptance.
// This test is not packaged. It reuses a reviewed synthetic asset and never
// bypasses the production transparent-image request/approval gate.
const { _electron: electron } = require('@playwright/test');
const { createClient } = require('@supabase/supabase-js');
const { randomUUID, createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const assert = require('node:assert/strict');
const run = promisify(execFile), root = path.resolve(__dirname, '../..');
const target = 'https://lthcucgggoevgcboouqw.supabase.co';
const out = path.join(root, `test-results/desktop-overlay-${randomUUID()}`);
const report = { startedAt: new Date().toISOString(), cloud: target, checks: [], screenshots: [], ok: false, cleanup: false,
  boundaries: { systemStartup: 'bootstrap intercepts the startup-setting write; no registry changes', model: 'one synthetic companion request, existing deployed model configuration', OSInput: 'Windows user32 synthesized mouse input; not human input', multiMonitorDpi: 'not tested', installation: 'unpackaged tested source; existing installer unchanged', lockScreen: 'not tested', visualScope: 'one previously reviewed synthetic rembg image; no universal quality claim' } };
let app, owner, password, service, client, profile, sourcePath;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const ok = result => { if (result.error) throw Error(result.error.message); return result.data; };
const check = (value, name) => { assert.ok(value, name); report.checks.push(name); console.log(name); };
async function persist() { await fs.mkdir(out, { recursive: true }); await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); }
async function waitFor(predicate, timeout = 20000) {
  const start = Date.now(); while (Date.now() - start < timeout) { const found = await predicate(); if (found) return found; await new Promise(resolve => setTimeout(resolve, 150)); }
  throw Error('condition_timed_out');
}
async function snapshot(page) { const value = await page.evaluate(() => window.petDesktop.state()); assert.equal(value.ok, true); return value.value; }
async function windows() { return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => ({ id: w.id, mode: new URL(w.webContents.getURL() || 'about:blank').searchParams.get('mode'), visible: w.isVisible(), bounds: w.getBounds(), alwaysOnTop: w.isAlwaysOnTop(), background: w.getBackgroundColor(), prefs: { transparent: w.webContents.getLastWebPreferences().transparent, sandbox: w.webContents.getLastWebPreferences().sandbox } }))); }
async function petPage() { return waitFor(async () => app.windows().find(p => p.url().includes('mode=pet'))); }
async function capture(mode, name) {
  const shot = await app.evaluate(async ({ BrowserWindow }, mode) => {
    const w = BrowserWindow.getAllWindows().find(w => new URL(w.webContents.getURL()).searchParams.get('mode') === mode);
    w.webContents.setBackgroundThrottling(false);
    await w.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const image = await w.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
    const pixels = image.toBitmap(); let transparent = 0, visible = 0;
    for (let n = 3; n < pixels.length; n += 4) { if (pixels[n] < 10) transparent++; if (pixels[n] > 220) visible++; }
    return { png: image.toPNG().toString('base64'), size: image.getSize(), transparent, visible, total: pixels.length / 4 };
  }, mode);
  await fs.writeFile(path.join(out, name), Buffer.from(shot.png, 'base64')); delete shot.png; report.screenshots.push(name); return shot;
}
async function pointer(action, from, to = from) {
  const handles = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => w.getNativeWindowHandle().readBigUInt64LE().toString()).join(','));
  const result = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'overlay-pointer.ps1'), '-Action', action, '-X', String(from.x), '-Y', String(from.y), '-ToX', String(to.x), '-ToY', String(to.y), '-AllowedWindowHandles', handles], { windowsHide: true, timeout: 15000 });
  return JSON.parse(result.stdout);
}
async function petPoint() {
  return app.evaluate(({ BrowserWindow, screen }) => {
    const pet = BrowserWindow.getAllWindows().find(w => new URL(w.webContents.getURL()).searchParams.get('mode') === 'pet');
    const b = pet.getBounds(); return screen.dipToScreenPoint({ x: Math.round(b.x + b.width * .5), y: Math.round(b.y + b.height * .62) });
  });
}
(async () => {
  assert.equal(process.platform, 'win32'); assert.equal(process.env.SUPABASE_URL, target);
  assert.ok(process.env.SUPABASE_SERVICE_ROLE_KEY); assert.ok(process.env.SUPABASE_ANON_KEY);
  const settings = { auth: { persistSession: false, autoRefreshToken: false } };
  service = createClient(target, process.env.SUPABASE_SERVICE_ROLE_KEY, settings); client = createClient(target, process.env.SUPABASE_ANON_KEY, settings);
  await fs.mkdir(out, { recursive: true });
  const source = await fs.readFile(path.join(root, 'test-results/avatar-live-20260914/avatar.jpg'));
  const reviewed = JSON.parse(await fs.readFile(path.join(root, 'test-results/mobile-feedback-20260914/transparency/manual-review.json'), 'utf8'));
  check(sha(source) === reviewed.source_sha256, 'source_matches_prior_synthetic_provenance');
  report.asset = { source: 'test-results/avatar-live-20260914/avatar.jpg', sourceSha256: sha(source), expectedTransparentSha256: reviewed.output_sha256, review: 'test-results/mobile-feedback-20260914/transparency/manual-review.json' };
  const email = `desktop-overlay-${randomUUID()}@example.test`; password = `Synthetic-${randomUUID()}-1!`;
  owner = ok(await service.auth.admin.createUser({ email, password, email_confirm: true })).user.id;
  report.fixtureAccount = owner; await persist();
  ok(await service.from('profiles').insert({ id: owner, email, nickname: '桌宠悬浮合成验收' }));
  ok(await client.auth.signInWithPassword({ email, password }));
  const pet = ok(await service.from('pets').insert({ owner_id: owner, name: '窗边小绒' }).select().single());
  const assetId = randomUUID(); sourcePath = `${owner}/${assetId}.jpg`;
  ok(await service.storage.from('pet-portraits').upload(sourcePath, source, { contentType: 'image/jpeg' }));
  ok(await service.from('pet_visual_assets').insert({ id: assetId, pet_id: pet.id, owner_id: owner, storage_path: sourcePath, prompt_hash: 'existing-synthetic-desktop-overlay-regression', is_draft: false }));
  ok(await service.from('pets').update({ status: 'confirmed', confirmed_at: new Date().toISOString(), current_asset_id: assetId }).eq('id', pet.id));
  const requested = ok(await client.functions.invoke('pet-display', { body: { action: 'request', pet_id: pet.id, request_id: randomUUID(), expected_version: 0 } }));
  report.transparentJob = requested.job.id; await persist();
  let display; const began = Date.now();
  while (Date.now() - began < 120000) {
    display = ok(await client.functions.invoke('pet-display', { body: { action: 'status', pet_id: pet.id } }));
    if (['succeeded', 'failed', 'cancelled'].includes(display.job?.status)) break;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  report.transparentWorker = { status: display.job?.status, elapsedMs: Date.now() - began };
  check(display.job?.status === 'succeeded' && display.job?.id === requested.job.id, 'normal_cloud_worker_completes_own_transparent_job');
  check(!display.url && !!display.candidate_url, 'transparent_candidate_not_applied_before_owner_approval');
  assert.equal(new URL(display.candidate_url).origin, target);
  const response = await fetch(display.candidate_url, { redirect: 'error', signal: AbortSignal.timeout(30000) }); assert.ok(response.ok);
  const bytes = Buffer.from(await response.arrayBuffer()); report.asset.actualTransparentSha256 = sha(bytes);
  check(sha(bytes) === reviewed.output_sha256, 'cloud_candidate_matches_visually_reviewed_transparent_bytes');
  ok(await client.functions.invoke('pet-display', { body: { action: 'approve', pet_id: pet.id, job_id: requested.job.id, source_asset_id: assetId, request_id: randomUUID(), expected_version: 0 } }));
  display = ok(await client.functions.invoke('pet-display', { body: { action: 'status', pet_id: pet.id } }));
  check(!!display.url && display.preference.approved_job_id === requested.job.id, 'synthetic_owner_explicitly_approves_current_asset');
  profile = path.join(out, `profile-${randomUUID()}`);
  const env = { ...process.env, PET_DESKTOP_TEST_DATA: profile };
  for (const key of ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_URL']) delete env[key];
  app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, 'interaction-bootstrap.cjs'), '--smoke-test'], env, timeout: 45000 });
  const controls = await app.firstWindow(); await controls.waitForSelector('#login:not([hidden])');
  await controls.locator('#email').fill(email); await controls.locator('#password').fill(password); await controls.locator('#login button').click();
  await controls.waitForSelector('#settings:not([hidden])', { timeout: 45000 });
  check(!(await snapshot(controls)).enabled && (await windows()).length === 1, 'approved_account_still_defaults_to_disabled');
  await controls.locator('#start').click();
  await waitFor(async () => (await windows()).find(w => w.mode === 'pet' && w.visible), 45000);
  let petWindow = (await windows()).find(w => w.mode === 'pet');
  report.nativePetWindow = petWindow;
  await persist();
  // getBackgroundColor returns RGB only. Assert real alpha from native capture below.
  check(petWindow.alwaysOnTop && petWindow.prefs.sandbox, 'actual_visible_pet_window_is_always_on_top_and_sandboxed');
  let page = await petPage();
  await page.waitForFunction(() => document.querySelector('canvas').getContext('2d').getImageData(256, 300, 1, 1).data[3] > 200);
  report.render = await capture('pet', '01-native-transparent-pet.png');
  check(report.render.transparent > report.render.total * .5 && report.render.visible > report.render.total * .05, 'native_capture_has_transparent_background_and_visible_pet_body');
  // A controlled local window beneath the pet proves native click-through,
  // without clicking or capturing another application or the user's desktop.
  const underneath = await app.evaluate(async ({ BrowserWindow, screen }) => {
    const overlay = BrowserWindow.getAllWindows().find(w => new URL(w.webContents.getURL() || 'about:blank').searchParams.get('mode') === 'pet');
    const bounds = overlay.getBounds();
    // Keep the tested corner inside the content area, away from native resize borders.
    const probe = new BrowserWindow({ ...bounds, x: bounds.x - 12, y: bounds.y - 12, width: bounds.width + 24, height: bounds.height + 24, frame: false, resizable: false, show: false, skipTaskbar: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    await probe.loadURL('data:text/html,<body style="margin:0;background:%23edf1ea"><script>window.clicks=0;window.events=[];["pointermove","pointerdown","pointerup","click"].forEach(t=>addEventListener(t,e=>{if(window.events.length<15)window.events.push({type:t,x:e.clientX,y:e.clientY});if(t==="click")window.clicks++}))</script>');
    probe.setAlwaysOnTop(true, 'normal');
    probe.show(); overlay.moveTop();
    await overlay.webContents.executeJavaScript('window.pointerProbe=[];["pointermove","pointerdown","pointerup","click"].forEach(t=>addEventListener(t,e=>{if(window.pointerProbe.length<15)window.pointerProbe.push({type:t,x:e.clientX,y:e.clientY})}))');
    return { id: probe.id, handle: probe.getNativeWindowHandle().readBigUInt64LE().toString(), overlayHandle: overlay.getNativeWindowHandle().readBigUInt64LE().toString(), point: screen.dipToScreenPoint({ x: bounds.x + 3, y: bounds.y + 3 }) };
  });
  try {
    report.pointerInput = await pointer('click', underneath.point);
    await new Promise(resolve => setTimeout(resolve, 700));
    report.pointerProbe = { ...underneath, overlayEvents: await page.evaluate(() => window.pointerProbe), underneath: await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).webContents.executeJavaScript('({clicks:window.clicks,events:window.events})'), underneath.id) };
    await persist();
    const clicks = await waitFor(() => app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).webContents.executeJavaScript('window.clicks'), underneath.id));
    check(clicks === 1 && !(await windows()).some(w => w.mode === 'chat'), 'transparent_corner_passes_native_click_to_controlled_underlying_window');
  } finally { await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.destroy(), underneath.id); }
  // Real OS mouse input exercises the pointer handlers and native window move.
  const before = petWindow.bounds, point = await petPoint();
  await pointer('drag', point, { x: point.x - 160, y: point.y - 70 });
  await waitFor(async () => { const b = (await windows()).find(w => w.mode === 'pet')?.bounds; return b && Math.abs(b.x - before.x) > 40; });
  const dragged = (await windows()).find(w => w.mode === 'pet').bounds; report.drag = { before, after: dragged };
  check(dragged.x < before.x - 40 && dragged.y < before.y, 'OS_mouse_drag_moves_real_overlay');
  await new Promise(resolve => setTimeout(resolve, 650));
  await controls.locator('#visibility').click();
  await waitFor(async () => !(await windows()).find(w => w.mode === 'pet').visible);
  check(!(await windows()).find(w => w.mode === 'pet').visible && (await snapshot(controls)).hidden, 'controls_hide_removes_overlay_from_desktop');
  await app.evaluate(() => { const item = global.__desktopInteraction.trayMenu.items.find(i => i.label === '显示桌宠'); if (!item?.enabled) throw Error('tray_show_unavailable'); item.click(); });
  await waitFor(async () => (await windows()).find(w => w.mode === 'pet')?.visible);
  check(!(await snapshot(controls)).hidden, 'actual_tray_menu_handler_restores_overlay');
  check((await windows()).find(w => w.mode === 'pet').alwaysOnTop, 'restored_pet_remains_always_on_top');
  await controls.locator('#stop').click(); await controls.locator('#start').click();
  await waitFor(async () => (await windows()).find(w => w.mode === 'pet' && w.visible), 45000);
  petWindow = (await windows()).find(w => w.mode === 'pet');
  report.restoredPetWindow = petWindow; await persist();
  check(petWindow.bounds.x === dragged.x && petWindow.bounds.y === dragged.y, 'stop_and_enable_restores_persisted_account_placement');
  page = await petPage(); await page.waitForFunction(() => document.querySelector('canvas').getContext('2d').getImageData(256, 300, 1, 1).data[3] > 200);
  await pointer('click', await petPoint());
  await waitFor(async () => (await windows()).find(w => w.mode === 'chat' && w.visible));
  const chat = await waitFor(async () => app.windows().find(p => p.url().includes('mode=chat')));
  check(new URL(chat.url()).protocol === 'file:' && (await windows()).find(w => w.mode === 'pet').visible, 'OS_pet_click_opens_independent_visible_local_mini_chat');
  check((await windows()).find(w => w.mode === 'chat').alwaysOnTop, 'mini_chat_remains_always_on_top');
  const text = '这是一条合成账号的桌宠小窗验收消息。请用一句简短中文回应，不查询其他资料，也不创建事项或记忆。';
  const sentAt = Date.now(); await chat.locator('#draft').fill(text); await chat.locator('#send').click();
  await waitFor(async () => { const s = await snapshot(chat); return s.lines.some(r => r.role === 'pet') || s.pending.some(r => r.state === 'failed'); }, 155000);
  const result = await snapshot(chat); report.model = { elapsedMs: Date.now() - sentAt, pending: result.pending.map(r => ({ state: r.state, error: r.error || null })), ownerLines: result.lines.filter(r => r.role === 'owner').length, petLines: result.lines.filter(r => r.role === 'pet').length, phase: result.phase, error: result.error };
  check(result.lines.filter(r => r.role === 'owner').length === 1 && result.lines.filter(r => r.role === 'pet').length === 1 && result.pending.length === 0, 'real_cloud_mini_chat_commits_exactly_one_owner_and_pet_message');
  check(await chat.locator('#draft').inputValue() === '', 'mini_chat_success_leaves_composer_empty');
  await capture('chat', '02-native-mini-chat.png');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => new URL(w.webContents.getURL()).searchParams.get('mode') === 'chat').close());
  await waitFor(async () => !(await windows()).some(w => w.mode === 'chat'));
  check(!(await windows()).some(w => w.mode === 'chat') && (await windows()).find(w => w.mode === 'pet').visible, 'native_chat_close_keeps_pet_visible');
  await pointer('click', await petPoint()); await waitFor(async () => (await windows()).find(w => w.mode === 'chat' && w.visible));
  await controls.locator('#visibility').click();
  await waitFor(async () => !(await windows()).some(w => w.mode === 'chat') && !(await windows()).find(w => w.mode === 'pet').visible);
  check(!(await windows()).some(w => w.mode === 'chat') && !(await windows()).find(w => w.mode === 'pet').visible, 'hide_also_closes_active_mini_chat');
  await controls.locator('#visibility').click(); await waitFor(async () => (await windows()).find(w => w.mode === 'pet')?.visible); await pointer('click', await petPoint()); await waitFor(async () => (await windows()).find(w => w.mode === 'chat' && w.visible));
  await controls.locator('#logout').click(); await controls.waitForSelector('#login:not([hidden])', { timeout: 45000 });
  check((await windows()).every(w => w.mode === 'controls') && !(await snapshot(controls)).signedIn, 'logout_removes_pet_and_mini_chat_windows');
  check(await app.evaluate(() => global.__desktopInteraction.startupWrites.length) === 1, 'test_does_not_write_system_startup_configuration');
  report.ok = true;
})().catch(async error => {
  process.exitCode = 1; report.error = String(error.message).slice(0, 500); console.error(report.error);
  if (app) {
    report.failureWindows = await windows().catch(() => []);
    const page = app.windows().find(p => p.url().includes('mode=pet'));
    if (page) report.failureRenderer = await page.evaluate(() => ({ hidden: document.hidden, alpha: document.querySelector('canvas').getContext('2d').getImageData(256,317,1,1).data[3], events: window.pointerProbe })).catch(() => null);
  }
}).finally(async () => {
  if (app) await app.close().catch(() => {});
  if (profile) { assert.equal(path.dirname(profile), out); assert.ok(path.basename(profile).startsWith('profile-')); await fs.rm(profile, { recursive: true, force: true }); }
  if (owner && client && service) {
    // Avoid anonymized test logs after account deletion sets owner_id to null.
    await service.from('pet_personality_states').update({ paused: true }).eq('owner_id', owner);
    await service.from('pet_learning_jobs').update({ status: 'cancelled', lease_token: null, lease_until: null }).eq('owner_id', owner).in('status', ['queued', 'running', 'failed']);
    const modelLogs = await service.from('model_runs').delete().eq('owner_id', owner);
    if (modelLogs.error) throw Error('synthetic_model_logs_cleanup_failed');
    const deleted = await client.functions.invoke('delete-account', { body: { password } });
    const profiles = await service.from('profiles').select('id').eq('id', owner), auth = await service.auth.admin.getUserById(owner);
    report.cleanup = !deleted.error && !profiles.error && profiles.data.length === 0 && auth.error?.status === 404;
    if (!report.cleanup) report.cleanupError = 'synthetic_delete_not_confirmed';
  } else report.cleanup = !owner;
  report.ok = report.ok && report.cleanup; if (!report.ok) process.exitCode = 1;
  report.finishedAt = new Date().toISOString(); await persist(); console.log(JSON.stringify(report, null, 2));
});
