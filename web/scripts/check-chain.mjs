import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { decodeFunctionResult, encodeFunctionData, encodeAbiParameters, keccak256, parseAbi, parseEther } from 'viem';
import { json } from './shared.mjs';
const m = json('../dist/imd-deployment.json');
const hook = m.contracts.find(c => c.name === 'LastBuyerJackpotHook');
const token = m.contracts.find(c => c.name === m.token.contract);
const abi = json(`../dist/${hook.abiPath}`);
const key = { currency0: m.pool.pairedCurrency, currency1: token.address, fee: m.pool.fee, tickSpacing: m.pool.tickSpacing, hooks: hook.address };
const components = ['address currency0','address currency1','uint24 fee','int24 tickSpacing','address hooks'].map(s=>{const [type,name]=s.split(' ');return {type,name};});
const poolId = keccak256(encodeAbiParameters([{type:'tuple',components}],[key]));
const evidence = { checkedAt: new Date().toISOString(), poolId, endpoints: [], result: 'unavailable', broadcast: false };
for (const url of m.network.rpcUrls) {
  try {
    const rpc = (method,params=[]) => {
      const raw = execFileSync('curl',['--silent','--show-error','--fail','--max-time','15','-H','Content-Type: application/json','--data-binary',JSON.stringify({jsonrpc:'2.0',id:1,method,params}),url],{encoding:'utf8'});
      const response = JSON.parse(raw); if (response.error) throw Error(response.error.message); return response.result;
    };
    const chainId = Number(rpc('eth_chainId')); if (chainId !== m.chainId) throw Error(`Unexpected chain ${chainId}`);
    const block = rpc('eth_getBlockByNumber',['latest',false]);
    const code = m.contracts.map(c => ({ name:c.name, address:c.address, bytes:(rpc('eth_getCode',[c.address,block.number]).length-2)/2 }));
    if (code.some(c=>c.bytes===0)) throw Error('Empty contract code');
    const state = {};
    for (const functionName of ['jackpot','lastBuyer','lastBuyAt','round','claimableAt','poolManager']) {
      const data = encodeFunctionData({abi,functionName,args:functionName==='poolManager'?[]:[poolId]});
      const result = rpc('eth_call',[{to:hook.address,data},block.number]);
      state[functionName] = String(decodeFunctionResult({abi,functionName,data:result}));
    }
    const quoteAbi = parseAbi(['function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)']);
    let quote;
    try {
      const quoteData = encodeFunctionData({abi:quoteAbi,functionName:'quoteExactInputSingle',args:[{poolKey:key,zeroForOne:true,exactAmount:parseEther('0.001'),hookData:encodeAbiParameters([{type:'address'}],[token.address])}]});
      const result = rpc('eth_call',[{to:m.network.uniswapV4.quoter,data:quoteData},block.number]);
      const decoded = decodeFunctionResult({abi:quoteAbi,functionName:'quoteExactInputSingle',data:result});
      quote = {inputWei:parseEther('0.001').toString(),netOutput:decoded[0].toString(),gasEstimate:decoded[1].toString(),mode:'eth_call only'};
    } catch (e) { quote = {error:String(e.message)}; }
    evidence.endpoints.push({url,chainId,block:block.number,timestamp:block.timestamp,code,state,quote});
    evidence.result = 'read-only checks passed'; break;
  } catch(e) { evidence.endpoints.push({url,error:String(e.message).slice(0,500)}); }
}
writeFileSync('../docs/evidence/chain.json',JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence,null,2));
