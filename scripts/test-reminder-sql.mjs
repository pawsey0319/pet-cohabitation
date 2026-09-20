// Full PostgreSQL SQL/ACL tests in one rolled-back transaction. No Expo calls.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const container = process.env.SUPABASE_TEST_DB_CONTAINER ?? "supabase_db_android-companion-validation";
if (!["supabase_db_android-companion-validation","supabase_db_android-final-validation"].includes(container)) throw new Error("Isolated fixture container required");
const probe = spawnSync("docker", ["exec", container, "psql", "-U", "postgres", "-d", "postgres", "-tAc", "select coalesce(to_regclass('public.work_items')::text,''),coalesce(to_regclass('public.reminder_series')::text,'');"], { encoding: "utf8" });
assert.equal(probe.status, 0, probe.stderr);
const [work, reminders] = probe.stdout.trim().split("|");
const migration = path => readFileSync(path, "utf8").replace(/^begin;\s*$/gm, "").replace(/^commit;\s*$/gm, "");
let sql = "begin;\n";
if (!work) sql += migration("supabase/migrations/202609110004_work_collaboration.sql");
if (!reminders) sql += migration("supabase/migrations/202609110005_reminder_delivery.sql");
sql += `
create function pg_temp.assert_true(test boolean, label text) returns void language plpgsql as $$ begin if test is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
select pg_temp.assert_true(reminder_next_at('2026-01-31 09:00','Asia/Shanghai','{"frequency":"monthly","day":31}','2026-01-31T01:00Z')='2026-02-28T01:00Z','month end clamp');
select pg_temp.assert_true(reminder_next_at('2026-01-31 09:00','Asia/Shanghai','{"frequency":"monthly","day":31}','2026-02-28T01:00Z')='2026-03-31T01:00Z','month anchor preserved');
select pg_temp.assert_true(reminder_next_at('2028-01-31 09:00','Asia/Shanghai','{"frequency":"monthly","day":31}','2028-01-31T01:00Z')='2028-02-29T01:00Z','leap clamp');
select pg_temp.assert_true(reminder_next_at('2026-03-07 09:00','America/New_York','{"frequency":"daily"}','2026-03-07T14:00Z')='2026-03-08T13:00Z','DST daily preserves wall clock');
select pg_temp.assert_true(reminder_next_at('2026-03-08 02:30','America/New_York','{"frequency":"once"}','2026-03-07T00:00Z')='2026-03-08T07:30Z','DST gap standard offset');
select pg_temp.assert_true(reminder_next_at('2026-11-01 01:30','America/New_York','{"frequency":"once"}','2026-10-31T00:00Z')='2026-11-01T06:30Z','DST overlap fires once at standard offset');
select pg_temp.assert_true(reminder_next_at('2026-09-11 09:00','Asia/Shanghai','{"frequency":"weekdays"}','2026-09-11T01:00Z')='2026-09-14T01:00Z','weekend excluded');
select pg_temp.assert_true(reminder_next_at('2026-09-11 09:00','Asia/Shanghai','{"frequency":"weekly","weekdays":[2,4]}','2026-09-11T01:00Z')='2026-09-15T01:00Z','selected weekdays');
select pg_temp.assert_true(reminder_next_at('2026-03-07 09:00','America/New_York','{"frequency":"interval","interval":2,"unit":"day"}','2026-03-07T14:00Z')='2026-03-09T13:00Z','custom calendar days DST');
select pg_temp.assert_true(reminder_next_at('2026-09-11 09:00','Asia/Shanghai','{"frequency":"daily","until":"2026-09-12"}','2026-09-12T01:00Z') is null,'inclusive end date stops');
select pg_temp.assert_true(reminder_next_at('2026-09-11 09:00','Asia/Shanghai','{"frequency":"daily","until":"2026-09-12"}','2026-09-11T01:00Z')='2026-09-12T01:00Z','includes end date');
insert into auth.users(id,email) values('ab111111-1111-4111-8111-111111111111','reminder-test-a@example.test'),('ab222222-2222-4222-8222-222222222222','reminder-test-b@example.test');
insert into profiles(id,email,nickname) values('ab111111-1111-4111-8111-111111111111','reminder-test-a@example.test','reminder-a'),('ab222222-2222-4222-8222-222222222222','reminder-test-b@example.test','reminder-b');
select set_config('request.jwt.claim.sub','ab111111-1111-4111-8111-111111111111',true);
do $$
declare a uuid:='ab111111-1111-4111-8111-111111111111'; b uuid:='ab222222-2222-4222-8222-222222222222';
  cmd jsonb; result jsonb; original jsonb; changed jsonb; s uuid; original_next timestamptz; count_events integer; token_a uuid; token_b uuid; event_a uuid; claimed record; payload jsonb; n integer;
begin
  cmd:='{"action":"create","request_id":"reminder-test-create","input":{"content":"do not leak task title","timezone":"Asia/Shanghai","start_local":"2050-01-31T09:00","rule":{"frequency":"monthly","day":31}}}';
  result:=manage_reminder(cmd); original:=result; s:=(result->'series'->>'id')::uuid; original_next:=(result->'series'->>'next_at')::timestamptz;
  perform pg_temp.assert_true(manage_reminder(cmd)=result,'immutable request replay');
  begin perform manage_reminder(jsonb_set(cmd,'{input,content}','"different"')); raise exception 'test_expected_conflict'; exception when others then if sqlerrm<>'request_content_mismatch' then raise; end if; end;
  begin perform manage_reminder(jsonb_build_object('action','edit','request_id','reminder-test-stale','series_id',s,'expected_version',9,'input',jsonb_build_object('content','changed'))); raise exception 'test_expected_version_conflict'; exception when others then if sqlerrm<>'version_conflict' then raise; end if; end;
  result:=manage_reminder(jsonb_build_object('action','skip','request_id','reminder-test-skip','series_id',s,'expected_version',1,'scheduled_at',original_next));
  perform pg_temp.assert_true((select status='skipped' from reminder_occurrences where series_id=s and scheduled_at=original_next),'skip materialized');
  perform pg_temp.assert_true((result->'series'->>'version')::integer=2,'skip increments version');
  perform pg_temp.assert_true((result->'series'->>'next_at')::timestamptz='2050-02-28T01:00Z','skip advances next occurrence');
  result:=manage_reminder(jsonb_build_object('action','edit','request_id','reminder-test-only','series_id',s,'expected_version',2,'scope','only','scheduled_at',original_next,'input',jsonb_build_object('start_local','2050-01-31T10:00','content','one exception')));
  perform pg_temp.assert_true((select deliver_at='2050-01-31T02:00Z' and status='pending' from reminder_occurrences where series_id=s and scheduled_at=original_next),'only override unskips');
  perform pg_temp.assert_true((select next_at='2050-02-28T01:00Z' and rule->>'day'='31' from reminder_series where id=s),'only preserves rule');
  result:=manage_reminder(jsonb_build_object('action','edit','request_id','reminder-test-future','series_id',s,'expected_version',3,'scope','future','scheduled_at','2050-02-28T01:00Z','input',jsonb_build_object('start_local','2050-02-28T10:00')));
  perform pg_temp.assert_true((result->'series'->>'parent_id')::uuid=s,'future splits series');
  perform pg_temp.assert_true((select series_version=4 and status='pending' from reminder_occurrences where series_id=s and scheduled_at=original_next),'earlier exception remains valid');
  perform pg_temp.assert_true((select stop_before='2050-02-28T01:00Z' from reminder_series where id=s),'future exact cutoff');
  -- Manufacture a due instant inside this rolled-back fixture only.
  update reminder_series set next_at=now()-interval '1 minute',start_local=(now()-interval '1 minute') at time zone timezone,rule='{"frequency":"once"}',stop_before=null where id=s;
  n:=reminder_dispatch_due(a); perform pg_temp.assert_true(n=1,'due event enqueue');
  perform pg_temp.assert_true(reminder_dispatch_due(a)=0,'dispatch replay no duplicate');
  select e.id into event_a from notification_events e where e.user_id=a and e.payload->>'reminder_series_id'=s::text;
  perform pg_temp.assert_true(event_a is not null,'event persisted before success');
  token_a:=register_push_device_v2('ExponentPushToken[testtoken111111111111111111111111]','fixture a','android');
  token_b:=register_push_device_v2('ExponentPushToken[testtoken222222222222222222222222]','fixture b','android');
  for claimed in select * from claim_notification_deliveries(10) loop
    payload:=prepare_notification_delivery(claimed.id,claimed.lease_id);
    perform pg_temp.assert_true(payload->>'title'='异宠' and payload->>'body'='你设置的提醒到时间了','lockscreen title and body private');
    perform pg_temp.assert_true(payload->>'channelId'='reminders-v2','reminder dedicated channel');
    if claimed.device_id=token_a then perform finish_notification_ticket(claimed.id,claimed.lease_id,'ticket-fixture',null);
    else perform finish_notification_ticket(claimed.id,claimed.lease_id,null,'MessageRateExceeded'); end if;
  end loop;
  perform pg_temp.assert_true((select count(*)=1 from notification_deliveries where event_id=event_a and status='ticket_accepted'),'one accepted device');
  perform pg_temp.assert_true((select count(*)=1 from notification_deliveries where event_id=event_a and status='retry'),'only failing device retries');
  perform pg_temp.assert_true((select count(*)=0 from claim_notification_deliveries(10)),'leased or backoff no duplicate claims');
  update notification_deliveries set next_attempt_at=now()-interval '1 second' where event_id=event_a and status='retry';
  for claimed in select * from claim_notification_deliveries(10) loop
    perform pg_temp.assert_true(claimed.device_id=token_b,'accepted device not replayed');
    perform prepare_notification_delivery(claimed.id,claimed.lease_id);
    update notification_deliveries set lease_until=now()-interval '1 second' where id=claimed.id;
  end loop;
  perform claim_notification_deliveries(10);
  perform pg_temp.assert_true((select status='receipt_unknown' from notification_deliveries where event_id=event_a and device_id=token_b),'unknown HTTP outcome is not blindly replayed');
  perform unregister_push_device(token_a);
  perform pg_temp.assert_true((select not enabled from device_push_tokens where id=token_a),'logout unbinds own device');
  perform pg_temp.assert_true((select enabled from device_push_tokens where id=token_b),'logout preserves other device');
  perform set_config('request.jwt.claim.sub',b::text,true);
  begin perform manage_reminder(jsonb_build_object('action','cancel','request_id','reminder-test-outsider','series_id',s,'expected_version',4)); raise exception 'test_expected_notfound'; exception when others then if sqlerrm<>'reminder_not_found' then raise; end if; end;
  perform pg_temp.assert_true(resolve_notification_target(event_a)->>'state'='unavailable','cross account deep link denied');
end $$;
set local role authenticated;
select pg_temp.assert_true((select count(*)=0 from reminder_series),'RLS hides other account series');
select pg_temp.assert_true((select count(*)=0 from notification_deliveries),'RLS hides other account delivery');
reset role;
select set_config('request.jwt.claim.sub','ab111111-1111-4111-8111-111111111111',true);
do $$
<<group_test>>
declare a uuid:='ab111111-1111-4111-8111-111111111111'; b uuid:='ab222222-2222-4222-8222-222222222222';
  space uuid; item uuid; event_id uuid; token uuid; delivery record; result jsonb; s uuid; payload jsonb;
begin
  space:=create_relationship_space('提醒权限测试','friend_circle');
  insert into space_members(space_id,user_id,role) values(space,b,'member');
  insert into work_items(owner_id,space_id,kind,title,assignee_id,participants,status,publication,terms_expires_at)
    values(a,space,'task','需本人确认的安排',b,array[b],'pending_acceptance','published',now()+interval '1 day') returning id into item;
  insert into work_item_confirmations(item_id,terms_version,user_id,decision) values(item,1,b,'pending');
  insert into work_item_events(item_id,actor_id,event_kind,item_version,recipients) values(item,a,'publish',1,array[b]);
  select e.id into event_id from notification_events e where e.user_id=b and e.entity_id=item;
  perform pg_temp.assert_true(event_id is not null,'formal confirmation creates notification transactionally');
  perform set_config('request.jwt.claim.sub',b::text,true);
  token:=register_push_device_v2('ExponentPushToken[groupfixture111111111111111111111]','group fixture','android');
  select * into delivery from claim_notification_deliveries(50) d where d.event_id=group_test.event_id;
  perform pg_temp.assert_true(delivery.id is not null,'confirmation delivery claimed');
  update work_item_confirmations set decision='agreed' where item_id=item and user_id=b;
  update work_items set accepted_terms_version=1 where id=item;
  perform pg_temp.assert_true(prepare_notification_delivery(delivery.id,delivery.lease_id) is null,'late confirmation push suppressed after acceptance');
  result:=manage_reminder(jsonb_build_object('action','create','request_id','group-own-reminder','input',jsonb_build_object('content','只提醒本人','timezone','Asia/Shanghai','start_local','2050-01-01T09:00','work_item_id',item,'rule',jsonb_build_object('frequency','once'))));
  s:=(result->'series'->>'id')::uuid;
  delete from space_members where space_id=space and user_id=b;
  update reminder_series set next_at=now()-interval '1 minute' where id=s;
  perform pg_temp.assert_true(reminder_dispatch_due(b)=0,'leaving group stops associated reminder');
  perform pg_temp.assert_true((select status='cancelled' from reminder_series where id=s),'revoked source is cancelled');
  perform pg_temp.assert_true(resolve_notification_target(event_id)->>'state'='forbidden','deep link checks current membership');
  -- A cancelled series invalidates a worker claim before its final HTTP gate.
  result:=manage_reminder('{"action":"create","request_id":"cancel-race-create","input":{"content":"取消并发","timezone":"Asia/Shanghai","start_local":"2050-01-01T09:00","rule":{"frequency":"once"}}}');
  s:=(result->'series'->>'id')::uuid;
  update reminder_series set next_at=now()-interval '1 minute',start_local=(now()-interval '1 minute') at time zone timezone where id=s;
  perform reminder_dispatch_due(b);
  select e.id into event_id from notification_events e where e.user_id=b and e.payload->>'reminder_series_id'=s::text;
  select * into delivery from claim_notification_deliveries(50) d where d.event_id=group_test.event_id;
  perform manage_reminder(jsonb_build_object('action','cancel','request_id','cancel-race-action','series_id',s,'expected_version',1));
  perform pg_temp.assert_true(prepare_notification_delivery(delivery.id,delivery.lease_id) is null,'cancellation stops leased send');
  perform block_notification_owner(b);
  begin perform register_push_device_v2('ExponentPushToken[blocked11111111111111111111111111]','late','android'); raise exception 'test_expected_account_block'; exception when others then if sqlerrm<>'account_deleting' then raise; end if; end;
  perform pg_temp.assert_true(not notification_event_allowed(event_id),'deletion block stops event');
end $$;
rollback;
`;
const result = spawnSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], { input: sql, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
if (result.status !== 0) { console.error(result.stderr); process.exit(result.status || 1); }
console.log("PASS reminder SQL: month clamp/leap/DST/weekdays/custom/enddate, immutable requests, version conflicts, only/future/skip, transaction dispatch, per-device retry/lease, private lockscreen, logout, cross-account ACL; all fixture changes rolled back.");
