// Freeze, export, publish and verify only the already installed Android 1.0.9 runtime.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, readdir, symlink, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root=process.cwd(),[phase,mode]=process.argv.slice(2);
assert.ok(['ui','capabilities'].includes(phase));assert.ok(['prepare','export','publish','verify'].includes(mode));
const folder=path.join(root,'test-results',`pet-${phase}-ota-20260922`),target=path.join(folder,'source');
const cli=process.env.LEGACY_INVENTORY_EAS_CLI;
const sha=b=>createHash('sha256').update(b).digest('hex');
const json=async p=>JSON.parse((await readFile(p,'utf8')).replace(/^\uFEFF/,''));
const save=async(name,data)=>writeFile(path.join(folder,name),JSON.stringify(data,null,2)+'\n');
const ignored=new Set(['node_modules','.expo','.git','test-results','dist','build','__pycache__']);
async function copy(relative,files) {
 const source=path.join(root,relative),info=await stat(source);
 if(info.isDirectory()) {await mkdir(path.join(target,relative),{recursive:true});for(const entry of await readdir(source,{withFileTypes:true}))if(!ignored.has(entry.name)&&!entry.name.startsWith('.env')&&!entry.isSymbolicLink())await copy(path.join(relative,entry.name),files);return;}
 if(/\.(?:log|pyc|jks|keystore|p12|pem)$/.test(relative))return;
 if(phase==='ui'&&relative.replaceAll('\\','/')==='app/pet-capabilities.tsx')return;
 let bytes=await readFile(source);
 if(phase==='ui'&&relative.replaceAll('\\','/')==='app/pet-settings.tsx')bytes=Buffer.from(bytes.toString().split('\n').filter(line=>!line.includes('title="能力与授权"')).join('\n'));
 if(phase==='ui'&&relative.replaceAll('\\','/')==='app/(tabs)/pet.tsx')bytes=Buffer.from(bytes.toString().replace(/^import \{ PetActionReceipts \}[^\n]*\n/m,'').replace('<PetActionReceipts sourceMessageId={sourceMessageId}/>',''));
 await mkdir(path.dirname(path.join(target,relative)),{recursive:true});await writeFile(path.join(target,relative),bytes);
 files.push({path:relative.replaceAll('\\','/'),sha256:sha(bytes)});
}
if(mode==='prepare') {
 try { await stat(path.join(folder,'published.json')); throw new Error('Published source must remain frozen'); } catch(error) { if(error.code!=='ENOENT')throw error; }
 await mkdir(folder,{recursive:true});await mkdir(target,{recursive:true});const files=[];
 for(const relative of ['app','src','assets','modules','supabase/functions/_shared','package.json','package-lock.json','eas.json','babel.config.js','tsconfig.json','index.js'])await copy(relative,files);
 const baseline=path.join(root,'test-results/android-acceptance-1.0.9-build11');
 for(const name of ['package.json','package-lock.json'])assert.equal(sha(await readFile(path.join(target,name))),sha(await readFile(path.join(baseline,name))),`native dependency change: ${name}`);
 const configBytes=await readFile(path.join(baseline,'app.json'));const config=JSON.parse(configBytes);
 assert.equal(config.expo.version,'1.0.9');assert.equal(config.expo.android.versionCode,11);
 assert.equal(config.expo.android.package,'com.pawsey.petcohabitation');assert.equal(config.expo.runtimeVersion.policy,'appVersion');
 await writeFile(path.join(target,'app.json'),configBytes);files.push({path:'app.json',sha256:sha(configBytes)});
 try {await stat(path.join(target,'node_modules'));}catch(error){if(error.code!=='ENOENT')throw error;await symlink(path.join(root,'node_modules'),path.join(target,'node_modules'),'junction');}
 await save('source-manifest.json',{phase,at:new Date().toISOString(),runtime:'1.0.9',nativeCode:11,files,scope:phase==='ui'?'Workspace UI/cache only. Capability entry and receipt renderer excluded until backend rollout.':'Capabilities client after compatible server rollout.'});
 console.log(`Prepared ${phase} source with ${files.length} files`);process.exit(0);
}
assert.ok(cli,'LEGACY_INVENTORY_EAS_CLI required');
const manifest=await json(path.join(folder,'source-manifest.json'));
for(const row of manifest.files)assert.equal(sha(await readFile(path.join(target,row.path))),row.sha256,`Frozen source changed: ${row.path}`);
if(mode==='export') {
 const listed=spawnSync(process.execPath,[cli,'env:list','preview','--format','short'],{cwd:target,encoding:'utf8',windowsHide:true});assert.equal(listed.status,0,'preview environment unavailable');
 const env={...process.env,EXPO_NO_DOTENV:'1',EAS_PROJECT_ROOT:target};
 for(const line of listed.stdout.split(/\r?\n/)){const match=line.trim().match(/^(EXPO_PUBLIC_(?:SUPABASE_URL|SUPABASE_PUBLISHABLE_KEY|DEMO_MODE))=(.*)$/);if(match)env[match[1]]=match[2];}
 assert.equal(env.EXPO_PUBLIC_SUPABASE_URL,'https://lthcucgggoevgcboouqw.supabase.co');assert.equal(env.EXPO_PUBLIC_DEMO_MODE,'false');assert.ok(env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
 const exported=spawnSync(process.execPath,[path.join(root,'node_modules/expo/bin/cli'),'export','--platform','android','--output-dir','.expo/pet-export','--source-maps','--clear'],{cwd:target,env,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});
 await writeFile(path.join(folder,'export.log'),(exported.stdout??'')+'\n'+(exported.stderr??''));assert.equal(exported.status,0,'Android export failed');
 const dir=path.join(target,'.expo/pet-export/_expo/static/js/android');const names=(await readdir(dir)).filter(n=>n.endsWith('.hbc'));assert.equal(names.length,1);
 const bundle=await readFile(path.join(dir,names[0])),map=await json(path.join(dir,names[0]+'.map'));
 for(const relative of ['src/pets/workspaceCache.ts','src/components/PetCompanionPanel.tsx','app/(tabs)/pet.tsx']) {
  const index=map.sources.findIndex(source=>source.replaceAll('\\','/').endsWith('/'+relative));assert.ok(index>=0,`bundle misses ${relative}`);
  assert.equal(map.sourcesContent[index],await readFile(path.join(target,relative),'utf8'),`shared Metro cache used a different source: ${relative}`);
 }
 await save('export-proof.json',{passed:true,runtime:'1.0.9',bundlePath:path.relative(target,path.join(dir,names[0])),bundleSha256:sha(bundle),bytes:bundle.length});
 console.log(`Verified frozen Android 1.0.9 ${phase} export`);process.exit(0);
}
const proof=await json(path.join(folder,'export-proof.json'));assert.equal(proof.passed,true);assert.equal(sha(await readFile(path.join(target,proof.bundlePath))),proof.bundleSha256);
if(mode==='publish') {
 try {await stat(path.join(folder,'published.json'));throw new Error('Already published; verify existing receipt instead');}catch(error){if(error.code!=='ENOENT')throw error;}
 const result=spawnSync(process.execPath,[cli,'update','--channel','preview','--platform','android','--environment','preview','--input-dir','.expo/pet-export','--skip-bundler','--message',`Android 1.0.9: pet ${phase}, 2026-09-22 acceptance candidate`,'--json','--non-interactive'],{cwd:target,env:{...process.env,EXPO_NO_DOTENV:'1',EAS_PROJECT_ROOT:target},encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});
 await writeFile(path.join(folder,'publish.log'),(result.stdout??'')+'\n'+(result.stderr??''));assert.equal(result.status,0,'Publication failed; inspect receipt before retrying');
 const updates=JSON.parse(result.stdout.slice(result.stdout.search(/^\s*\[/m)));assert.equal(updates.length,1);assert.equal(updates[0].runtimeVersion,'1.0.9');assert.equal(updates[0].platform,'android');
 await save('published.json',{at:new Date().toISOString(),runtime:'1.0.9',phase,updates,bundleSha256:proof.bundleSha256,phoneAcceptance:'pending'});
}
const receipt=await json(path.join(folder,'published.json'));
const checked=spawnSync(process.execPath,[path.join(root,'scripts/verify-android-preview-resilient.mjs'),receipt.updates[0].id,'1.0.9'],{cwd:target,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});
await writeFile(path.join(folder,'verify.log'),(checked.stdout??'')+'\n'+(checked.stderr??''));assert.equal(checked.status,0,'Publication saved; remote verification failed; use verify without publishing again');
const cloud=await json(path.join(target,'test-results/background-release/android-update-verification.json'));
assert.equal(cloud.assets.find(a=>a.launch).sha256,proof.bundleSha256);await save('cloud-verification.json',cloud);
console.log(JSON.stringify({published:true,remoteVerified:true,phase,runtime:'1.0.9',updateId:receipt.updates[0].id,assets:cloud.assets.length,phoneAcceptance:'pending'}));
