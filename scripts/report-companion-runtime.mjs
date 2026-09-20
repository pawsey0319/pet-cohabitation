// Reads operational metadata only: never requests prompts, replies, or user IDs.
import { createClient } from '@supabase/supabase-js';
import { mkdir, writeFile } from 'node:fs/promises';
const url=process.env.SUPABASE_URL;
if(!url||new URL(url).hostname!==process.env.COMPANION_TEST_HOST)throw new Error('Explicit COMPANION_TEST_HOST required');
const until=new Date(process.env.COMPANION_METRICS_TO??Date.now());
const since=new Date(process.env.COMPANION_METRICS_FROM??until.getTime()-86400000);
if(!Number.isFinite(+since)||!Number.isFinite(+until)||+since>=+until||+until-+since>31*86400000)throw new Error('Use a valid time window of up to 31 days');
const client=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const kinds=['pet_private_reply','pet_memory_extract'];
const rows=[];
for(let offset=0;;offset+=1000){
  const result=await client.from('model_runs').select('id,run_kind,status,latency_ms,error_code,created_at')
    .in('run_kind',kinds).gte('created_at',since.toISOString()).lt('created_at',until.toISOString())
    .order('created_at').order('id').range(offset,offset+999);
  if(result.error)throw new Error('Runtime metadata query failed');
  rows.push(...result.data);
  if(result.data.length<1000)break;
}
const summarize=(items)=>{
  const completed=items.filter(row=>['succeeded','failed'].includes(row.status));
  const succeeded=completed.filter(row=>row.status==='succeeded');
  const latency=succeeded.map(row=>row.latency_ms).filter(Number.isFinite).sort((a,b)=>a-b);
  const quantile=p=>latency.length?latency[Math.max(0,Math.ceil(latency.length*p)-1)]:null;
  const errors={};
  for(const row of completed.filter(row=>row.status==='failed')){
    const code=/^[a-z0-9_:]{1,120}$/.test(row.error_code??'')?row.error_code:'unclassified_failure';
    errors[code]=(errors[code]??0)+1;
  }
  return {total:items.length,completed:completed.length,succeeded:succeeded.length,incomplete:items.length-completed.length,
    completionSuccessRate:completed.length?succeeded.length/completed.length:null,latencyMs:{p50:quantile(.5),p95:quantile(.95)},errors};
};
const report={from:since.toISOString(),to:until.toISOString(),
  scope:'Private reply includes companion, steward, and legacy routing. Model runs are logical operations, not individual HTTP attempts. Incomplete runs do not count as successes.',
  byKind:Object.fromEntries(kinds.map(kind=>[kind,summarize(rows.filter(row=>row.run_kind===kind))])),
  byHour:Object.fromEntries([...new Set(rows.map(row=>row.created_at.slice(0,13)))].sort().map(hour=>[hour,summarize(rows.filter(row=>row.created_at.startsWith(hour)))])),
  availability:'Hours without requests do not establish uptime; record CPA/tunnel opening and closing separately.'};
const modes=new Map();
for(let offset=0;;offset+=1000){
  const result=await client.from('pet_private_threads').select('conversation_kind,model_run_id').eq('role','pet')
    .gte('created_at',since.toISOString()).lt('created_at',until.toISOString()).order('created_at').order('id').range(offset,offset+999);
  if(result.error)throw new Error('Conversation mode metadata query failed');
  for(const row of result.data)if(row.model_run_id)modes.set(row.model_run_id,row.conversation_kind);
  if(result.data.length<1000)break;
}
report.byCompletedConversationMode=Object.fromEntries(['companion','steward','legacy'].map(mode=>[mode,summarize(rows.filter(row=>modes.get(row.id)===mode))]));
await mkdir('test-results',{recursive:true});
await writeFile('test-results/companion-runtime-metrics.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
