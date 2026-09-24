import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
assert.equal(url, 'http://127.0.0.1:47321', 'isolated_companion_fixture_required');
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const users = [], spaces = [], checks = [];
function ok(result) { if (result.error) throw new Error(result.error.message); return result.data; }
function check(value, label) { assert.ok(value, label); checks.push(label); }
async function account(name) {
  const email = `personality-${crypto.randomUUID()}@example.test`, password = `Aa1!${crypto.randomUUID()}`;
  const id = ok(await service.auth.admin.createUser({ email, password, email_confirm: true })).user.id; users.push(id);
  ok(await service.from('profiles').insert({ id, email, nickname: name }));
  const client = createClient(url, process.env.SUPABASE_ANON_KEY, options); ok(await client.auth.signInWithPassword({ email, password }));
  const pet = ok(await service.from('pets').insert({ owner_id: id, name: `${name}宠`, personality_seed_prompt: '温柔但保留独立判断的初始性格底色' }).select('id').single());
  return { id, client, pet: pet.id };
}
async function state(pet) { return ok(await service.rpc('get_pet_personality_context', { p_pet: pet })); }
async function finish(source, pet, kind, candidates) {
  const job = ok(await service.from('pet_learning_jobs').select('id').eq('source_id', source).eq('pet_id', pet).eq('kind', kind).single());
  const claim = ok(await service.rpc('claim_pet_learning_job', { p_job: job.id }));
  assert.ok(claim, 'claim exists');
  ok(await service.rpc('finish_pet_learning_job', { p_job: job.id, p_token: claim.job.lease_token, p_candidates: candidates }));
  return job.id;
}

