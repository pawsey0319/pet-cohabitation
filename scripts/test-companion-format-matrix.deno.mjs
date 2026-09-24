// Real configured business model, synthetic inputs only; never a cloud/device gate.
import assert from 'node:assert/strict';
import { streamPrivateCompanionReply } from '../supabase/functions/_shared/modelStream.ts';
const label=Deno.args[Deno.args.indexOf('--label')+1];
assert.ok(Deno.args.includes('--label')&&/^[a-z0-9-]{1,50}$/.test(label));
assert.equal(Deno.env.get('MODEL_MOCK_MODE'),'false');
const output=`test-results/companion-format-matrix-${label}.json`;
try{await Deno.stat(output);throw new Error('Preserve previous evidence');}catch(error){if(!(error instanceof Deno.errors.NotFound))throw error;}
const questions=[
  '今天忙完了，坐下来休息一会儿，和我轻松聊两句。',
  '今天回答一句话就好，我想安静地歇一会儿。',
  '刚才我说的是“暂时没想好”，不是已经决定了，先不用替我安排。',
  '我想把这两行留作随便聊天的话题：\n喝水\n看看窗外🙂',
  '今天没有要办的事，暂时也不用总结，随便聊一小句。',
];
const originalFetch=globalThis.fetch;let requests=0;
globalThis.fetch=(...args)=>{requests++;return originalFetch(...args);};
const report={synthetic_only:true,model:Deno.env.get('TEXT_MODEL'),scope:'20 distinct combinations: 0/1/3/8 historical exchanges and five current questions. Direct adapter via existing gateway, no cloud commit or device. Format checks only; no conversational-quality score.',started_at:new Date().toISOString(),samples:[]};
try{
  for(const turns of [0,1,3,8])for(const [questionIndex,question] of questions.entries()){
    if(report.stopped)break;
    const messages=[];
    for(let i=0;i<turns;i++){
      messages.push({role:'owner',content:`这是第${i+1}轮合成日常聊天。今天有点忙，现在休息。`,created_at:`2026-09-21T09:${String(i).padStart(2,'0')}:00Z`});
      messages.push({role:'pet',content:i%2?'“没想好”也没关系，先慢慢歇一会儿。\n我在旁边陪着🙂':'今天忙完可以放松一下，我们随便聊聊。',created_at:`2026-09-21T09:${String(i).padStart(2,'0')}:01Z`});
    }
    messages.push({role:'owner',content:question,created_at:'2026-09-21T09:30:00Z'});
    const input={petName:'合成格式验收宠',personality:'正在形成',styles:[],memories:[],recalledMessages:[],messages,contextStartedAt:null};
    const row={case:`history-${turns}-question-${questionIndex+1}`,history_exchanges:turns,question,success:false,error:null,first_text_ms:null,resets:0,attempts:0,total_ms:0,reply:null};
    const before=requests,started=performance.now();
    try{
      const reply=await streamPrivateCompanionReply(input,async text=>{
        if(!text){row.resets++;row.first_text_ms=null;}
        else if(row.first_text_ms===null)row.first_text_ms=Math.round(performance.now()-started);
      });
      assert.ok(reply.content.trim()&&reply.content.length<=1200);
      row.reply=reply.content;row.success=true;
    }catch(error){row.error=error instanceof Error?error.message:'request_failed';}
    row.attempts=requests-before;row.total_ms=Math.round(performance.now()-started);report.samples.push(row);
    if(row.error&&/network|http_429|configuration|timeout/.test(row.error))report.stopped='Availability/quota failure; do not continue consuming calls.';
    await Deno.writeTextFile(output,JSON.stringify(report,null,2));
    console.log(JSON.stringify({case:row.case,success:row.success,error:row.error,attempts:row.attempts,total_ms:row.total_ms}));
  }
}finally{
  globalThis.fetch=originalFetch;report.finished_at=new Date().toISOString();
  report.passed=report.samples.length===20&&report.samples.every(row=>row.success);
  await Deno.writeTextFile(output,JSON.stringify(report,null,2));
}
if(!report.passed)Deno.exit(1);
