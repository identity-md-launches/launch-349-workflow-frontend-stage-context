import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { abiHash, json } from './shared.mjs';
const m = json('../dist/imd-deployment.json'), d = json('config/deployment.json'), n = json('config/network.json');
for (const k of ['launchId', 'chainId', 'sourceCommit', 'attestationHash']) assert.equal(m[k], d[k]);
assert.equal(m.version, 1);
assert.deepEqual(m.network, n.network);
assert.deepEqual(m.walletAddChain, n.walletAddChain);
assert.deepEqual(m.pool, d.manifest.pool);
assert.deepEqual(m.contracts.map(({name,address,abiHash})=>({name,address,abiHash})), d.contracts.map(({name,address,abiHash})=>({name,address,abiHash})));
for (const c of m.contracts) assert.equal(abiHash(json(`../dist/${c.abiPath}`)), c.abiHash);
const files = (dir,p='')=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(`${dir}/${e.name}`,`${p}${e.name}/`):[p+e.name]);
assert.deepEqual(files('../dist').filter(p=>p!=='imd-deployment.json').sort(), m.assets.map(a=>a.path).sort());
let bytes = 0;
for (const a of m.assets) {
  assert.match(a.path, /^(?!\/)(?!.*\.\.)(?!.*:)[\w./-]+$/);
  const b = readFileSync(`../dist/${a.path}`); bytes += b.length;
  assert(b.length <= 8388608);
  assert.equal(createHash('sha256').update(b).digest('hex'), a.sha256);
}
assert(m.assets.length <= 128); assert(bytes < 32 * 1024 * 1024);
assert(readFileSync('../dist/index.html','utf8').includes('src="./assets/'));
console.log(`PASS: handoff, network, ABI binding, relative entrypoint, complete inventory; ${m.assets.length} assets / ${bytes} bytes.`);
