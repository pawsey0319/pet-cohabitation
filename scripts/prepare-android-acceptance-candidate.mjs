// Freeze a reviewed candidate for an internal native build without moving old runtimes.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,copyFile,symlink} from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),[snapshotLabel,version,codeText]=process.argv.slice(2),code=Number(codeText);
assert.match(snapshotLabel??'',/^[a-z0-9-]+$/);assert.match(version??'',/^\d+\.\d+\.\d+$/);
assert.ok(Number.isSafeInteger(code)&&code>0);
const sourceRoot=path.join(root,'test-results',snapshotLabel);
const manifest=JSON.parse(await readFile(path.join(sourceRoot,'manifest.json'),'utf8'));
const config=JSON.parse(await readFile(path.join(sourceRoot,'source/app.json'),'utf8'));
assert.ok(code>config.expo.android.versionCode);assert.notEqual(version,config.expo.version);
const target=path.join(root,'test-results',`android-acceptance-${version}-build${code}`);
await mkdir(target); // Never overwrite an already submitted build source.
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const row of manifest.files){
  if(/^(desktop|docs|e2e|\.github)\//.test(row.path))continue;
  const bytes=await readFile(path.join(sourceRoot,'source',row.path));assert.equal(hash(bytes),row.sha256);
  const destination=path.join(target,row.path);await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,bytes);
}
config.expo.version=version;config.expo.android.versionCode=code;
await writeFile(path.join(target,'app.json'),JSON.stringify(config,null,2)+'\n');
assert.equal(config.expo.android.package,'com.pawsey.petcohabitation');
assert.equal(config.expo.android.googleServicesFile,'./google-services.json');
await copyFile(path.join(root,'google-services.json'),path.join(target,'google-services.json'));
await symlink(path.join(root,'node_modules'),path.join(target,'node_modules'),'junction');
const report={createdAt:new Date().toISOString(),target,version,versionCode:code,package:config.expo.android.package,channel:'preview',sourceSnapshot:snapshotLabel,sourceManifestSha256:hash(await readFile(path.join(sourceRoot,'manifest.json'))),candidateConfigSha256:hash(await readFile(path.join(target,'app.json'))),buildEnvironment:{EAS_NO_VCS:'1',EAS_PROJECT_ROOT:target,EXPO_NO_DOTENV:'1'},scope:'Internal device-acceptance candidate only. Both EAS_NO_VCS=1 and the absolute EAS_PROJECT_ROOT=target are required: no-VCS otherwise discovers the parent Git root and excludes test-results. Inspect the upload archive before submitting. No OTA or release manifest published.'};
await writeFile(path.join(root,'test-results',`android-${version}-build${code}-preparation.json`),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
