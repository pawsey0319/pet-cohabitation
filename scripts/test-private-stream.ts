import {partialJsonContent,streamPrivateCompanionReply} from "../supabase/functions/_shared/modelStream.ts";
import assert from "node:assert/strict";
const assertEquals:(actual:unknown,expected:unknown)=>void=assert.deepEqual;
const assertRejects=(fn:()=>Promise<unknown>,_error:ErrorConstructor,message:string)=>assert.rejects(fn,{message});
const input={petName:"验收宠",personality:"平和",styles:[],memories:[],recalledMessages:[],messages:[{role:"owner",content:"我很累",created_at:new Date().toISOString()}],contextStartedAt:null};
Deno.test("incremental JSON content handles fragmented escapes without inventing text",()=>{
 assertEquals(partialJsonContent('{"content":"第一句\\n第'),"第一句\n第");
 assertEquals(partialJsonContent('{"content":"\\uD83D'),"");
 assertEquals(partialJsonContent('{"content":"\\uD83D\\uDE00"}'),"😀");
 assertEquals(partialJsonContent('{"reason":"ignore","content":"actual"}'),"actual");
});
Deno.test("provider SSE carries real chunks and rejects interrupted or illegal final responses",async()=>{
 const original=globalThis.fetch;
 const vars=["MODEL_MOCK_MODE","TEXT_API_BASE_URL","TEXT_API_KEY","TEXT_MODEL"];
 const old=vars.map(key=>Deno.env.get(key));
 Deno.env.set("MODEL_MOCK_MODE","false");Deno.env.set("TEXT_API_BASE_URL","http://fixture.invalid/v1");Deno.env.set("TEXT_API_KEY","fixture-only");Deno.env.set("TEXT_MODEL","fixture-stream");
 const provider=(fragments:string[],finish:string|null)=>{
  const lines=fragments.map(content=>`data: ${JSON.stringify({choices:[{delta:{content}}]})}\n\n`);
  if(finish)lines.push(`data: ${JSON.stringify({choices:[{delta:{},finish_reason:finish}]})}\n\n`);
  const bytes=new TextEncoder().encode(lines.join(""));let index=0;
  return new Response(new ReadableStream({pull(controller){if(index>=bytes.length){controller.close();return;}controller.enqueue(bytes.slice(index,index+7));index+=7;}}),{headers:{"Content-Type":"text/event-stream"}});
 };
 try{
  const seen:string[]=[];
  globalThis.fetch=async()=>provider(['{"content":"今天','可以慢慢来。"}'],"stop");
  const result=await streamPrivateCompanionReply(input,async(text)=>{seen.push(text);});
  assertEquals(result.content,"今天可以慢慢来。");assertEquals(seen[0],"今天");assertEquals(seen.at(-1),result.content);
  globalThis.fetch=async()=>provider(['```json\n{"content":"合法正文"}\n```','\n额外解释'],"stop");
  assertEquals((await streamPrivateCompanionReply(input,async()=>{})).content,"合法正文");
  globalThis.fetch=async()=>provider(['{"content":"未完成'],null);
  await assertRejects(()=>streamPrivateCompanionReply(input,async()=>{}),Error,"text_model_stream_interrupted");
  globalThis.fetch=async()=>provider(['{"content":"截断'],"length");
  await assertRejects(()=>streamPrivateCompanionReply(input,async()=>{}),Error,"text_model_truncated");
  globalThis.fetch=async()=>provider(['{"content":4}'],"stop");
  await assertRejects(()=>streamPrivateCompanionReply(input,async()=>{}),Error,"text_model_invalid_structure");
  globalThis.fetch=async()=>new Response('{}',{headers:{"Content-Type":"application/json"}});
  await assertRejects(()=>streamPrivateCompanionReply(input,async()=>{}),Error,"text_model_stream_unsupported");
 }finally{globalThis.fetch=original;vars.forEach((key,i)=>{if(old[i]===undefined)Deno.env.delete(key);else Deno.env.set(key,old[i]!);});}
});

