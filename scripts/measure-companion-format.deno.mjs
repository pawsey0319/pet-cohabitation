// Direct adapter comparison using ONLY the failed run's synthetic conversation.
// This is not a cloud/app end-to-end acceptance or a device timing benchmark.
import assert from 'node:assert/strict';
const mode=Deno.args.includes('--baseline')?'baseline':'candidate';
const label=Deno.args.includes('--label')?Deno.args[Deno.args.indexOf('--label')+1]:'20260921';
const count=Deno.args.includes('--samples')?Number(Deno.args[Deno.args.indexOf('--samples')+1]):20;
assert.match(label,/^[a-z0-9-]{1,40}$/);assert.ok(Number.isInteger(count)&&count>=1&&count<=20);
const modulePath=mode==='baseline'?'../test-results/next-release-baseline-20260921/source/supabase/functions/_shared/modelStream.ts':'../supabase/functions/_shared/modelStream.ts';
const {streamPrivateCompanionReply}=await import(modulePath);
const fixture=JSON.parse(await Deno.readTextFile('test-results/companion-group-timeout-20260914/cloud-next-release-personal-20260921.json'));
assert.equal(fixture.synthetic_only,true);
const source=fixture.measurements;assert.equal(source[3].error,'text_model_invalid_json');
const messages=[];
for(const [i,row] of source.slice(0,3).entries()){
  assert.ok(row.reply?.content);
  messages.push({role:'owner',content:row.question,created_at:`2026-09-21T08:00:0${i*2}Z`});
  messages.push({role:'pet',content:row.reply.content,created_at:`2026-09-21T08:00:0${i*2+1}Z`});
}
messages.push({role:'owner',content:source[3].question,created_at:'2026-09-21T08:00:07Z'});
const input={petName:'查询验收宠',personality:'正在形成',styles:[],memories:[],recalledMessages:[],messages,contextStartedAt:null};
const path=`test-results/next-release-format-${mode}-${label}.json`;
try{await Deno.stat(path);throw new Error('Preserve the previous run');}catch(error){if(!(error instanceof Deno.errors.NotFound))throw error;}
const report={mode,model:Deno.env.get('TEXT_MODEL'),synthetic_only:true,scope:'Same saved synthetic history and configured business model via local CPA; excludes cloud context/commit, real phone and full prompt parity.',samples:[]};
const original=globalThis.fetch;let attempts=0;
const captures=[];
globalThis.fetch=async(...args)=>{
  attempts++;const response=await original(...args);
  if(Deno.args.includes('--capture-synthetic-output'))captures.push(response.clone().text().then(text=>{
    let raw='';for(const line of text.split('\n'))if(line.startsWith('data:')&&!line.includes('[DONE]')){try{raw+=JSON.parse(line.slice(5)).choices?.[0]?.delta?.content??'';}catch{}}
    return raw.slice(0,4000);
  }));
  return response;
};
try{
  for(let i=0;i<count;i++){
    const started=performance.now(),before=attempts;let first=null,resets=0,preview=null;
    const row={sample:i+1,success:false,error:null,first_text_ms:null,total_ms:null,attempts:0,resets:0,first_text_preview:null};
    try{
      const reply=await streamPrivateCompanionReply(input,async text=>{
        if(!text){resets++;first=null;preview=null;return;}
        if(first===null){first=Math.round(performance.now()-started);preview=text.slice(0,80);}
      });
      assert.ok(reply.content.trim());row.success=true;
    }catch(error){row.error=error instanceof Error?error.message:'request_failed';}
    if(captures.length){row.synthetic_raw_outputs=await Promise.all(captures);captures.length=0;}
    Object.assign(row,{first_text_ms:first,total_ms:Math.round(performance.now()-started),attempts:attempts-before,resets,first_text_preview:preview});
    report.samples.push(row);await Deno.writeTextFile(path,JSON.stringify(report,null,2));
    console.log(JSON.stringify({mode,sample:row.sample,success:row.success,error:row.error,total_ms:row.total_ms,attempts:row.attempts}));
    if(row.error&&/network|http_429|configuration|timeout/.test(row.error)){report.stopped='Stop on provider availability/quota failure; do not repeatedly consume quota.';break;}
  }
}finally{
  globalThis.fetch=original;
  report.finished_at=new Date().toISOString();report.successes=report.samples.filter(row=>row.success).length;
  await Deno.writeTextFile(path,JSON.stringify(report,null,2));
}
