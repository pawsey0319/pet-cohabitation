// Exercise the complete migration files, then restore the isolated fixture.
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const files=['202609220001_pet_capabilities','202609220002_pet_action_plans','202609220003_pet_action_context','202609220004_pet_action_jobs'];
const cleanup=`
drop trigger if exists revoke_pet_delegations_after_leave on space_members;
drop trigger if exists pet_action_background_job_guard on chat_background_generations;
drop trigger if exists pet_action_avatar_job_guard on avatar_generations;
drop function if exists manage_pet_delegation(jsonb),execute_pet_capability(uuid,uuid,text,uuid,integer,jsonb,uuid,uuid),pet_action_planning_context(uuid,uuid,uuid,text),pet_group_action_context(uuid,uuid,uuid,text,uuid,text),revoke_pet_delegations_on_leave(),guard_pet_action_image_job();
drop table if exists pet_action_plans,pet_action_receipts,pet_delegation_grants,pet_action_capabilities cascade;
`;
const strip=sql=>sql.replace(/^begin;\s*/i,'').replace(/(?:commit|rollback);\s*$/i,'');
const sql='begin;\n'+cleanup+files.map(file=>strip(readFileSync(`supabase/migrations/${file}.sql`,'utf8'))).join('\n')+'\n'+strip(readFileSync('scripts/test-pet-capabilities.sql','utf8'))+'\nrollback;';
const r=spawnSync('wsl.exe',['-d','Ubuntu','-u','root','--','env','DOCKER_HOST=unix:///var/run/docker.sock','docker','exec','-i','supabase_db_android-companion-validation','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',windowsHide:true,timeout:60000});
writeFileSync('test-results/pet-capability-migrations-20260922.log',(r.stdout??'')+'\n'+(r.stderr??''));
if(r.status!==0)console.error(r.stderr?.replaceAll('\0','').slice(-2500));
assert.equal(r.status,0);assert.ok(r.stdout.trimEnd().endsWith('ROLLBACK'));
console.log('PASS all four complete migrations plus transactional capability acceptance; isolated fixture restored.');
