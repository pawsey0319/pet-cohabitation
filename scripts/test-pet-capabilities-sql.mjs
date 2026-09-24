import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const sql = readFileSync(new URL('./test-pet-capabilities.sql', import.meta.url), 'utf8');
assert.ok(sql.startsWith('begin;') && sql.trimEnd().endsWith('rollback;'));
const args = ['exec','-i','supabase_db_android-companion-validation','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'];
const result = process.platform === 'win32' ? spawnSync('wsl.exe',['-d','Ubuntu','-u','root','--','env','DOCKER_HOST=unix:///var/run/docker.sock','docker',...args],{input:sql,encoding:'utf8',windowsHide:true,timeout:60000}) : spawnSync('docker',args,{input:sql,encoding:'utf8',timeout:60000});
mkdirSync('test-results',{recursive:true});
writeFileSync('test-results/pet-capabilities-sql-20260922.log',(result.stdout??'')+'\n'+(result.stderr??''));
if(result.status!==0) { console.error(result.stdout?.slice(-1500)); console.error(result.stderr?.replaceAll('\0','').slice(-2000)); }
assert.equal(result.status,0,'isolated SQL capability acceptance');
console.log('Pet capabilities: transactional authorization, mentions, grants and retries passed (fixtures rolled back).');
