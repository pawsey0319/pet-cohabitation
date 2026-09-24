// Explicit cloud acceptance using only newly created synthetic users/messages.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';
const label=process.argv[process.argv.indexOf('--label')+1];
assert.ok(process.argv.includes('--cloud')&&/^[a-z0-9-]{1,40}$/.test(label??''));
const mode=process.argv.includes('--steward')?'steward':'companion',final=process.argv.includes('--final');
const plain=process.argv.includes('--plain');
const sampleCount=process.argv.includes('--samples')?Number(process.argv[process.argv.indexOf('--samples')+1]):1;
assert.ok(Number.isInteger(sampleCount)&&sampleCount>=1&&sampleCount<=20);
assert.ok(!final||sampleCount===1,'final_replay_check_and_measurement_batch_are_separate');
const url=process.env.SUPABASE_URL;assert.equal(url,'https://lthcucgggoevgcboouqw.supabase.co');
const out=`test-results/companion-group-timeout-20260914/cloud-${label}.json`;
assert.ok(!existsSync(out));mkdirSync('test-results/companion-group-timeout-20260914',{recursive:true});
const opts={auth:{persistSession:false,autoRefreshToken:false}};
const service=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,opts);
const users=[],clients=[],sourceIds=[],requests=[];let space,pet,owner;
const report={started_at:new Date().toISOString(),label,mode,transport:mode==='steward'?'json':'sse',final,synthetic_only:true,synthetic_ids:{users,space:null,pet:null},measurements:[],checks:[],cleanup:[],passed:false};
report.conditions={path:plain?'personal_companion':'companion_group_recall',sample_count:sampleCount,cold_start:'uncontrolled',subsequent:'same account, pet, network and growing thread; sequential',device:'host SSE client, not Android UI/overlay',first_text:'first nonempty text event only; phase/accepted/done do not count'};
const save=()=>writeFileSync(out,JSON.stringify(report,null,2));
const ok=r=>{if(r.error)throw new Error(r.error.message);return r.data;};
async function account(nickname){const email=`recall-timeout-${randomUUID()}@example.test`,password=`Aa1!${randomUUID()}`;
 const user=ok(await service.auth.admin.createUser({email,password,email_confirm:true})).user;users.push(user.id);save();
 ok(await service.from('profiles').insert({id:user.id,email,nickname}));const client=createClient(url,process.env.SUPABASE_ANON_KEY,opts);clients.push(client);
 const session=ok(await client.auth.signInWithPassword({email,password})).session;return{id:user.id,client,token:session.access_token};}
