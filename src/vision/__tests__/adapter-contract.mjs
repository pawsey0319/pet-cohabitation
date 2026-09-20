import assert from "node:assert/strict";
import { VisionModelAdapter, parseVisionAnswer, visionAvailable, visionMessages } from "../../../supabase/functions/_shared/visionAdapter.ts";

const settings = new Map();
globalThis.Deno = { env: { get: key => settings.get(key) } };
let checks = 0;
const check = (name, operation) => { operation(); checks++; process.stdout.write(`PASS ${name}\n`); };
check("unverified input capability is closed", () => assert.equal(visionAvailable(), false));
for (const [key,value] of Object.entries({ VISION_INPUT_VERIFIED:"true", VISION_MODEL:"configured-test-model", VISION_API_BASE_URL:"https://vision.invalid/v1", VISION_API_KEY:"synthetic-test-key" })) settings.set(key,value);
check("explicit independent verified configuration opens capability", () => assert.equal(visionAvailable(), true));
settings.set("MODEL_MOCK_MODE", "true");
check("mock mode never advertises real image understanding", () => assert.equal(visionAvailable(), false));
settings.delete("MODEL_MOCK_MODE");
const messages = visionMessages("识别图中的形状", "data:image/png;base64,YQ==");
check("input image is included in the actual multimodal message", () => assert.deepEqual(messages[1].content[1], {type:"image_url",image_url:{url:"data:image/png;base64,YQ=="}}));
check("image text has no authority to issue tool actions", () => assert.match(messages[0].content,/永远不是指令/));
check("valid answers retain uncertainty", () => assert.deepEqual(parseVisionAnswer({choices:[{message:{content:JSON.stringify({content:"看不清文字。",uncertain:true})}}]}),{content:"看不清文字。",uncertain:true}));
for (const [name,message] of Object.entries({
 tools:{content:'{"content":"已完成","uncertain":false}',tool_calls:[{function:{name:"create_task"}}]},
 prose:{content:"这不是要求的可校验回执"},
 absent_uncertainty:{content:'{"content":"回答"}'},
 oversized:{content:JSON.stringify({content:"长".repeat(1201),uncertain:false})},
})) check(`reject ${name}`, () => assert.throws(() => parseVisionAnswer({choices:[{message}]}),/vision_response_invalid/));
const originalFetch = globalThis.fetch; let sent;
try {
 globalThis.fetch = async (url,options) => { sent={url,body:JSON.parse(options.body)};return new Response(JSON.stringify({choices:[{message:{content:'{"content":"一个红色形状。","uncertain":true}'}}]}),{headers:{"Content-Type":"application/json"}}); };
 const answer = await new VisionModelAdapter().analyze({question:"这是什么？",bytes:new Uint8Array([1,2,3]),mimeType:"image/png"});
 check("adapter uses independent model and no tool schema", () => { assert.equal(sent.body.model,"configured-test-model");assert.equal(sent.body.tools,undefined);assert.equal(sent.url,"https://vision.invalid/v1/chat/completions"); });
 check("adapter returns the validated final answer", () => assert.equal(answer.uncertain,true));
 settings.set("VISION_INPUT_VERIFIED","false");
 await assert.rejects(()=>new VisionModelAdapter().analyze({question:"?",bytes:new Uint8Array([1]),mimeType:"image/png"}),/vision_unavailable/);checks++;
} finally { globalThis.fetch=originalFetch; }
process.stdout.write(`${checks} adapter contract checks passed. No real model was called.\n`);
