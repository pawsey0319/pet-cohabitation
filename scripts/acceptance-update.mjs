// Preserve each installed runtime; change only its audited APK metadata.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir, symlink } from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(), [version,mode]=process.argv.slice(2);
const codes={'1.0.4':5,'1.0.5':6,'1.0.6':7,'1.0.7':8,'1.0.8':10,'1.0.9':11};
assert.ok(version in codes); assert.ok(['prepare','export','publish','verify'].includes(mode));
const dir=path.join(root,'test-results/android-109-update-entry');
const target=path.join(dir,version), cli=process.env.LEGACY_INVENTORY_EAS_CLI;
const hash=b=>createHash('sha256').update(b).digest('hex');
const json=async p=>JSON.parse((await readFile(p,'utf8')).replace(/^\uFEFF/,''));
const save=async (suffix,value)=>writeFile(path.join(dir,`${version}-${suffix}.json`),JSON.stringify(value,null,2)+'\n');
const legacy=path.join(root,'test-results/legacy-update-inventory');
const source=version==='1.0.9'?path.join(root,'test-results/android-acceptance-1.0.9-build11'):
  version==='1.0.8'?path.join(root,'test-results/android-update-108-theme-source-20260921'):
  path.join(legacy,version==='1.0.4'?'bridge-1.0.4':`candidate-${version}-lf`);
