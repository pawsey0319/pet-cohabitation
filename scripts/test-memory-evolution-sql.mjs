import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const container = process.env.SUPABASE_TEST_DB_CONTAINER ?? "supabase_db_android-companion-validation";
if (!["supabase_db_android-companion-validation","supabase_db_android-final-validation"].includes(container)) throw new Error("Isolated fixture container required");
const probe = spawnSync("docker", ["exec", container, "psql", "-U", "postgres", "-d", "postgres", "-tAc", "select coalesce(to_regclass('public.pet_life_facts')::text,'');"], { encoding: "utf8" });
assert.equal(probe.status, 0, probe.stderr);
const migration = probe.stdout.trim() ? "" : readFileSync("supabase/migrations/202609110009_companion_memory_evolution.sql", "utf8").replace(/^begin;\s*$/gm, "").replace(/^commit;\s*$/gm, "");
const sql = `begin;
${migration}
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$ begin if value is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
insert into auth.users(id,email) values('ac111111-1111-4111-8111-111111111111','memory-life-a@example.test'),('ac222222-2222-4222-8222-222222222222','memory-life-b@example.test');
insert into profiles(id,email,nickname) values('ac111111-1111-4111-8111-111111111111','memory-life-a@example.test','memory-a'),('ac222222-2222-4222-8222-222222222222','memory-life-b@example.test','memory-b');
select set_config('request.jwt.claim.sub','ac111111-1111-4111-8111-111111111111',true);
do $$
declare owner uuid:='ac111111-1111-4111-8111-111111111111'; outsider uuid:='ac222222-2222-4222-8222-222222222222';
  pet uuid; source uuid; second_source uuid; third_source uuid; reply uuid; fact uuid; claim jsonb; context jsonb; result jsonb; preview jsonb; task uuid; rev bigint; cmd jsonb; candidate jsonb;
begin
  insert into pets(owner_id,name) values(owner,'记忆异宠') returning id into pet;
  insert into pet_companion_states(pet_id,owner_id,revision,context_started_at) values(pet,owner,0,null);
  insert into pet_private_threads(pet_id,owner_id,role,content,conversation_kind) values(pet,owner,'owner','我完成了长跑。今天回答简短一点','companion') returning id into source;
  claim:=claim_pet_life_extraction(source);
  perform pg_temp.assert_true(claim is not null,'new owner source queues a lease');
  perform pg_temp.assert_true(claim_pet_life_extraction(source) is null,'live lease cannot be reclaimed');
  perform pg_temp.assert_true(finish_pet_life_extraction(source,(claim->>'token')::uuid,'[{"kind":"experience","label":"长跑","quote":"我完成了长跑","phase":"happened"}]','[{"key":"response_length","value":"concise","quote":"今天回答简短一点"}]')=2,'valid original quote is stored');
  perform pg_temp.assert_true(finish_pet_life_extraction(source,(claim->>'token')::uuid,'[]','[]')=0,'late duplicate finish does not accumulate');
  context:=get_companion_memory_context(pet,null,'长跑');
  perform pg_temp.assert_true(jsonb_array_length(context->'facts')=1 and context->'settings'->>'response_length'='concise','facts and effective style delivered');
  perform pg_temp.assert_true((context->'source_ids') @> to_jsonb(array[source]),'context carries original source for final version checks');
  select id into fact from pet_life_facts where source_message_id=source;
  -- A late source from an earlier topic cannot leak its temporary setting into a new topic.
  insert into pet_private_threads(pet_id,owner_id,role,content,conversation_kind) values(pet,owner,'owner','这次请详细回答','companion') returning id into second_source;
  claim:=claim_pet_life_extraction(second_source);
  update pet_companion_states set context_started_at=clock_timestamp() where pet_id=pet;
  perform finish_pet_life_extraction(second_source,(claim->>'token')::uuid,'[]','[{"key":"response_length","value":"detailed","quote":"这次请详细回答"}]');
  context:=get_companion_memory_context(pet,(select context_started_at from pet_companion_states where pet_id=pet));
  perform pg_temp.assert_true(context->'settings'->>'response_length'='concise','old-topic setting not applied to new topic');
  update pet_interaction_settings set expires_at=clock_timestamp()-interval '1 second' where source_message_id=source;
  context:=get_companion_memory_context(pet,(select context_started_at from pet_companion_states where pet_id=pet));
  perform pg_temp.assert_true(not(context->'settings' ? 'response_length'),'today setting expires');
  rev:=(context->>'revision')::bigint;
  cmd:=jsonb_build_object('action','set_style','request_id',gen_random_uuid(),'expected_revision',rev,'input',jsonb_build_object('key','response_length','value','balanced','scope','permanent','timezone','Asia/Shanghai'));
  result:=manage_memory_evolution(cmd);
  perform pg_temp.assert_true(manage_memory_evolution(cmd)=result,'setting request replay');
  begin perform manage_memory_evolution(jsonb_set(cmd,'{input,value}','"detailed"')); raise exception 'expected_conflict'; exception when others then if sqlerrm<>'memory_request_conflict' then raise; end if; end;
  context:=get_companion_memory_context(pet,'2050-01-01T00:00Z');
  perform pg_temp.assert_true(context->'settings'->>'response_length'='balanced','permanent setting crosses topics');
  -- A model response is not eligible as fact evidence.
  insert into pet_private_threads(pet_id,owner_id,role,content,conversation_kind) values(pet,owner,'pet','我完成了飞行','companion') returning id into third_source;
  perform pg_temp.assert_true(claim_pet_life_extraction(third_source) is null,'assistant text never queues extraction');
  -- Model-invented text and labels must fail literal validation.
  insert into pet_private_threads(pet_id,owner_id,role,content,conversation_kind) values(pet,owner,'owner','我参加了比赛','companion') returning id into third_source;
  claim:=claim_pet_life_extraction(third_source);
  begin perform finish_pet_life_extraction(third_source,(claim->>'token')::uuid,'[{"kind":"experience","label":"冠军","quote":"我拿到了冠军","phase":"happened"}]','[]'); raise exception 'expected_quote_failure'; exception when others then if sqlerrm<>'life_quote_invalid' then raise; end if; end;
  -- Retrospective and continuation cite actual source; dismissal is per owner.
  perform pg_temp.assert_true(get_companion_review(7)->>'has_enough_sources'='true','review has grounded sources');
  insert into work_items(owner_id,kind,title,status,source_private_message_id) values(owner,'task','长跑记录整理','not_started',source) returning id into task;
  candidate:=get_companion_continuation();
  perform pg_temp.assert_true(candidate->>'item_id'=task::text,'continuation reflects real current item');
  perform manage_memory_evolution(jsonb_build_object('action','dismiss','request_id',gen_random_uuid(),'input',jsonb_build_object('fragment_key',candidate->>'fragment_key')));
  perform pg_temp.assert_true(get_companion_continuation() is null,'dismissed unchanged fragment stays hidden');
  -- A reply derived from the fact source must be excluded transitively.
  insert into pet_private_threads(pet_id,owner_id,role,content,conversation_kind,context_message_ids) values(pet,owner,'pet','长跑那次我们聊过','companion',array[source]) returning id into reply;
  preview:=preview_life_memory_forget(fact);
  perform pg_temp.assert_true((preview->'sources') @> to_jsonb(array[reply]),'forget preview includes dependent reply');
  perform pg_temp.assert_true(jsonb_array_length(preview->'private_items')=1,'forget preview includes linked private task');
  insert into work_items(owner_id,kind,title,status,parent_id) values(owner,'task','其下细节','not_started',task);
  begin
    perform manage_memory_evolution(jsonb_build_object('action','forget','request_id',gen_random_uuid(),'fact_id',fact,'expected_version',1,'input',jsonb_build_object('private_items',jsonb_build_array(jsonb_build_object('id',task,'expected_version',1,'action','remove')))));
    raise exception 'expected_children_guard';
  exception when others then if sqlerrm<>'private_item_has_children' then raise; end if; end;
  perform manage_memory_evolution(jsonb_build_object('action','forget','request_id',gen_random_uuid(),'fact_id',fact,'expected_version',1));
  perform pg_temp.assert_true((select status='not_started' from work_items where id=task),'default forgetting does not cancel private tasks');
  perform pg_temp.assert_true((select state='forgotten' from pet_life_facts where id=fact),'fact disabled');
  perform pg_temp.assert_true((select count(*)=2 from pet_private_context_exclusions where message_id in(source,reply)),'source and dependent reply excluded');
  perform pg_temp.assert_true(jsonb_array_length(get_companion_review(7)->'facts')=0 and jsonb_array_length(get_companion_review(7)->'private_items')=0,'forgotten source removed from review');
  perform pg_temp.assert_true((select count(*)=0 from search_companion_life_memory(owner,'长跑')),'forgotten source absent in keyword recall');
  perform pg_temp.assert_true(get_companion_continuation() is null,'forgotten task source absent in continuation');
  perform pg_temp.assert_true(claim_pet_life_extraction(source) is null,'forgotten source cannot be re-extracted');
  insert into pet_private_threads(pet_id,owner_id,role,content,conversation_kind,created_at) values(pet,owner,'owner','我想学游泳','companion',clock_timestamp()-interval '2 minutes') returning id into second_source;
  claim:=claim_pet_life_extraction(second_source);
  perform finish_pet_life_extraction(second_source,(claim->>'token')::uuid,'[{"kind":"goal","label":"学游泳","quote":"我想学游泳","phase":"desired"}]','[]');
  insert into pet_private_threads(pet_id,owner_id,role,content,conversation_kind) values(pet,owner,'owner','我正在学游泳','companion') returning id into third_source;
  claim:=claim_pet_life_extraction(third_source);
  perform finish_pet_life_extraction(third_source,(claim->>'token')::uuid,'[{"kind":"goal","label":"学游泳","quote":"我正在学游泳","phase":"ongoing"}]','[]');
  perform pg_temp.assert_true((select state='superseded' from pet_life_facts where source_message_id=second_source),'explicit new goal phase updates old understanding');
  insert into pet_private_threads(pet_id,owner_id,role,content,conversation_kind,created_at) values(pet,owner,'owner','我计划学游泳','companion',clock_timestamp()-interval '1 minute') returning id into second_source;
  claim:=claim_pet_life_extraction(second_source);
  perform finish_pet_life_extraction(second_source,(claim->>'token')::uuid,'[{"kind":"goal","label":"学游泳","quote":"我计划学游泳","phase":"planned"}]','[]');
  perform pg_temp.assert_true((select count(*)=1 and bool_and(phase='ongoing') from pet_life_facts where pet_id=pet and kind='goal' and state='active'),'late extraction cannot roll back newer understanding');
  select id into fact from pet_life_facts where source_message_id=third_source;
  result:=manage_memory_evolution(jsonb_build_object('action','correct','request_id',gen_random_uuid(),'fact_id',fact,'expected_version',1,'input',jsonb_build_object('label','游泳','quote','我并没有在学游泳，那是刚才说错了','phase','desired')));
  perform pg_temp.assert_true(result->>'outcome'='corrected' and (select state='corrected' from pet_life_facts where id=fact),'explicit correction invalidates wrong understanding');
  perform pg_temp.assert_true(exists(select 1 from pet_private_context_exclusions where message_id=third_source),'wrong source excluded after correction');
  perform pg_temp.assert_true(exists(select 1 from pet_private_threads where id=(result->'fact'->>'source_message_id')::uuid and role='owner' and content='我并没有在学游泳，那是刚才说错了'),'correction is a new visible owner statement');
  perform set_config('request.jwt.claim.sub',outsider::text,true);
  begin perform get_companion_memory_context(pet); raise exception 'expected_forbidden'; exception when others then if sqlerrm<>'memory_forbidden' then raise; end if; end;
end $$;
set local role authenticated;
select pg_temp.assert_true((select count(*)=0 from pet_life_facts),'RLS cross-account life facts');
select pg_temp.assert_true((select count(*)=0 from pet_interaction_settings),'RLS cross-account settings');
reset role;
rollback;`;
const result = spawnSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], { input: sql, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
if (result.status !== 0) { console.error(result.stderr); process.exit(result.status || 1); }
console.log("PASS memory evolution SQL: literal owner evidence, leases/dedup, no assistant extraction, scopes/expiry/topic race, request conflicts, grounded review/continuation/dismiss, forget preview/transitive exclusion/search, RLS; transaction rolled back.");
