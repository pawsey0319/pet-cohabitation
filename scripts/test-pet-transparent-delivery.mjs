// Actual locked worker -> authorized gateway -> private preview -> approval.
// Uses only the existing synthetic furry portrait; never reads a user's pet.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createClient } from '@supabase/supabase-js';
const cloud=process.argv.includes('--cloud');
const url=process.env.SUPABASE_URL;
assert.equal(url,cloud?'https://lthcucgggoevgcboouqw.supabase.co':'http://127.0.0.1:47321');
const out=resolve('test-results/mobile-feedback-20260914');await mkdir(out,{recursive:true});
const report={started_at:new Date().toISOString(),cloud,checks:[],cleanup:false,passed:false};
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);};
const options={auth:{persistSession:false,autoRefreshToken:false}};
const service=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,options),client=createClient(url,process.env.SUPABASE_ANON_KEY,options);
const ok=r=>{if(r.error)throw new Error('test_api_failed');return r.data;};
let owner,password;
try {
 const email=`transparent-${randomUUID()}@example.test`;password=`Synthetic-${randomUUID()}!`;
 owner=ok(await service.auth.admin.createUser({email,password,email_confirm:true})).user.id;
 report.fixture_account=owner;
 await writeFile(join(out,cloud?'transparent-cloud.json':'transparent-local.json'),JSON.stringify(report,null,2)+'\n');
 ok(await service.from('profiles').insert({id:owner,email,nickname:'透明本体验收'}));ok(await client.auth.signInWithPassword({email,password}));
 const pet=ok(await service.from('pets').insert({owner_id:owner,name:'本体验收'}).select().single());
 const assetId=randomUUID(),sourcePath=`${owner}/${assetId}.jpg`,source=await readFile('test-results/avatar-live-20260914/avatar.jpg');
 report.source_sha256=createHash('sha256').update(source).digest('hex');
 ok(await service.storage.from('pet-portraits').upload(sourcePath,source,{contentType:'image/jpeg'}));
 ok(await service.from('pet_visual_assets').insert({id:assetId,pet_id:pet.id,owner_id:owner,storage_path:sourcePath,prompt_hash:'existing-synthetic-furry-regression',is_draft:false}));
 ok(await service.from('pets').update({status:'confirmed',confirmed_at:new Date().toISOString(),current_asset_id:assetId}).eq('id',pet.id));
 const body={action:'request',pet_id:pet.id,request_id:randomUUID(),expected_version:0};
 const requested=ok(await client.functions.invoke('pet-display',{body}));
 check('authorized owner creates transparent task',!!requested.job.id);
 check('same request returns same job',ok(await client.functions.invoke('pet-display',{body})).job.id===requested.job.id);
 if(!cloud){
   const envText=await readFile('test-results/android-companion-supabase/functions.env','utf8');
   const token=envText.match(/^PET_TRANSPARENT_WORKER_TOKEN=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g,'');
   assert.ok(token?.length>=32,'fixture worker credential exists');
   const env={...process.env,PET_TRANSPARENT_WORKER_TOKEN:token,PET_TRANSPARENT_WORKER_URL:`${url}/functions/v1/pet-transparent-worker`,NO_PROXY:'127.0.0.1,localhost,::1'};
   delete env.SUPABASE_SERVICE_ROLE_KEY;delete env.SUPABASE_ANON_KEY;
   const modelDir=join(tmpdir(),'pet-transparent-validation');
   const child=spawn(join(modelDir,'venv/Scripts/python.exe'),[resolve('src/avatars/transparent-worker/worker.py'),'--once','--model-dir',modelDir],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
   let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',()=>{});
   const code=await new Promise((done,reject)=>{child.on('error',reject);child.on('exit',done);});
   check('actual local worker commits through gateway',code===0&&output.includes('"status": "committed"'));
 }
 let candidate;const began=performance.now();
 while(performance.now()-began<90000){
   candidate=ok(await client.functions.invoke('pet-display',{body:{action:'status',pet_id:pet.id}}));
   if(['succeeded','failed','cancelled'].includes(candidate.job?.status))break;
   await new Promise(r=>setTimeout(r,2000));
 }
 check('worker completes own task',candidate.job?.status==='succeeded'&&candidate.job?.id===requested.job.id);
 check('result is a private preview before owner approval',candidate.url===null&&!!candidate.candidate_url);
 const signed=new URL(candidate.candidate_url);report.preview_origin=signed.origin;
 check('preview stays on authorized storage origin',signed.origin===url||(!cloud&&signed.origin==='http://kong:8000'));
 const accessible=new URL(signed.pathname+signed.search,url);
 const fetched=await fetch(accessible,{redirect:'error',signal:AbortSignal.timeout(30000)});check('actual PNG preview is downloadable',fetched.ok);
 const bytes=Buffer.from(await fetched.arrayBuffer());
 check('actual output PNG has RGBA and original dimensions',bytes[25]===6&&bytes.readUInt32BE(16)===1024&&bytes.readUInt32BE(20)===1024);
 const expected=await readFile('test-results/mobile-feedback-20260914/transparency/transparent.png');
 check('cloud bytes match visually reviewed synthetic result',createHash('sha256').update(bytes).digest('hex')===createHash('sha256').update(expected).digest('hex'));
 check('system repair consumes no personal design quota',ok(await service.from('personal_image_design_claims').select('request_id').eq('owner_id',owner)).length===0);
 check('source asset remains unchanged',ok(await service.from('pets').select('current_asset_id').eq('id',pet.id).single()).current_asset_id===assetId);
 const approval={action:'approve',pet_id:pet.id,job_id:requested.job.id,source_asset_id:assetId,expected_version:0,request_id:randomUUID()};
 ok(await client.functions.invoke('pet-display',{body:approval}));
 let state=ok(await client.functions.invoke('pet-display',{body:{action:'status',pet_id:pet.id}}));
 check('explicit approval enables the same current-source portrait',!!state.url&&state.preference.approved_job_id===requested.job.id);
 ok(await client.functions.invoke('pet-display',{body:{action:'set',pet_id:pet.id,expected_version:0,request_id:randomUUID(),use_transparent:false}}));
 ok(await client.functions.invoke('pet-display',{body:approval}));
 state=ok(await client.functions.invoke('pet-display',{body:{action:'status',pet_id:pet.id}}));
 check('restore survives replay of the old approval receipt',state.url===null&&!state.preference.use_transparent);
 report.passed=true;
} catch(e){report.error=e instanceof assert.AssertionError?e.message:'transparent_delivery_check_failed';throw e;}
finally {
 if(owner){
   const deleted=await client.functions.invoke('delete-account',{body:{password}});
   if(deleted.error)report.cleanup_error='synthetic_delete_failed';
   const profile=await service.from('profiles').select('id').eq('id',owner);
   const auth=await service.auth.admin.getUserById(owner);
   report.cleanup=!profile.error&&profile.data.length===0&&auth.error?.status===404;
 }
 report.passed=report.passed&&report.cleanup;report.finished_at=new Date().toISOString();
 await writeFile(join(out,cloud?'transparent-cloud.json':'transparent-local.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({passed:report.passed,cloud,checks:report.checks.length,cleanup:report.cleanup,error:report.error}));
 if(!report.cleanup)process.exitCode=1;
}