const exportDir=path.join(target,'.expo/acceptance-export');
async function bundleAt(folder){
  const d=path.join(folder,'_expo/static/js/android');
  const names=(await readdir(d)).filter(n=>n.endsWith('.hbc')); assert.equal(names.length,1);
  const file=path.join(d,names[0]);
  return {file,bytes:await readFile(file),map:await json(file+'.map')};
}
async function collect(folder,relative='',copyTo=null){
  const rows=[];
  for(const entry of await readdir(path.join(folder,relative),{withFileTypes:true})){
    if(['node_modules','.expo','dist','test-results','.git','.gradle','build','__pycache__'].includes(entry.name)||entry.name.startsWith('.env')||/\.(?:jks|keystore|p12|log)$/.test(entry.name))continue;
    assert.ok(!entry.isSymbolicLink(),'Unexpected source link');
    const rel=path.join(relative,entry.name);
    if(entry.isDirectory()){rows.push(...await collect(folder,rel,copyTo));continue;}
    const bytes=await readFile(path.join(folder,rel));
    if(copyTo){await mkdir(path.dirname(path.join(copyTo,rel)),{recursive:true});await writeFile(path.join(copyTo,rel),bytes);}
    rows.push({path:rel.replaceAll('\\','/'),sha256:hash(bytes)});
  }
  return rows;
}
await mkdir(dir,{recursive:true});
if(mode==='prepare'){
  let baseline=null;
  if(version!=='1.0.9'){
    const prior=version==='1.0.8'?await json(path.join(source,'source-manifest.json')):
      await json(path.join(legacy,`${version==='1.0.4'?'bridge':'candidate'}-${version}-export-verification-theme.json`));
    const old=await bundleAt(path.join(source,version==='1.0.8'?'dist':'.expo/bridge-export'));
    assert.equal(hash(old.bytes),prior.launchSha256??prior.bundleSha256);
    for(const row of prior.files??prior.sourceFiles??[])assert.equal(hash(await readFile(path.join(source,row.path))),row.sha256,`Frozen source drift: ${row.path}`);
    if(version==='1.0.4'){
      const prep=await json(path.join(legacy,'bridge-1.0.4-preparation-theme.json'));
      for(const row of [...prep.preserved.filter(f=>f.source!=='published-source-map'),...prep.changes])
        assert.equal(hash(await readFile(path.join(source,row.path))),row.sha256,`Legacy source drift: ${row.path}`);
    }
    // Check all bundled application source against the prior accepted export.
    for(let i=0;i<old.map.sources.length;i++){
      const s=old.map.sources[i];
      if(/^\/(?:app\/|src\/|modules\/|supabase\/)/.test(s))
        assert.equal(await readFile(path.join(source,s.slice(1)),'utf8'),old.map.sourcesContent[i],`Export/source mismatch: ${s}`);
    }
    baseline={bundlePath:old.file,bundleSha256:hash(old.bytes)};
  }
  const config=await json(path.join(source,'app.json'));
  assert.equal(config.expo.version,version);assert.equal(config.expo.android.versionCode,codes[version]);
  await mkdir(target); // Never overwrite an earlier publication's source.
  const files=await collect(source,'',target);
  await symlink(path.join(version==='1.0.8'?root:source,'node_modules'),path.join(target,'node_modules'),'junction');
  await save('preparation',{createdAt:new Date().toISOString(),version,source,target,baseline,files});
  console.log(JSON.stringify({prepared:true,version,files:files.length}));
  process.exit(0);
}
assert.ok(cli,'Set LEGACY_INVENTORY_EAS_CLI');
const prep=await json(path.join(dir,`${version}-preparation.json`));
const metadataPath='src/updates/release.ts';
const stripMetadata=text=>text.replace(/const APPROVED_APK = \{[\s\S]*?\n\};/,'const APPROVED_APK = APPROVED_METADATA;');
if(mode==='export'){
  const original=await readFile(path.join(source,metadataPath),'utf8');
  const next=await readFile(path.join(root,metadataPath),'utf8');
  assert.equal(stripMetadata(original),stripMetadata(next),'Only approved APK metadata may change');
  assert.ok(next.includes('version: "1.0.9"'));
  await writeFile(path.join(target,metadataPath),next);
  for(const f of prep.files)if(f.path!==metadataPath)assert.equal(hash(await readFile(path.join(target,f.path))),f.sha256,`Unexpected modification: ${f.path}`);
  const listed=spawnSync(process.execPath,[cli,'env:list','preview','--format','short'],{cwd:target,encoding:'utf8',windowsHide:true});
  assert.equal(listed.status,0);
  const env={...process.env,EXPO_NO_DOTENV:'1',EAS_NO_VCS:'1',EAS_PROJECT_ROOT:target};
  for(const line of listed.stdout.split(/\r?\n/)){
    const m=line.trim().match(/^(EXPO_PUBLIC_(?:SUPABASE_URL|SUPABASE_PUBLISHABLE_KEY|DEMO_MODE))=(.*)$/);
    if(m)env[m[1]]=m[2];
  }
  assert.equal(env.EXPO_PUBLIC_SUPABASE_URL,'https://lthcucgggoevgcboouqw.supabase.co');assert.equal(env.EXPO_PUBLIC_DEMO_MODE,'false');
  const auth=await fetch(env.EXPO_PUBLIC_SUPABASE_URL+'/auth/v1/settings',{headers:{apikey:env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY},signal:AbortSignal.timeout(15000)});
  assert.equal(auth.status,200);await auth.arrayBuffer();
  const result=spawnSync(process.execPath,[path.join(target,'node_modules/expo/bin/cli'),'export','--clear','--platform','android','--source-maps','--max-workers','2','--output-dir',exportDir],{cwd:target,env,encoding:'utf8',maxBuffer:12*1024*1024,windowsHide:true});
  await writeFile(path.join(dir,`${version}-export.log`),(result.stdout??'')+'\n'+(result.stderr??''));assert.equal(result.status,0,'See export log');
  const nextBundle=await bundleAt(exportDir);
  assert.equal(nextBundle.map.sourcesContent[nextBundle.map.sources.indexOf('/'+metadataPath)],next);
  let unchangedModules=0,changedModules=[],dependencyPathRemaps=0;
  if(prep.baseline){
    assert.equal(hash(await readFile(prep.baseline.bundlePath)),prep.baseline.bundleSha256);
    const oldMap=await json(prep.baseline.bundlePath+'.map');
    // Metro reports a junction's real dependency directory in source maps.
    // Canonicalize that directory only; compare every module body unchanged.
    const canonical=s=>s.includes('/node_modules/')?s.slice(s.indexOf('/node_modules/')):s;
    const oldNames=oldMap.sources.map(canonical),nextNames=nextBundle.map.sources.map(canonical);
    assert.equal(new Set(oldNames).size,oldNames.length,'Duplicate old dependency identity');
    assert.equal(new Set(nextNames).size,nextNames.length,'Duplicate new dependency identity');
    assert.ok(JSON.stringify([...oldNames].sort())===JSON.stringify([...nextNames].sort()),'Dependency/module set changed; inspect saved source maps');
    dependencyPathRemaps=nextBundle.map.sources.filter((s,i)=>s!==nextNames[i]).length;
    const oldRoot=version==='1.0.8'?root:source;
    const escaped=s=>JSON.stringify(s).slice(1,-1);
    for(let i=0;i<oldMap.sources.length;i++){
      const name=oldNames[i],before=oldMap.sourcesContent[i],after=nextBundle.map.sourcesContent[nextNames.indexOf(name)];
      if(before===after){unchangedModules++;continue;}
      if(name==='/'+metadataPath)assert.equal(stripMetadata(before),stripMetadata(after));
      else if(name.startsWith('/app?ctx='))assert.equal(before.replaceAll(escaped(oldRoot),escaped(target)),after);
      else assert.fail(`Unexpected bundled module change: ${name}`);
      changedModules.push(name);
    }
  }else{
    for(let i=0;i<nextBundle.map.sources.length;i++){
      const s=nextBundle.map.sources[i];
      if(/^\/(?:app\/|src\/|modules\/|supabase\/)/.test(s))assert.equal(nextBundle.map.sourcesContent[i],await readFile(path.join(target,s.slice(1)),'utf8'));
    }
  }
  await save('export',{passed:true,version,target,bundleSha256:hash(nextBundle.bytes),bundleBytes:nextBundle.bytes.length,files:await collect(target),unchangedModules,changedModules,dependencyPathRemaps,nativeConfigurationAndLockUnchanged:true,scope:'Only approved APK metadata changed; dependency directory paths normalized with all module bodies compared, device loading remains unverified.'});
  console.log(JSON.stringify({exported:true,version,unchangedModules,changedModules}));process.exit(0);
}
const proof=await json(path.join(dir,`${version}-export.json`));assert.equal(proof.passed,true);
for(const f of proof.files)assert.equal(hash(await readFile(path.join(target,f.path))),f.sha256);
assert.equal(hash((await bundleAt(exportDir)).bytes),proof.bundleSha256);
const receiptPath=path.join(dir,`${version}-published.json`);
let receipt;
if(mode==='publish'){
  try{await readFile(receiptPath);assert.fail('Already published; verify only');}catch(e){if(e.code!=='ENOENT')throw e;}
  const result=spawnSync(process.execPath,[cli,'update','--channel','preview','--platform','android','--environment','preview','--input-dir',exportDir,'--skip-bundler','--message',`Android ${version}: offer 1.0.9 device acceptance candidate`,'--json','--non-interactive'],{cwd:target,env:{...process.env,EXPO_NO_DOTENV:'1',EAS_NO_VCS:'1',EAS_PROJECT_ROOT:target},encoding:'utf8',maxBuffer:12*1024*1024,windowsHide:true});
  await writeFile(path.join(dir,`${version}-publish.stdout.log`),result.stdout??'');await writeFile(path.join(dir,`${version}-publish.stderr.log`),result.stderr??'');
  assert.equal(result.status,0,'Inspect logs before any retry');
  const updates=JSON.parse(result.stdout.slice(result.stdout.search(/^\s*\[/m)));
  assert.equal(updates.length,1);assert.equal(updates[0].runtimeVersion,version);assert.equal(updates[0].platform,'android');
  receipt={publishedAt:new Date().toISOString(),version,bundleSha256:proof.bundleSha256,updates:updates.map(({id,group,runtimeVersion,platform,createdAt,message})=>({id,group,runtimeVersion,platform,createdAt,message})),skipBundler:true};
  await save('published',receipt);
}else receipt=await json(receiptPath);
const result=spawnSync(process.execPath,[path.join(root,'scripts/verify-android-preview-resilient.mjs'),receipt.updates[0].id,version],{cwd:target,encoding:'utf8',maxBuffer:12*1024*1024,windowsHide:true});
await writeFile(path.join(dir,`${version}-verify.log`),(result.stdout??'')+'\n'+(result.stderr??''));
assert.equal(result.status,0,'Published; use verify mode to retry read-only verification');
const verified=await json(path.join(target,'test-results/background-release/android-update-verification.json'));
assert.equal(verified.assets.find(a=>a.launch).sha256,proof.bundleSha256);
await save('verified',{...verified,sourceBound:true,nativeConfigurationAndLockUnchanged:true});
console.log(JSON.stringify({published:true,verified:true,version,updateId:receipt.updates[0].id,assets:verified.assets.length}));
