const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const asar = require('@electron/asar');
const { validatePublicConfig } = require('../contracts.cjs');
const root = path.resolve(__dirname, '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const archive = path.join(root, 'release/win-unpacked/resources/app.asar');
const sourceFiles = ['main.cjs', 'companion.cjs', 'contracts.cjs', 'renderer.js', 'preload.cjs', 'index.html', 'styles.css'];
const sourceHashes = {};
for (const name of sourceFiles) {
  sourceHashes[name] = hash(fs.readFileSync(path.join(root, name)));
  assert.equal(hash(asar.extractFile(archive, name)), sourceHashes[name], `packaged_source_mismatch:${name}`);
}
const entries = asar.listPackage(archive);
assert.ok(!entries.some(name => /^[/\\]tests[/\\]/.test(name)), 'test_tools_must_not_be_packaged');
validatePublicConfig(JSON.parse(asar.extractFile(archive, 'config.production.json').toString('utf8')));
assert.equal(JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8')).version, version);
const artifact = `release/pet-desktop-${version}-x64.exe`;
const bytes = fs.readFileSync(path.join(root, artifact));
const report = { checkedAt: new Date().toISOString(), artifact: `desktop/${artifact}`, version, bytes: bytes.length, sha256: hash(bytes), sourceHashes, publicConfigValidated: true, testToolsExcluded: true, installationTested: false };
const destination = path.resolve(root, `../test-results/desktop-${version}-artifact.json`);
fs.writeFileSync(destination, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
