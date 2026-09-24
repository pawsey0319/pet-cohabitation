import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { writeFile } from 'node:fs/promises';
assert.equal(process.env.SUPABASE_URL, 'http://127.0.0.1:47321', 'isolated_fixture_required');
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const users = [], checks = []; let space;
const ok = result => { if (result.error) throw Error(result.error.message); return result.data; };
async function account(name) {
  const email = `relation-direction-${crypto.randomUUID()}@example.test`, password = `Aa1!${crypto.randomUUID()}`;
  const id = ok(await service.auth.admin.createUser({ email, password, email_confirm: true })).user.id; users.push(id);
  ok(await service.from('profiles').insert({ id, email, nickname: name }));
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, options);
  ok(await client.auth.signInWithPassword({ email, password })); return { id, client };
}
try {
  const a = await account('甲'), b = await account('乙'), c = await account('丙');
  const pet = ok(await service.from('pets').insert({ owner_id: a.id, name: '方向验收宠' }).select('id').single()).id;
  space = ok(await a.client.rpc('create_relationship_space', { space_name: '关系归因验收', space_kind: 'friend_circle' }));
  ok(await service.from('space_members').insert([b, c].map(member => ({ space_id: space, user_id: member.id, role: 'member' }))));
  ok(await service.from('space_pet_permissions').upsert({ space_id: space, pet_id: pet, owner_id: a.id, participation_enabled: true }));
  for (const member of [a, b, c]) ok(await service.rpc('set_pet_relationship_consent', { p_actor: member.id, p_pet: pet, p_space: space, p_decision: true }));
  for (const test of [
    { name: 'subject_speaker_is_self_stated', speaker: a, subject: a.id, object: b.id, relation: '同事', text: '我和乙是同事。', assertion: 'self_stated', expected: 'self_stated', state: 'active' },
    { name: 'object_speaker_is_self_stated_without_reversing_father', speaker: a, subject: b.id, object: a.id, relation: '父亲', text: '乙是我的父亲。', assertion: 'self_stated', expected: 'self_stated', state: 'active' },
    { name: 'third_party_cannot_self_confirm', speaker: c, subject: b.id, object: a.id, relation: '父亲', text: '乙是甲的父亲，我是丙。', assertion: 'self_stated', expected: 'reported', state: 'reported' },
    { name: 'participant_report_is_not_promoted', speaker: a, subject: b.id, object: a.id, relation: '朋友', text: '据说乙觉得我们是朋友。', assertion: 'reported', expected: 'reported', state: 'reported' },
    { name: 'uncertain_participant_stays_pending', speaker: a, subject: b.id, object: a.id, relation: '合作伙伴', text: '我还不能确定乙与我算不算合作伙伴。', assertion: 'uncertain', expected: 'uncertain', state: 'pending' },
  ]) {
    const source = ok(await test.speaker.client.rpc('send_space_message_v2', { message_client_id: crypto.randomUUID(), target_space_id: space, message_kind: 'text', message_text: test.text })).message.id;
    const job = ok(await service.from('pet_learning_jobs').select('id').eq('pet_id', pet).eq('source_id', source).eq('kind', 'relationship').single());
    const claim = ok(await service.rpc('claim_pet_learning_job', { p_job: job.id })); assert.ok(claim);
    ok(await service.rpc('finish_pet_learning_job', { p_job: job.id, p_token: claim.job.lease_token, p_candidates: [{ subject_id: test.subject, object_id: test.object, relation: test.relation, quote: test.text, assertion: test.assertion, operation: 'assert' }] }));
    const actual = ok(await service.from('pet_group_relationships').select('subject_id,object_id,speaker_id,relation,assertion,state').eq('pet_id', pet).eq('source_id', source).single());
    assert.deepEqual(actual, { subject_id: test.subject, object_id: test.object, speaker_id: test.speaker.id, relation: test.relation, assertion: test.expected, state: test.state }, test.name);
    checks.push(test.name);
  }
  await writeFile('test-results/relationship-attribution-local.json', JSON.stringify({ passed: checks.length, checks }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, checks }));
} finally {
  if (space) ok(await service.from('spaces').delete().eq('id', space));
  for (const id of users) ok(await service.auth.admin.deleteUser(id));
}
