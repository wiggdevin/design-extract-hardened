import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import qs from 'qs';
const read = p => readFileSync(new URL('../'+p, import.meta.url),'utf8');
test('qs enforces bracket comma array limits', () => {
 assert.throws(() => qs.parse('a[]=1,2,3,4',{comma:true,arrayLimit:3,throwOnLimitExceeded:true}), RangeError);
});
test('qs round-trip cannot call attacker-controlled isBuffer', () => {
 const parsed=qs.parse('x%5Bconstructor%5D%5BisBuffer%5D=y',{plainObjects:true});
 assert.doesNotThrow(() => qs.stringify(parsed));
});
test('root install has no lifecycle hook and all packages have immutable registry integrity', () => {
 const p=JSON.parse(read('package.json')), lock=JSON.parse(read('package-lock.json'));
 for(const key of ['preinstall','install','postinstall','prepare']) assert.equal(p.scripts[key],undefined);
 for(const [name,v] of Object.entries(p.dependencies)) assert.equal(v,lock.packages['node_modules/'+name].version);
 for(const [name,pkg] of Object.entries(lock.packages)) if(name) {assert.match(pkg.resolved,/^https:\/\/registry\.npmjs\.org\//);assert.match(pkg.integrity,/^sha512-/);}
 assert.match(read('.npmrc'),/ignore-scripts=true/);
});
test('workflow actions use immutable commits and no mutable package execution', () => {
 const files=readdirSync(new URL('../.github/workflows/',import.meta.url)).map(f=>'.github/workflows/'+f).concat('github-action/action.yml');
 for(const f of files) for(const match of read(f).matchAll(/uses:\s*([^\s]+)/g)) assert.match(match[1],/@[a-f0-9]{40}$/);
 for(const f of ['github-action/action.yml','smithery.yaml','smithery.dockerfile']) assert.doesNotMatch(read(f),/\bnpx\b|npm install -g/);
});
test('Smithery uses a pinned image, checked-in code and non-root runtime', () => {
 const docker=read('smithery.dockerfile');
 assert.match(docker,/FROM node:[^\n]+@sha256:[a-f0-9]{64}/);
 assert.match(docker,/USER node/);
 assert.match(docker,/chown node:node \/app/);
 assert.match(docker,/npm ci --ignore-scripts/);
 assert.match(docker,/ENTRYPOINT \["node", "\/app\/bin\/design-extract.js", "mcp"\]/);
 assert.ok(docker.indexOf('USER node')<docker.indexOf('RUN npm ci'));
});

test('Raycast locks patched minimatch and esbuild without automatic npx execution', () => {
 const lock=JSON.parse(read('raycast-extension/package-lock.json'));
 for(const [path,pkg] of Object.entries(lock.packages)) {
  if(path.endsWith('/minimatch') && pkg.version.startsWith('9.')) assert.equal(pkg.version,'9.0.7');
  if(path.endsWith('/esbuild')) assert.equal(pkg.version,'0.28.1');
 }
 for(const path of ['extract.tsx','score.tsx','copy-cli.tsx']) assert.doesNotMatch(read('raycast-extension/src/'+path),/\bnpx\b/);
});
