import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { spawn } from 'node:child_process';
const url = process.env.SUPABASE_URL;
assert.equal(url, 'http://127.0.0.1:47321', 'isolated_companion_fixture_required');
const auth = { persistSession: false, autoRefreshToken: false };
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth });
const users = [], spaces = [], checks = [];
function ok(result) { if (result.error) throw new Error(result.error.message); return result.data; }
function check(value, name) { assert.ok(value, name); checks.push(name); }
function sql(text) {
  // Only this fixed local fixture; never accept a cloud DSN or arbitrary container.
  const args = ['exec', '-i', 'supabase_db_android-companion-validation', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'];
  const inWsl = process.env.SUPABASE_TEST_DOCKER_RUNTIME === 'wsl';
  return new Promise((resolve, reject) => {
    const child = spawn(inWsl ? 'wsl.exe' : 'docker', inWsl ? ['-d', 'Ubuntu', '-u', 'root', '--', 'env', 'DOCKER_HOST=unix:///var/run/docker.sock', '/usr/bin/docker', ...args] : args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', error = ''; child.stdout.on('data', value => { output += value; }); child.stderr.on('data', value => { error += value; });
    child.on('error', reject); child.on('close', code => code === 0 ? resolve(output.trim()) : reject(new Error(`fixture_sql_failed: ${error.slice(-500)}`)));
    child.stdin.end(text);
  });
}
async function account() {
  const email = `read-cursor-${crypto.randomUUID()}@example.test`, password = `Aa1!${crypto.randomUUID()}`;
  const user = ok(await service.auth.admin.createUser({ email, password, email_confirm: true })).user; users.push(user.id);
  ok(await service.from('profiles').insert({ id: user.id, email, nickname: '游标验收' }));
  const client = createClient(url, process.env.SUPABASE_ANON_KEY, { auth });
  ok(await client.auth.signInWithPassword({ email, password }));
  return { id: user.id, client };
}
try {
  const A = await account(), B = await account(), outsider = await account();
  const space = ok(await A.client.rpc('create_relationship_space', { space_name: '已读游标临时验收', space_kind: 'friend_circle' })); spaces.push(space);
  ok(await service.from('space_members').insert({ space_id: space, user_id: B.id, role: 'member' }));
  const send = (who, id, text = '测试普通消息') => who.client.rpc('send_space_message_v2', { message_client_id: id, target_space_id: space, message_kind: 'text', message_text: text });
  const firstId = crypto.randomUUID(), first = ok(await send(B, firstId)), second = ok(await send(B, crypto.randomUUID()));
  check(first.message.space_sequence < second.message.space_sequence, 'committed-messages-have-increasing-sequence');
  const repeated = ok(await send(B, firstId));
  check(repeated.message.id === first.message.id && repeated.message.space_sequence === first.message.space_sequence, 'retry-reuses-receipt-without-increment');
  check(Boolean((await send(B, firstId, '不同正文')).error), 'request-content-cannot-change');
  const sameTime = '2026-09-20T00:00:00Z';
  await sql(`begin; select set_config('request.jwt.claims','${JSON.stringify({sub:B.id,role:'authenticated'})}',true); update public.messages set created_at='${sameTime}' where id in ('${first.message.id}','${second.message.id}'); commit;`);
  check(ok(await service.from('messages').select('created_at').in('id', [first.message.id, second.message.id])).every(row => Date.parse(row.created_at) === Date.parse(sameTime)), 'test-rows-really-share-a-timestamp');
  const read = ok(await A.client.rpc('mark_space_read_v3', { target_space_id: space, through_message_id: first.message.id }));
  check(read.read_sequence === first.message.space_sequence && read.unread_count === 1, 'same-timestamp-does-not-mark-later-message-read');
  const row = ok(await A.client.rpc('list_my_spaces_v3')).find(row => row.id === space);
  check(row.unread_count === 1 && row.last_read_sequence === read.read_sequence, 'space-list-and-read-receipt-agree');
  const batch = (await Promise.all(Array.from({ length: 8 }, () => send(B, crypto.randomUUID())))).map(ok);
  check(new Set(batch.map(value => value.message.space_sequence)).size === 8, 'concurrent-sends-have-distinct-cursors');
  const sameTimeMessages = [first.message, second.message, ...batch.map(value => value.message)].sort((a, b) => b.space_sequence - a.space_sequence);
  await sql(`begin; select set_config('request.jwt.claims','${JSON.stringify({sub:B.id,role:'authenticated'})}',true); update public.messages set created_at='${sameTime}' where space_id='${space}'; commit;`);
  check(ok(await service.from('messages').select('created_at').eq('space_id', space)).every(row => Date.parse(row.created_at) === Date.parse(sameTime)), 'all-history-pagination-fixtures-share-a-timestamp');
  const paged = [];
  let beforeSequence = null;
  for (let page = 0; page < 6; page++) {
    const rows = ok(await A.client.rpc('list_space_messages_v3', { target_space_id: space, before_sequence: beforeSequence, page_size: 3 }));
    paged.push(...rows);
    if (!rows.length) break;
    beforeSequence = rows.at(-1).space_sequence;
  }
  check(JSON.stringify(paged.map(row => row.id)) === JSON.stringify(sameTimeMessages.map(row => row.id)), 'sequence-history-pagination-has-no-duplicates-or-omissions');
  check(paged.every((row, index) => !index || paged[index - 1].space_sequence > row.space_sequence), 'same-time-history-order-follows-insertion-sequence');
  const anchor = sameTimeMessages[4];
  const legacyPage = ok(await A.client.rpc('list_space_messages_v3', { target_space_id: space, before_message_id: anchor.id, before_at: '1999-01-01T00:00:00Z', page_size: 3 }));
  check(JSON.stringify(legacyPage.map(row => row.id)) === JSON.stringify(sameTimeMessages.slice(5, 8).map(row => row.id)), 'old-cache-message-id-resolves-sequence-before-timestamp-fallback');
  const anchored = ok(await A.client.rpc('list_space_messages_v3', { target_space_id: space, anchor_id: anchor.id, page_size: 4 }));
  check(JSON.stringify(anchored.map(row => row.id)) === JSON.stringify(sameTimeMessages.slice(4, 8).map(row => row.id)), 'notification-anchor-includes-target-and-immediately-preceding-messages');
  check(ok(await A.client.rpc('list_space_messages_v3', { target_space_id: space, anchor_id: crypto.randomUUID() })).length === 0, 'unknown-anchor-does-not-return-unrelated-history');
  const latest = batch.reduce((a, b) => a.message.space_sequence > b.message.space_sequence ? a : b);
  const complete = ok(await A.client.rpc('mark_space_read_v3', { target_space_id: space, through_message_id: latest.message.id }));
  check(complete.unread_count === 0, 'latest-visible-message-clears-unread');
  const lateOld = ok(await A.client.rpc('mark_space_read_v3', { target_space_id: space, through_message_id: first.message.id }));
  check(lateOld.read_sequence === complete.read_sequence, 'late-old-read-cannot-regress');
  const fresh = ok(await send(B, crypto.randomUUID()));
  const oldAfterFresh = ok(await A.client.rpc('mark_space_read_v3', { target_space_id: space, through_message_id: latest.message.id }));
  check(oldAfterFresh.unread_count === 1 && oldAfterFresh.latest_sequence === fresh.message.space_sequence, 'old-visible-cursor-does-not-clear-new-arrival');
  const notifications = ok(await service.from('notification_events').select('entity_id,read_at').eq('user_id', A.id).eq('space_id', space).in('kind', ['message', 'mention']));
  check(notifications.some(row => row.entity_id === fresh.message.id && row.read_at === null), 'new-notification-remains-unread');
  check(notifications.filter(row => row.entity_id !== fresh.message.id).every(row => row.read_at !== null), 'visible-message-notifications-marked-read');
  const history = ok(await A.client.rpc('list_space_messages_v2', { target_space_id: space, page_size: 100 }));
  check(history.every(row => Number.isInteger(row.space_sequence)), 'history-transports-sequence');
  const syncBefore = ok(await A.client.rpc('sync_space_messages_v3', { target_space_id: space, after_sequence: 0 }));
  const syncCursor = Math.max(...syncBefore.map(row => row.sync_sequence));
  const lateId = crypto.randomUUID();
  const lateSend = sql(`begin; select set_config('request.jwt.claims','${JSON.stringify({sub:B.id,role:'authenticated'})}',true); select pg_sleep(2); select public.send_space_message_v2('${lateId}','${space}','text','older transaction commits later'); commit;`);
  await new Promise(resolve => setTimeout(resolve, 700));
  const early = ok(await send(B, crypto.randomUUID())); await lateSend;
  const afterEarly = ok(await A.client.rpc('sync_space_messages_v3', { target_space_id: space, after_sequence: early.message.sync_sequence }));
  const late = afterEarly.find(row => row.client_id === lateId);
  check(late && late.sync_sequence > early.message.sync_sequence && Date.parse(late.created_at) < Date.parse(early.message.created_at), 'late-commit-with-older-time-is-not-lost');
  const laterHistory = ok(await A.client.rpc('list_space_messages_v3', { target_space_id: space, page_size: 2 }));
  check(laterHistory[0]?.id === late.id && laterHistory[1]?.id === early.message.id, 'history-keeps-commit-order-when-created-time-moves-backward');
  const beforeLate = ok(await A.client.rpc('list_space_messages_v3', { target_space_id: space, before_message_id: late.id, before_at: late.created_at, page_size: 1 }));
  check(beforeLate[0]?.id === early.message.id, 'legacy-cache-id-does-not-skip-a-newer-timestamp-predecessor');
  check(ok(await A.client.rpc('sync_space_messages_v3', { target_space_id: space, after_sequence: syncCursor })).length >= 2, 'offline-reconnect-recovers-both-commits');
  await sql(`begin; select set_config('request.jwt.claims','${JSON.stringify({sub:B.id,role:'authenticated'})}',true); delete from public.messages where id='${first.message.id}'; commit;`);
  const deletion = ok(await A.client.rpc('sync_space_messages_v3', { target_space_id: space, after_sequence: late.sync_sequence }));
  check(deletion.some(row => row.id === first.message.id && row.deleted_at && row.sync_sequence > late.sync_sequence), 'hard-delete-advances-reconnect-cursor');
  const pet = ok(await service.from('pets').insert({owner_id:B.id,name:'静音测试异宠'}).select('id').single());
  ok(await service.from('space_member_pet_settings').upsert({space_id:space,member_id:A.id,pet_id:pet.id,muted:true}));
  const petMessage = ok(await service.from('messages').insert({client_id:crypto.randomUUID(),space_id:space,sender_id:null,actor_kind:'pet',actor_id:pet.id,actor_name:'静音测试异宠',kind:'text',text:'不会被本人看到的消息'}).select('id').single());
  const allRead = ok(await A.client.rpc('mark_space_read_v3', {target_space_id:space,through_message_id:late.id}));
  check(allRead.unread_count === 0, 'muted-pet-does-not-create-an-unclearable-badge');
  const mutedList = ok(await A.client.rpc('list_my_spaces_v3')).find(row => row.id === space);
  check(mutedList.unread_count === 0 && mutedList.latest_sequence === late.space_sequence, 'list-latest-message-follows-same-visibility');
  check(!ok(await A.client.rpc('sync_space_messages_v3', {target_space_id:space,after_sequence:0})).some(row => row.id === petMessage.id), 'sync-excludes-muted-pet');
  check(!ok(await A.client.rpc('list_space_messages_v3', {target_space_id:space,page_size:100})).some(row => row.id === petMessage.id), 'history-excludes-muted-pet');
  check(Boolean((await outsider.client.rpc('mark_space_read_v3', { target_space_id: space, through_message_id: fresh.message.id })).error), 'outsider-cannot-mark-read');
  check(Boolean((await outsider.client.rpc('list_space_messages_v3', { target_space_id: space, anchor_id: fresh.message.id })).error), 'outsider-cannot-read-anchor-history');
  check(!ok(await outsider.client.rpc('list_my_spaces_v3')).some(row => row.id === space), 'outsider-cannot-list-space');
  ok(await service.from('space_members').delete().eq('space_id', space).eq('user_id', A.id));
  check(Boolean((await A.client.rpc('mark_space_read_v3', { target_space_id: space, through_message_id: fresh.message.id })).error), 'revoked-member-cannot-submit-late-read');
  for (const [label, cursor] of [['page', {before_sequence: late.space_sequence}], ['legacy-cache', {before_message_id: late.id}], ['anchor', {anchor_id: late.id}]]) {
    check(Boolean((await A.client.rpc('list_space_messages_v3', { target_space_id: space, ...cursor })).error), `revoked-member-cannot-read-${label}`);
  }
  console.log(JSON.stringify({ ok: true, checks }, null, 2));
} finally {
  for (const space of spaces) await service.from('spaces').delete().eq('id', space);
  for (const user of users) await service.auth.admin.deleteUser(user);
}
