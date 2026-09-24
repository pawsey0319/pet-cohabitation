import assert from "node:assert/strict";
function assertEquals(actual:unknown,expected:unknown){assert.deepEqual(actual,expected);}
const assertRejects=(run:()=>Promise<unknown>,type:typeof Error,message:string)=>assert.rejects(run,(error:unknown)=>error instanceof type&&error.message.includes(message));
import { streamPrivateCompanionReply } from "./modelStream.ts";
const input={petName:"合成宠",personality:"平静",styles:[],memories:[],recalledMessages:[],messages:[{role:"owner",content:"合成测试，轻松聊两句",created_at:"2026-09-21T00:00:00Z"}],contextStartedAt:null};

function stream(parts:string[],finish="stop") {
  const frames=parts.map(content=>`data: ${JSON.stringify({choices:[{delta:{content}}]})}\n\n`);
  frames.push(`data: ${JSON.stringify({choices:[{delta:{},finish_reason:finish}]})}\n\ndata: [DONE]\n\n`);
  return new Response(frames.join(""),{headers:{"Content-Type":"text/event-stream"}});
}
async function fixture(run:(requests:Record<string,unknown>[],signals:AbortSignal[])=>Promise<void>,responses:(()=>Response|Promise<Response>)[]) {
  const fetchBefore=globalThis.fetch;
  const values={MODEL_MOCK_MODE:"false",TEXT_API_BASE_URL:"https://synthetic.invalid/v1",TEXT_API_KEY:"synthetic-test-only",TEXT_MODEL:"unchanged-business-model"};
  const before=new Map(Object.keys(values).map(key=>[key,Deno.env.get(key)]));
  const requests:Record<string,unknown>[]=[],signals:AbortSignal[]=[];
  for(const [key,value] of Object.entries(values))Deno.env.set(key,value);
  globalThis.fetch=(_url,init)=>{
    requests.push(JSON.parse(String(init?.body)));signals.push(init?.signal as AbortSignal);
    const response=responses[requests.length-1];if(!response)throw new Error("unexpected_extra_call");
    return Promise.resolve(response());
  };
  try{await run(requests,signals);}finally{
    globalThis.fetch=fetchBefore;
    for(const [key,value] of before)if(value===undefined)Deno.env.delete(key);else Deno.env.set(key,value);
  }
}

Deno.test("valid stream uses one request and publishes actual text",async()=>{
  await fixture(async requests=>{
    const visible:string[]=[];const result=await streamPrivateCompanionReply(input,async text=>{visible.push(text);});
    assertEquals(result,{content:"你好🙂"});assertEquals(requests.length,1);assertEquals(visible.at(-1),"你好🙂");
  },[()=>stream(['{"content":"你好\\uD83D','\\uDE42"}'])]);
});
Deno.test("malformed completed JSON is cleared then retried once with same model and deadline",async()=>{
  await fixture(async(requests,signals)=>{
    const visible:string[]=[];const result=await streamPrivateCompanionReply(input,async text=>{visible.push(text);});
    assertEquals(visible,["旧的临时文字","","恢复后的回应"]);
    assertEquals(result,{content:"恢复后的回应"});assertEquals(requests.length,2);
    assertEquals(requests.map(row=>row.model),["unchanged-business-model","unchanged-business-model"]);
    assertEquals(signals[0],signals[1]);assertEquals(requests[1].temperature,0);
    assertEquals(JSON.stringify(requests[1]).includes("旧的临时文字"),false);
  },[()=>stream(['{"content":"旧的临时文字']),()=>stream(['{"content":"恢复后的回应"}'])]);
});
Deno.test("plain text repair still requires validated JSON",async()=>{
  await fixture(async requests=>{
    await assertRejects(()=>streamPrivateCompanionReply(input,async()=>{}),Error,"text_model_invalid_json");
    assertEquals(requests.length,2);
  },[()=>stream(["不是 JSON"]),()=>stream(["仍然不是 JSON"])]);
});
Deno.test("forgetting or revision revocation while clearing prevents another model call",async()=>{
  await fixture(async requests=>{
    await assertRejects(()=>streamPrivateCompanionReply(input,async text=>{if(text==="")throw new Error("companion_context_changed");}),Error,"companion_context_changed");
    assertEquals(requests.length,1);
  },[()=>stream(["invalid"])]);
});
Deno.test("stop after first attempt prevents regeneration",async()=>{
  await fixture(async requests=>{
    const controller=new AbortController();
    await assertRejects(()=>streamPrivateCompanionReply(input,async()=>{controller.abort();},controller.signal),Error,"private_request_stopped");
    assertEquals(requests.length,1);
  },[()=>stream(["invalid"])]);
});
Deno.test("network errors are not a format repair trigger",async()=>{
  await fixture(async requests=>{
    await assertRejects(()=>streamPrivateCompanionReply(input,async()=>{}),Error,"text_model_network_error");
    assertEquals(requests.length,1);
  },[()=>{throw new Error("network unavailable");}]);
});
Deno.test("truncated and provider-filtered streams are not retried",async()=>{
  for(const finish of ["length","content_filter"]){
    await fixture(async requests=>{
      await assertRejects(()=>streamPrivateCompanionReply(input,async()=>{}),Error,finish==="length"?"text_model_truncated":"text_model_stream_interrupted");
      assertEquals(requests.length,1);
    },[()=>stream(['{"content":"未完成'],finish)]);
  }
});
Deno.test("failed final structure cannot become committed content",async()=>{
  await fixture(async requests=>{
    await assertRejects(()=>streamPrivateCompanionReply(input,async()=>{}),Error,"text_model_invalid_structure");
    assertEquals(requests.length,2);
  },[()=>stream(['{"content":42}']),()=>stream(['{"content":""}'])]);
});
Deno.test("UTF-8 and SSE frames may be split at every byte",async()=>{
  const wire=await stream(['{"content":"你好🙂"}']).text();
  await fixture(async requests=>{
    const visible:string[]=[];
    const reply=await streamPrivateCompanionReply(input,async text=>{visible.push(text);});
    assertEquals(reply.content,"你好🙂");assertEquals(visible.at(-1),"你好🙂");assertEquals(requests.length,1);
  },[()=>new Response(new ReadableStream<Uint8Array>({start(controller){
    for(const byte of new TextEncoder().encode(wire))controller.enqueue(Uint8Array.of(byte));
    controller.close();
  }}),{headers:{"Content-Type":"text/event-stream"}})]);
});
Deno.test("provider HTTP rejection never consumes a format retry",async()=>{
  for(const status of [401,429,503]){
    await fixture(async requests=>{
      await assertRejects(()=>streamPrivateCompanionReply(input,async()=>{}),Error,`text_model_http_${status}`);
      assertEquals(requests.length,1);
    },[()=>new Response("unavailable",{status})]);
  }
});
