/** Deployed UI acceptance using two new synthetic accounts and one new group only.
 * No persistent browser profile, traces, HARs, tokens, passwords or email screenshots.
 * Requires process SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY and an explicit build gate.
 */
import { chromium, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const project = 'lthcucgggoevgcboouqw', api = `https://${project}.supabase.co`;
const base = 'https://pet-cohabitation-public.vercel.app';
const expectedBundle = process.env.PUBLIC_UI_EXPECTED_BUNDLE;
if (process.argv.slice(2).join(' ') !== '--cloud --deployment-ready' || !/^index-[a-f0-9]{32}\.js$/.test(expectedBundle ?? '')) throw new Error('explicit_deployment_build_gate_required');
if (process.env.SUPABASE_URL !== api || !process.env.SUPABASE_ANON_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('expected_project_process_credentials_required');
const run = randomUUID(), out = resolve(`test-results/public-next-version-browser-${run}`);
await mkdir(out, { recursive: true });
const users = [], spaces = [], files = [], checks = [], metrics = [], cleanup = [], pageErrors = [], blockedModels = [], preventedHealthChecks = [], modelAudits = [];
let browser, context, page, currentStage = 'deployment_version', failure = null, spaceId, releaseSend = () => {}, releaseAvatars = () => {};
let holdSend = false, holdAvatars = false, delayPetReads = false, delayedPetReads = 0;
const safeCode = value => typeof value === 'string' && /^[A-Za-z0-9_:-]{1,100}$/.test(value) ? value : 'request_failed';
const check = (value, name) => { if (!value) throw new Error(name); checks.push(name); };
const ok = (result, name) => { if (result.error) throw new Error(`${name}:${safeCode(result.error.code)}`); return result.data; };
const guardedFetch = (input, init = {}) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin !== api) throw new Error('unexpected_api_destination');
  const timeout = AbortSignal.timeout(45_000);
  return fetch(input, { ...init, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
};
const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: guardedFetch } };
const service = createClient(api, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const resources = () => writeFile(resolve(out, 'resources.json'), JSON.stringify({ project, run, users: users.map(user => user.id), spaces, files }, null, 2));
async function account(label) {
  const email = `public-ui-${run}-${label}@example.test`, password = `Synthetic-Aa1!${randomUUID()}`;
  const id = ok(await service.auth.admin.createUser({ email, password, email_confirm: true }), 'create_synthetic_account').user.id;
  const user = { id, email, password, nickname: `云端界面验收${label}`, client: createClient(api, process.env.SUPABASE_ANON_KEY, options) };
  users.push(user); await resources();
  ok(await service.from('profiles').insert({ id, email, nickname: user.nickname }), 'create_synthetic_profile');
  ok(await user.client.auth.signInWithPassword({ email, password }), 'login_synthetic_client'); return user;
}
async function upload(bucket, owner, bytes) {
  const path = `${owner}/${randomUUID()}.png`; files.push({ bucket, path }); await resources();
  ok(await service.storage.from(bucket).upload(path, bytes, { contentType: 'image/png', upsert: false }), 'upload_synthetic_brand_asset'); return path;
}
async function publishAvatar(user, bytes) {
  const id = randomUUID(), storage_path = await upload('avatars', user.id, bytes);
  ok(await service.from('avatar_assets').insert({ id, owner_id: user.id, storage_path, source: 'upload', content_sha256: createHash('sha256').update(bytes).digest('hex') }), 'insert_synthetic_avatar');
  ok(await service.rpc('apply_avatar', { p_owner_id: user.id, p_request_id: randomUUID(), p_target_kind: 'profile', p_target_id: user.id, p_asset_id: id, p_expected_version: 0 }), 'publish_synthetic_avatar');
}
async function shot(name) {
  const masks = [page.locator('input[type="password"]'), page.getByLabel('邮箱', { exact: true }), ...users.map(user => page.getByText(user.email, { exact: true }))];
  await page.screenshot({ path: resolve(out, `${name}.png`), mask: masks });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}_no_horizontal_overflow`);
}
async function login(user) {
  await page.goto(`${base}/login`); await page.getByLabel('邮箱', { exact: true }).fill(user.email); await page.getByLabel('密码', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: '登录', exact: true }).click(); await expect(page).toHaveURL(/\/pet(?:[?#]|$)/, { timeout: 35_000 });
}
async function readyCompanion() {
  await expect(page.getByLabel('异宠私聊输入')).toBeVisible({ timeout: 35_000 });
  await expect(page.getByText('云端验收小陶', { exact: true }).filter({visible:true})).toBeVisible();
  await expect(page.getByText('正在加载当前账号的异宠…', { exact: true })).toHaveCount(0);
}
async function verifyCompanionContrast(dark) {
  const value = await page.getByLabel('异宠私聊输入').evaluate(input => {
    const rgb = color => color.match(/[\d.]+/g)?.map(Number) ?? [];
    let parent = input, background;
    while (parent) {
      const color = getComputedStyle(parent).backgroundColor, parts = rgb(color);
      if (parts.length >= 3 && (parts.length < 4 || parts[3] >= .99)) { background = color; break; }
      parent = parent.parentElement;
    }
    const lum = color => rgb(color).slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const foreground = getComputedStyle(input).color, a = lum(foreground), b = lum(background);
    return { foreground, background, background_luminance: b, contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
  });
  check(value.background && (dark ? value.background_luminance < .15 : value.background_luminance > .5) && value.contrast >= 4.5, `${dark ? 'dark' : 'light'}_ready_companion_input_contrast`);
  metrics.push({ name: `${dark ? 'dark' : 'light'}_companion_colors`, ...value });
}
const tab = name => page.getByRole('tab', { name, exact: true }).click();
const groupName = `云端界面测试群-${run.slice(0, 8)}`;
const listRow = () => page.getByText(groupName, { exact: true }).locator('..').locator('..').locator('..');
const unreadBadge = () => listRow().getByText(/^(?:[1-9]\d*|99\+)$/, { exact: true });
const state = async user => ok(await user.client.rpc('list_my_spaces_v3'), 'read_synthetic_space_state').find(space => space.id === spaceId);
const send = async (user, text) => ok(await user.client.rpc('send_space_message_v2', { message_client_id: randomUUID(), target_space_id: spaceId, message_kind: 'text', message_text: text }), 'send_synthetic_ordinary_message');
async function avatarHashes() {
  return page.getByLabel(`${groupName}的成员头像拼图`, { exact: true }).filter({ visible: true }).evaluate(async element => {
    const images = [...element.querySelectorAll('img')];
    if (images.length !== 2 || images.some(image => !image.complete || image.naturalWidth === 0)) return [];
    return Promise.all(images.map(async image => {
      const bytes = await (await fetch(image.currentSrc || image.src)).arrayBuffer();
      return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
    })).then(values => values.sort());
  });
}
async function retryCleanup(name, operation) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { const result = await operation(); if (!result.error) { cleanup.push({ name, success: true }); return; } } catch { /* Never log credential-bearing request details. */ }
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
  }
  cleanup.push({ name, success: false });
}
async function auditSyntheticModelActivity(stage) {
  if (!users.length) return;
  const ownerIds = users.map(user => user.id);
  const rows = ok(await service.from('model_runs').select('id,run_kind,status').in('owner_id', ownerIds), 'synthetic_model_run_check');
  if (spaces.length) rows.push(...ok(await service.from('model_runs').select('id,run_kind,status').in('space_id', spaces), 'synthetic_group_model_run_check'));
  const runs = [...new Map(rows.map(row => [row.id, row])).values()];
  const jobs = ok(await service.from('pet_learning_jobs').select('kind,source_kind,status').in('owner_id', ownerIds), 'synthetic_learning_job_check');
  const countBy = (values, key) => values.reduce((counts, value) => { counts[key(value)] = (counts[key(value)] ?? 0) + 1; return counts; }, {});
  const result = { stage, model_run_count: runs.length, run_kinds: countBy(runs, row => row.run_kind), run_statuses: countBy(runs, row => row.status), learning_job_count: jobs.length, learning_jobs: countBy(jobs, row => `${row.kind}:${row.source_kind}:${row.status}`) };
  modelAudits.push(result); return result;
}

try {
  // No accounts or other side effects until the public domain serves the announced bundle.
  const html = await (await fetch(base, { cache: 'no-store', signal: AbortSignal.timeout(30_000) })).text();
  check(html.includes(expectedBundle), 'fixed_public_domain_serves_announced_bundle');
  currentStage = 'synthetic_setup';
  const a = await account('A'), b = await account('B');
  const icon = await readFile('assets/brand/icon.png'), foreground = await readFile('assets/brand/adaptive-foreground.png');
  const hashes = [icon, foreground].map(bytes => createHash('sha256').update(bytes).digest('hex')).sort();
  await publishAvatar(a, icon); await publishAvatar(b, foreground);
  const pet = ok(await service.from('pets').insert({ owner_id: a.id, name: '云端验收小陶', seed_summary: '用于界面验收的合成异宠' }).select('id').single(), 'create_synthetic_pet');
  const storage_path = await upload('pet-portraits', a.id, icon);
  const asset = ok(await service.from('pet_visual_assets').insert({ pet_id: pet.id, owner_id: a.id, storage_path, is_draft: false, prompt_hash: 'synthetic-public-ui-no-model' }).select('id').single(), 'insert_published_synthetic_pet_asset');
  ok(await service.from('pets').update({ current_asset_id: asset.id, status: 'confirmed', confirmed_at: new Date().toISOString() }).eq('id', pet.id).eq('owner_id', a.id), 'confirm_synthetic_pet');
  spaceId = ok(await a.client.rpc('create_relationship_space', { space_name: groupName, space_kind: 'friend_circle' }), 'create_synthetic_group'); spaces.push(spaceId); await resources();
  ok(await service.from('space_members').insert({ space_id: spaceId, user_id: b.id, role: 'member' }), 'join_synthetic_peer');
  ok(await service.from('space_pet_permissions').upsert({ space_id: spaceId, pet_id: pet.id, owner_id: a.id, participation_enabled: false }), 'disable_synthetic_pet_participation');
  await send(b, '合成旧消息甲'); await send(b, '合成旧消息乙');
  await auditSyntheticModelActivity('before_browser');

  browser = await chromium.launch(); context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 }); page = await context.newPage(); page.setDefaultTimeout(18_000);
  page.on('pageerror', error => pageErrors.push({ name: error.name, stage: currentStage }));
  let sendGate, avatarGate;
  const forbiddenFunctions = new Set(['pet-chat', 'generate-pet-candidate', 'generate-chat-background', 'evolve-pet', 'evaluate-pet-growth', 'space-agent', 'semantic-search', 'retry-pet-memory', 'pet-transparent-worker', 'dispatch-space-messages', 'purge-demo-data', 'image-maintenance', 'evolution-sweep', 'send-push-notifications']);
  await context.route(`${api}/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname, name = path.startsWith('/functions/v1/') ? path.split('/')[3] : null;
    let body; try { body = request.postDataJSON(); } catch { /* GET and binary uploads have no JSON body. */ }
    // model-health is NOT read-only: it reserves text_health_check and generates
    // a fixed JSON probe. The account page invokes it automatically on mount.
    // Do not permit a real model call just to verify navigation and chat delivery.
    if (name === 'model-health') {
      if (request.method() === 'POST') preventedHealthChecks.push({ function: name, stage: currentStage, expected_run_kind_from_source: 'text_health_check', server_invoked: false });
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"synthetic_ui_health_generation_disabled"}' }); return;
    }
    const readOnlyCapabilities = name === 'generate-chat-background' && body?.action === 'capabilities';
    if (forbiddenFunctions.has(name) && !readOnlyCapabilities || name === 'avatar-assets' && ['generate', 'upload', 'apply'].includes(body?.action)) {
      blockedModels.push({ function: name, stage: currentStage }); await route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"synthetic_ui_model_calls_disabled"}' }); return;
    }
    if (holdSend && path === '/rest/v1/rpc/send_space_message_v2' && request.method() === 'POST') await sendGate;
    if (holdAvatars && name === 'avatar-assets' && ['read_batch', 'space_state', 'read'].includes(body?.action)) await avatarGate;
    if (delayPetReads && (path.startsWith('/rest/v1/pet') || path.startsWith('/rest/v1/rpc/get_pet') || path.startsWith('/rest/v1/rpc/get_companion') || name === 'pet-personality')) {
      delayedPetReads++; await new Promise(resolve => setTimeout(resolve, 2000));
    }
    await route.continue();
  });
  currentStage = 'login_module_boundaries'; await login(a); await readyCompanion(); await verifyCompanionContrast(false);
  for (const name of ['消息', '异宠', '事项', '我的', '陪伴', '记忆', '成长', '桌宠']) await expect(page.getByRole('tab', { name, exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: '消息管家', exact: true })).toHaveCount(0); check(true, 'default_companion_and_canonical_module_tabs'); await shot('01-companion-390-light');
  await expect(page.getByTestId('pet-position-stage')).toHaveCount(0);
  await tab('记忆'); await expect(page).toHaveURL(/section=memory/); await expect(page.getByText('你主动保存的记忆', { exact: true })).toBeVisible();
  await tab('成长'); await expect(page).toHaveURL(/section=growth/); await expect(page.getByText('性格变化', { exact: true })).toBeVisible();
  await tab('桌宠'); await expect(page.getByRole('tab', {name:'桌宠',exact:true})).toHaveAttribute('aria-selected','true');
  await tab('陪伴'); await readyCompanion(); await page.getByLabel('异宠私聊输入').fill('慢网络切换仍保留的草稿');
  delayPetReads = true;
  ok(await service.from('pets').update({ name: '云端验收小陶' }).eq('id', pet.id), 'invalidate_only_synthetic_pet_cache');
  const switchTimes = [];
  for (let round = 0; round < 20; round++) for (const label of ['记忆','成长','桌宠','陪伴']) {
    const start = performance.now(); await tab(label);
    await expect(page.getByRole('tab',{name:label,exact:true})).toHaveAttribute('aria-selected','true');
    if (label === '陪伴') await expect(page.getByLabel('异宠私聊输入')).toHaveValue('慢网络切换仍保留的草稿');
    switchTimes.push(Math.round(performance.now()-start));
  }
  delayPetReads = false; switchTimes.sort((x,y)=>x-y);
  check(delayedPetReads > 0, 'two_second_network_delay_was_exercised');
  check(switchTimes[Math.floor(switchTimes.length*.95)] < 1000, 'warm_workspace_switches_do_not_wait_for_two_second_requests');
  metrics.push({name:'warm_workspace_20_rounds_with_2s_network_delay',switches:switchTimes.length,p95_ms:switchTimes[Math.floor(switchTimes.length*.95)],delayed_requests:delayedPetReads,note:'Real cloud data, browser automation timing; native 200 ms target still requires phone measurement.'});
  check(true,'workspace_draft_preserved_across_20_rounds'); await shot('01b-workspace-after-delayed-switches');
  await page.goto(`${base}/pet-capabilities`); await expect(page.getByText('能力与授权',{exact:true})).toBeVisible();
  await expect(page.getByText('能力执行正在完成发布验证，当前授权不会提前触发操作。',{exact:true})).toHaveCount(0);
  await page.getByLabel('查找能力').fill('创建目标'); await expect(page.getByRole('button',{name:'授权具体范围',exact:true})).toBeEnabled({timeout:30000});
  await page.getByRole('button',{name:'授权具体范围',exact:true}).click();
  await expect(page.getByText('授权：创建目标、阶段或任务',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'确认授权，范围内直接执行',exact:true}).click();
  await expect(page.getByRole('button',{name:'撤销此授权',exact:true})).toBeVisible({timeout:20000});
  await page.getByRole('button',{name:'撤销此授权',exact:true}).click();
  await expect(page.getByRole('button',{name:'撤销此授权',exact:true})).toHaveCount(0,{timeout:20000});
  check(true,'real_owner_can_grant_and_revoke_from_deployed_capability_ui'); await shot('01c-capability-grant-revoked');
  await page.goto(`${base}/pet?section=companion`); await readyCompanion();
  await page.goto(`${base}/items`); await expect(page.getByRole('button', { name: '新建', exact: true })).toBeVisible(); await shot('02-items-canonical');
  await tab('我的'); await expect(page.getByText('外观与显示', { exact: true })).toBeVisible(); await expect(page.getByText('回应偏好', { exact: true })).toHaveCount(0); await shot('03-me-credentials-masked');
  await auditSyntheticModelActivity('after_account_page_mount');
  check(true, 'memory_growth_items_and_account_have_separate_entries');
  await page.getByText('应用更新', { exact: true }).click();
  await page.getByRole('button', { name: '检查更新', exact: true }).click();
  await expect(page.getByText('请在安卓 App 内检查更新；网页版刷新即可使用云端版本。', { exact: true })).toBeVisible();
  check(true, 'update_settings_opens_and_web_does_not_claim_native_install');
  await shot('03b-app-update-entry');
  await page.getByRole('button', { name: '返回设置', exact: true }).click();

  currentStage = 'initial_unread_and_avatar'; await tab('消息'); await expect(page.getByText(groupName, { exact: true })).toBeVisible(); await expect(unreadBadge()).toHaveText('2');
  await listRow().click(); await expect(page.getByLabel('消息内容')).toBeVisible(); await expect(page.getByRole('button', { name: '消息：合成旧消息乙', exact: true })).toBeVisible();
  await expect.poll(avatarHashes, { timeout: 25_000 }).toEqual(hashes); check(true, 'published_member_avatar_bytes_match_both_synthetic_accounts');
  await expect.poll(async () => (await state(a)).unread_count, { timeout: 20_000 }).toBe(0); await shot('04-group-read-avatars');

  currentStage = 'optimistic_send_and_ack';
  holdSend = true; sendGate = new Promise(resolve => { releaseSend = resolve; });
  const typed = '合成前端发送回执验证', newDraft = '这是发送期间继续输入的合成草稿';
  await page.getByLabel('消息内容').fill(typed); const started = performance.now(); await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('button', { name: `消息：${typed}`, exact: true })).toBeVisible({ timeout: 1000 });
  metrics.push({ name: 'local_echo_ms', value: Math.round(performance.now() - started), note: 'Outbound receipt RPC intentionally held until local echo; Playwright interaction overhead included.' });
  await expect(page.getByText('发送中', { exact: true })).toBeVisible(); await page.getByLabel('消息内容').fill(newDraft);
  const response = page.waitForResponse(value => new URL(value.url()).pathname === '/rest/v1/rpc/send_space_message_v2' && value.request().method() === 'POST' && value.status() === 200);
  const releasedAt = performance.now(); holdSend = false; releaseSend(); await response;
  await expect(page.getByText('发送中', { exact: true })).toHaveCount(0); await expect(page.getByLabel('消息内容')).toHaveValue(newDraft);
  metrics.push({ name: 'ack_after_gate_release_ms', value: Math.round(performance.now() - releasedAt) });
  const sentRows = ok(await service.from('messages').select('id').eq('space_id', spaceId).eq('sender_id', a.id).eq('text', typed), 'verify_only_synthetic_receipt'); check(sentRows.length === 1, 'server_ack_clears_pending_once_without_duplicate_or_draft_loss');
  await expect(page.getByText('等待异宠处理', { exact: true })).toHaveCount(0); await shot('05-send-ack-current-draft');

  currentStage = 'read_exit_new_unread_and_cached_avatar';
  await page.getByLabel('返回会话列表').click(); await expect(page.getByText(groupName, { exact: true })).toBeVisible(); await expect(unreadBadge()).toHaveCount(0); check(true, 'leaving_read_group_has_no_old_badge');
  await send(b, '退出后到达的合成新消息'); await expect(unreadBadge()).toHaveText('1', { timeout: 25_000 }); check((await state(a)).unread_count === 1, 'new_message_preserves_real_unread_badge'); await shot('06-new-arrival-unread');
  holdAvatars = true; avatarGate = new Promise(resolve => { releaseAvatars = resolve; });
  const reenterAt = performance.now(); await listRow().click(); await expect(page.getByLabel('消息内容')).toBeVisible();
  await expect.poll(avatarHashes, { timeout: 1500 }).toEqual(hashes); metrics.push({ name: 'cached_avatar_reentry_ms', value: Math.round(performance.now() - reenterAt), note: 'Avatar HTTP revalidation intentionally held; unchanged published image bytes are visible from process cache.' });
  holdAvatars = false; releaseAvatars(); check(true, 'group_reentry_restores_correct_avatars_before_refresh');
  await expect(page.getByRole('button', { name: '消息：退出后到达的合成新消息', exact: true })).toBeVisible(); await expect.poll(async () => (await state(a)).unread_count, { timeout: 20_000 }).toBe(0);
  await page.getByLabel('返回会话列表').click(); await expect(unreadBadge()).toHaveCount(0); check(true, 'new_message_read_then_exit_clears_its_badge');
  await auditSyntheticModelActivity('after_ordinary_group_messages');

  currentStage = 'dark_theme_and_logout'; await tab('我的'); await page.getByText('外观与显示', { exact: true }).click();
  await page.getByRole('button', { name: '使用暖夜主题', exact: true }).click(); await page.getByRole('button', { name: '保存', exact: true }).click();
  await tab('异宠'); await expect.poll(() => page.evaluate(() => document.documentElement.style.colorScheme)).toBe('dark'); await readyCompanion(); await verifyCompanionContrast(true); await shot('07-companion-390-dark');
  await tab('我的');
  if (await page.getByRole('button', { name: '返回设置', exact: true }).count()) await page.getByRole('button', { name: '返回设置', exact: true }).click();
  await page.getByText('应用更新', { exact: true }).click();
  await expect(page.getByText(/^当前安装版本/)).toHaveCSS('color', 'rgb(189, 191, 183)');
  check(true, 'update_panel_honors_manual_app_dark_theme');
  await shot('07b-app-update-dark');
  await page.getByRole('button', { name: '退出登录', exact: true }).click(); await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  await expect(page.getByText('云端验收小陶', { exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(owner => Object.keys(localStorage).filter(key => key.includes(owner) && /^(?:avatar-cache-v1:|pet-read-state-v3:|pet-chat-messages-v1:)/.test(key)).length, a.id)).toBe(0);
  check(true, 'logout_removes_old_owner_avatar_read_and_message_cache'); await shot('08-logged-out-credentials-masked');
  await login(b); await expect(page.getByText('云端验收小陶', { exact: true })).toHaveCount(0);
  await tab('我的'); await expect(page.getByText(b.nickname, { exact: true })).toBeVisible(); await expect(page.getByText(a.nickname, { exact: true })).toHaveCount(0); check(true, 'next_account_does_not_show_previous_owner_pet_or_profile');
  await shot('09-next-account-isolated-credentials-masked');
  await page.getByRole('button', { name: '退出登录', exact: true }).click(); await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  check(pageErrors.length === 0, 'no_browser_runtime_errors'); check(blockedModels.length === 0, 'ui_attempts_no_generative_actions');
  const audit = await auditSyntheticModelActivity('after_all_ui_checks');
  check(audit.model_run_count === 0, 'no_model_run_created');
  check(audit.learning_job_count === 0, 'no_unauthorized_learning_job_created');
  check(preventedHealthChecks.some(call => call.stage === 'login_module_boundaries'), 'account_page_automatic_health_probe_identified_and_prevented'); currentStage = 'completed';
} catch (error) {
  failure = { stage: currentStage, code: safeCode(error instanceof Error ? error.message : null), kind: error instanceof Error ? error.name : 'Error' };
  // Selector diagnostics may include input values. Redact before writing; never
  // emit this detail to stdout or retain an unrestricted stack/trace.
  let detail = error instanceof Error ? error.message : 'unexpected_failure';
  for (const secret of [process.env.SUPABASE_SERVICE_ROLE_KEY, process.env.SUPABASE_ANON_KEY, ...users.flatMap(user => [user.email, user.password])]) if (secret) detail = detail.replaceAll(secret, '[redacted]');
  detail = detail.replace(/eyJ[A-Za-z0-9_.-]{40,}/g, '[redacted-token]').replace(/([?&](?:token|apikey|access_token|refresh_token)=)[^&\s]+/g, '$1[redacted]');
  await writeFile(resolve(out, 'failure-detail.txt'), detail.slice(0, 2000));
  if (page) await shot('failure-masked').catch(() => undefined);
} finally {
  holdSend = false; holdAvatars = false; releaseSend(); releaseAvatars();
  await context?.close().catch(() => undefined); await browser?.close().catch(() => undefined);
  // These rows use ON DELETE SET NULL for owner; remove our run logs before
  // deleting synthetic accounts, otherwise cleanup loses the exact attribution.
  if (users.length) await retryCleanup('synthetic_model_run_logs', () => service.from('model_runs').delete().in('owner_id', users.map(user => user.id)));
  if (spaces.length) await retryCleanup('synthetic_group_model_run_logs', () => service.from('model_runs').delete().in('space_id', spaces));
  for (const id of spaces) await retryCleanup('synthetic_space', () => service.from('spaces').delete().eq('id', id));
  for (const file of files) await retryCleanup('synthetic_asset_file', () => service.storage.from(file.bucket).remove([file.path]));
  for (const user of users) await retryCleanup('synthetic_account', () => service.auth.admin.deleteUser(user.id));
  if (users.length) {
    try { const remaining = ok(await service.from('profiles').select('id').in('id', users.map(user => user.id)), 'cleanup_profile_check'); cleanup.push({ name: 'synthetic_profiles_absent', success: remaining.length === 0 }); } catch { cleanup.push({ name: 'synthetic_profiles_absent', success: false }); }
  }
  const report = { success: !failure && cleanup.every(item => item.success), timestamp: new Date().toISOString(), project, domain: base, bundle: expectedBundle, stage: currentStage, failure, checks, metrics, pageErrors, blockedModels, preventedHealthChecks, modelAudits, cleanup,
    limits: ['Two newly created synthetic accounts and one group only', 'No existing account data or external recipient', 'Account page automatic model-health generation was intercepted; its UNKNOWN state is expected and AI availability was not evaluated', 'No model generation, device push or native overlay test', 'Cache timings are synthetic browser observations, not native device P50/P95'] };
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ success: report.success, stage: currentStage, failure, checks: checks.length, metrics, cleanupFailures: cleanup.filter(item => !item.success).length, report: resolve(out, 'report.json') }, null, 2));
  if (!report.success) process.exitCode = 1;
}
