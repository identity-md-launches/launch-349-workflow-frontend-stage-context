import { BaseError, ContractFunctionRevertedError, encodeAbiParameters, formatUnits, parseUnits, zeroAddress, type Address } from 'viem';
import { quoterAbi, type Runtime } from './config';

export function message(error: unknown): string {
  const revert = error instanceof BaseError ? error.walk(e => e instanceof ContractFunctionRevertedError) : undefined;
  const reason = revert instanceof ContractFunctionRevertedError ? revert.data?.errorName : undefined;
  const text = reason ?? (error instanceof BaseError ? error.shortMessage : error instanceof Error ? error.message : String(error));
  if (/reject|denied/i.test(text)) return 'Request declined in your wallet. You can try again when ready.';
  if (/InsufficientOutput/i.test(text)) return 'The price moved beyond your minimum. Refresh the quote and try again.';
  if (/TooEarly/i.test(text)) return 'A new buy reset the timer. Refresh the round before claiming.';
  if (/NothingToClaim/i.test(text)) return 'This round has no leader to pay. Refresh the round.';
  return text.length > 240 ? text.slice(0, 240) + '…' : text;
}
export function amountFromInput(value: string, decimals: number) {
  if (!new RegExp(`^(?:0|[1-9]\\d*)(?:\\.\\d{1,${decimals}})?$`).test(value)) throw Error(`Enter a positive amount with up to ${decimals} decimal places.`);
  const amount = parseUnits(value, decimals);
  if (amount <= 0n || amount >= 2n ** 128n) throw Error('Enter an amount greater than zero and below the quote limit.');
  return amount;
}
export function slippageBps(value: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw Error('Use a slippage between 0.1% and 5%, with up to two decimal places.');
  const bps = Math.round(Number(value) * 100);
  if (bps < 10 || bps > 500) throw Error('Use a slippage between 0.1% and 5%.');
  return BigInt(bps);
}
export function displayAmount(value: bigint, decimals: number, max = 4) {
  const full = formatUnits(value, decimals);
  const [whole, fraction] = full.split('.');
  if (value > 0n && Number(full) < 10 ** -max) return `<${(10 ** -max).toFixed(max)}`;
  return Number(whole).toLocaleString('en-US') + (fraction ? '.' + fraction.slice(0, max).replace(/0+$/, '') : '').replace(/\.$/, '');
}
export const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
export async function verifyChain(r: Runtime) {
  if (await r.client.getChainId() !== r.deployment.chainId) throw Error('The public RPC returned the wrong chain. Transactions are disabled.');
  const entries = [...r.deployment.contracts, ...(['poolManager','quoter'] as const).map(name => ({ name, address: r.deployment.network.uniswapV4[name] }))];
  await Promise.all(entries.map(async c => {
    const code = await r.client.getCode({ address: c.address });
    if (!code || code === '0x') throw Error(`No deployed code found for ${c.name}. Transactions are disabled.`);
  }));
  const manager = await r.client.readContract({ ...r.hook, functionName: 'poolManager' }) as Address;
  if (manager.toLowerCase() !== r.deployment.network.uniswapV4.poolManager.toLowerCase()) throw Error('The hook PoolManager does not match the deployment network.');
  return true;
}
export async function readGame(r: Runtime, account?: Address) {
  if (await r.client.getChainId() !== r.deployment.chainId) throw Error('RPC chain mismatch. Try refreshing.');
  const block = await r.client.getBlock();
  const readHook = (functionName: string, args: unknown[] = [r.poolId]) => r.client.readContract({ ...r.hook, functionName, args, blockNumber: block.number });
  const [jackpot, lastBuyer, lastBuyAt, round, claimableAt, minBuy, delay, fee, decimals, symbol, tokenBalance, ethBalance] = await Promise.all([
    readHook('jackpot'), readHook('lastBuyer'), readHook('lastBuyAt'), readHook('round'), readHook('claimableAt'),
    readHook('MIN_BUY', []), readHook('ROUND_DELAY', []), readHook('FEE_BPS', []),
    r.client.readContract({ ...r.token, functionName: 'decimals', blockNumber: block.number }),
    r.client.readContract({ ...r.token, functionName: 'symbol', blockNumber: block.number }),
    account ? r.client.readContract({ ...r.token, functionName: 'balanceOf', args: [account], blockNumber: block.number }) : Promise.resolve(0n),
    account ? r.client.getBalance({ address: account, blockNumber: block.number }) : Promise.resolve(0n),
  ]);
  if (Number(decimals) !== r.deployment.token.decimals || symbol !== r.deployment.token.symbol) throw Error('Live token metadata does not match the deployment.');
  return { jackpot: jackpot as bigint, lastBuyer: lastBuyer as Address, lastBuyAt: lastBuyAt as bigint,
    round: round as bigint, claimableAt: claimableAt as bigint, minBuy: minBuy as bigint, delay: delay as bigint,
    fee: fee as bigint, decimals: Number(decimals), symbol: String(symbol), tokenBalance: tokenBalance as bigint,
    ethBalance, block: block.number, timestamp: Number(block.timestamp), receivedAt: Date.now() };
}
export type Game = Awaited<ReturnType<typeof readGame>>;
export type Activity = { name: string; amount?: bigint; person?: Address; transactionHash: string; block: bigint; index: number };
export async function readActivity(r: Runtime): Promise<Activity[]> {
  const head = await r.client.getBlockNumber();
  const fromBlock = head - 499n > BigInt(r.deployment.deploymentBlock) ? head - 499n : BigInt(r.deployment.deploymentBlock);
  if (fromBlock > head) return [];
  const logs = await r.client.getLogs({ address: r.hook.address,
    events: r.hook.abi.filter(item => item.type === 'event'), fromBlock, toBlock: head, strict: true });
  return logs.filter(log => {
    const args = log.args as { poolId?: string };
    return args.poolId === r.poolId;
  }).map(log => {
    const args = log.args as { amount?: bigint; buyer?: Address; winner?: Address };
    return { name: log.eventName ?? '', amount: args.amount, person: args.buyer ?? args.winner,
      transactionHash: log.transactionHash!, block: log.blockNumber!, index: log.logIndex! };
  }).sort((a,b) => a.block === b.block ? b.index - a.index : a.block > b.block ? -1 : 1).slice(0, 6);
}
export async function quoteBuy(r: Runtime, account: Address, input: bigint, bps: bigint) {
  const quote = await r.client.simulateContract({ address: r.deployment.network.uniswapV4.quoter, abi: quoterAbi,
    functionName: 'quoteExactInputSingle', account, args: [{ poolKey: r.poolKey, zeroForOne: true,
      exactAmount: input, hookData: encodeAbiParameters([{ type: 'address' }], [account]) }] });
  // The quoter executes afterSwap: its returned output is already net of the hook's fee.
  const output = quote.result[0];
  const minimum = output * (10000n - bps) / 10000n;
  if (output <= 0n || minimum <= 0n) throw Error('No usable output for this amount. The pool may have no available liquidity.');
  return { input, output, minimum, bps, account, createdAt: Date.now() };
}
export type Quote = Awaited<ReturnType<typeof quoteBuy>>;
export function canClaim(game: Game) {
  return game.lastBuyer !== zeroAddress && game.claimableAt > 0n && BigInt(game.timestamp) >= game.claimableAt;
}
