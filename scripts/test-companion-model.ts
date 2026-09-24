/** Only synthetic fixtures leave the machine. Existing text-provider configuration is used. */
import { TextModelAdapter } from "../supabase/functions/_shared/modelAdapters.ts";
import { buildPreferenceViews, type MemoryEvidence } from "../supabase/functions/_shared/preferenceMemory.ts";

const live=Deno.args.includes("--live");
const only=Deno.args.find((arg)=>arg.startsWith("--only="))?.slice(7)??"all";
const repeat=Number(Deno.args.find((arg)=>arg.startsWith("--repeat="))?.slice(9)??1);
const caseFilter=Deno.args.find((arg)=>arg.startsWith("--case="))?.slice(7);
if(caseFilter&&!['current_request_overrides_old_preference','preference_change_keeps_other_topic'].includes(caseFilter))throw new Error("Unknown continuity case");
if(caseFilter&&only!=="continuity")throw new Error("--case requires --only=continuity");
if(!["all","extraction","correction","replies","continuity"].includes(only)||!Number.isInteger(repeat)||repeat<1||repeat>5)throw new Error("Use --only=all|extraction|correction|replies|continuity and --repeat=1..5");
const diagnostics:unknown[]=[];
if(Deno.args.includes("--diagnostics")){
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(input,init)=>{
    const response=await originalFetch(input,init);
    if(String(input).includes("chat/completions")){
      try {
        const body=await response.clone().json();
        diagnostics.push({status:response.status,finishReason:body.choices?.[0]?.finish_reason,content:body.choices?.[0]?.message?.content});
      }catch{diagnostics.push({status:response.status,error:"unreadable_provider_body"});}
    }
    return response;
  };
}
if(live){
  const content=await Deno.readTextFile("supabase/functions/.env.local");
  for(const line of content.split(/\r?\n/)) {
    const match=line.match(/^(TEXT_API_BASE_URL|TEXT_API_KEY|TEXT_MODEL)=(.*)$/); if(!match)continue;
    let value=match[2].trim().replace(/^['"]|['"]$/g,"");
    if(match[1]==="TEXT_API_BASE_URL")value=value.replace("host.docker.internal","127.0.0.1");
    Deno.env.set(match[1],value);
  }
  Deno.env.set("MODEL_MOCK_MODE","false");
}else Deno.env.set("MODEL_MOCK_MODE","true");
const adapter=new TextModelAdapter();
const results:unknown[]=[];let failed=0;
for(let attempt=1;attempt<=repeat;attempt++)for(const [content,expected] of [
  ["我以前喜欢咖啡，现在更喜欢茶",["咖啡:positive:past","茶:positive:current"]],
  ["我已经不喜欢咖啡了",["咖啡:negative:current"]],
  ["我晚上不喝咖啡",["咖啡:negative:current"]],
  ["朋友喜欢茶；假如我喜欢咖啡，会怎样？",[]],
  ["你记错了，我从没喜欢过咖啡",["咖啡:negative:current"]],
] as const){
  if(only==="replies"||only==="continuity"||(only==="correction"&&!content.includes("记错")))continue;
  try {
    const actual=await adapter.extractPersonalPreferences(content);
    const keys=actual.map((item)=>`${item.object}:${item.polarity}:${item.temporal}`);
    const pass=content.includes("记错") ? actual.length===1&&actual[0].object==="咖啡"&&actual[0].operation==="retract" : expected.length===keys.length&&expected.every((key)=>keys.includes(key)); if(!pass)failed++;
    results.push({kind:"extraction",attempt,input:content,pass,candidates:actual}); console.log(`extraction ${pass?"PASS":"FAIL"}: ${content}`);
  }catch(error){failed++;results.push({kind:"extraction",attempt,input:content,pass:false,error:error instanceof Error?error.message:"unknown"}); console.log("extraction ERROR");}
}
const at=new Date().toISOString();
const row=(object:string,polarity:"positive"|"negative"):MemoryEvidence=>({id:object,object,topic:"drink",context:"global",polarity,temporal:"current",strength:1,quote:`我${polarity==="negative"?"不":""}喜欢${object}`,operation:"observe",preferredOver:[],state:"active",origin:"conversation",sourceMessageId:object,manualMemoryId:null,occurredAt:at});
for(const content of ["今天想喝点什么，我已经不喜欢咖啡了。", "我今天很累，只想让你听我说，先别给建议。", "明天的面试让我有点紧张，你能和我一起梳理准备吗？"]){
  if(only==="correction"||only==="extraction"||only==="continuity")continue;
  try {
    const reply=await adapter.generatePrivateCompanionReply({petName:"芽芽",personality:"好奇但温和",styles:[],memories:[],recalledMessages:[],contextStartedAt:null,preferences:buildPreferenceViews([row("茶","positive"),row("咖啡","negative")]),messages:[{id:"current",role:"owner",content,created_at:at}]});
    results.push({kind:"reply",input:content,reply:reply.content}); console.log(`reply: ${reply.content}`);
  }catch(error){failed++;results.push({kind:"reply",input:content,error:error instanceof Error?error.message:"unknown"});console.log("reply ERROR");}
}
if(only==="continuity"){
  const oldAt=new Date(Date.now()-7*86400000).toISOString();
  const oldCoffee={...row("咖啡","positive"),occurredAt:oldAt};
  for(const [name,content] of [
    ["current_request_overrides_old_preference","我已经不喜欢咖啡了。今晚准备面试时想喝点什么？"],
    ["preference_change_keeps_other_topic","我现在更喜欢茶了。我们继续刚才的面试自我介绍，我应该怎样讲那个社团招新项目？"],
  ]){
    if(caseFilter&&name!==caseFilter)continue;
    try{
      const reply=await adapter.generatePrivateCompanionReply({petName:"芽芽",personality:"好奇但温和",styles:[],memories:[],recalledMessages:[],contextStartedAt:null,
        preferences:buildPreferenceViews([oldCoffee]),messages:[
          {id:"old-pref",role:"owner",content:"我喜欢咖啡",created_at:oldAt},
          {id:"interview",role:"owner",content:"我准备应聘产品实习生。刚才想用社团招新项目做自我介绍，重点是我用问卷找到报名流程太复杂的问题。",created_at:at},
          {id:"current",role:"owner",content,created_at:at},
        ]});
      results.push({kind:"continuity",name,input:content,reply:reply.content});console.log(`${name}: ${reply.content}`);
    }catch(error){failed++;results.push({kind:"continuity",name,input:content,error:error instanceof Error?error.message:"unknown"});}
  }
}
await Deno.mkdir("test-results",{recursive:true});
const artifact=`test-results/companion-model-${live?"live":"mock"}-${only}${caseFilter?`-${caseFilter}`:""}`;
await Deno.writeTextFile(`${artifact}.json`,JSON.stringify({model:TextModelAdapter.modelName(),live,only,caseFilter,repeat,failed,results},null,2));
if(diagnostics.length)await Deno.writeTextFile(`${artifact}-diagnostics.json`,JSON.stringify(diagnostics,null,2));
console.log(`Model validation: ${failed} failures. Replies require human review; this does not measure long-term companionship.`);
if(failed)Deno.exit(1);
