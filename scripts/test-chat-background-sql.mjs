// Executes the new migration on PostgreSQL/PGlite with minimal existing auth/storage schemas.
// Does not replace full Supabase/Storage/Edge Runtime integration validation.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
const require=createRequire(process.env.BACKGROUND_TEST_RUNTIME ? resolve(process.env.BACKGROUND_TEST_RUNTIME,"package.json") : import.meta.url);
const {PGlite}=require("@electric-sql/pglite"),db=new PGlite();let checks=0;
const a="11111111-1111-4111-8111-111111111111",b="22222222-2222-4222-8222-222222222222";
const id=(n)=>`99999999-9999-4999-8999-${String(n).padStart(12,"0")}`;
async function as(role,owner,fn){await db.exec(`set role ${role};`);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);try{return await fn();}finally{await db.exec("reset role;");}}
const claim=(owner,request,prompt="安静留白的竹林")=>db.query("select claim_chat_background_generation($1,$2,$3,'configured-image-model') as value",[owner,request,prompt]);
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create table profiles(id uuid primary key);
 create table demo_settings(id boolean primary key,image_generation_enabled boolean not null,global_daily_image_limit integer not null,test_ends_at timestamptz);
 insert into demo_settings values(true,true,100,null);
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;
 create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
 grant usage on schema public,auth,storage to anon,authenticated,service_role;
 grant select,insert,delete on storage.objects to authenticated;
 grant all on storage.objects,storage.buckets,profiles,demo_settings to service_role;`);
 await db.query("insert into profiles(id) values($1),($2)",[a,b]);
 await db.exec(await readFile(resolve("supabase/migrations/202609110001_chat_background_design.sql"),"utf8"));checks++;
 const job=(await as("service_role",a,()=>claim(a,id(1)))).rows[0].value;assert.equal(job.created,true);checks++;
 const repeat=(await as("service_role",a,()=>claim(a,id(1)))).rows[0].value;assert.equal(repeat.created,false);assert.equal(repeat.job.id,job.job.id);checks++;
 await assert.rejects(()=>as("service_role",a,()=>claim(a,id(1),"不同的描述")),/background_request_conflict/);checks++;
 await assert.rejects(()=>as("service_role",a,()=>claim(a,id(2))),/background_generation_busy/);checks++;
 await assert.rejects(()=>as("authenticated",a,()=>claim(a,id(2))),/permission denied/);checks++;
 assert.equal((await as("authenticated",b,()=>db.query("select * from chat_background_generations"))).rows.length,0);checks++;
 await as("service_role",a,()=>db.query("update chat_background_generations set status='running' where request_id=$1",[id(1)]));
 assert.equal((await as("service_role",a,()=>db.query("select begin_chat_background_upload($1,$2) as ok",[a,id(1)]))).rows[0].ok,true);
 assert.equal((await as("service_role",a,()=>db.query("select complete_chat_background_generation($1,$2,$3,$4) as ok",[a,id(1),id(3),`${a}/${id(3)}.png`]))).rows[0].ok,true);checks++;
 await as("authenticated",a,()=>db.query("insert into chat_background_settings(owner_id,thread_key,asset_id) values($1,'companion',$2)",[a,id(3)]));
 await assert.rejects(()=>as("authenticated",b,()=>db.query("insert into chat_background_settings(owner_id,thread_key,asset_id) values($1,'companion',$2)",[b,id(3)])),/foreign key/);checks++;
 await assert.rejects(()=>as("authenticated",b,()=>db.query("insert into chat_background_settings(owner_id,thread_key,preset_id) values($1,'global','paper')",[a])),/row-level security/);checks++;
 assert.equal((await as("authenticated",b,()=>db.query("select * from chat_background_assets"))).rows.length,0);checks++;
 await as("service_role",a,()=>claim(a,id(4)));
 await as("service_role",a,()=>db.query("update chat_background_generations set status='running' where request_id=$1",[id(4)]));
 await as("service_role",a,()=>db.query("select block_chat_background_owner($1)",[a]));
 assert.equal((await as("service_role",a,()=>db.query("select begin_chat_background_upload($1,$2) as ok",[a,id(4)]))).rows[0].ok,false);
 await assert.rejects(()=>as("service_role",a,()=>claim(a,id(5))),/background_account_deleting/);checks++;
 await assert.rejects(()=>as("authenticated",a,()=>db.query("insert into storage.objects(bucket_id,name) values('chat-backgrounds',$1)",[`${a}/${id(6)}.jpg`])),/row-level security/);checks++;
 await as("service_role",b,()=>claim(b,id(7)));
 await db.query("update chat_background_generations set status='failed' where request_id=$1",[id(7)]);
 assert.equal((await as("service_role",b,()=>db.query("select complete_chat_background_generation($1,$2,$3,$4) as ok",[b,id(7),id(8),`${b}/${id(8)}.jpg`]))).rows[0].ok,false);checks++;
 await db.query("delete from profiles where id=$1",[a]);assert.equal((await db.query("select * from chat_background_assets where owner_id=$1",[a])).rows.length,0);assert.equal((await db.query("select * from chat_background_settings where owner_id=$1",[a])).rows.length,0);checks++;
 await db.exec("update demo_settings set global_daily_image_limit=0;");await assert.rejects(()=>as("service_role",b,()=>claim(b,id(9))),/background_global_quota/);checks++;
 console.log(`PASS: ${checks} migration, request, RLS, private asset, late task, deletion, and quota checks`);
}finally{await db.close();}
