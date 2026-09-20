import {streamPrivateCompanionReply} from "../supabase/functions/_shared/modelStream.ts";
const inputs=["我今天很累，只想让你听我说，先别给建议。","我以前喜欢咖啡，现在更喜欢茶，我们继续聊刚才的面试准备。"];
const results=[];
for(const content of inputs){
 const start=performance.now();let first:number|null=null;let chunks=0;
 try{
  const reply=await streamPrivateCompanionReply({petName:"芽芽",personality:"温和、好奇，表达克制",styles:[],memories:[],recalledMessages:[],messages:[{role:"owner",content:"面试时我总担心介绍自己太啰嗦。",created_at:new Date(Date.now()-120000).toISOString()},{role:"owner",content,created_at:new Date().toISOString()}],contextStartedAt:null},async()=>{if(first===null)first=performance.now()-start;chunks++;});
  results.push({content,reply:reply.content,first_ms:first,total_ms:performance.now()-start,chunks,transport_ok:true});
  console.log(`Live stream received: ${chunks} chunks, first ${Math.round(first??0)}ms, total ${Math.round(performance.now()-start)}ms`);
 }catch(reason){results.push({content,error:reason instanceof Error?reason.message:"unknown",total_ms:performance.now()-start,transport_ok:false});console.log("Live stream failed:",reason instanceof Error?reason.message:"unknown");}
}
await Deno.mkdir("test-results/live-model",{recursive:true});await Deno.writeTextFile("test-results/live-model/companion-stream.json",JSON.stringify({model:Deno.env.get("TEXT_MODEL"),results},null,2));
if(results.some(row=>!row.transport_ok))Deno.exit(1);
