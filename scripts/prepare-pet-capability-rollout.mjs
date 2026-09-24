import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const names=['202609220001_pet_capabilities','202609220002_pet_action_plans','202609220003_pet_action_context','202609220004_pet_action_jobs'];
const folder='test-results/pet-capability-cloud-20260922';await mkdir(folder,{recursive:true});
let batch=`begin;
set local lock_timeout='8s';
set local statement_timeout='90s';
do $baseline$ begin
 if not exists(select 1 from supabase_migrations.schema_migrations where version='202609210001') then raise exception 'expected_release_baseline_missing';end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version like '20260922%') then raise exception 'rollout_already_applied_review_existing_receipt';end if;
end $baseline$;
`;
const files=[];
for(const name of names){
 const content=await readFile(`supabase/migrations/${name}.sql`,'utf8');
 assert.ok(content.startsWith('begin;')&&content.trimEnd().endsWith('commit;'));
 const sql=content.replace(/^begin;\s*/,'').replace(/commit;\s*$/,'');
 assert.ok(!sql.includes('$migration_history$'));
 batch+=sql+`\ninsert into supabase_migrations.schema_migrations(version,name,statements) values('${name.slice(0,12)}','${name.slice(13)}',array[$migration_history$${sql}$migration_history$]);\n`;
 files.push({name,sha256:createHash('sha256').update(content).digest('hex')});
}
batch+="commit;\nselect version,name from supabase_migrations.schema_migrations where version like '20260922%' order by version;\n";
await writeFile(`${folder}/migration-batch.sql`,batch);
await writeFile(`${folder}/migration-manifest.json`,JSON.stringify({at:new Date().toISOString(),project:'lthcucgggoevgcboouqw',files},null,2));
console.log('Prepared four reviewed migrations as one atomic batch with migration history.');
