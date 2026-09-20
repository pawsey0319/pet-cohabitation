import {cp,mkdir,readFile,symlink,writeFile} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {resolve,sep} from "node:path";
import {createHash} from "node:crypto";

const workspace=process.cwd(),base=resolve(workspace,"test-results"),target=resolve(base,`android-native-1.0.5-${Date.now()}`);
if(!target.startsWith(base+sep))throw new Error("Isolated target must stay inside test-results");
await mkdir(target,{recursive:false});
for(const name of ["app.json","package.json","package-lock.json","assets","modules/voice"])await cp(resolve(workspace,name),resolve(target,name),{recursive:true});
await symlink(resolve(workspace,"node_modules"),resolve(target,"node_modules"),process.platform==="win32"?"junction":"dir");
const originalConfig=await readFile(resolve(workspace,"app.json")),config=JSON.parse(originalConfig),files={};
if(config.expo.android.googleServicesFile){
 const source=resolve(workspace,config.expo.android.googleServicesFile),destination=resolve(target,config.expo.android.googleServicesFile);
 if(!source.startsWith(workspace+sep)||!destination.startsWith(target+sep))throw new Error("Firebase client configuration must stay inside the project");
 const firebase=JSON.parse(await readFile(source,"utf8"));
 if(!firebase.client?.some(client=>client.client_info?.android_client_info?.package_name===config.expo.android.package))throw new Error("Firebase Android package mismatch");
 if(firebase.private_key)throw new Error("Server credentials are not Android client configuration");
 await cp(source,destination);
 files.firebase_client_config=createHash("sha256").update(await readFile(source)).digest("hex");
}
if(config.expo.version!=="1.0.5"||config.expo.android.versionCode!==6)throw new Error("Expected Android 1.0.5 / versionCode 6");
for(const file of ["assets/brand/icon.png","assets/brand/adaptive-foreground.png","assets/brand/splash-light.png","assets/brand/splash-dark.png"])files[file]=createHash("sha256").update(await readFile(resolve(target,file))).digest("hex");
const env={...process.env,EXPO_NO_DOTENV:"1",CI:"1"};
function run(args,file){
 const result=spawnSync(process.platform==="win32"?"cmd.exe":"npx",process.platform==="win32"?["/d","/s","/c",`npx ${args.join(" ")}`]:args,{cwd:target,env,encoding:"utf8",windowsHide:true,maxBuffer:10*1024*1024});
 return writeFile(resolve(target,file),(result.stdout??"")+(result.stderr??"")).then(()=>{process.stdout.write(`${file}: exit ${result.status}\n`);if(result.error)throw result.error;return result.status;});
}
const autolinkExit=await run(["expo-modules-autolinking","resolve","--platform","android","--json"],"autolinking.json");
const prebuildExit=await run(["expo","prebuild","--platform","android","--no-install"],"prebuild.log");
const unchanged=originalConfig.equals(await readFile(resolve(workspace,"app.json")));
const report={created_at:new Date().toISOString(),target,version:config.expo.version,version_code:config.expo.android.versionCode,runtime_policy:config.expo.runtimeVersion,app_config_sha256:createHash("sha256").update(originalConfig).digest("hex"),source_config_unchanged:unchanged,brand_sha256:files,autolink_exit:autolinkExit,prebuild_exit:prebuildExit,native_compile:"not attempted by this script"};
await writeFile(resolve(target,"report.json"),JSON.stringify(report,null,2));await writeFile(resolve(base,"android-native-validation-latest.json"),JSON.stringify({target},null,2));
process.stdout.write(`Isolated output: ${target}\n`);
if(autolinkExit!==0||prebuildExit!==0||!unchanged)process.exitCode=1;
