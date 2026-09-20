import {spawnSync} from "node:child_process";
const args=["--yes","deno","run","--allow-env","--allow-net","--allow-read","supabase/functions/steward-actions/acceptance.test.ts"];
const result=spawnSync(process.platform==="win32"?"cmd.exe":"npx",process.platform==="win32"?["/d","/s","/c",`npx ${args.join(" ")}`]:args,{stdio:"inherit",env:process.env,windowsHide:true});
if(result.error)throw result.error;process.exitCode=result.status??1;
