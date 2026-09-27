import { readFileSync } from 'node:fs';
import { keccak256, toBytes } from 'viem';
export const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value !== null && typeof value === 'object' ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}` : JSON.stringify(value);
export const abiHash = abi => keccak256(toBytes(canonical(abi))).slice(2);
export const json = path => JSON.parse(readFileSync(path, 'utf8'));
