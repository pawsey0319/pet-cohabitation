// Synthetic prompts only. Report timings and final replies, never tokens or internal reasoning.
import { buildPrivateCompanionMessages } from "../supabase/functions/_shared/privateCompanion.ts";
const models=Deno.args;
if(!models.length)throw new Error("Pass the exact catalog model IDs to compare");
const base=Deno.env.get("TEXT_API_BASE_URL")!;
const key=Deno.env.get("TEXT_API_KEY")!;
const input={petName:"芽芽",personality:"温和，简洁",styles:[],memories:[],recalledMessages:[],contextStartedAt:null,
  messages:[{id:"synthetic",role:"owner",content:"今天忙了一天有点累，你先听我说，不用急着给建议。",created_at:new Date().toISOString()}]};
const results=[];
for(const model of models){
  const start=Date.now();
  try{
    const response=await fetch(base.replace(/\/$/,"")+"/chat/completions",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},
      body:JSON.stringify({model,messages:buildPrivateCompanionMessages(input),max_tokens:1200,temperature:.35,reasoning_effort:"low",response_format:{type:"json_object"}}),signal:AbortSignal.timeout(70000)});
    const body=await response.json();
    const message=body.choices?.[0]?.message;
    const result={model,status:response.status,elapsedMs:Date.now()-start,finishReason:body.choices?.[0]?.finish_reason,
      reasoningChars:typeof message?.reasoning_content==="string"?message.reasoning_content.length:0,content:message?.content??null};
    results.push(result);console.log(JSON.stringify(result));
  }catch(error){const result={model,elapsedMs:Date.now()-start,error:error instanceof Error?error.name:"request_failed"};results.push(result);console.log(JSON.stringify(result));}
}
await Deno.mkdir("test-results",{recursive:true});
await Deno.writeTextFile("test-results/companion-latency-comparison.json",JSON.stringify(results,null,2));
