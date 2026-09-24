/** Real cloud jobs, bounded to newly created synthetic accounts and sources. */
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const project = 'lthcucgggoevgcboouqw', url = `https://${project}.supabase.co`;
const args = process.argv.slice(2);
if (args.length !== 5 || args[0] !== '--cloud' || args[1] !== '--project-ref' || args[2] !== project || args[3] !== '--expected-model' || !args[4] || /grok/i.test(args[4])) {
  console.error('Requires --cloud --project-ref lthcucgggoevgcboouqw --expected-model <configured non-Grok model>'); process.exit(2);
}
const expectedModel = args[4];
if (process.env.SUPABASE_URL !== url || !process.env.SUPABASE_ANON_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Fixed project credentials must be provided through process environment.'); process.exit(2);
}
const runId = randomUUID(), reportPath = `test-results/learning-cloud-${runId}.json`, resourcePath = `test-results/learning-cloud-${runId}.resources.json`;
const users = [], spaces = [], pets = [], sources = [], checks = [], cleanup = [], observations = [];
let stage = 'setup', failure = null;
const originalFetch = globalThis.fetch;
const safeCode = value => typeof value === 'string' && /^[a-zA-Z0-9_:-]{1,140}$/.test(value) ? value : 'request_failed';
const safeFetch = (input, init = {}) => {
  if (new URL(input instanceof Request ? input.url : String(input)).origin !== url) throw new Error('unexpected_destination');
  const timeout = AbortSignal.timeout(25_000);
  return originalFetch(input, { ...init, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
};
const opts = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: safeFetch } };
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, opts);
const ok = (result, label) => { if (result.error) throw new Error(`${label}:${safeCode(result.error.message)}`); return result.data; };
const check = (value, name) => { if (!value) throw new Error(name); checks.push(name); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
await mkdir('test-results', { recursive: true });
async function resources() { await writeFile(resourcePath, JSON.stringify({ project, runId, users, spaces, pets, sources }, null, 2)); }
async function account(name, withPet = false) {
  const email = `learning-cloud-${runId}-${users.length}@example.test`, password = `Synthetic-Aa1!${randomUUID()}`;
  const id = ok(await service.auth.admin.createUser({ email, password, email_confirm: true }), 'create_account').user.id;
  users.push(id); await resources();
  ok(await service.from('profiles').insert({ id, email, nickname: name }), 'create_profile');
  const client = createClient(url, process.env.SUPABASE_ANON_KEY, opts);
  const session = ok(await client.auth.signInWithPassword({ email, password }), 'login').session;
  let pet = null;
  if (withPet) {
    pet = ok(await service.from('pets').insert({ owner_id: id, name: '合成学习伙伴', seed_summary: '独立且温柔的合成伙伴', personality_seed_prompt: '合成测试底色' }).select('id').single(), 'create_pet').id;
    pets.push(pet); await resources();
  }
  return { id, client, token: session.access_token, pet };
}
async function edge(name, who, body) {
  const response = await safeFetch(`${url}/functions/v1/${name}`, { method: 'POST', headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${who.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let result; try { result = await response.json(); } catch { throw new Error(`${name}:non_json_response`); }
  if (!response.ok) throw new Error(`${name}:${safeCode(result.error)}`);
  return result;
}
async function waitJob(pet, source, kind) {
  const started = Date.now(), deadline = started + 100_000;
  for (;;) {
    const job = ok(await service.from('pet_learning_jobs').select('id,pet_id,owner_id,kind,source_kind,source_id,space_id,consent_epoch,status,attempts,error_code,created_at,updated_at').eq('pet_id', pet).eq('source_id', source).eq('kind', kind).maybeSingle(), 'job_state');
    if (!job) throw new Error('source_did_not_enqueue_learning_job');
    if (['succeeded', 'failed', 'cancelled'].includes(job.status) || Date.now() >= deadline) {
      observations.push({ kind, cloud_job: job, elapsed_to_terminal_ms: Date.now() - started });
      console.log(JSON.stringify({ stage: kind, status: job.status, attempts: job.attempts, error_code: job.error_code, elapsed_ms: Date.now() - started }));
      if (job.status !== 'succeeded') throw new Error(`learning_${kind}_${job.status}:${safeCode(job.error_code ?? 'deadline')}`);
      return job;
    }
    await sleep(2000);
  }
}
async function modelRuns(owner, pet) {
  return ok(await service.from('model_runs').select('id,run_kind,owner_id,pet_id,model,status,error_code,latency_ms,created_at').eq('owner_id', owner).eq('pet_id', pet).order('created_at'), 'scoped_model_runs');
}
async function completedModels(owner, pet, count) {
  for (let i = 0; i < 6; i++) {
    const rows = await modelRuns(owner, pet);
    if (rows.length >= count && rows.every(row => row.status !== 'running')) return rows;
    await sleep(500);
  }
  return modelRuns(owner, pet);
}
async function clean(label, action) {
  for (let i = 0; i < 2; i++) {
    try { const result = await action(); if (!result.error) { cleanup.push({ resource: label, status: 'removed' }); return true; } } catch { /* bounded retry */ }
    if (!i) await sleep(500);
  }
  cleanup.push({ resource: label, status: 'failed' }); return false;
}

try {
  const a = await account('合成小林', true), b = await account('合成小周'), outsider = await account('合成群外成员');
  const space = ok(await a.client.rpc('create_relationship_space', { space_name: `云端学习验收-${runId.slice(0, 8)}`, space_kind: 'friend_circle' }), 'create_space');
  spaces.push(space); await resources();
  ok(await service.from('space_members').insert({ space_id: space, user_id: b.id, role: 'member' }), 'join_member');
  ok(await service.from('space_pet_permissions').upsert({ space_id: space, pet_id: a.pet, owner_id: a.id, participation_enabled: true }), 'enable_participation');
  const send = async content => {
    const result = ok(await a.client.rpc('send_space_message_v2', { message_client_id: randomUUID(), target_space_id: space, message_kind: 'text', message_text: content }), 'send_synthetic_source');
    sources.push(result.message.id); await resources();
    await edge('handle-space-message', a, { message_id: result.message.id });
    return result.message.id;
  };

  stage = 'owner_style';
  for (const member of [a, b]) ok(await member.client.rpc('set_space_observation_consent', { target_space_id: space, target_pet_id: a.pet, decision: true }), 'observation_consent');
  check(ok(await service.rpc('is_observation_enabled', { target_space_id: space, target_pet_id: a.pet }), 'observation_status') === true, 'owner_group_style_requires_existing_all_member_observation_consent');
  const gentleText = '别着急，你可以按自己的节奏说，我会认真听；即使还没有答案，也不用责怪自己。';
  const styleSource = await send(gentleText);
  const styleJob = await waitJob(a.pet, styleSource, 'style');
  const evidence = ok(await service.from('pet_personality_evidence').select('id,pet_id,owner_id,source_kind,source_id,space_id,trait,quote,confidence,state,source_date').eq('pet_id', a.pet).eq('source_id', styleSource), 'style_evidence');
  observations[0].evidence = evidence;
  check(evidence.some(row => row.trait === 'gentle') && evidence.every(row => row.state === 'active' && row.owner_id === a.id && row.source_id === styleSource && row.source_kind === 'space' && row.quote.length >= 2 && gentleText.includes(row.quote)), 'real_model_style_candidates_have_exact_owner_source');
  const state = await edge('pet-personality', a, { action: 'state' });
  check(state.state.styles.length === 0, 'one_expression_does_not_mature_into_stable_personality');
  check(ok(await b.client.from('pet_personality_evidence').select('id').eq('pet_id', a.pet).eq('source_id', styleSource), 'peer_style_access').length === 0, 'group_peer_cannot_read_private_style_evidence');
  check(ok(await outsider.client.from('pet_personality_evidence').select('id').eq('pet_id', a.pet), 'outsider_style_access').length === 0, 'outsider_cannot_read_private_style_evidence');
  const firstRuns = await completedModels(a.id, a.pet, 1);
  check(firstRuns.length === 1 && firstRuns[0].model === expectedModel && firstRuns[0].status === 'succeeded' && firstRuns[0].run_kind === 'pet_memory_extract', 'style_job_records_configured_real_model_and_success');
  observations[0].evidence = evidence; observations[0].models = firstRuns;
  check(styleJob.attempts === 1, 'style_job_succeeded_on_first_claim');

  stage = 'relationship';
  // Disable style before the relationship sample so exactly one job tests each path.
  ok(await b.client.rpc('set_space_observation_consent', { target_space_id: space, target_pet_id: a.pet, decision: false }), 'withdraw_style_consent');
  const invalidated = ok(await service.from('pet_personality_evidence').select('state').eq('pet_id', a.pet).eq('source_id', styleSource), 'style_after_revocation');
  check(invalidated.every(row => row.state === 'invalidated'), 'withdraw_observation_invalidates_style_sources');
  const scope = { space_id: space, pet_id: a.pet };
  const one = await edge('space-relationship-consent', a, { action: 'decide', ...scope, decision: true });
  check(one.enabled === false, 'owner_alone_cannot_enable_relationship_learning');
  const all = await edge('space-relationship-consent', b, { action: 'decide', ...scope, decision: true });
  check(all.enabled === true, 'member_without_pet_can_complete_separate_relationship_consent');
  const relationText = '合成小周是我同事，我们在同一个项目组工作。';
  const relationSource = await send(relationText);
  const relationJob = await waitJob(a.pet, relationSource, 'relationship');
  const relations = ok(await service.from('pet_group_relationships').select('id,pet_id,owner_id,space_id,subject_id,object_id,speaker_id,relation,quote,source_id,consent_epoch,assertion,state').eq('pet_id', a.pet).eq('source_id', relationSource), 'relationship_rows');
  observations[1].relationships = relations;
  observations[1].synthetic_input = { content: relationText, speaker_id: a.id, members: [{ id: a.id, name: '合成小林' }, { id: b.id, name: '合成小周' }] };
  observations[1].models = (await completedModels(a.id, a.pet, 2)).filter(row => !firstRuns.some(first => first.id === row.id));
  // Colleague is symmetric: either subject order is valid, but attribution must
  // remain self-stated by A, not reported by a third party. Directed relations
  // retain their order and are covered by the isolated attribution regression.
  check(relations.length === 1 && new Set([relations[0].subject_id, relations[0].object_id]).size === 2 && [relations[0].subject_id, relations[0].object_id].every(id => [a.id, b.id].includes(id)) && relations[0].speaker_id === a.id && relations[0].assertion === 'self_stated' && relations[0].state === 'active' && /同事/.test(relations[0].relation) && relationText.includes(relations[0].quote), 'real_relationship_uses_actual_member_ids_exact_source_and_speaker');
  check(relations[0].consent_epoch === all.scope.epoch && relationJob.consent_epoch === all.scope.epoch, 'relationship_evidence_binds_to_current_independent_consent_epoch');
  check(ok(await b.client.from('pet_group_relationships').select('id').eq('pet_id', a.pet), 'peer_relation_access').length === 0 && ok(await outsider.client.from('pet_group_relationships').select('id').eq('pet_id', a.pet), 'outside_relation_access').length === 0, 'pet_relationship_understanding_is_owner_private');
  const secondRuns = await completedModels(a.id, a.pet, 2);
  check(secondRuns.length === 2 && secondRuns.every(row => row.model === expectedModel && row.status === 'succeeded' && row.run_kind === 'pet_memory_extract'), 'both_cloud_jobs_record_correct_model_and_success');
  check(relationJob.attempts === 1, 'relationship_job_succeeded_on_first_claim');
  observations[1].relationships = relations; observations[1].models = secondRuns.filter(row => !firstRuns.some(first => first.id === row.id));
  const jobs = ok(await service.from('pet_learning_jobs').select('id,kind,status,source_id').eq('pet_id', a.pet), 'bounded_job_count');
  check(jobs.length === 2 && jobs.every(row => sources.includes(row.source_id)), 'only_two_authorized_synthetic_sources_created_learning_jobs');
  check(ok(await service.from('messages').select('id').eq('space_id', space).eq('actor_kind', 'pet'), 'no_pet_reply').length === 0, 'ordinary_learning_sources_did_not_summon_pet_replies');
  const withdrew = await edge('space-relationship-consent', b, { action: 'decide', ...scope, decision: false });
  check(withdrew.enabled === false && ok(await service.from('pet_group_relationships').select('state').eq('pet_id', a.pet).eq('source_id', relationSource), 'after_withdrawal').every(row => row.state === 'invalidated'), 'relationship_revocation_invalidates_real_model_result');
  stage = 'completed';
} catch (reason) {
  failure = reason instanceof Error ? safeCode(reason.message) : 'unexpected_failure';
} finally {
  // Cancel scoped work before deleting runs, otherwise SET NULL leaves test runs behind.
  if (pets.length) {
    await clean('synthetic_learning_pause', () => service.from('pet_personality_states').update({ paused: true }).in('pet_id', pets));
    await clean('synthetic_learning_jobs_cancel', () => service.from('pet_learning_jobs').update({ status: 'cancelled', lease_token: null, lease_until: null }).in('pet_id', pets).in('status', ['queued', 'running', 'failed']));
  }
  if (users.length) {
    await clean('synthetic_route_cancel', () => service.from('agent_jobs').update({ status: 'blocked', lease_token: null, lease_until: null, retryable: false }).in('requested_by', users).in('status', ['queued', 'running', 'failed']));
    await sleep(500);
    const runIds = await service.from('model_runs').select('id').in('owner_id', users);
    if (!runIds.error) observations.push({ cleanup_model_run_ids: runIds.data.map(row => row.id) });
    const removed = await clean('synthetic_model_runs_before_auth', () => service.from('model_runs').delete().in('owner_id', users));
    if (!removed) failure ??= 'model_run_cleanup_failed_accounts_retained';
    for (const id of spaces) await clean('synthetic_space', () => service.from('spaces').delete().eq('id', id));
    if (removed) {
      for (const id of users) await clean('synthetic_account', () => service.auth.admin.deleteUser(id));
      if (!runIds.error && runIds.data.length) {
        const remaining = await service.from('model_runs').select('id').in('id', runIds.data.map(row => row.id));
        cleanup.push({ resource: 'known_model_run_ids', status: !remaining.error && remaining.data.length === 0 ? 'removed' : 'failed' });
      }
    }
  }
  const report = { timestamp: new Date().toISOString(), project, runId, success: !failure && cleanup.every(row => row.status === 'removed'), stage, failure, expected_model: expectedModel, checks, observations, cleanup, limits: ['Only newly created synthetic accounts, sources and scoped cloud jobs.', 'Real deployed background model/DB chain; no direct local extraction or manually inserted candidates.', 'Two synthetic examples do not prove long-term adaptation or full model quality.', 'Owner style sampled through existing explicitly authorized group observation, not private chat.', 'No global dispatcher called; no existing account conversations read.'] };
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ success: report.success, stage, failure, checks: checks.length, cleanup_failures: cleanup.filter(row => row.status !== 'removed').length, report: reportPath, resources: resourcePath }, null, 2));
  if (!report.success) process.exitCode = 1;
}
