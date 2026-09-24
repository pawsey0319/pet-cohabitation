// Stage metadata only after checking the actual APK and official signature proof.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const json=async file=>JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));
const prefix='test-results/android-1.0.9-build11';
const [build,inspection,signature]=await Promise.all(['public-build','inspection','signature'].map(s=>json(`${prefix}-${s}.json`)));
const apk=await readFile('artifacts/pet-cohabitation-preview-1.0.9-build11.apk');
const sha256=createHash('sha256').update(apk).digest('hex');
assert.equal(build.status,'FINISHED');assert.equal(build.version,'1.0.9');assert.equal(Number(build.versionCode),11);
const url=new URL(build.buildUrl);assert.equal(url.origin,'https://expo.dev');assert.match(url.pathname,/^\/artifacts\/eas\/[A-Za-z0-9_-]+\.apk$/);assert.equal(url.search+url.hash,'');
assert.equal(inspection.apk_sha256,sha256);assert.equal(inspection.apk_bytes,apk.length);assert.equal(inspection.candidate_accepted_by_this_static_check,true);
assert.equal(inspection.actual.version_name,'1.0.9');assert.equal(inspection.actual.version_code,11);assert.equal(inspection.actual.runtime_version,'1.0.9');assert.equal(inspection.actual.package,'com.pawsey.petcohabitation');
assert.equal(signature.apk_sha256,sha256);assert.equal(signature.passed,true);assert.equal(signature.expected_signing_certificate_matched,true);
assert.equal(signature.cryptographic_verification_passed,true);assert.equal(signature.apksigner_exit_code,0);
const old=await json('public/releases/android-preview.json');assert.equal(old.latest.version,'1.0.8');
await writeFile(`${prefix}-previous-manifest.json`,JSON.stringify(old,null,2)+'\n',{flag:'wx'});
const source=await readFile('src/updates/release.ts','utf8');
await writeFile(`${prefix}-previous-release.ts`,source,{flag:'wx'});
const next=source.replace(/const APPROVED_APK = \{[\s\S]*?\n\};/,`const APPROVED_APK = {\n  path: "${url.pathname}",\n  sha256: "${sha256}",\n  bytes: ${apk.length}, version: "1.0.9", versionCode: 11, runtimeVersion: "1.0.9",\n};`);
assert.notEqual(next,source);
const manifest={...old,latest:{version:'1.0.9',versionCode:11,runtimeVersion:'1.0.9',url:url.href,sha256,bytes:apk.length,notes:[
  '手机验收候选：桌宠未发送草稿在关闭、切后台和重新启动后恢复。',
  '修复待发送队列已满时桌宠启动与停止回复被阻断的问题。',
  '请覆盖安装并反馈草稿、跨 App 触摸与锁屏通知结果。'
],publishedAt:build.completedAt}};
const config=await json('app.json'),candidate=await json('test-results/android-acceptance-1.0.9-build11/app.json');
assert.equal(config.expo.version,'1.0.8');config.expo.version='1.0.9';config.expo.android.versionCode=11;
assert.deepEqual(config,candidate,'Unexpected native configuration change');
await writeFile('src/updates/release.ts',next);
await writeFile('public/releases/android-preview.json',JSON.stringify(manifest,null,2)+'\n');
await writeFile('app.json',JSON.stringify(config,null,2)+'\n');
console.log(JSON.stringify({staged:true,version:'1.0.9',versionCode:11,sha256,bytes:apk.length,published:false}));
