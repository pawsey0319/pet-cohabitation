// Only synthetic accounts and prompts; never inspect existing private conversations.
import {createClient} from '@supabase/supabase-js';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
const url=process.env.SUPABASE_URL;
if(!url||new URL(url).hostname!==process.env.COMPANION_TEST_HOST)throw new Error('Explicit cloud target required');
const settings={auth:{persistSession:false,autoRefreshToken:false}};
const service=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,settings);
const client=createClient(url,process.env.SUPABASE_ANON_KEY,settings);
const ok=r=>{if(r.error)throw new Error(r.error.message);return r.data;};
const email=`latency-${randomUUID()}@example.test`;const password=`Test-${randomUUID()}!a1`;
let ownerId;const results=[];
try{
  const owner=ok(await service.auth.admin.createUser({email,password,email_confirm:true}));ownerId=owner.user.id;
  ok(await service.from('profiles').insert({id:ownerId,email,nickname:'耗时验收'}));
  const session=ok(await client.auth.signInWithPassword({email,password})).session;
  const pet=ok(await client.from('pets').insert({owner_id:ownerId,name:'验收芽芽'}).select('id').single());
  const asset=ok(await service.from('pet_visual_assets').insert({pet_id:pet.id,owner_id:ownerId,storage_path:`fixture/${randomUUID()}.png`,prompt_hash:'synthetic-fixture',is_draft:true}).select('id').single());
  ok(await service.from('pet_expectation_drafts').insert({pet_id:pet.id,owner_id:ownerId,personality_seed_prompt:'Synthetic calm pet personality',visual_seed_prompt:'Synthetic pixel creature',seed_summary:'Synthetic fixture'}));
  ok(await service.rpc('confirm_pet_asset',{target_owner:ownerId,target_asset:asset.id}));
  for(const [mode,content] of [
    ['companion','今天忙了一天有点累，你先听我说，不用急着给建议。'],
    ['legacy','今天忙了一天有点累，你先听我说，不用急着给建议。'],
    ['companion','刚才工作太多没休息，现在终于可以安静一会儿了。'],
    ['legacy','刚才工作太多没休息，现在终于可以安静一会儿了。'],
    ['companion','谢谢，我现在感觉轻松一点了。'],
  ]){
    const started=Date.now();
    const response=await fetch(`${url}/functions/v1/pet-chat`,{method:'POST',headers:{apikey:process.env.SUPABASE_ANON_KEY,Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},
      body:JSON.stringify({content,request_id:randomUUID(),...(mode==='companion'?{mode}:{})}),signal:AbortSignal.timeout(150000)});
    const body=await response.json();
    const result={mode,status:response.status,elapsedMs:Date.now()-started,serverTiming:response.headers.get('server-timing'),reply:body.content??null,error:body.error??null};
    results.push(result);console.log(JSON.stringify(result));
    if(!response.ok)process.exitCode=1;
  }
}finally{
  if(ownerId)ok(await service.auth.admin.deleteUser(ownerId));
  await mkdir('test-results',{recursive:true});
  await writeFile('test-results/companion-cloud-latency.json',JSON.stringify(results,null,2));
  console.log('Synthetic latency account removed.');
}
