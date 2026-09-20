import {spawnSync} from "node:child_process";
const args=["--yes","deno","run","--env-file=test-results/current-models.private.env","--allow-env","--allow-net","--allow-read","--allow-write=test-results","supabase/functions/group-work-suggestions/live.test.ts"];
const result=spawnSync(process.platform==="win32"?"cmd.exe":"npx",process.platform==="win32"?["/d","/s","/c",`npx ${args.join(" ")}`]:args,{stdio:"inherit",env:process.env,windowsHide:true});
if(result.error)throw result.error;process.exitCode=result.status??1;
