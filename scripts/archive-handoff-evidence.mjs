// Run only on the original release workstation. These are explicitly selected,
// synthetic acceptance reports, public release receipts and native source hashes.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const destination='docs/handoff/evidence';
const files=[
 ['pet-capability-cloud-20260922/release-summary.json','release-summary.json'],
 ['pet-capability-cloud-20260922/migration-manifest.json','migration-manifest.json'],
 ['pet-capability-cloud-20260922/migration-readback.json','migration-readback.json'],
 ['pet-capabilities-ota-20260922/published.json','android-capabilities-ota.json'],
 ['pet-capabilities-ota-20260922/export-proof.json','android-capabilities-export.json'],
 ['pet-capabilities-ota-20260922/cloud-verification.json','android-capabilities-remote.json'],
 ['pet-ui-ota-20260922/published.json','android-ui-ota.json'],
 ['pet-ui-ota-20260922/cloud-verification.json','android-ui-remote.json'],
 ['pet-actions-integration-20260922.json','capabilities-local-integration.json'],
 ['pet-capability-cloud-fa87a428-d4eb-4042-9f82-0586df06c52d/report.json','capabilities-real-model-cloud.json'],
 ['public-next-version-browser-f1b9294c-bd0f-4d79-ab7b-4896d2c28d91/report.json','public-web-acceptance.json'],
 ['public-next-version-browser-f1b9294c-bd0f-4d79-ab7b-4896d2c28d91/01b-workspace-after-delayed-switches.png','workspace.png'],
 ['public-next-version-browser-f1b9294c-bd0f-4d79-ab7b-4896d2c28d91/01c-capability-grant-revoked.png','capabilities.png'],
 ['pet-workspace-browser-20260922/report.json','workspace-local-browser.json'],
 ['android-1.0.9-build11-delivery.json','android-build11-delivery.json'],
 ['android-1.0.9-build11-public-build.json','android-build11-public-build.json'],
 ['android-1.0.9-build11-signature.json','android-build11-signature.json'],
 ['windows-install-0a418e90-44a6-481e-8e4f-86b5d195bc84/report.json','windows-1.1.1-install.json'],
];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
await mkdir(destination,{recursive:true});
const copied=[];
for(const [source,name] of files){
 const bytes=await readFile(path.join('test-results',source));
 await writeFile(path.join(destination,name),bytes);
 copied.push({source:`test-results/${source}`,file:name,bytes:bytes.length,sha256:sha(bytes),...(name.endsWith('.json')?{sha256LF:sha(bytes.toString('utf8').replace(/\r\n/g,'\n'))}:{})});
}
const baseline='test-results/android-acceptance-1.0.9-build11';
const canonicalJson=async p=>JSON.stringify(JSON.parse((await readFile(p,'utf8')).replace(/^\uFEFF/,'')));
const config=JSON.parse(await canonicalJson(`${baseline}/app.json`));
const { readdir }=await import('node:fs/promises');
const native=[];
async function walk(relative){for(const entry of await readdir(path.join(baseline,relative),{withFileTypes:true})){
 if(entry.isDirectory()){if(!['build','.gradle','node_modules'].includes(entry.name))await walk(path.join(relative,entry.name));}
 else {const p=path.join(relative,entry.name).replaceAll('\\','/');native.push({path:p,sha256LF:sha((await readFile(path.join(baseline,p),'utf8')).replace(/\r\n/g,'\n'))});}
}}
await walk('modules/desktop-pet');await walk('modules/voice');
const nativeBaseline={runtime:'1.0.9',versionCode:11,appConfig:config,
 jsonHashEncoding:'JSON.stringify(JSON.parse(UTF8_without_BOM)); native text uses LF',
 packageJsonSha256:sha(await canonicalJson(`${baseline}/package.json`)),
 packageLockSha256:sha(await canonicalJson(`${baseline}/package-lock.json`)),
 nativeFiles:native.sort((a,b)=>a.path.localeCompare(b.path)),
 note:'Native changes or dependency changes require a new native release and runtime review. This file does not authorize publication.'};
await writeFile(path.join(destination,'android-1.0.9-native-baseline.json'),JSON.stringify(nativeBaseline,null,2)+'\n');
await writeFile(path.join(destination,'archive-index.json'),JSON.stringify({archivedAt:new Date().toISOString(),scope:'Selected release/acceptance evidence; not a database, credential or complete test-results backup',files:copied},null,2)+'\n');
console.log(`Archived ${copied.length} selected evidence files and native baseline.`);
