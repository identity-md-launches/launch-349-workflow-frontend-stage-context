import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { abiHash, json } from './shared.mjs';

const handoff = json('config/deployment.json');
const chain = json('config/network.json');
if (chain.network.chainId !== handoff.chainId) throw Error('Handoff/network chain mismatch');
mkdirSync('../dist/abi', { recursive: true });
const contracts = handoff.contracts.map(({ name, address, abiHash: expected }) => {
  const sourcePath = `docs/abi/${name}.json`;
  const pinned = execFileSync('git', ['show', `${handoff.sourceCommit}:${sourcePath}`], { encoding: 'utf8' });
  const abi = JSON.parse(pinned);
  if (!Array.isArray(abi) || abiHash(abi) !== expected) throw Error(`Pinned ABI mismatch: ${name}`);
  if (readFileSync(`../${sourcePath}`, 'utf8') !== pinned) throw Error(`Working ABI differs from pinned source: ${name}`);
  const abiPath = `abi/${name}.json`;
  writeFileSync(`../dist/${abiPath}`, pinned);
  console.log(`${name}: canonical Keccak ${expected} verified at ${handoff.sourceCommit}`);
  return { name, address, abiHash: expected, abiPath };
});
function enumerate(dir, prefix = '') {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? enumerate(`${dir}/${e.name}`, `${prefix}${e.name}/`) : [`${prefix}${e.name}`]);
}
const assets = enumerate('../dist').filter(p => p !== 'imd-deployment.json').sort().map(path => {
  const bytes = readFileSync(`../dist/${path}`);
  if (bytes.length > 8388608) throw Error(`Oversize asset ${path}`);
  return { path, sha256: createHash('sha256').update(bytes).digest('hex') };
});
if (assets.length > 128) throw Error('Too many assets');
const { launchId, chainId, sourceCommit, attestationHash } = handoff;
const manifest = { version: 1, launchId, chainId, sourceCommit, attestationHash, contracts, assets,
  network: chain.network, walletAddChain: chain.walletAddChain, pool: handoff.manifest.pool,
  token: handoff.manifest.token, deploymentBlock: Math.min(...handoff.contracts.map(c => c.blockNumber)) };
writeFileSync('../dist/imd-deployment.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(`Export manifest generated with ${assets.length} hashed assets.`);