async function ask(content,requestId=randomUUID()){
 requests.push(requestId);const started=performance.now();const result={request_id:requestId,question:content,events:[],accepted_revision:null,elapsed_ms:null,reply:null,error:null,first_text_ms:null,first_text_preview:null,text_events:0};report.measurements.push(result);save();
 try{
  const response=await fetch(`${url}/functions/v1/pet-chat`,{method:'POST',headers:{apikey:process.env.SUPABASE_ANON_KEY,Authorization:`Bearer ${owner.token}`,'Content-Type':'application/json'},body:JSON.stringify({content,request_id:requestId,mode,...(mode==='companion'?{stream:true}:{}),timezone:'Asia/Shanghai'}),signal:AbortSignal.timeout(145000)});
  result.http_status=response.status;result.server_timing=response.headers.get('server-timing');
  if(mode==='steward'||!response.ok){
   const payload=await response.json();
   if(!response.ok)result.error=typeof payload.error==='string'?payload.error:`http_${response.status}`;
   assert.ok(response.ok,result.error??'reply_http_error');assert.match(response.headers.get('content-type')??'',/application\/json/);
   result.reply=payload;
  }else{
   assert.match(response.headers.get('content-type')??'',/text\/event-stream/);assert.ok(response.body,'stream_body_required');
   const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
   try{for(;;){const part=await reader.read();if(part.done)break;buffer+=decoder.decode(part.value,{stream:true});assert.ok(buffer.length<300000);let end;
    while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end).trim();buffer=buffer.slice(end+1);if(!line.startsWith('data:'))continue;const event=JSON.parse(line.slice(5));
     result.events.push({type:event.type,phase:event.phase??null,at_ms:Math.round(performance.now()-started)});
     if(event.type==='text'&&typeof event.content==='string'&&event.content.trim()){
       result.text_events++;if(result.first_text_ms===null){result.first_text_ms=Math.round(performance.now()-started);result.first_text_preview=event.content.slice(0,100);}
     }
     if(event.type==='accepted')result.accepted_revision=event.revision;
     if(event.type==='done')result.reply=event.message;
     if(event.type==='error')result.error=event.error;
     save();
    }
   }}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  }
  assert.ok(!result.error,result.error??'stream_error');assert.ok(result.reply?.id&&result.reply.content,'committed_reply_required');
  assert.equal(result.reply.conversation_kind,mode,'reply_must_use_requested_mode');
  assert.ok(!result.reply.content.includes('旧暗号紫色月亮'),'pre_join_message_must_not_be_used');
  for(const source of result.reply.recall_sources??[]){assert.equal(source.space_id,space);assert.ok(sourceIds.includes(source.message_id));}
  if(!plain)assert.ok((result.reply.recall_sources??[]).length>0,'actual_sources_required');return result;
 }catch(error){result.error??=error instanceof Error?error.message.slice(0,160):'request_failed';throw error;}
 finally{result.elapsed_ms=Math.round(performance.now()-started);save();}
}
async function modelRuns(timeoutMs=5000){
 return ok(await service.from('model_runs').select('id,status,model,error_code,latency_ms').eq('owner_id',owner.id).eq('pet_id',pet.id).eq('run_kind','pet_private_reply').abortSignal(AbortSignal.timeout(timeoutMs)));
}
async function checkRecoveryReads(first,peer){
 // One committed-state probe of the actual recovery SELECT contracts. These
 // use authenticated clients, never service-role reads or a recovery loop.
 const started=performance.now(),petId=first.reply.pet_id,sourceId=first.reply.in_reply_to_id,replyId=first.reply.id;
 assert.equal(petId,pet.id);assert.equal(first.reply.owner_id,owner.id);assert.ok(sourceId&&replyId);
 const ids=[...new Set([sourceId,replyId,...(first.reply.context_message_ids??[])])];
 const read=async client=>{
  const signal=AbortSignal.timeout(10000);
  const queries={
   request:client.from('pet_private_requests').select('pet_id,owner_message_id,reply_message_id').eq('owner_id',owner.id).eq('client_request_id',first.request_id).abortSignal(signal).maybeSingle(),
   source:client.from('pet_private_threads').select('id,created_at,conversation_kind,reply_status,reply_error_code').eq('owner_id',owner.id).eq('pet_id',petId).eq('id',sourceId).eq('role','owner').eq('request_key',first.request_id).eq('conversation_kind',mode).abortSignal(signal).maybeSingle(),
   reply:client.from('pet_private_threads').select('*').eq('owner_id',owner.id).eq('pet_id',petId).eq('id',replyId).eq('role','pet').eq('in_reply_to_id',sourceId).eq('conversation_kind',mode).abortSignal(signal).maybeSingle(),
   cancellation:client.from('pet_private_cancellations').select('request_id').eq('owner_id',owner.id).eq('pet_id',petId).eq('request_id',first.request_id).abortSignal(signal).maybeSingle(),
   exclusions:client.from('pet_private_context_exclusions').select('message_id').eq('owner_id',owner.id).eq('pet_id',petId).in('message_id',ids).abortSignal(signal),
   ...(mode==='companion'?{
    state:client.from('pet_companion_states').select('revision,context_started_at').eq('owner_id',owner.id).eq('pet_id',petId).abortSignal(signal).maybeSingle(),
    stream:client.from('pet_private_streams').select('status,revision').eq('owner_id',owner.id).eq('pet_id',petId).eq('request_id',first.request_id).abortSignal(signal).maybeSingle(),
   }:{}),
  };
  const entries=Object.entries(queries),results=await Promise.allSettled(entries.map(async([name,query])=>[name,ok(await query)]));
  for(const result of results)if(result.status==='rejected')throw result.reason;
  return Object.fromEntries(results.map(result=>result.value));
 };
 report.recovery_rls={mode,pet_id:petId,request_id:first.request_id,source_id:sourceId,reply_id:replyId,owner_passed:false,peer_passed:false,elapsed_ms:null};save();
 try{
  const own=await read(owner.client);
  assert.deepEqual(own.request,{pet_id:petId,owner_message_id:sourceId,reply_message_id:replyId});
  assert.equal(own.source?.id,sourceId);assert.equal(own.source.conversation_kind,mode);assert.equal(own.source.reply_status,'succeeded');
  assert.equal(own.reply?.id,replyId);assert.equal(own.reply.in_reply_to_id,sourceId);assert.equal(own.reply.content,first.reply.content);
  assert.equal(own.cancellation,null);assert.deepEqual(own.exclusions,[]);
  if(mode==='companion'){
   const expectedRevision=first.accepted_revision??own.stream?.revision;
   assert.ok(Number.isSafeInteger(expectedRevision),'accepted_or_stream_revision_required');
   assert.equal(own.state?.revision??0,expectedRevision);
   if(own.stream){assert.equal(own.stream.status,'committed');assert.equal(own.stream.revision,expectedRevision);}
   report.recovery_rls.expected_revision=expectedRevision;
   if(own.state?.context_started_at)assert.ok(Date.parse(own.source.created_at)>Date.parse(own.state.context_started_at));
  }
  report.recovery_rls.owner_passed=true;
  report.recovery_rls.owner_rows=Object.fromEntries(Object.entries(own).map(([name,value])=>[name,Array.isArray(value)?value.length:value?1:0]));save();
  const other=await read(peer.client);
  for(const [name,value]of Object.entries(other))assert.equal(Array.isArray(value)?value.length:value?1:0,0,`other_account_cannot_read_${name}`);
  report.recovery_rls.peer_passed=true;report.recovery_rls.peer_rows=Object.fromEntries(Object.keys(other).map(name=>[name,0]));
  report.checks.push('owner recovery SELECTs read the same committed request/source/reply IDs and valid guards','other synthetic account cannot read the same private recovery IDs or state');
 }finally{report.recovery_rls.elapsed_ms=Math.round(performance.now()-started);save();}
}
async function settledModelRuns(expected){
 // Reply commit precedes optional background finishModelRun bookkeeping.
 // Poll only this synthetic pet's records, with one fixed convergence budget.
 const started=performance.now(),budget=8000;let attempts=0;
 report.model_run_settlement={budget_ms:budget,polls:0,elapsed_ms:0,converged:false};
 for(;;){
  const remaining=Math.floor(budget-(performance.now()-started));assert.ok(remaining>0,'model_run_finish_did_not_converge');
  const runs=await modelRuns(remaining);report.model_runs=runs;
  Object.assign(report.model_run_settlement,{polls:++attempts,elapsed_ms:Math.round(performance.now()-started)});save();
  assert.ok(runs.length<=expected,'unexpected_extra_model_run');
  assert.ok(!runs.some(run=>['failed','blocked'].includes(run.status)),'actual_model_run_failed');
  if(runs.length===expected&&runs.every(run=>run.status==='succeeded')){report.model_run_settlement.converged=true;save();return runs;}
  assert.ok(performance.now()-started<budget,'model_run_finish_did_not_converge');
  await new Promise(resolve=>setTimeout(resolve,Math.min(500,Math.max(1,budget-(performance.now()-started)))));
 }
}
async function cleanup(kind,operation){
 try{const result=await operation();report.cleanup.push({kind,passed:!result.error});}
 catch{report.cleanup.push({kind,passed:false});}
 save();
}
try{
 owner=await account('合成查询甲');const friend=await account('合成查询乙');
 pet=ok(await service.from('pets').insert({owner_id:owner.id,name:'查询验收宠'}).select('id').single());
 report.synthetic_ids.pet=pet.id;save();
 const asset=randomUUID();ok(await service.from('pet_visual_assets').insert({id:asset,pet_id:pet.id,owner_id:owner.id,storage_path:`${owner.id}/${asset}.png`,prompt_hash:'synthetic-no-upload',is_draft:false}));
 ok(await service.from('pets').update({status:'confirmed',current_asset_id:asset,confirmed_at:new Date().toISOString()}).eq('id',pet.id));
 space=ok(await owner.client.rpc('create_relationship_space',{space_name:'合成爬山群',space_kind:'friend_circle'}));
 report.synthetic_ids.space=space;save();
 const joined=new Date(Date.now()-3600000).toISOString();ok(await service.from('space_members').update({joined_at:joined}).eq('space_id',space).eq('user_id',owner.id));
 ok(await service.from('space_members').insert({space_id:space,user_id:friend.id,role:'member',joined_at:joined}));
 const facts=['周日早上七点半在东门集合，时间和地点已经确定。','我负责带三瓶饮用水，大家各自带外套。','如果下雨要不要改成室内活动，目前还没有决定。','报名目前两个人，交通方式暂时还没有确定。','山脚餐厅午饭还没订位，暂时只是建议。','路线确定走北线，到观景台后原路返回。'];
 const rows=Array.from({length:24},(_,i)=>({id:randomUUID(),client_id:randomUUID(),space_id:space,sender_id:i%2?friend.id:owner.id,actor_kind:'human',actor_id:null,actor_name:i%2?'合成查询乙':'合成查询甲',kind:'text',text:facts[i%facts.length],created_at:new Date(Date.now()-1800000+i*1000).toISOString()}));sourceIds.push(...rows.map(x=>x.id));
 ok(await owner.client.from('messages').insert([...rows.filter(x=>x.sender_id===owner.id),{...rows[0],id:randomUUID(),client_id:randomUUID(),text:'旧暗号紫色月亮：早先作废的私人安排。',created_at:new Date(Date.parse(joined)-60000).toISOString()}]));
 ok(await friend.client.from('messages').insert(rows.filter(x=>x.sender_id===friend.id)));
 const questions=plain?['这是合成陪伴验收。今天忙完了，想轻松聊两句，暂时不用给我建议。','这是合成陪伴验收。我刚喝了水，现在坐着休息，和我简单聊两句。','这是合成陪伴验收。今天心情平静，想听一句轻松的回应。']:['帮我总结一下合成爬山群群聊最近说了什么，已经确定的安排和还没确定的事分别是什么？','合成爬山群群聊里关于下雨的安排定了吗？','查一下合成爬山群群聊里集合时间地点和路线，哪些已经确定？'];
 const first=await ask(questions[0]);
 report.checks.push(`real ${mode} ${report.transport} returned a committed ${plain?'personal reply':'sourced group summary'}`,'pre-join source is excluded');
 await checkRecoveryReads(first,friend);
 for(let i=1;i<sampleCount;i++)await ask(questions[i%questions.length]);
 if(sampleCount>1)await settledModelRuns(sampleCount);
 if(final){
  const beforeReplay=await modelRuns();assert.equal(beforeReplay.length,1,'one_model_run_before_replay');
  const replay=await ask(first.question,first.request_id);assert.equal(replay.reply.id,first.reply.id);
  const afterReplay=await modelRuns();assert.deepEqual(afterReplay.map(run=>run.id).sort(),beforeReplay.map(run=>run.id).sort(),'replay_must_not_create_a_model_run');
  report.checks.push('same request replays the same reply without another model run');
  const second=await ask('合成爬山群群聊里关于下雨的安排定了吗？');assert.notEqual(second.request_id,first.request_id);assert.notEqual(second.reply.id,first.reply.id);report.checks.push('second topic returns its own committed sourced reply');
  const runs=await settledModelRuns(2);assert.equal(runs.length,2);assert.ok(runs.some(run=>run.id===beforeReplay[0].id));report.checks.push('exactly two successful model-run records for two questions after bounded bookkeeping convergence');
 }
 report.passed=true;
}catch(e){report.error=e instanceof Error?e.message.slice(0,160):'acceptance_failed';process.exitCode=1;}
finally{
 if(owner&&pet&&!report.passed)for(const id of [...new Set(requests)])await cleanup('synthetic_request_stop',()=>owner.client.rpc('stop_pet_private_reply',{p_pet:pet.id,p_request:id}));
 if(space)await cleanup('synthetic_group',()=>service.from('spaces').delete().eq('id',space));
 for(const id of users)await cleanup('synthetic_account',()=>service.auth.admin.deleteUser(id));
 if(report.cleanup.some(result=>!result.passed)){report.passed=false;report.error??='synthetic_cleanup_failed';process.exitCode=1;}
 await Promise.allSettled(clients.map(x=>x.removeAllChannels()));report.finished_at=new Date().toISOString();save();
 const successful=report.measurements.filter(row=>!row.error&&row.reply);
 const stats=(rows,field)=>{const values=rows.map(row=>row[field]).filter(value=>typeof value==='number').sort((a,b)=>a-b);const p=q=>values.length?values[Math.ceil(values.length*q)-1]:null;return{samples:values.length,p50_ms:p(.5),p95_ms:p(.95),min_ms:values[0]??null,max_ms:values.at(-1)??null};};
 report.summary={attempts:report.measurements.length,succeeded:successful.length,failed:report.measurements.filter(row=>row.error).length,first_text:stats(successful,'first_text_ms'),completed:stats(successful,'elapsed_ms'),all_attempt_durations:stats(report.measurements,'elapsed_ms'),note:'Completed and first-text distributions include successful replies only. Small synthetic sample; no phone rendering or controlled cold/warm comparison.'};save();
 console.log(JSON.stringify({passed:report.passed,mode,transport:report.transport,output:out,error:report.error,measurements:report.measurements.map(x=>({elapsed_ms:x.elapsed_ms,error:x.error,reply_received:!!x.reply})),cleanup:report.cleanup}));
}
