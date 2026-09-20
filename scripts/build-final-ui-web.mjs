import {spawnSync} from "node:child_process";
if(!process.env.SUPABASE_URL||!process.env.SUPABASE_ANON_KEY)throw new Error("Isolated Supabase environment required");
if(!["localhost","127.0.0.1"].includes(new URL(process.env.SUPABASE_URL).hostname))throw new Error("Only the isolated local fixture is allowed");
const args=["expo","export","--platform","web","--output-dir","test-results/final-ui-web"];
const result=spawnSync(process.platform==="win32"?"cmd.exe":"npx",process.platform==="win32"?["/d","/s","/c",`npx ${args.join(" ")}`]:args,{stdio:"inherit",windowsHide:true,env:{...process.env,EXPO_NO_DOTENV:"1",EXPO_PUBLIC_DEMO_MODE:"false",EXPO_PUBLIC_SUPABASE_URL:process.env.SUPABASE_URL,EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:process.env.SUPABASE_ANON_KEY}});
if(result.error)throw result.error;process.exitCode=result.status??1;
