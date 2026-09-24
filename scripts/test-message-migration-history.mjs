import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

assert.equal(process.env.SUPABASE_URL, 'http://127.0.0.1:47321', 'isolated_fixture_required');
const auth = { persistSession: false, autoRefreshToken: false };
const service = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth });
const path = 'test-results/message-migration-history.json';
const ok = result => { if (result.error) throw new Error(result.error.message); return result.data; };
if (process.env.MIGRATION_PHASE === 'seed') {
  const users = [];
  async function account() {
    const email = `migration-history-${crypto.randomUUID()}@example.test`, password = `Aa1!${crypto.randomUUID()}`;
    const id = ok(await service.auth.admin.createUser({ email, password, email_confirm: true })).user.id;
    users.push(id);
    ok(await service.from('profiles').insert({ id, email, nickname: '历史迁移验收' }));
    const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth });
    ok(await client.auth.signInWithPassword({ email, password }));
    return { id, client };
  }
  const a = await account(), b = await account();
  const space = ok(await a.client.rpc('create_relationship_space', { space_name: '历史元数据迁移测试', space_kind: 'friend_circle' }));
  ok(await service.from('space_members').insert({ space_id: space, user_id: b.id, role: 'member' }));
  const send = () => b.client.rpc('send_space_message_v2', { message_client_id: crypto.randomUUID(), target_space_id: space, message_kind: 'text', message_text: '迁移前的人类消息' });
  const first = ok(await send());
  ok(await a.client.rpc('mark_space_read_through', { target_space_id: space, through_message_id: first.message.id }));
  const second = ok(await send());
  const messages = ok(await service.from('messages').select('id,created_at,updated_at').in('id', [first.message.id, second.message.id]));
  const member = ok(await service.from('space_members').select('last_read_at').eq('space_id', space).eq('user_id', a.id).single());
  await mkdir('test-results', { recursive: true });
  await writeFile(path, JSON.stringify({ users, space, owner: a.id, first: first.message.id, messages, readAt: member.last_read_at }));
  console.log('Historical fixture seeded: two accounts, two human messages, first message read.');
} else if (process.env.MIGRATION_PHASE === 'verify') {
  const saved = JSON.parse(await readFile(path, 'utf8'));
  try {
    const rows = ok(await service.from('messages').select('id,created_at,updated_at,space_sequence,sync_sequence').in('id', saved.messages.map(m => m.id)));
    for (const old of saved.messages) {
      const row = rows.find(r => r.id === old.id);
      assert.equal(row.created_at, old.created_at, 'created_at_preserved');
      assert.equal(row.updated_at, old.updated_at, 'updated_at_preserved');
      assert.ok(row.space_sequence > 0 && row.sync_sequence > 0, 'historical_cursors_backfilled');
    }
    const member = ok(await service.from('space_members').select('last_read_at,last_read_sequence').eq('space_id', saved.space).eq('user_id', saved.owner).single());
    assert.equal(member.last_read_at, saved.readAt, 'legacy_timestamp_preserved');
    assert.equal(member.last_read_sequence, rows.find(r => r.id === saved.first).space_sequence, 'legacy_read_cursor_backfilled_without_marking_newer_message');
    assert.equal(rows.filter(r => r.space_sequence > member.last_read_sequence).length, 1, 'unread_message_still_unread');
    console.log(JSON.stringify({ passed: 9, checks: ['human-message metadata timestamps preserved', 'message/sync cursors backfilled', 'legacy read timestamp preserved', 'read cursor retains only read messages'] }));
  } finally {
    ok(await service.from('spaces').delete().eq('id', saved.space));
    for (const id of saved.users) ok(await service.auth.admin.deleteUser(id));
  }
} else { throw new Error('Set MIGRATION_PHASE to seed or verify'); }
