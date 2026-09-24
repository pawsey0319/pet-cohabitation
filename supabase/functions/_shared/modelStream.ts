import {parseStructuredModelContent} from "./jsonExtraction.ts";
import { buildPrivateCompanionMessages, type CompanionPromptInput } from "./privateCompanion.ts";
import { TextModelAdapter } from "./modelAdapters.ts";

/** Extract only the JSON content string, preserving incomplete escapes until next chunk. */
export function partialJsonContent(source: string): string {
  source=source.replace(/<think>[\s\S]*?<\/think>/gi,"");
  if(/<think>/i.test(source))return "";
  const match = /(?:^|[{,])\s*"content"\s*:\s*"/.exec(source);
  if (!match) return "";
  let text = "";
  for (let i=match.index+match[0].length;i<source.length;i++) {
    const ch=source[i];
    if(ch==='"') break;
    if(ch!=="\\") { text+=ch;continue; }
    const escaped=source[++i];if(!escaped)break;
    if(escaped==='u') {
      const digits=source.slice(i+1,i+5);if(!/^[0-9a-f]{4}$/i.test(digits))break;
      text+=String.fromCharCode(parseInt(digits,16));i+=4;
    } else {
      const map:Record<string,string>={'"':'"',"\\":"\\","/":"/",n:"\n",r:"\r",t:"\t",b:"\b",f:"\f"};
      if(!(escaped in map))break;text+=map[escaped];
    }
  }
  // Don't expose half a Unicode surrogate when providers split an escaped emoji.
  if(/[\uD800-\uDBFF]$/.test(text))text=text.slice(0,-1);
  return text;
}

export async function streamPrivateCompanionReply(input:CompanionPromptInput,onText:(content:string)=>Promise<void>,signal?:AbortSignal):Promise<{content:string}> {
  if(Deno.env.get("MODEL_MOCK_MODE")==="true") {
    const reply=await new TextModelAdapter().generatePrivateCompanionReply(input);
    // A mock is a single completed fixture, never a simulated typing benchmark.
    await onText(reply.content);return reply;
  }
  const base=Deno.env.get("TEXT_API_BASE_URL"),key=Deno.env.get("TEXT_API_KEY"),model=Deno.env.get("TEXT_MODEL");
  if(!base||!key||!model)throw new Error("text_model_configuration_missing");
  const cancellation=signal?AbortSignal.any([signal,AbortSignal.timeout(90000)]):AbortSignal.timeout(90000);
  const messages=buildPrivateCompanionMessages(input);
  for(let attempt=0;attempt<2;attempt++){
    try {
      cancellation.throwIfAborted();
      return await streamAttempt({base,key,model,messages:attempt===0?messages:[...messages,{role:"system",content:'上一轮输出未通过 JSON 格式校验。请重新回答本轮问题，只输出一个完整 JSON 对象，content 为非空字符串（最多1200字），concerns_owner 为布尔值，risk 为 none、low 或 high。不要输出 Markdown、思考过程或对象以外的文字。'}],temperature:attempt===0?.35:0},onText,cancellation);
    } catch(reason){
      if(cancellation.aborted)throw new Error(signal?.aborted?"private_request_stopped":"text_model_timeout");
      // Only completed, malformed text may be regenerated once. Never retry
      // transport failures, stop/forget guard failures, truncated output or tools.
      if(attempt!==0||!(reason instanceof Error)||!["text_model_invalid_json","text_model_invalid_structure"].includes(reason.message))throw reason;
      // Revoke provisional text AND recheck the caller's revision/lease before
      // another model call. The same request still has exactly one final commit.
      await onText("");
    }
  }
  throw new Error("text_model_invalid_json");
}

async function streamAttempt(config:{base:string;key:string;model:string;messages:readonly {role:string;content:string}[];temperature:number},onText:(content:string)=>Promise<void>,cancellation:AbortSignal):Promise<{content:string}> {
  let response:Response;
  try {
    response=await fetch(`${config.base.replace(/\/+$/,"")}/chat/completions`,{method:"POST",headers:{Authorization:`Bearer ${config.key}`,"Content-Type":"application/json"},body:JSON.stringify({model:config.model,messages:config.messages,stream:true,response_format:{type:"json_object"},temperature:config.temperature,max_tokens:1200,reasoning_effort:"low"}),signal:cancellation});
  }catch(reason){throw new Error(reason instanceof Error&&/timeout|abort/i.test(reason.name)?"text_model_timeout":"text_model_network_error");}
  if(!response.ok)throw new Error(`text_model_http_${response.status}`);
  if(!response.body || !response.headers.get("content-type")?.includes("text/event-stream"))throw new Error("text_model_stream_unsupported");
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer="",raw="",visible="",finish="",lastPublish=0;
  try {
    for(;;){
      const chunk=await reader.read();if(chunk.done)break;
      buffer+=decoder.decode(chunk.value,{stream:true});
      if(buffer.length>200000)throw new Error("text_model_invalid_stream");
      let newline:number;
      while((newline=buffer.indexOf("\n"))>=0){
        const line=buffer.slice(0,newline).trimEnd();buffer=buffer.slice(newline+1);
        if(!line.startsWith("data:"))continue;
        const data=line.slice(5).trim();if(!data||data==="[DONE]")continue;
        let payload;try{payload=JSON.parse(data);}catch{throw new Error("text_model_invalid_stream");}
        if(payload.error)throw new Error("text_model_stream_error");
        const choice=payload.choices?.[0];if(choice?.finish_reason)finish=choice.finish_reason;
        if(typeof choice?.delta?.content!=="string")continue;
        raw+=choice.delta.content;if(raw.length>12000)throw new Error("text_model_invalid_output");
        const content=partialJsonContent(raw);
        if(content.length>1200)throw new Error("text_model_invalid_output");
        if(content!==visible && (Date.now()-lastPublish>=180 || content.length-visible.length>=48)){
          await onText(content);visible=content;lastPublish=Date.now();
        }
      }
    }
    if(finish!=="stop")throw new Error(finish==="length"?"text_model_truncated":"text_model_stream_interrupted");
    const parsed=parseStructuredModelContent<{content:string}>(raw,finish,(candidate)=>{
      const value=candidate as {content?:unknown}|null;
      return value&&typeof value.content==="string"&&value.content.trim()&&value.content.length<=1200?{success:true,data:{content:value.content}}:{success:false};
    });
    if(parsed.content!==visible)await onText(parsed.content);
    return {content:parsed.content};
  }finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
}
