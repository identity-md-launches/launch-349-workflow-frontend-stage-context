import { createPublicClient, defineChain, encodeAbiParameters, fallback, http, isAddress, keccak256, toBytes, zeroAddress, type Abi, type Address } from 'viem';
import { createConfig } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { canonical } from './canonical';

export type Deployment = {
  version: number; launchId: string; chainId: number; sourceCommit: string; attestationHash: string;
  contracts: { name: string; address: Address; abiHash: string; abiPath: string }[];
  assets: { path: string; sha256: string }[];
  network: { chainId: number; name: string; testnet: boolean; rpcUrls: string[]; explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number }; faucets: string[];
    uniswapV4: Record<'poolManager' | 'quoter' | 'universalRouter' | 'permit2' | 'stateView' | 'positionManager', Address> };
  walletAddChain: { chainId: string; chainName: string; rpcUrls: string[]; nativeCurrency: {name:string; symbol:string; decimals:number}; blockExplorerUrls: string[] };
  pool: { pairedCurrency: Address; fee: number; tickSpacing: number; initialPrice: string };
  token: { name: string; symbol: string; decimals: number; contract: string };
  deploymentBlock: number;
};
export const poolComponents = [
  { name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' },
  { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' },
] as const;
export const quoterAbi = [{ type: 'function', name: 'quoteExactInputSingle', stateMutability: 'nonpayable',
  inputs: [{ name: 'params', type: 'tuple', components: [
    { name: 'poolKey', type: 'tuple', components: poolComponents }, { name: 'zeroForOne', type: 'bool' },
    { name: 'exactAmount', type: 'uint128' }, { name: 'hookData', type: 'bytes' },
  ] }], outputs: [{ name: 'amountOut', type: 'uint256' }, { name: 'gasEstimate', type: 'uint256' }],
}] as const;

export async function loadRuntime() {
  const response = await fetch('./imd-deployment.json', { cache: 'no-cache' });
  if (!response.ok) throw Error('Deployment configuration could not be loaded. Reload to retry.');
  const deployment: Deployment = await response.json();
  const d = deployment, n = d.network;
  if (d.version !== 1 || !n || n.chainId !== d.chainId || Number(d.walletAddChain.chainId) !== d.chainId || !n.rpcUrls.length) throw Error('Deployment network configuration is invalid.');
  if (d.pool.pairedCurrency !== zeroAddress) throw Error('This interface requires the attested native-ETH pool.');
  const abis = new Map<string, Abi>();
  for (const c of d.contracts) {
    if (!isAddress(c.address) || !/^(?!.*\.\.)[\w/-]+\.json$/.test(c.abiPath)) throw Error('Invalid deployment contract entry.');
    const response = await fetch(`./${c.abiPath}`);
    if (!response.ok) throw Error(`Unable to load the ${c.name} interface. Reload to retry.`);
    const abi = await response.json();
    if (!Array.isArray(abi) || keccak256(toBytes(canonical(abi))).slice(2) !== c.abiHash) throw Error(`${c.name} interface failed its attested hash check. Transactions are disabled.`);
    abis.set(c.name, abi);
  }
  const contract = (name: string) => {
    const entry = d.contracts.find(c => c.name === name), abi = abis.get(name);
    if (!entry || !abi) throw Error(`Missing ${name} deployment.`);
    return { address: entry.address, abi };
  };
  const token = contract(d.token.contract), hook = contract('LastBuyerJackpotHook');
  const poolKey = { currency0: d.pool.pairedCurrency, currency1: token.address, fee: d.pool.fee, tickSpacing: d.pool.tickSpacing, hooks: hook.address };
  const poolId = keccak256(encodeAbiParameters([{ type: 'tuple', components: poolComponents }], [poolKey]));
  const chain = defineChain({ id: d.chainId, name: n.name, nativeCurrency: n.nativeCurrency,
    rpcUrls: { default: { http: n.rpcUrls } }, blockExplorers: { default: { name: 'Explorer', url: n.explorer } }, testnet: n.testnet });
  const transport = fallback(n.rpcUrls.map(url => http(url, { timeout: 8000, retryCount: 0 })), { retryCount: 0 });
  const client = createPublicClient({ chain, transport, batch: { multicall: false }, pollingInterval: 6000 });
  const wagmi = createConfig({ chains: [chain], connectors: [injected()], multiInjectedProviderDiscovery: true, transports: { [chain.id]: transport } });
  return { deployment, hook, token, poolKey, poolId, chain, client, wagmi };
}
export type Runtime = Awaited<ReturnType<typeof loadRuntime>>;
