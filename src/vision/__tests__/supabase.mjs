import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
const url=process.env.SUPABASE_URL;if(!url||new URL(url).hostname!=='127.0.0.1'||new URL(url).port!=='47321')throw new Error('Use isolated companion fixture :47321');
const options={auth:{persistSession:false,autoRefreshToken:false}};const service=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,options);const accounts=[];let checks=0;
const ok=r=>{if(r.error)throw new Error(r.error.message);return r.data;};const pass=(v,label)=>{assert.ok(v,label);checks++;};
async function call(client,body){const r=await client.functions.invoke('vision-assets',{body});if(r.error){let code='edge_failed';try{code=(await r.error.context.json()).error??code;}catch{}throw new Error(code);}return r.data;}
async function account(){const email=`vision-${randomUUID()}@example.test`,password=`Temporary-${randomUUID()}!`;const id=ok(await service.auth.admin.createUser({email,password,email_confirm:true})).user.id;const client=createClient(url,process.env.SUPABASE_ANON_KEY,options);accounts.push({id,client});ok(await service.from('profiles').insert({id,email,nickname:'图片理解隔离验收'}));ok(await client.auth.signInWithPassword({email,password}));const pet=ok(await service.from('pets').insert({owner_id:id,name:'图片验收'}).select().single());const portrait=ok(await service.from('pet_visual_assets').insert({owner_id:id,pet_id:pet.id,storage_path:`${id}/${randomUUID()}.png`,prompt_hash:'synthetic-vision-fixture',is_draft:false}).select().single());ok(await service.from('pets').update({status:'confirmed',confirmed_at:new Date().toISOString(),current_asset_id:portrait.id}).eq('id',pet.id));return{id,client,pet:pet.id};}
const jpeg=await readFile('src/avatars/__tests__/avatar-fixture.jpg');
async function upload(a){const id=randomUUID();ok(await a.client.storage.from('pet-vision').upload(`${a.id}/${id}.jpg`,jpeg,{contentType:'image/jpeg',upsert:false}));return(await call(a.client,{action:'register',request_id:id})).asset;}
const claim=(a,asset,request=randomUUID(),text='看看这张合成图片')=>({target_pet_id:a.pet,request_id:request,owner_content:text,image_asset_id:asset.id,image_asset_version:asset.version});
async function commit(a,input,turn,text='合成图片测试描述：红色三角形'){return service.rpc('commit_pet_private_delivery',{target_pet_id:a.pet,request_id:input.request_id,target_token:turn.token,expected_revision:turn.revision,reply_content:text,target_model_run_id:null,context_ids:[turn.message_id]});}
try{
 const[a,b]=await Promise.all([account(),account()]);
 pass((await call(a.client,{action:'capabilities'})).available===false,'unverified model remains disabled');
 const asset=await upload(a);pass(asset.version===1,'private raster registered through real Edge');
 pass((await call(a.client,{action:'register',request_id:asset.id})).asset.id===asset.id,'upload retry keeps asset id');
 pass(!!(await a.client.storage.from('pet-vision').upload(`${a.id}/${asset.id}.jpg`,jpeg,{contentType:'image/jpeg',upsert:true})).error,'immutable storage cannot be overwritten');
 pass(ok(await b.client.from('pet_vision_assets').select('id')).length===0,'asset metadata private');
 await assert.rejects(()=>call(b.client,{action:'read',asset_id:asset.id}),/unavailable/);checks++;
 pass(!!(await b.client.storage.from('pet-vision').createSignedUrl(`${a.id}/${asset.id}.jpg`,60)).error,'private image storage denies foreign account');
 const first=claim(a,asset);const turn=ok(await service.rpc('claim_pet_vision_request',first));
 const source=ok(await a.client.from('pet_private_threads').select('image_asset_id,image_asset_version').eq('id',turn.message_id).single());pass(source.image_asset_id===asset.id&&source.image_asset_version===1,'same transaction binds text and exactly one image');
 pass(ok(await service.from('pet_life_extraction_jobs').select('source_message_id').eq('source_message_id',turn.message_id)).length===0,'image source is not automatically extracted into life facts');
 pass(!!(await service.rpc('claim_pet_vision_request',{...first,owner_content:'changed content'})).error,'same request cannot change text');
 const spare=await upload(a);pass(!!(await service.rpc('claim_pet_vision_request',{...first,image_asset_id:spare.id})).error,'same request cannot replace image');
 pass(!!(await service.rpc('claim_pet_private_request',{target_pet_id:a.pet,request_id:first.request_id,owner_content:first.owner_content,request_mode:'companion'})).error,'same request cannot omit image');
 pass(!!(await service.rpc('claim_pet_vision_request',claim(b,asset))).error,'other pet cannot claim owner image');
 pass(!!(await a.client.rpc('claim_pet_vision_request',first)).error,'claim RPC is service-only');
 const answer=ok(await commit(a,first,turn));pass(answer.in_reply_to_id===turn.message_id,'verified attachment can commit a private answer');
 pass(ok(await service.from('pet_memory_extraction_jobs').select('source_message_id').eq('source_message_id',turn.message_id)).length===0,'answer commit does not enqueue preference extraction for image');
 pass(ok(await service.rpc('claim_pet_vision_request',first)).reply_id===answer.id,'completed retry returns original answer');
 pass(ok(await service.from('pet_private_threads').select('id').eq('owner_id',a.id).eq('role','owner')).length===1,'image retries do not duplicate owner message');
 const preview={action:'prepare_memory',request_id:randomUUID(),asset_id:asset.id,expected_version:1,source_message_id:turn.message_id,content:'这是测试图片中的红色三角形'};
 const drafted=await call(a.client,preview);pass(drafted.outcome==='waiting_confirmation'&&drafted.draft.state==='pending','explicit preview is pending confirmation');
 pass(ok(await a.client.from('pet_personal_memories').select('id')).length===0,'preview alone creates no long-term memory');
 pass((await call(a.client,preview)).draft.id===drafted.draft.id,'preview retry fixed');
 await assert.rejects(()=>call(a.client,{...preview,content:'changed'}),/conflict/);checks++;
 await assert.rejects(()=>call(b.client,{...preview,request_id:randomUUID()}),/changed/);checks++;
 const confirm={action:'confirm_memory',request_id:randomUUID(),draft_id:drafted.draft.id,expected_version:1};
 const saved=await call(a.client,confirm);pass(saved.outcome==='memory_created','owner confirmation creates manual memory');
 pass((await call(a.client,confirm)).memory_id===saved.memory_id,'confirmation retry does not duplicate memory');
 pass(ok(await a.client.from('pet_personal_memories').select('id')).length===1,'only one confirmed memory');
 ok(await a.client.rpc('remove_pet_personal_memory',{target_memory_id:saved.memory_id}));
 pass(!!(await service.rpc('assert_pet_vision_request',{p_pet:a.pet,p_request:first.request_id})).error,'forget invalidates image source for future model input');
 pass((await call(a.client,{action:'read',asset_id:asset.id})).asset.state==='excluded','forgotten original image remains readable in original conversation');
 await assert.rejects(()=>call(a.client,confirm),/changed/);checks++;
 pass(ok(await a.client.rpc('search_owned_content',{p_owner:a.id,p_query:'红色三角形'})).length===0,'forgotten image description and memory excluded from unified search');
 pass(ok(await a.client.from('pet_private_threads').select('id').eq('id',answer.id)).length===1,'raw original conversation retained');
 const second=claim(a,spare),late=ok(await service.rpc('claim_pet_vision_request',second));
 const pending=await call(a.client,{action:'prepare_memory',request_id:randomUUID(),asset_id:spare.id,expected_version:1,source_message_id:late.message_id,content:'尚未确认的图片说明'});
 await assert.rejects(()=>call(a.client,{action:'delete',request_id:randomUUID(),asset_id:spare.id,expected_version:2}),/conflict/);checks++;
 const deletion={action:'delete',request_id:randomUUID(),asset_id:spare.id,expected_version:1};pass((await call(a.client,deletion)).outcome==='deleted','versioned deletion succeeds');
 pass((await call(a.client,deletion)).outcome==='deleted','delete retry has same receipt');
 pass(!!(await commit(a,second,late)).error,'deleted input blocks late answer commit');
 await assert.rejects(()=>call(a.client,{action:'confirm_memory',request_id:randomUUID(),draft_id:pending.draft.id,expected_version:1}),/changed/);checks++;
 pass(ok(await a.client.from('pet_vision_memory_drafts').select('content').eq('id',pending.draft.id).single()).content===null,'deleted source clears derived draft');
 pass(!!(await a.client.storage.from('pet-vision').createSignedUrl(`${a.id}/${spare.id}.jpg`,60)).error,'deleted image cannot receive new signed URL');
 const hash=createHash('sha256').update(jpeg).digest('hex');pass(!!(await service.rpc('register_pet_vision_asset',{p_owner:a.id,p_id:asset.id,p_hash:hash,p_mime:'image/jpeg',p_bytes:jpeg.length})).error,'register retry cannot restore excluded original');
 console.log(`PASS: ${checks} real Supabase vision storage, immutable request, explicit memory consent, exclusion and late-result fencing checks.`);
}finally{for(const a of accounts){const files=ok(await service.storage.from('pet-vision').list(a.id));const paths=files.filter(x=>x.id).map(x=>`${a.id}/${x.name}`);if(paths.length)ok(await service.storage.from('pet-vision').remove(paths));ok(await service.auth.admin.deleteUser(a.id));}}
