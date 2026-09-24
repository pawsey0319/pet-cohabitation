// Production smoke restricted to freshly created synthetic accounts and one space.
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
const url='https://lthcucgggoevgcboouqw.supabase.co';
assert.equal(process.env.SUPABASE_URL,url);assert.equal(process.argv[2],'--cloud');
const run=randomUUID(),folder=`test-results/pet-capability-cloud-${run}`;await mkdir(folder,{recursive:true});
const ids=[],spaces=[],checks=[],measurements=[],cleanup=[];let failure=null;
const guardedFetch=(input,init={})=>{assert.equal(new URL(String(input)).origin,url);return fetch(input,{...init,signal:AbortSignal.timeout(125000)})};
const options={auth:{persistSession:false,autoRefreshToken:false},global:{fetch:guardedFetch}};
const service=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,options);
const ok=(result)=>{if(result.error)throw new Error(result.error.message);return result.data};
const check=(value,label)=>{assert.ok(value,label);checks.push(label);console.log(`PASS ${label}`)};
const save=()=>writeFile(`${folder}/report.json`,JSON.stringify({run,at:new Date().toISOString(),project:'lthcucgggoevgcboouqw',synthetic_only:true,ids,spaces,checks,measurements,cleanup,failure,passed:!failure&&checks.length>10},null,2));
async function account(label){
 const email=`pet-capability-${run}-${label}@example.test`,password=`Aa1!${randomUUID()}`;
 const user=ok(await service.auth.admin.createUser({email,password,email_confirm:true})).user;ids.push(user.id);await save();
 ok(await service.from('profiles').insert({id:user.id,email,nickname:'云端同名测试成员'}));
 const client=createClient(url,process.env.SUPABASE_ANON_KEY,options),session=ok(await client.auth.signInWithPassword({email,password})).session;
 return {id:user.id,client,token:session.access_token};
}
async function edge(name,owner,body){
 const started=Date.now();const response=await guardedFetch(`${url}/functions/v1/${name}`,{method:'POST',headers:{apikey:process.env.SUPABASE_ANON_KEY,Authorization:`Bearer ${owner.token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const data=await response.json();measurements.push({function:name,elapsed_ms:Date.now()-started,http:response.status});await save();
 assert.ok(response.ok,`${name}: ${data.error??response.status}`);return data;
}
try{
 const A=await account('a'),B=await account('b');
 const pet=ok(await service.from('pets').insert({owner_id:B.id,name:'云端验收小树',seed_summary:'仅用于权限验收的合成伙伴',personality_seed_prompt:'温和且准确的测试伙伴'}).select('id,name').single());
 const asset=randomUUID();ok(await service.from('pet_visual_assets').insert({id:asset,pet_id:pet.id,owner_id:B.id,storage_path:`${B.id}/${asset}.png`,prompt_hash:'capability-synthetic-no-upload',is_draft:false}));
 ok(await service.from('pets').update({status:'confirmed',current_asset_id:asset,confirmed_at:new Date().toISOString()}).eq('id',pet.id));
 const space=ok(await B.client.rpc('create_relationship_space',{space_name:'能力发布专用验收群',space_kind:'friend_circle'}));spaces.push(space);await save();
 ok(await service.from('space_members').insert({space_id:space,user_id:A.id,role:'member'}));
 ok(await service.from('space_pet_permissions').upsert({space_id:space,pet_id:pet.id,owner_id:B.id,participation_enabled:true}));
 const catalog=await edge('pet-capabilities',B,{});check(catalog.enabled&&catalog.capabilities.length===105,'deployed catalog and execution flag');
 check(!catalog.capabilities.find(c=>c.id==='vision.understand').availability.available,'unverified image capability remains closed');
 const send=async()=>ok(await A.client.rpc('send_space_message_v2',{message_client_id:randomUUID(),target_space_id:space,message_kind:'text',message_text:`@${pet.name} 请 @ 你的主人`,mentioned_pet_ids:[pet.id]}));
 const source=await send();await edge('handle-space-message',A,{message_id:source.message.id,cue_pet_ids:[pet.id]});
 let receipts=[];
 for(let i=0;i<35;i++){receipts=ok(await service.from('pet_action_receipts').select('*').eq('pet_id',pet.id).eq('source_id',source.message.id));if(receipts.length)break;await new Promise(r=>setTimeout(r,1000));}
 check(receipts[0]?.status==='succeeded','cloud route executes member request to mention owner');
 const receipt=receipts[0];
 check(ok(await service.from('message_mentions').select('target_user_id').eq('message_id',receipt.message_id))[0]?.target_user_id===B.id,'structured mention uses verified owner ID');
 check(ok(await service.from('notification_events').select('id').eq('entity_id',receipt.message_id).eq('user_id',B.id).eq('kind','mention')).length===1,'real notification event exists');
 check(receipt.route.includes(receipt.message_id),'receipt links to the actual group message');
 await edge('handle-space-message',A,{message_id:source.message.id,cue_pet_ids:[pet.id]});
 check(ok(await service.from('pet_action_receipts').select('id').eq('pet_id',pet.id).eq('source_id',source.message.id)).length===1,'cloud retry does not duplicate the mention');
 const ask=async(content,requestId=randomUUID())=>{
  const reply=await edge('pet-chat',B,{content,request_id:requestId,mode:'companion',timezone:'Asia/Shanghai'});
  const request=ok(await service.from('pet_private_requests').select('owner_message_id').eq('pet_id',pet.id).eq('client_request_id',requestId).single());
  const actions=ok(await service.from('pet_action_receipts').select('*').eq('pet_id',pet.id).eq('source_id',request.owner_message_id).order('step'));
  return {reply,actions,requestId};
 };
 const denied=await ask('请创建一个私人任务，标题为“云端未授权任务”，不要添加截止时间。');
 check(denied.actions[0]?.status==='not_granted','real model proposes action but server rejects missing grant');
 const grant=ok(await B.client.rpc('manage_pet_delegation',{command:{action:'grant',pet_id:pet.id,capability:'work.create',target_scope:'personal'}}));
 const created=await ask('请创建一个私人任务，标题为“云端授权任务”，不要添加截止时间。');
 check(created.actions[0]?.status==='succeeded'&&created.actions[0]?.result?.item?.title==='云端授权任务','real model and server create the requested work item');
 await ask('请创建一个私人任务，标题为“云端授权任务”，不要添加截止时间。',created.requestId);
 check(ok(await service.from('work_items').select('id').eq('owner_id',B.id).eq('title','云端授权任务')).length===1,'private transport retry does not duplicate work');
 ok(await B.client.rpc('manage_pet_delegation',{command:{action:'revoke',pet_id:pet.id,grant_id:grant.id,expected_version:grant.version}}));
 const revoked=await ask('请创建一个私人任务，标题为“云端撤权后任务”，不要添加截止时间。');
 check(revoked.actions[0]?.status==='not_granted'&&ok(await service.from('work_items').select('id').eq('owner_id',B.id).eq('title','云端撤权后任务')).length===0,'revocation prevents the next real-model action');
 check(ok(await A.client.from('pet_action_receipts').select('id').eq('owner_id',B.id)).length===0,'member cannot read owner private receipts');
}catch(error){failure=String(error);console.error(failure);process.exitCode=1;}
finally{
 for(const id of spaces){const r=await service.from('spaces').delete().eq('id',id);cleanup.push({kind:'space',id,removed:!r.error});}
 for(const id of ids){const r=await service.auth.admin.deleteUser(id);cleanup.push({kind:'account',id,removed:!r.error});}
 if(cleanup.some(r=>!r.removed)){failure??='synthetic_cleanup_incomplete';process.exitCode=1;}
 await save();console.log(JSON.stringify({passed:!failure,checks:checks.length,report:`${folder}/report.json`,phoneAcceptance:'pending'}));
}
