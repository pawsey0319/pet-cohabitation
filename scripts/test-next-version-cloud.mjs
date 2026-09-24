/**
 * Post-deployment smoke. Explicitly limited to this project and synthetic data.
 * Usage: node scripts/test-next-version-cloud.mjs --cloud --project-ref lthcucgggoevgcboouqw
 * Required process env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
 * Does not deploy, call a model, run a global worker, list users, or read existing accounts.
 */
import { createClient } from '@supabase/supabase-js';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const PROJECT = 'lthcucgggoevgcboouqw';
const EXPECTED_URL = `https://${PROJECT}.supabase.co`;
const args = process.argv.slice(2);
if (args.length !== 3 || args[0] !== '--cloud' || args[1] !== '--project-ref' || args[2] !== PROJECT) {
  console.error(`Usage: node scripts/test-next-version-cloud.mjs --cloud --project-ref ${PROJECT}`);
  process.exit(2);
}
if (process.env.SUPABASE_URL?.replace(/\/$/, '') !== EXPECTED_URL || !process.env.SUPABASE_ANON_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Expected cloud project URL and both process credentials are required.');
  process.exit(2);
}
for (const key of [process.env.SUPABASE_ANON_KEY, process.env.SUPABASE_SERVICE_ROLE_KEY]) {
  if (key.split('.').length !== 3) continue; // New publishable/secret keys have no JWT claims.
  let claims;
  try { claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8')); } catch { console.error('Invalid credential format.'); process.exit(2); }
  if (claims.ref && claims.ref !== PROJECT) { console.error('Credential project mismatch.'); process.exit(2); }
}

const runId = randomUUID();
const reportPath = `test-results/next-version-cloud-${runId}.json`;
const resourcesPath = `test-results/next-version-cloud-${runId}.resources.json`;
const users = [], spaces = [], files = [], checks = [], samples = [], cleanup = [];
let stage = 'setup', failure = null, attemptedSends = 0;
const safeCode = value => typeof value === 'string' && /^[a-zA-Z0-9_:-]{1,100}$/.test(value) ? value : 'request_failed';
function ok(result, label) { if (result.error) throw new Error(`${label}:${safeCode(result.error.code)}`); return result.data; }
function check(value, label) { if (!value) throw new Error(label); checks.push(label); }
const guardedFetch = async (input, init = {}) => {
  const target = new URL(input instanceof Request ? input.url : String(input));
  if (target.origin !== EXPECTED_URL) throw new Error('unexpected_network_destination');
  const deadline = AbortSignal.timeout(60_000);
  return fetch(input, { ...init, signal: init.signal ? AbortSignal.any([init.signal, deadline]) : deadline });
};
const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: guardedFetch } };
const service = createClient(EXPECTED_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
await mkdir('test-results', { recursive: true });
async function saveResources() {
  // IDs only: enough to clean an interrupted run without retaining passwords/tokens.
  await writeFile(resourcesPath, JSON.stringify({ project: PROJECT, run_id: runId, users, spaces, files }, null, 2));
}
async function account(label, withPet) {
  const email = `next-version-${runId}-${label}@example.test`, password = `Synthetic-Aa1!${randomUUID()}`;
  const user = ok(await service.auth.admin.createUser({ email, password, email_confirm: true }), `create_${label}`).user;
  users.push(user.id); await saveResources();
  ok(await service.from('profiles').insert({ id: user.id, email, nickname: `云端合成验收${label}` }), `profile_${label}`);
  const client = createClient(EXPECTED_URL, process.env.SUPABASE_ANON_KEY, options);
  const session = ok(await client.auth.signInWithPassword({ email, password }), `login_${label}`).session;
  const pet = withPet ? ok(await service.from('pets').insert({ owner_id: user.id, name: `合成验收宠${label}`, seed_summary: '温柔独立的合成伙伴', personality_seed_prompt: 'synthetic-cloud-private-seed' }).select('id').single(), `pet_${label}`).id : null;
  return { id: user.id, client, token: session.access_token, pet };
}
async function edge(name, account, payload) {
  const response = await guardedFetch(`${EXPECTED_URL}/functions/v1/${name}`, {
    method: 'POST', headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${account.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  let value;
  try { value = await response.json(); } catch { throw new Error(`${name}:non_json_response`); }
  return { status: response.status, value };
}
function success(result, label) { check(result.status >= 200 && result.status < 300, label); return result.value; }
async function retryCleanup(label, operation) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { const result = await operation(); if (!result.error) { cleanup.push({ resource: label, status: 'removed' }); return; } } catch { /* Retry without logging credentials or response bodies. */ }
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
  }
  cleanup.push({ resource: label, status: 'cleanup_failed' });
}

try {
  const a = await account('A', true), b = await account('B', false), outsider = await account('C', true);
  stage = 'personality';
  const state = success(await edge('pet-personality', a, { action: 'state' }), 'owner_personality_http');
  check(state.state.pet_id === a.pet && state.seed === '温柔独立的合成伙伴' && !JSON.stringify(state).includes('synthetic-cloud-private-seed'), 'owner_state_is_bound_to_session_and_public_seed');
  const mutation = { action: 'pause', request_id: randomUUID(), expected_revision: state.state.revision };
  const paused = success(await edge('pet-personality', a, mutation), 'owner_pause_http');
  const duplicate = success(await edge('pet-personality', a, mutation), 'personality_retry_http');
  check(paused.paused && duplicate.revision === paused.revision, 'personality_retry_is_idempotent');
  const conflict = await edge('pet-personality', a, { action: 'resume', request_id: randomUUID(), expected_revision: state.state.revision });
  check(conflict.status >= 400 && conflict.value.error === 'personality_version_conflict', 'personality_stale_version_rejected');
  const foreign = success(await edge('pet-personality', outsider, { action: 'state', pet_id: a.pet, owner_id: a.id }), 'foreign_request_has_only_own_state');
  check(foreign.state.pet_id === outsider.pet && foreign.state.pet_id !== a.pet, 'foreign_target_cannot_override_authenticated_owner');
  const noPet = await edge('pet-personality', b, { action: 'state', pet_id: a.pet });
  check(noPet.status >= 400 && !noPet.value.state, 'member_without_pet_cannot_read_owners_private_state');

  stage = 'message_ack';
  const space = ok(await a.client.rpc('create_relationship_space', { space_name: `云端合成验收-${runId.slice(0, 8)}`, space_kind: 'friend_circle' }), 'create_test_space');
  spaces.push(space); await saveResources();
  ok(await service.from('space_members').insert({ space_id: space, user_id: b.id, role: 'member' }), 'join_test_member');
  // No private messages, @ cues, participation, observation, or relationship learning during sends.
  ok(await service.from('space_pet_permissions').upsert({ space_id: space, pet_id: a.pet, owner_id: a.id, participation_enabled: false }), 'disable_test_pet_participation');
  const receipts = [];
  const send = (id, text) => b.client.rpc('send_space_message_v2', { message_client_id: id, target_space_id: space, message_kind: 'text', message_text: text });
  for (let i = 0; i < 8; i++) {
    const id = randomUUID(), text = `合成普通消息 ${i + 1}`, started = performance.now();
    attemptedSends++;
    const receipt = ok(await send(id, text), 'ordinary_send_receipt');
    samples.push(Math.round(performance.now() - started));
    check(receipt.message?.id && Number.isInteger(receipt.message.space_sequence) && Number.isInteger(receipt.message.sync_sequence), `ordinary_ack_${i + 1}_contains_v3_cursors`);
    receipts.push({ ...receipt.message, request: id, submitted: text });
  }
  const first = receipts[0], last = receipts.at(-1);
  const retry = ok(await send(first.request, first.submitted), 'repeat_send');
  check(retry.message.id === first.id && retry.message.space_sequence === first.space_sequence, 'repeat_send_reuses_message_and_sequence');
  check(Boolean((await send(first.request, '合成不同正文')).error), 'request_id_cannot_change_content');
  check(new Set(receipts.map(row => row.space_sequence)).size === 8, 'eight_send_sequences_are_unique');
  stage = 'message_read_sync';
  const listed = ok(await a.client.rpc('list_my_spaces_v3'), 'list_spaces_v3').find(row => row.id === space);
  check(listed?.unread_count === 8, 'v3_list_counts_unread_from_fixture_only');
  const paged = []; let before = null;
  for (let i = 0; i < 4; i++) {
    const page = ok(await a.client.rpc('list_space_messages_v3', { target_space_id: space, before_sequence: before, page_size: 3 }), 'history_v3');
    paged.push(...page); if (!page.length) break; before = page.at(-1).space_sequence;
  }
  check(JSON.stringify(paged.map(row => row.id)) === JSON.stringify([...receipts].reverse().map(row => row.id)), 'v3_history_pages_all_eight_messages_once');
  const sync = ok(await a.client.rpc('sync_space_messages_v3', { target_space_id: space, after_sequence: 0 }), 'sync_v3');
  check(receipts.every(row => sync.some(item => item.id === row.id)), 'v3_sync_contains_all_sent_messages');
  const read = ok(await a.client.rpc('mark_space_read_v3', { target_space_id: space, through_message_id: receipts[3].id }), 'read_v3');
  check(read.read_sequence === receipts[3].space_sequence && read.unread_count === 4, 'v3_read_only_marks_visible_prefix');
  const allRead = ok(await a.client.rpc('mark_space_read_v3', { target_space_id: space, through_message_id: last.id }), 'read_latest_v3');
  const staleRead = ok(await a.client.rpc('mark_space_read_v3', { target_space_id: space, through_message_id: first.id }), 'read_old_v3');
  check(allRead.unread_count === 0 && staleRead.read_sequence === allRead.read_sequence, 'late_read_does_not_regress_watermark');
  const legacyHistory = ok(await a.client.rpc('list_space_messages_v2', { target_space_id: space, page_size: 100 }), 'legacy_history_v2');
  const legacySync = ok(await a.client.rpc('sync_space_messages_v2', { target_space_id: space, after_at: '1970-01-01T00:00:00Z', after_id: '00000000-0000-0000-0000-000000000000' }), 'legacy_sync_v2');
  ok(await a.client.rpc('mark_space_read_through', { target_space_id: space, through_message_id: last.id }), 'legacy_read_through');
  check(legacyHistory.length === 8 && legacySync.length === 8, 'legacy_v2_history_sync_and_read_remain_compatible');
  check(Boolean((await outsider.client.rpc('list_space_messages_v3', { target_space_id: space })).error), 'outsider_cannot_read_v3_history');
  check(Boolean((await outsider.client.rpc('mark_space_read_v3', { target_space_id: space, through_message_id: last.id })).error), 'outsider_cannot_write_read_watermark');

  stage = 'relationship_consent';
  const scope = { space_id: space, pet_id: a.pet };
  const consentState = success(await edge('space-relationship-consent', b, { action: 'state', ...scope }), 'member_without_pet_can_view_consent');
  check(consentState.enabled === false, 'relationship_learning_starts_disabled');
  const one = success(await edge('space-relationship-consent', a, { action: 'decide', ...scope, decision: true }), 'owner_consent_http');
  check(one.enabled === false, 'owner_consent_alone_is_insufficient');
  const all = success(await edge('space-relationship-consent', b, { action: 'decide', ...scope, decision: true }), 'member_without_pet_can_decide');
  check(all.enabled === true, 'independent_all_member_consent_enables_scope');
  const forbidden = await edge('space-relationship-consent', outsider, { action: 'decide', ...scope, decision: true });
  check(forbidden.status === 403, 'outsider_cannot_consent_for_group');
  const withdrawn = success(await edge('space-relationship-consent', b, { action: 'decide', ...scope, decision: false }), 'withdraw_consent_http');
  check(withdrawn.enabled === false && withdrawn.scope.epoch > all.scope.epoch, 'withdrawal_disables_scope_and_invalidates_epoch');

  stage = 'avatar_references';
  const avatar = randomUUID(), path = `${a.id}/${avatar}.png`;
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0l8AAAAASUVORK5CYII=', 'base64');
  files.push({ bucket: 'avatars', path }); await saveResources();
  ok(await service.storage.from('avatars').upload(path, pixel, { contentType: 'image/png', upsert: false }), 'synthetic_avatar_upload');
  ok(await service.from('avatar_assets').insert({ id: avatar, owner_id: a.id, storage_path: path, source: 'upload', content_sha256: createHash('sha256').update(pixel).digest('hex') }), 'synthetic_avatar_record');
  const reference = `avatar://${avatar}`;
  const own = success(await edge('avatar-assets', a, { action: 'read_batch', references: [{ reference, space_id: null }, { reference: `avatar://${randomUUID()}`, space_id: null }] }), 'own_avatar_batch_http');
  check(own.entries.length === 2 && own.entries[0].reference === reference && typeof own.entries[0].url === 'string' && own.entries[0].published === false && !own.entries[0].bucket && !own.entries[0].path, 'own_private_avatar_returns_ephemeral_url_without_storage_inputs');
  check(own.entries[1].error === 'avatar_forbidden' && !own.entries[1].url, 'missing_avatar_is_denied_per_entry');
  const peerAvatar = success(await edge('avatar-assets', b, { action: 'read_batch', references: [{ reference, space_id: space }] }), 'peer_avatar_batch_http');
  check(peerAvatar.entries[0].error === 'avatar_forbidden' && !peerAvatar.entries[0].url, 'shared_group_does_not_grant_access_to_private_avatar_draft');
  const outsideAvatar = success(await edge('avatar-assets', outsider, { action: 'read_batch', references: [{ reference, space_id: space }] }), 'outside_avatar_batch_http');
  check(outsideAvatar.entries[0].error === 'avatar_scope_forbidden' && !outsideAvatar.entries[0].url, 'nonmember_avatar_scope_rejected');

  stage = 'account_export';
  const exported = success(await edge('export-my-data', a, {}), 'synthetic_account_export_http');
  const learning = exported.personality_learning;
  const keys = ['pet_personality_states', 'pet_relationship_scopes', 'pet_learning_jobs', 'pet_personality_evidence', 'pet_personality_history', 'pet_group_relationships', 'pet_personality_requests', 'pet_group_reply_contexts', 'relationship_consents'];
  check(exported.profile.id === a.id && keys.every(key => Array.isArray(learning?.[key])), 'export_contains_complete_personality_learning_structure');
  check(learning.pet_personality_states.some(row => row.pet_id === a.pet && row.owner_id === a.id) && learning.pet_personality_requests.length === 1, 'export_includes_real_management_state_and_single_retry_receipt');
  check(keys.every(key => learning[key].every(row => key === 'relationship_consents' ? row.member_id === a.id : row.owner_id === a.id)), 'personality_export_contains_only_authenticated_account_records');
  const runRows = ok(await service.from('model_runs').select('id').in('owner_id', users).limit(1), 'check_no_model_calls');
  const learningRows = ok(await service.from('pet_learning_jobs').select('id').in('owner_id', users).limit(1), 'check_no_learning_jobs');
  check(runRows.length === 0 && learningRows.length === 0, 'smoke_creates_no_model_runs_or_learning_jobs');
  stage = 'completed';
} catch (reason) {
  failure = reason instanceof Error ? safeCode(reason.message) : 'unexpected_failure';
} finally {
  for (const id of spaces) await retryCleanup('synthetic_space', () => service.from('spaces').delete().eq('id', id));
  for (const file of files) await retryCleanup('synthetic_avatar_file', () => service.storage.from(file.bucket).remove([file.path]));
  for (const id of users) await retryCleanup('synthetic_account', () => service.auth.admin.deleteUser(id));
  const sorted = [...samples].sort((a, b) => a - b), percentile = q => sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)] : null;
  const report = {
    project: PROJECT, run_id: runId, timestamp: new Date().toISOString(), success: !failure && cleanup.every(item => item.status === 'removed'),
    stage, failure, checks, ordinary_send_ack: { attempted: attemptedSends, acknowledged: samples.length, samples_ms: samples, p50_ms: percentile(.5), p95_ms: percentile(.95), error_rate: attemptedSends ? (attemptedSends - samples.length) / attemptedSends : null, note: '8 sequential synthetic sends; includes network, does not measure model latency or establish a performance guarantee.' },
    cleanup, limits: ['Synthetic accounts only', 'No external models', 'No device or push verification', 'No private chat or existing-account reads'],
  };
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ success: report.success, stage, failure, passed_checks: checks.length, ordinary_send_ack: report.ordinary_send_ack, cleanup_failures: cleanup.filter(item => item.status !== 'removed').length, report: reportPath, resources: resourcesPath }, null, 2));
  if (!report.success) process.exitCode = 1;
}
