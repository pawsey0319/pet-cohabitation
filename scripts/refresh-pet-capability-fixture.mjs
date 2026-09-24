// Update only the two new functions and the catalog in the named isolated fixture.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const sql = readFileSync('supabase/migrations/202609220001_pet_capabilities.sql','utf8');
let update = sql.slice(sql.indexOf('insert into pet_action_capabilities('),sql.indexOf('-- END GENERATED CAPABILITIES')).trim().replace(/;$/,' on conflict(id) do update set label=excluded.label,mode=excluded.mode,parameters=excluded.parameters,route=excluded.route;');
update += '\n' + sql.slice(sql.indexOf('do $migration$'),sql.indexOf('end $migration$;')+16);
for(const name of ['manage_pet_delegation','execute_pet_capability']) {
 const start = sql.indexOf(`create function public.${name}(`);
 const end = sql.indexOf('\nend $$;',start)+8;
 assert.ok(start>0&&end>start);update+='\n'+sql.slice(start,end).replace('create function','create or replace function');
}
update+='\n'+readFileSync('supabase/migrations/202609220003_pet_action_context.sql','utf8').replace(/^begin;\s*/,'').replace(/commit;\s*$/,'').replaceAll('create function','create or replace function');
const r=spawnSync('wsl.exe',['-d','Ubuntu','-u','root','--','env','DOCKER_HOST=unix:///var/run/docker.sock','docker','exec','-i','supabase_db_android-companion-validation','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input:'begin;\n'+update+'\ncommit;',encoding:'utf8',windowsHide:true,timeout:60000});
if(r.status!==0)console.error(r.stderr?.replaceAll('\0','').slice(-1500));
assert.equal(r.status,0);console.log('Updated isolated capability fixture functions.');
