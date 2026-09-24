// Runs the actual Edge handlers over loopback HTTP with real local Auth/DB.
// The Deno.serve interception only mounts handlers; business logic is unchanged.
import assert from 'node:assert/strict';
import { createClient } from 'npm:@supabase/supabase-js@2';

const url = Deno.env.get('SUPABASE_URL');
assert.equal(url, 'http://127.0.0.1:47321', 'isolated_fixture_required');
assert.equal(Deno.env.get('MODEL_MOCK_MODE'), 'true', 'external_model_calls_forbidden');
const auth = { persistSession: false, autoRefreshToken: false };
const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), { auth });
const serve = Deno.serve, handlers = [], users = [], spaces = [], checks = [];
const ok = result => { if (result.error) throw new Error(result.error.message); return result.data; };
const check = (condition, label) => { assert.ok(condition, label); checks.push(label); };
let server;
const stop = new AbortController();
async function account(name, withPet) {
  const email = `personality-http-${crypto.randomUUID()}@example.test`, password = `Aa1!${crypto.randomUUID()}`;
  const id = ok(await service.auth.admin.createUser({ email, password, email_confirm: true })).user.id;
  users.push(id);
  ok(await service.from('profiles').insert({ id, email, nickname: name }));
  const client = createClient(url, Deno.env.get('SUPABASE_ANON_KEY'), { auth });
  const session = ok(await client.auth.signInWithPassword({ email, password })).session;
  const pet = withPet ? ok(await service.from('pets').insert({ owner_id: id, name: `${name}宠`, seed_summary: '温柔独立的伙伴', personality_seed_prompt: 'synthetic-internal-seed-must-not-be-returned' }).select('id').single()).id : null;
  return { id, client, token: session.access_token, pet };
}
async function call(path, user, body) {
  const response = await fetch(`http://127.0.0.1:47329/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user.token}` } : {}) }, body: JSON.stringify(body) });
  const value = await response.json();
  return { status: response.status, value, cache: response.headers.get('Cache-Control') };
}

try {
  Deno.serve = handler => { handlers.push(handler); };
  await import('../supabase/functions/pet-personality/index.ts');
  await import('../supabase/functions/space-relationship-consent/index.ts');
  Deno.serve = serve;
  assert.equal(handlers.length, 2);
  server = serve({ hostname: '127.0.0.1', port: 47329, signal: stop.signal, onListen() {} }, request => {
    const path = new URL(request.url).pathname;
    return path === '/personality' ? handlers[0](request) : path === '/consent' ? handlers[1](request) : new Response(null, { status: 404 });
  });
  const a = await account('主人', true), member = await account('没有养宠的成员', false), outsider = await account('群外账号', true);
  const state = await call('personality', a, { action: 'state' });
  check(state.status === 200 && state.value.state.pet_id === a.pet, 'owner-can-read-own-personality-over-http');
  check(state.value.seed === '温柔独立的伙伴' && !JSON.stringify(state.value).includes('synthetic-internal-seed'), 'public-state-never-exposes-internal-seed-prompt');
  check(state.cache === 'no-store', 'personal-api-disables-http-response-caching');
  const request = crypto.randomUUID(), payload = { action: 'pause', request_id: request, expected_revision: state.value.state.revision };
  const paused = await call('personality', a, payload);
  check(paused.status === 200 && paused.value.paused === true, 'owner-mutation-is-committed-over-http');
  const replay = await call('personality', a, payload);
  check(replay.status === 200 && replay.value.revision === paused.value.revision, 'http-retry-reuses-management-receipt');
  const stale = await call('personality', a, { action: 'resume', request_id: crypto.randomUUID(), expected_revision: state.value.state.revision });
  check(stale.status >= 400 && stale.value.error === 'personality_version_conflict', 'http-version-conflict-rejects-stale-mutation');
  const forged = await call('personality', outsider, { action: 'state', pet_id: a.pet, owner_id: a.id });
  check(forged.status === 200 && forged.value.state.pet_id === outsider.pet && forged.value.state.pet_id !== a.pet, 'foreign-pet-id-cannot-override-authenticated-owner');
  const noPet = await call('personality', member, { action: 'state', pet_id: a.pet });
  check(noPet.status >= 400 && !noPet.value.state, 'member-without-pet-cannot-read-another-owners-private-state');
  const unauthenticated = await call('personality', null, { action: 'state' });
  check(unauthenticated.status === 401, 'missing-authentication-is-rejected');

  const space = ok(await a.client.rpc('create_relationship_space', { space_name: 'HTTP 独立授权验收', space_kind: 'friend_circle' }));
  spaces.push(space);
  ok(await service.from('space_members').insert({ space_id: space, user_id: member.id, role: 'member' }));
  ok(await service.from('space_pet_permissions').upsert({ space_id: space, pet_id: a.pet, owner_id: a.id, participation_enabled: true }));
  const scope = { space_id: space, pet_id: a.pet };
  const memberState = await call('consent', member, { action: 'state', ...scope });
  check(memberState.status === 200 && memberState.value.pet.id === a.pet && memberState.value.enabled === false, 'group-member-does-not-need-own-pet-to-view-consent');
  const ownerAgrees = await call('consent', a, { action: 'decide', ...scope, decision: true });
  check(ownerAgrees.status === 200 && ownerAgrees.value.enabled === false, 'owner-alone-cannot-enable-group-learning');
  const memberAgrees = await call('consent', member, { action: 'decide', ...scope, decision: true });
  check(memberAgrees.status === 200 && memberAgrees.value.enabled === true && memberAgrees.value.votes.some(v => v.member_id === member.id && v.consented), 'member-without-pet-can-complete-independent-all-member-consent');
  const outsideState = await call('consent', outsider, { action: 'state', ...scope });
  const outsideDecision = await call('consent', outsider, { action: 'decide', ...scope, decision: true });
  check(outsideState.status === 403 && outsideDecision.status === 403 && outsideDecision.value.error === 'not_space_member', 'non-member-cannot-read-or-vote-on-group-consent');
  const withdrew = await call('consent', member, { action: 'decide', ...scope, decision: false });
  check(withdrew.status === 200 && withdrew.value.enabled === false && withdrew.value.scope.epoch > memberAgrees.value.scope.epoch, 'http-withdrawal-disables-learning-and-advances-consent-epoch');
  const report = { passed: checks.length, real_http: true, real_local_auth_db: true, external_models: false, checks };
  await Deno.writeTextFile('test-results/personality-http.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  Deno.serve = serve;
  stop.abort();
  if (server) await server.finished;
  for (const id of spaces) ok(await service.from('spaces').delete().eq('id', id));
  for (const id of users) ok(await service.auth.admin.deleteUser(id));
}
