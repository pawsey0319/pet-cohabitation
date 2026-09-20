import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";

const container = process.env.SUPABASE_TEST_DB_CONTAINER ?? "supabase_db_android-companion-validation";
if (!["supabase_db_android-companion-validation", "supabase_db_android-final-validation"].includes(container)) throw new Error("Isolated fixture container required");
const original = readFileSync("scripts/recover-legacy-workers-after-drain.sql", "utf8");
const recovery = original.replace(/^begin;\s*$/gm, "").replace(/^commit;\s*$/gm, "");
const evidence = `test-results/legacy-worker-cutover-${new Date().toISOString().replace(/[-:.]/g, "")}`;
mkdirSync(evidence, { recursive: true });
const checks = [];
const a = randomUUID(), b = randomUUID(), c = randomUUID(), d = randomUUID();
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const confirmed = `select set_config('app.release_compatible_handlers','confirmed',true); select set_config('app.release_legacy_workers_drained','confirmed',true);`;
const cutoff = `select set_config('app.release_legacy_cutoff','2001-01-01T00:00:00Z',true);`;
const assert = (condition, label) => `select pg_temp.assert_cutover((${condition}),${quote(label)});`;
function execute(name, sql, expectedError) {
  const result = spawnSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qAt"], { input: sql, encoding: "utf8", maxBuffer: 4 * 1024 * 1024, timeout: 60_000 });
  writeFileSync(`${evidence}/${name}.log`, `${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  const passed = expectedError ? result.status !== 0 && result.stderr?.includes(expectedError) : result.status === 0;
  checks.push({ name, passed, exit_code: result.status, expected_error: expectedError ?? null });
  if (!passed) throw new Error(`${name} failed: ${result.error?.message ?? result.stderr}`);
  for (const match of (result.stderr ?? "").matchAll(/CUTOVER_ASSERT ([^\r\n]+)/g)) checks.push({ name: match[1], passed: true });
}
function save() {
  writeFileSync(`${evidence}/verification.json`, JSON.stringify({ checked_at: new Date().toISOString(), container, source_sha256: createHash("sha256").update(original).digest("hex"), test_sha256: createHash("sha256").update(readFileSync("scripts/test-legacy-worker-cutover.mjs")).digest("hex"), passed: checks.every(check => check.passed), checks, production_changed: false, execution: "Real PostgreSQL transactions in an allowlisted isolated Docker fixture; every data setup is rolled back; no Edge, model, HTTP or worker-drain acceptance." }, null, 2) + "\n");
}

const setup = `
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claim.sub','${a}',true);
insert into auth.users(id,email) values ${[a,b,c,d].map(id => `('${id}','${id}@cutover.example.test')`).join(",")};
insert into profiles(id,email,nickname) values ${[a,b,c,d].map(id => `('${id}','${id}@cutover.example.test','Cutover fixture')`).join(",")};
create function pg_temp.assert_cutover(ok boolean,label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'CUTOVER_ASSERT_FAILED %',label; end if; raise notice 'CUTOVER_ASSERT %',label; end $$;
create temp table cases(kind text,label text primary key,id uuid,expected_status text,expected_error text,expected_action text);
create temp table fixture(g uuid,p uuid);
do $$ declare g uuid; p uuid; begin
 g:=create_relationship_space('Synthetic cutover fixture','friend_circle');
 insert into space_members(space_id,user_id,role) values(g,'${b}','member'),(g,'${c}','member');
 insert into pets(owner_id,name) values('${a}','Cutover fixture') returning id into p;
 insert into fixture values(g,p);
end $$;`;

const routeCases = [
  ["route_old_zero", "queued", null, "requeued"], ["route_old_two", "queued", null, "requeued"],
  ...["live", "token_only", "lease_only", "expired_token", "after_cutoff", "at_cutoff"].map(name => [`route_${name}`, "running", null, null]),
  ["route_completed", "succeeded", null, null], ["route_already_queued", "queued", null, null],
  ["route_exhausted", "failed", "route_attempts_exhausted", "failed"],
  ...["blocked", "notification_blocked", "nonmember", "deleted_source", "wrong_space"].map(name => [`route_${name}`, "failed", "legacy_route_source_unavailable", "failed"]),
  ...["partial_message", "child_succeeded_message", "child_succeeded_no_message", "child_running_no_message", "child_failed_no_message", "child_queued_no_message", "child_blocked_no_message", "child_implicit"].map(name => [`route_${name}`, "failed", "legacy_route_review_required", "manual_review"]),
  ["route_nonreply_child", "queued", null, "requeued"],
];
const backgroundCases = [
  ["background_old", "queued", null, "requeued"], ["background_parent_valid", "queued", null, "requeued"],
  ...["live", "token_only", "lease_only", "expired_token", "after_cutoff", "at_cutoff"].map(name => [`background_${name}`, "uploading", null, null]),
  ["background_completed", "succeeded", null, null], ["background_already_queued", "queued", null, null],
  ["background_exhausted", "failed", "background_generation_timeout", "failed"],
  ...["blocked", "notification_blocked", "parent_deleted", "parent_version"].map(name => [`background_${name}`, "failed", "background_source_unavailable", "failed"]),
  ...["partial_link", "partial_reference", "partial_deleted_asset"].map(name => [`background_${name}`, "failed", "background_legacy_review_required", "manual_review"]),
];
const definitions = [...routeCases.map(row => ["route", ...row]), ...backgroundCases.map(row => ["background", ...row])];
const values = definitions.map(row => `(${row.map(value => value === null ? "null" : quote(value)).join(",")})`).join(",\n");

const functional = `begin; ${setup}
create temp table definitions(kind text,label text,expected_status text,expected_error text,expected_action text);
insert into definitions values ${values};
do $$ declare x record; g uuid; p uuid; m uuid; j uuid; child uuid; asset uuid; parent uuid; actor uuid; child_status job_status; begin
 select f.g,f.p into g,p from fixture f;
 for x in select * from definitions loop
  actor:=case when x.label in ('route_blocked','background_blocked') then '${b}'::uuid when x.label in ('route_notification_blocked','background_notification_blocked') then '${c}'::uuid when x.label='route_nonmember' then '${d}'::uuid else '${a}'::uuid end;
  if x.kind='route' then
   insert into messages(client_id,space_id,sender_id,actor_kind,actor_name,kind,text) values(gen_random_uuid()::text,g,'${a}','human','Cutover fixture','text','synthetic cutover') returning id into m;
   if x.label='route_deleted_source' then update messages set deleted_at=now() where id=m; end if;
   insert into agent_jobs(job_kind,scope_kind,scope_id,requested_by,source_message_id,status,attempts,created_at,lease_token,lease_until,input,result)
   values('route_space_pets','space',case when x.label='route_wrong_space' then gen_random_uuid() else g end,actor,m,
    case when x.label='route_completed' then 'succeeded'::job_status when x.label='route_already_queued' then 'queued'::job_status else 'running'::job_status end,
    case when x.label='route_exhausted' then 3 when x.label='route_old_zero' then 0 else 2 end,
    case when x.label='route_after_cutoff' then '2002-01-01'::timestamptz when x.label='route_at_cutoff' then '2001-01-01'::timestamptz else '2000-01-01'::timestamptz end,
    case when x.label in ('route_live','route_token_only','route_expired_token') then gen_random_uuid() end,
    case when x.label in ('route_live','route_lease_only') then now()+interval '5 minutes' when x.label='route_expired_token' then now()-interval '1 minute' end,
    '{"synthetic_input":true}','{"preserve_partial_result":true}') returning id into j;
   if x.label like 'route_child_%' or x.label in ('route_partial_message','route_nonreply_child') then
    child_status:=case when x.label like 'route_child_succeeded%' then 'succeeded'::job_status when x.label='route_child_failed_no_message' then 'failed'::job_status when x.label='route_child_queued_no_message' then 'queued'::job_status when x.label='route_child_blocked_no_message' then 'blocked'::job_status else 'running'::job_status end;
    insert into agent_jobs(job_kind,scope_kind,scope_id,requested_by,source_message_id,status,attempts,result)
    values(case when x.label='route_nonreply_child' then 'synthetic_nonreply_work' when x.label='route_child_implicit' then 'implicit_pet_reply' else 'explicit_pet_reply' end,'pet',p,'${a}',m,child_status,2,'{"preserved_child":true}') returning id into child;
    if x.label in ('route_partial_message','route_child_succeeded_message') then
     insert into messages(client_id,space_id,actor_kind,actor_id,actor_name,kind,text,reply_to_message_id) values('agent-'||child::text,g,'pet',p,'Cutover fixture','text','synthetic existing partial result',m);
    end if;
   end if;
  else
   parent:=null;
   if x.label like 'background_parent_%' then
    parent:=gen_random_uuid();
    insert into chat_background_assets(id,owner_id,storage_path,source,deleted_at) values(parent,actor,actor::text||'/'||parent::text||'.png','upload',case when x.label='background_parent_deleted' then now() end);
   end if;
   insert into chat_background_generations(owner_id,request_id,prompt,status,attempts,created_at,lease_token,lease_until,parent_asset_id,parent_asset_version,model,latency_ms)
   values(actor,gen_random_uuid(),'synthetic background',case when x.label='background_completed' then 'succeeded' when x.label='background_already_queued' then 'queued' else 'uploading' end,
    case when x.label='background_exhausted' then 3 when x.label='background_old' then 0 else 2 end,
    case when x.label='background_after_cutoff' then '2002-01-01'::timestamptz when x.label='background_at_cutoff' then '2001-01-01'::timestamptz else '2000-01-01'::timestamptz end,
    case when x.label in ('background_live','background_token_only','background_expired_token') then gen_random_uuid() end,
    case when x.label in ('background_live','background_lease_only') then now()+interval '4 minutes' when x.label='background_expired_token' then now()-interval '1 minute' end,
    parent,case when parent is not null then case when x.label='background_parent_version' then 2 else 1 end end,'synthetic-existing-model',123) returning id into j;
   if x.label like 'background_partial_%' then
    asset:=gen_random_uuid();
    insert into chat_background_assets(id,owner_id,storage_path,source,generation_id,deleted_at) values(asset,actor,actor::text||'/'||asset::text||'.png','ai',case when x.label<>'background_partial_reference' then j end,case when x.label='background_partial_deleted_asset' then now() end);
    if x.label='background_partial_reference' then update chat_background_generations set asset_id=asset where id=j; end if;
   end if;
  end if;
  insert into cases values(x.kind,x.label,j,x.expected_status,x.expected_error,x.expected_action);
 end loop;
 insert into chat_background_owner_controls(owner_id,deleting) values('${b}',true) on conflict(owner_id) do update set deleting=true;
 insert into notification_owner_blocks(owner_id) values('${c}');
end $$;
create temp table before_agents as select j.id,to_jsonb(j) body from agent_jobs j where j.requested_by in ('${a}','${b}','${c}','${d}');
create temp table before_backgrounds as select j.id,to_jsonb(j) body from chat_background_generations j where j.owner_id in ('${a}','${b}','${c}','${d}');
create temp table before_messages as select m.id,to_jsonb(m) body from messages m where m.space_id=(select g from fixture);
create temp table before_assets as select a.id,to_jsonb(a) body from chat_background_assets a where a.owner_id in ('${a}','${b}','${c}','${d}');
${confirmed} ${cutoff} ${recovery}
${definitions.map(([kind,label,status,error]) => assert(`exists(select 1 from ${kind === "route" ? "agent_jobs" : "chat_background_generations"} j join cases c on c.id=j.id where c.label=${quote(label)} and j.status::text=${quote(status)} and j.error_code is not distinct from ${error ? quote(error) : "null"}${kind === "route" && status === "failed" ? " and j.retryable=false" : ""})`,label)).join("\n")}
${assert("not exists(select 1 from cases c left join pg_temp.legacy_worker_cutover_results r on r.job_id=c.id where (c.expected_action is null and r.job_id is not null) or (c.expected_action is not null and (r.job_id is null or r.action<>c.expected_action or r.review_label is null)))","actionable_ids_types_reasons_labels")}
${assert("not exists(select 1 from agent_jobs j join cases c on c.id=j.id where c.expected_action='manual_review' and (j.progress_label<>'历史异宠回复待人工核对' or j.completed_at is null or j.stage<>'failed'))","route_review_terminal_label")}
${assert("not exists(select 1 from before_agents b left join agent_jobs j on j.id=b.id where j.id is null or (to_jsonb(j)-array['status','stage','progress_label','retryable','completed_at','error_code'])<>(b.body-array['status','stage','progress_label','retryable','completed_at','error_code']))","route_ids_attempts_input_results_and_children_preserved")}
${assert("not exists(select 1 from before_backgrounds b left join chat_background_generations j on j.id=b.id where j.id is null or (to_jsonb(j)-array['status','completed_at','error_code'])<>(b.body-array['status','completed_at','error_code']))","background_ids_attempts_asset_references_and_metadata_preserved")}
${assert("not exists(select 1 from before_messages b left join messages m on m.id=b.id where m.id is null or to_jsonb(m)<>b.body)","existing_messages_unchanged")}
${assert("not exists(select 1 from before_assets b left join chat_background_assets a on a.id=b.id where a.id is null or to_jsonb(a)<>b.body)","existing_assets_including_deleted_unchanged")}
${assert("not exists(select 1 from before_agents b join agent_jobs j on j.id=b.id where not exists(select 1 from cases c where c.id=j.id and c.expected_action is not null) and to_jsonb(j)<>b.body)","unselected_agents_and_children_completely_unchanged")}
${assert("not exists(select 1 from before_backgrounds b join chat_background_generations j on j.id=b.id join cases c on c.id=j.id where c.expected_action is null and to_jsonb(j)<>b.body)","unselected_backgrounds_completely_unchanged")}
${assert("not exists(select 1 from cases where kind='route' and expected_action='manual_review' and claim_space_route_job(id) is not null)","review_route_not_claimable")}
${assert("not exists(select 1 from cases where kind='background' and expected_action='manual_review' and lease_background_design(id) is not null)","review_background_not_leaseable")}
create temp table after_agents as select j.id,to_jsonb(j) body from agent_jobs j join before_agents b on b.id=j.id;
create temp table after_backgrounds as select j.id,to_jsonb(j) body from chat_background_generations j join before_backgrounds b on b.id=j.id;
${recovery}
${assert("not exists(select 1 from pg_temp.legacy_worker_cutover_results)","repeat_has_zero_changes")}
${assert("not exists(select 1 from after_agents b left join agent_jobs j on j.id=b.id where j.id is null or to_jsonb(j)<>b.body)","repeat_preserves_all_route_and_child_rows_including_review")}
${assert("not exists(select 1 from after_backgrounds b left join chat_background_generations j on j.id=b.id where j.id is null or to_jsonb(j)<>b.body)","repeat_preserves_all_background_rows_including_review")}
rollback;`;

const bounded = `begin; ${setup}
do $$ declare g uuid; p uuid; m uuid; j uuid; asset uuid; n integer; begin
 select f.g,f.p into g,p from fixture f;
 for n in 1..105 loop
  insert into messages(client_id,space_id,sender_id,actor_kind,actor_name,kind,text) values(gen_random_uuid()::text,g,'${a}','human','Cutover fixture','text','synthetic bound test') returning id into m;
  insert into agent_jobs(job_kind,scope_kind,scope_id,requested_by,source_message_id,status,attempts,created_at,result) values('route_space_pets','space',g,'${a}',m,'running',0,'1999-01-01'::timestamptz+n*interval '1 second','{"preserve":true}') returning id into j;
  insert into cases values('route','route_'||n,j,null,null,null);
  if n<=50 then insert into agent_jobs(job_kind,scope_kind,scope_id,requested_by,source_message_id,status) values('explicit_pet_reply','pet',p,'${a}',m,case n%4 when 0 then 'succeeded'::job_status when 1 then 'running'::job_status when 2 then 'failed'::job_status else 'queued'::job_status end); end if;
  insert into chat_background_generations(owner_id,request_id,prompt,status,attempts,created_at) values('${a}',gen_random_uuid(),'synthetic bound test','uploading',0,'1999-01-01'::timestamptz+n*interval '1 second') returning id into j;
  insert into cases values('background','background_'||n,j,null,null,null);
  if n<=50 then asset:=gen_random_uuid(); insert into chat_background_assets(id,owner_id,storage_path,source,generation_id) values(asset,'${a}','${a}/'||asset::text||'.png','ai',j); end if;
 end loop;
end $$;
${confirmed} ${cutoff} ${recovery}
${assert("(select count(*) from pg_temp.legacy_worker_cutover_results)=200","first_batch_total_200_including_review")}
${["route_space_pets","chat_background_generation"].map(kind => assert(`(select count(*) from pg_temp.legacy_worker_cutover_results where job_kind=${quote(kind)})=100 and (select count(*) from pg_temp.legacy_worker_cutover_results where job_kind=${quote(kind)} and action='manual_review')=50 and (select count(*) from pg_temp.legacy_worker_cutover_results where job_kind=${quote(kind)} and action='requeued')=50`,`${kind}_review_shares_100_limit`)).join("\n")}
${assert("(select count(*) from agent_jobs j join cases c on c.id=j.id where j.status='running')=5 and (select count(*) from chat_background_generations j join cases c on c.id=j.id where j.status='uploading')=5","first_batch_leaves_five_each")}
create temp table review_agents as select j.id,to_jsonb(j) body from agent_jobs j join cases c on c.id=j.id where j.error_code='legacy_route_review_required';
create temp table review_backgrounds as select j.id,to_jsonb(j) body from chat_background_generations j join cases c on c.id=j.id where j.error_code='background_legacy_review_required';
create temp table batch_assets as select a.id,to_jsonb(a) body from chat_background_assets a where a.owner_id='${a}';
${recovery}
${assert("(select count(*) from pg_temp.legacy_worker_cutover_results)=10 and not exists(select 1 from pg_temp.legacy_worker_cutover_results where action<>'requeued')","second_batch_only_remaining_ten")}
${recovery}
${assert("not exists(select 1 from pg_temp.legacy_worker_cutover_results)","third_batch_zero_changes")}
${assert("not exists(select 1 from review_agents b left join agent_jobs j on j.id=b.id where j.id is null or to_jsonb(j)<>b.body) and not exists(select 1 from review_backgrounds b left join chat_background_generations j on j.id=b.id where j.id is null or to_jsonb(j)<>b.body)","batch_replays_leave_review_terminals_unchanged")}
${assert("not exists(select 1 from batch_assets b left join chat_background_assets a on a.id=b.id where a.id is null or to_jsonb(a)<>b.body)","batch_replays_preserve_partial_assets")}
${assert("not exists(select 1 from agent_jobs j join cases c on c.id=j.id where j.attempts<>0) and not exists(select 1 from chat_background_generations j join cases c on c.id=j.id where j.attempts<>0)","all_210_original_attempt_counts_preserved")}
rollback;`;

try {
  for (const [name, settings, expected] of [
    ["missing_both_flags", "", "verified_deployment_and_worker_drain_required"],
    ["missing_drain_flag", "select set_config('app.release_compatible_handlers','confirmed',true);", "verified_deployment_and_worker_drain_required"],
    ["missing_handlers_flag", "select set_config('app.release_legacy_workers_drained','confirmed',true);", "verified_deployment_and_worker_drain_required"],
    ["missing_cutoff", confirmed, "explicit_valid_legacy_cutoff_required"],
    ["invalid_cutoff", `${confirmed} select set_config('app.release_legacy_cutoff','invalid',true);`, "explicit_valid_legacy_cutoff_required"],
    ["future_cutoff", `${confirmed} select set_config('app.release_legacy_cutoff',(now()+interval '1 day')::text,true);`, "explicit_valid_legacy_cutoff_required"],
  ]) execute(name, `begin; ${settings} ${recovery} rollback;`, expected);
  execute("functional_and_repeat", functional);
  execute("bounded_mixed_review_and_requeue", bounded);
  execute("rollback_cleanup", `begin read only; do $$ begin if exists(select 1 from auth.users where id in ('${a}','${b}','${c}','${d}')) then raise exception 'synthetic_accounts_not_rolled_back'; end if; end $$; rollback;`);
  save();
  console.log(`PASS ${checks.length} SQL checks in ${container}; all setup rolled back. Evidence: ${evidence}/verification.json`);
} catch (error) {
  save();
  console.error(error);
  process.exitCode = 1;
}
