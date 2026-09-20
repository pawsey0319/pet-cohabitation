import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const container = process.env.SUPABASE_TEST_DB_CONTAINER ?? "supabase_db_android-companion-validation";
if (!["supabase_db_android-companion-validation","supabase_db_android-final-validation"].includes(container)) throw new Error("Isolated fixture container required");
const probe = spawnSync("docker", ["exec", container, "psql", "-U", "postgres", "-d", "postgres", "-tAc", "select coalesce(to_regprocedure('public.revalidate_search_results(uuid,jsonb,uuid,timestamp with time zone,timestamp with time zone,text)')::text,'');"], { encoding: "utf8" });
if (probe.status !== 0) throw new Error(probe.stderr);
const migration = probe.stdout.trim() ? "" : readFileSync("supabase/migrations/202609110014_semantic_search_revalidation.sql", "utf8").replace(/^begin;\s*$/gm, "").replace(/^commit;\s*$/gm, "");
const sql = `begin;
${migration}
create function pg_temp.assert_true(value boolean,label text) returns void language plpgsql as $$ begin if value is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
insert into auth.users(id,email) values('ad111111-1111-4111-8111-111111111111','semantic-a@example.test'),('ad222222-2222-4222-8222-222222222222','semantic-b@example.test');
insert into profiles(id,email,nickname) values('ad111111-1111-4111-8111-111111111111','semantic-a@example.test','semantic-a'),('ad222222-2222-4222-8222-222222222222','semantic-b@example.test','semantic-b');
select set_config('request.jwt.claim.sub','ad111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claim.role','service_role',true);
do $$
declare a uuid:='ad111111-1111-4111-8111-111111111111'; b uuid:='ad222222-2222-4222-8222-222222222222'; p uuid; src uuid; g uuid; item uuid; snapshot jsonb; original jsonb;
begin
  insert into pets(owner_id,name) values(a,'语义验收') returning id into p;
  insert into pet_private_threads(pet_id,owner_id,role,content,conversation_kind) values(p,a,'owner','我完成了语义验收旅行整理','companion') returning id into src;
  select jsonb_agg(value) into snapshot from search_owned_content(a,'语义验收') value;
  perform pg_temp.assert_true((select count(*)=1 from revalidate_search_results(a,snapshot)),'unchanged owned source survives');
  perform pg_temp.assert_true((select count(*)=0 from revalidate_search_results(b,snapshot)),'forged other owner snapshot excluded');
  update pet_private_threads set content='已经变化的内容' where id=src;
  perform pg_temp.assert_true((select count(*)=0 from revalidate_search_results(a,snapshot)),'changed source invalidates old model rank');
  update pet_private_threads set content='我完成了语义验收旅行整理' where id=src;
  perform exclude_pet_memory_context(p,array[src]);
  perform pg_temp.assert_true((select count(*)=0 from revalidate_search_results(a,snapshot)),'forget during model call revokes result');
  g:=create_relationship_space('语义验收群','friend_circle');
  insert into space_members(space_id,user_id,role) values(g,b,'member');
  insert into work_items(owner_id,space_id,kind,title,status,publication) values(a,g,'task','语义验收群任务','not_started','published') returning id into item;
  select jsonb_agg(value) into snapshot from search_owned_content(b,'语义验收群任务') value;
  perform pg_temp.assert_true((select count(*)=1 from revalidate_search_results(b,snapshot)),'member source visible before leave');
  delete from space_members where space_id=g and user_id=b;
  perform pg_temp.assert_true((select count(*)=0 from revalidate_search_results(b,snapshot)),'leave during model call revokes result');
  begin perform revalidate_search_results(b,snapshot,g); raise exception 'expected_scope_denial'; exception when others then if sqlerrm<>'not_space_member' then raise; end if; end;
  select jsonb_agg(value) into original from search_owned_content(a,'语义验收群任务') value;
  update work_items set status='completed',updated_at=clock_timestamp(),version=version+1 where id=item;
  perform pg_temp.assert_true((select count(*)=0 from revalidate_search_results(a,original,null,null,null,'not_started')),'current status and version invalidate old candidate');
  delete from work_items where id=item;
  perform pg_temp.assert_true((select count(*)=0 from revalidate_search_results(a,original)),'deleted object omitted');
  perform set_config('request.jwt.claim.role','authenticated',true);
  begin perform revalidate_search_results(a,'[]'); raise exception 'expected_service_only'; exception when others then if sqlerrm<>'forbidden' then raise; end if; end;
end $$;
rollback;`;
const result = spawnSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], { input: sql, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
if (result.status !== 0) { console.error(result.stderr); process.exit(result.status || 1); }
console.log("PASS semantic final SQL gate: own sources, source edits, forgetting, leave-group, status change, deletion, service-only; fixture transaction rolled back.");