try {
  const A = await account('同名'), B = await account('同名');
  const seedDate = new Date(Date.now() - 5 * 86400000).toISOString();
  ok(await service.from('pet_personality_states').insert({ pet_id: A.pet, owner_id: A.id, reset_at: seedDate }));
  const sourceIds = [];
  for (let i = 0; i < 5; i++) {
    const day = Math.floor(i / 2), content = `别着急，我愿意慢慢听你说第${i}件事。`;
    const source = ok(await service.from('pet_private_threads').insert({ pet_id: A.pet, owner_id: A.id, role: 'owner', conversation_kind: 'companion', content, created_at: new Date(Date.now() - (4 - day) * 86400000 + i * 1000).toISOString() }).select('id').single());
    sourceIds.push(source.id);
    await finish(source.id, A.pet, 'style', [{ trait: 'gentle', quote: content, confidence: .9 }]);
    if (i < 4) check((await state(A.pet)).styles.length === 0, `under-threshold-${i + 1}-has-no-trait`);
  }
  check((await state(A.pet)).styles[0]?.trait === 'gentle', 'five-independent-expressions-across-three-days-form-trait');
  ok(await service.from('pet_personality_states').insert({ pet_id: B.pet, owner_id: B.id, reset_at: seedDate }));
  for (let i = 0; i < 6; i++) {
    const content = '别着急，我愿意慢慢听你说。';
    const source = ok(await service.from('pet_private_threads').insert({ pet_id: B.pet, owner_id: B.id, role: 'owner', conversation_kind: 'companion', content, created_at: new Date(Date.now() - (4 - Math.floor(i / 2)) * 86400000 + i * 1000).toISOString() }).select('id').single());
    await finish(source.id, B.pet, 'style', [{ trait: 'gentle', quote: content, confidence: .9 }]);
  }
  check((await state(B.pet)).styles.length === 0, 'copying-one-expression-across-days-does-not-form-personality');
  const duplicateJob = ok(await service.from('pet_learning_jobs').select('id').eq('source_id', sourceIds[0]).single());
  check(ok(await service.rpc('claim_pet_learning_job', { p_job: duplicateJob.id })) === null, 'completed-source-cannot-be-counted-again');
  const otherRead = ok(await B.client.from('pet_personality_evidence').select('id').eq('pet_id', A.pet));
  check(otherRead.length === 0, 'private-style-evidence-isolated-by-account');
  const directRpc = await B.client.rpc('get_pet_personality_context', { p_pet: A.pet });
  check(Boolean(directRpc.error), 'service-learning-context-not-callable-by-other-accounts');

  const before = await state(A.pet), request = crypto.randomUUID();
  const payload = { action: 'block_trait', trait: 'gentle', expected_revision: before.revision };
  const changed = ok(await service.rpc('manage_pet_personality', { p_owner: A.id, p_pet: A.pet, p_request: request, p_payload: payload }));
  check(changed.styles.length === 0, 'blocked-trait-removed-immediately');
  check(ok(await service.rpc('manage_pet_personality', { p_owner: A.id, p_pet: A.pet, p_request: request, p_payload: payload })).revision === changed.revision, 'management-retry-is-idempotent');
  check(Boolean((await service.rpc('manage_pet_personality', { p_owner: A.id, p_pet: A.pet, p_request: request, p_payload: { ...payload, action: 'reset' } })).error), 'request-id-cannot-change-action');
  ok(await service.rpc('manage_pet_personality', { p_owner: A.id, p_pet: A.pet, p_request: crypto.randomUUID(), p_payload: { action: 'reset', expected_revision: changed.revision } }));
  check((await state(A.pet)).styles.length === 0, 'reset-does-not-relearn-old-sources');

  const pausedSource = ok(await service.from('pet_private_threads').insert({ pet_id: A.pet, owner_id: A.id, role: 'owner', conversation_kind: 'companion', content: '我慢慢听你说，这是暂停前已经开始分析的一句话。' }).select('id').single());
  const pausedJob = ok(await service.from('pet_learning_jobs').select('id').eq('source_id', pausedSource.id).single());
  const pausedClaim = ok(await service.rpc('claim_pet_learning_job', { p_job: pausedJob.id }));
  const beforePause = await state(A.pet);
  const paused = ok(await service.rpc('manage_pet_personality', { p_owner: A.id, p_pet: A.pet, p_request: crypto.randomUUID(), p_payload: { action: 'pause', expected_revision: beforePause.revision } }));
  check(Boolean((await service.rpc('manage_pet_personality', { p_owner: A.id, p_pet: A.pet, p_request: crypto.randomUUID(), p_payload: { action: 'resume', expected_revision: beforePause.revision } })).error), 'stale-management-version-cannot-overwrite-settings');
  ok(await service.rpc('manage_pet_personality', { p_owner: A.id, p_pet: A.pet, p_request: crypto.randomUUID(), p_payload: { action: 'resume', expected_revision: paused.revision } }));
  check(Boolean((await service.rpc('finish_pet_learning_job', { p_job: pausedJob.id, p_token: pausedClaim.job.lease_token, p_candidates: [] })).error), 'pause-and-resume-does-not-accept-an-old-in-flight-task');

  const lateSource = ok(await service.from('pet_private_threads').insert({ pet_id: A.pet, owner_id: A.id, role: 'owner', conversation_kind: 'companion', content: '这是一条随后被忘记的温柔发言。' }).select('id').single());
  const lateJob = ok(await service.from('pet_learning_jobs').select('id').eq('source_id', lateSource.id).single());
  const lateClaim = ok(await service.rpc('claim_pet_learning_job', { p_job: lateJob.id }));
  ok(await service.rpc('exclude_pet_memory_context', { target_pet_id: A.pet, source_ids: [lateSource.id] }));
  const lateCommit = await service.rpc('finish_pet_learning_job', { p_job: lateJob.id, p_token: lateClaim.job.lease_token, p_candidates: [{ trait: 'gentle', quote: '这是一条随后被忘记的温柔发言。', confidence: .9 }] });
  check(Boolean(lateCommit.error), 'late-style-task-cannot-restore-forgotten-source');
  check(ok(await service.from('pet_personality_evidence').select('id').eq('source_id', lateSource.id)).length === 0, 'forgotten-source-produces-no-evidence');

  const space = ok(await A.client.rpc('create_relationship_space', { space_name: '关系隔离测试', space_kind: 'friend_circle' })); spaces.push(space);
  ok(await service.from('space_members').insert({ space_id: space, user_id: B.id, role: 'member' }));
  for (const owner of [A, B]) ok(await service.from('space_pet_permissions').upsert({ space_id: space, pet_id: owner.pet, owner_id: owner.id, participation_enabled: true }));
  const send = async text => ok(await A.client.rpc('send_space_message_v2', { message_client_id: crypto.randomUUID(), target_space_id: space, message_kind: 'text', message_text: text }));
  const unauthorized = await send('同名是我同事。');
  check(ok(await service.from('pet_learning_jobs').select('id').eq('source_id', unauthorized.message.id)).length === 0, 'no-relationship-analysis-without-independent-consent');
  ok(await service.rpc('set_pet_relationship_consent', { p_actor: A.id, p_pet: A.pet, p_space: space, p_decision: true }));
  check(ok(await service.rpc('pet_relationship_enabled', { p_pet: A.pet, p_space: space })) === false, 'one-member-consent-is-insufficient');
  ok(await service.rpc('set_pet_relationship_consent', { p_actor: B.id, p_pet: A.pet, p_space: space, p_decision: true }));
  check(ok(await service.rpc('pet_relationship_enabled', { p_pet: A.pet, p_space: space })) === true, 'all-current-members-enable-own-pet-scope');
  const authorized = await send('同名是我同事。');
  await finish(authorized.message.id, A.pet, 'relationship', [{ subject_id: A.id, object_id: B.id, relation: '同事', quote: '同名是我同事。', assertion: 'self_stated', operation: 'assert' }]);
  const groupContext = ok(await service.rpc('get_pet_personality_context', { p_pet: A.pet, p_space: space }));
  check(groupContext.relationships.length === 1 && groupContext.relationships[0].speaker_id === A.id, 'relationship-retains-speaker-id-and-source');
  check(!JSON.stringify(groupContext).includes('原话') && !('quote' in groupContext.relationships[0]), 'model-context-contains-no-private-learning-quotes');
  check(ok(await service.from('pet_group_relationships').select('id').eq('pet_id', B.pet)).length === 0, 'each-pet-has-independent-understanding-and-consent');
  const derivedOne = ok(await service.from('messages').insert({ space_id: space, client_id: crypto.randomUUID(), actor_kind: 'pet', actor_id: A.pet, actor_name: '合成宠', kind: 'text', text: '你们介绍过是同事。' }).select('id').single());
  const derivedTwo = ok(await service.from('messages').insert({ space_id: space, client_id: crypto.randomUUID(), actor_kind: 'pet', actor_id: B.pet, actor_name: '另一只合成宠', kind: 'text', text: '这是刚才那条关系介绍的接续。' }).select('id').single());
  ok(await service.from('pet_group_reply_contexts').insert([
    { reply_message_id: derivedOne.id, pet_id: A.pet, owner_id: A.id, space_id: space, source_ids: [authorized.message.id] },
    { reply_message_id: derivedTwo.id, pet_id: B.pet, owner_id: B.id, space_id: space, source_ids: [derivedOne.id] },
  ]));
  ok(await service.rpc('manage_pet_personality', { p_owner: A.id, p_pet: A.pet, p_request: crypto.randomUUID(), p_payload: { action: 'forget_relationship', relationship_id: groupContext.relationships[0].id, expected_revision: (await state(A.pet)).revision } }));
  const forgottenGroup = ok(await service.rpc('get_pet_personality_context', { p_pet: A.pet, p_space: space }));
  check([authorized.message.id, derivedOne.id, derivedTwo.id].every(id => forgottenGroup.excluded_group_source_ids.includes(id)), 'relationship-forgetting-excludes-source-and-transitive-pet-replies');
  check(forgottenGroup.relationships.length === 0, 'forgotten-relationship-cannot-reenter-model-context');
  const revokeSource = await send('同名也是我的朋友。');
  const revokeJob = ok(await service.from('pet_learning_jobs').select('id').eq('source_id', revokeSource.message.id).eq('kind', 'relationship').single());
  const revokeClaim = ok(await service.rpc('claim_pet_learning_job', { p_job: revokeJob.id }));
  ok(await service.rpc('set_pet_relationship_consent', { p_actor: B.id, p_pet: A.pet, p_space: space, p_decision: false }));
  check(ok(await service.rpc('get_pet_personality_context', { p_pet: A.pet, p_space: space })).relationships.length === 0, 'revocation-removes-previous-relationship-context');
  check(Boolean((await service.rpc('finish_pet_learning_job', { p_job: revokeJob.id, p_token: revokeClaim.job.lease_token, p_candidates: [] })).error), 'revocation-fences-late-relationship-job');
  check(ok(await service.rpc('pet_relationship_enabled', { p_pet: A.pet, p_space: space })) === false, 'revocation-disables-independent-learning');
  for (const member of [A, B]) ok(await service.rpc('set_pet_relationship_consent', { p_actor: member.id, p_pet: A.pet, p_space: space, p_decision: true }));
  const currentSource = await send('同名是我的朋友，我们刚确认过。');
  await finish(currentSource.message.id, A.pet, 'relationship', [{ subject_id: A.id, object_id: B.id, relation: '朋友', quote: '同名是我的朋友，我们刚确认过。', assertion: 'self_stated', operation: 'assert' }]);
  check(ok(await service.rpc('get_pet_personality_context', { p_pet: A.pet, p_space: space })).relationships.length === 1, 'fresh-authorized-source-can-form-new-understanding');
  ok(await service.from('messages').delete().eq('id', currentSource.message.id).select('id').single());
  check(ok(await service.rpc('get_pet_personality_context', { p_pet: A.pet, p_space: space })).relationships.length === 0, 'deleted-group-source-immediately-invalidates-understanding');
  const joinSource = await send('同名也是我的同事，这是新的关系说明。');
  const joinJob = ok(await service.from('pet_learning_jobs').select('id').eq('source_id', joinSource.message.id).eq('kind', 'relationship').single());
  const joinClaim = ok(await service.rpc('claim_pet_learning_job', { p_job: joinJob.id }));
  const C = await account('新成员');
  ok(await service.from('space_members').insert({ space_id: space, user_id: C.id, role: 'member' }));
  check(ok(await service.rpc('pet_relationship_enabled', { p_pet: A.pet, p_space: space })) === false, 'new-member-requires-a-new-all-member-consent-round');
  check(Boolean((await service.rpc('finish_pet_learning_job', { p_job: joinJob.id, p_token: joinClaim.job.lease_token, p_candidates: [] })).error), 'membership-change-rejects-late-relationship-task');
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} finally {
  for (const id of spaces) ok(await service.from('spaces').delete().eq('id', id));
  for (const id of users) ok(await service.auth.admin.deleteUser(id));
}
