// Offline, read-only handoff integrity check. Does not connect to cloud services.
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const base='docs/handoff/evidence/';
const json=async p=>JSON.parse((await readFile(p,'utf8')).replace(/^\uFEFF/,''));
const sha=value=>createHash('sha256').update(value).digest('hex');
for(const file of ['AGENTS.md','docs/handoff/START-HERE.md','docs/handoff/ENVIRONMENT.md','.env.example','supabase/functions/.env.example','public/releases/android-preview.json'])await access(file);
const archive=await json(base+'archive-index.json');
for(const row of archive.files){const bytes=await readFile(base+row.file);assert.equal(sha(row.sha256LF?bytes.toString('utf8').replace(/\r\n/g,'\n'):bytes),row.sha256LF??row.sha256,`Archived evidence changed: ${row.file}`);}
const migrations=await json(base+'migration-manifest.json');
for(const row of migrations.files)await access(`supabase/migrations/${row.name}.sql`);
if(process.argv.includes('--native-baseline')){
 const baseline=await json(base+'android-1.0.9-native-baseline.json');
 for(const [file,expected] of [['package.json',baseline.packageJsonSha256],['package-lock.json',baseline.packageLockSha256]])assert.equal(sha(JSON.stringify(await json(file))),expected,`Native dependency baseline changed: ${file}; review runtime compatibility before any OTA.`);
 assert.deepEqual(await json('app.json'),baseline.appConfig,'App config differs from audited build11; review native/runtime changes.');
 for(const row of baseline.nativeFiles)assert.equal(sha((await readFile(row.path,'utf8')).replace(/\r\n/g,'\n')),row.sha256LF,`Native baseline changed: ${row.path}; review before OTA.`);
}
console.log(`PASS ${archive.files.length} archived evidence files, handoff entry points${process.argv.includes('--native-baseline')?' and Android 1.0.9 native baseline':''}. No cloud changes made.`);
