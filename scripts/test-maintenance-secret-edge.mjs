import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const url=process.env.SUPABASE_URL,fixture=process.env.COMPANION_SUPABASE_WORKDIR;
if(!url||!fixture||!["localhost","127.0.0.1"].includes(new URL(url).hostname))throw new Error("Isolated fixture required");
const file=readFileSync(join(fixture,"functions.env"),"utf8");
const secret=file.split(/\r?\n/).find(line=>line.startsWith("IMAGE_MAINTENANCE_CRON_SECRET="))?.slice("IMAGE_MAINTENANCE_CRON_SECRET=".length).replace(/^['"]|['"]$/g,"");
assert.ok(secret&&secret.length>=24,"fixture maintenance secret exists");
const call=async value=>fetch(`${url}/functions/v1/image-maintenance`,{method:"POST",headers:{"Content-Type":"application/json",...(value?{"x-cron-secret":value}:{})},body:JSON.stringify({generations:false})});
assert.equal((await call()).status,403,"no Authorization and no secret rejected by handler");
assert.equal((await call("invalid-maintenance-secret")).status,403,"wrong secret rejected");
let response=await call(secret);if(response.status===503){await new Promise(resolve=>setTimeout(resolve,1000));response=await call(secret);}
const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.generation_attempts_started,0);assert.equal(body.transparency,"independent_worker");
console.log("PASS maintenance Edge without Authorization or apikey: independent cron secret accepted, missing/wrong credentials rejected, storage-only mode starts no generation.");
