import {spawnSync} from "node:child_process";
const envFile=process.env.WORK_ACTION_LIVE==="true"?["--env-file=test-results/current-models.private.env"]:[];
const command=["--yes","deno","run",...envFile,"--allow-env","--allow-net","--allow-read","supabase/functions/companion-actions/model.test.ts"];
const result=spawnSync(process.platform==="win32"?"cmd.exe":"npx",process.platform==="win32"?["/d","/s","/c",`npx ${command.join(" ")}`]:command,{stdio:"inherit",env:process.env,windowsHide:true});
if(result.error)throw result.error;process.exitCode=result.status??1;
