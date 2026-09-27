import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { decodeFunctionData, encodeFunctionResult, encodeAbiParameters, encodeEventTopics, encodeErrorResult, keccak256, parseEther, zeroAddress } from 'viem';
import { json } from '../scripts/shared.mjs';

const manifest = json('../dist/imd-deployment.json');
const hook = manifest.contracts.find(c=>c.name==='LastBuyerJackpotHook');
const token = manifest.contracts.find(c=>c.name==='LaunchToken');
const hookAbi = json(`../dist/${hook.abiPath}`), tokenAbi = json(`../dist/${token.abiPath}`);
const account = '0x1234567890123456789012345678901234567890', leader = '0x9876543210987654321098765432109876543210';
const txHash = '0x'+'a'.repeat(64), blockHash = '0x'+'b'.repeat(64);
const components = ['address currency0','address currency1','uint24 fee','int24 tickSpacing','address hooks'].map(s=>{const [type,name]=s.split(' ');return {type,name};});
const poolKey = {currency0:zeroAddress,currency1:token.address,fee:manifest.pool.fee,tickSpacing:manifest.pool.tickSpacing,hooks:hook.address};
const poolId = keccak256(encodeAbiParameters([{type:'tuple',components}],[poolKey]));
const seconds = ()=>Math.floor(Date.now()/1000), hex=n=>'0x'+BigInt(n).toString(16);
const state = { lastBuyAt:seconds()-1353, leader, jackpot:parseEther('12485.62'), round:3n, failRpc:false, emptyCode:false, rejectSimulation:false, quoteFailure:false, delayQuote:0, stale:false, noEvents:false, receiptRevert:false };
const calls = [];
const block = ()=>({number:hex(12000000),hash:blockHash,parentHash:blockHash,nonce:'0x0000000000000000',sha3Uncles:blockHash,logsBloom:'0x'+'0'.repeat(512),transactionsRoot:blockHash,stateRoot:blockHash,receiptsRoot:blockHash,miner:zeroAddress,difficulty:'0x0',totalDifficulty:'0x0',extraData:'0x',size:'0x100',gasLimit:hex(30000000),gasUsed:'0x0',timestamp:hex(seconds()-(state.stale?300:0)),transactions:[],uncles:[],baseFeePerGas:'0x1',mixHash:blockHash});
function rpc(req) {
  calls.push(req);
  const {method,params=[]}=req;
  if(state.failRpc) return {error:{code:-32000,message:'Mock RPC unavailable'}};
  if(method==='eth_chainId') return {result:hex(manifest.chainId)};
  if(method==='eth_getCode') return {result:state.emptyCode?'0x':'0x6001600055'};
  if(method==='eth_blockNumber') return {result:hex(12000000)};
  if(method==='eth_getBlockByNumber' || method==='eth_getBlockByHash') return {result:block()};
  if(method==='eth_getBalance') return {result:hex(parseEther('1'))};
  if(method==='eth_getLogs') {
    if(state.noEvents) return {result:[]};
    return {result:[{address:hook.address,topics:encodeEventTopics({abi:hookAbi,eventName:'NewLeader',args:{poolId,buyer:state.leader}}),data:encodeAbiParameters([{type:'uint256'}],[state.round]),blockNumber:hex(11999998),blockHash,transactionHash:txHash,transactionIndex:'0x0',logIndex:'0x0',removed:false},
      {address:hook.address,topics:encodeEventTopics({abi:hookAbi,eventName:'JackpotFed',args:{poolId}}),data:encodeAbiParameters([{type:'uint256'}],[parseEther('238.62')]),blockNumber:hex(11999998),blockHash,transactionHash:txHash,transactionIndex:'0x0',logIndex:'0x1',removed:false}]};
  }
  if(method==='eth_getTransactionReceipt') return {result:{transactionHash:txHash,transactionIndex:'0x0',blockHash,blockNumber:hex(12000000),from:account,to:hook.address,cumulativeGasUsed:hex(150000),gasUsed:hex(150000),contractAddress:null,logs:[],logsBloom:'0x'+'0'.repeat(512),status:state.receiptRevert?'0x0':'0x1',effectiveGasPrice:'0x1',type:'0x2'}};
  if(method==='eth_call') {
    const target = params[0].to.toLowerCase();
    if(target===manifest.network.uniswapV4.quoter.toLowerCase()) {
      if(state.quoteFailure) return {error:{code:3,message:'execution reverted: no available liquidity',data:'0x'}};
      return {result:encodeAbiParameters([{type:'uint256'},{type:'uint256'}],[parseEther('23623.75'),150000n])};
    }
    const abi=target===hook.address.toLowerCase()?hookAbi:tokenAbi;
    const {functionName,args}=decodeFunctionData({abi,data:params[0].data});
    if(functionName==='buy' || functionName==='claim') {
      if(state.rejectSimulation) return {error:{code:3,message:'execution reverted',data:encodeErrorResult({abi:hookAbi,errorName:functionName==='claim'?'TooEarly':'InsufficientOutput',args:functionName==='claim'?[BigInt(seconds()+3600)]:[1n,args[1]]})}};
      return {result:encodeFunctionResult({abi,functionName,result:functionName==='buy'?parseEther('23623.75'):undefined})};
    }
    const values = {poolManager:manifest.network.uniswapV4.poolManager,jackpot:state.jackpot,lastBuyer:state.leader,lastBuyAt:BigInt(state.lastBuyAt),round:state.round,claimableAt:state.leader===zeroAddress?0n:BigInt(state.lastBuyAt+3600),MIN_BUY:parseEther('0.001'),ROUND_DELAY:3600n,FEE_BPS:100n,decimals:18,symbol:'LBUY',balanceOf:parseEther('42500')};
    assert(functionName in values,`Unhandled call ${functionName}`);
    if(['jackpot','lastBuyer','lastBuyAt','round','claimableAt'].includes(functionName)) assert.equal(args[0],poolId);
    return {result:encodeFunctionResult({abi,functionName,result:values[functionName]})};
  }
  throw Error('Unhandled RPC '+method);
}

const root=resolve('../dist');
const server=createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://local').pathname);
  const file=resolve(root,pathname.replace(/^\/preview\//,'')||'index.html');
  if(!pathname.startsWith('/preview/') || !file.startsWith(root+'/') || !existsSync(file)) {res.writeHead(404);res.end();return;}
  const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'}[extname(file)];
  res.writeHead(200,{'Content-Type':mime||'application/octet-stream'});res.end(readFileSync(file));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/preview/`;
const executablePath=process.env.BROWSER_EXECUTABLE || '/opt/imd-tools/ms-playwright/chromium_headless_shell-1246/chrome-headless-shell-linux64/chrome-headless-shell';
const browser=await chromium.launch({headless:true,...(existsSync(executablePath)?{executablePath}:{})});
const report={productionExport:'dist/',servedAt:'/preview/',date:new Date().toISOString(),browser:await browser.version(),checks:[],screenshots:[],consoleErrors:[],resourceFailures:[],realTransactions:0};
const check=(name)=>{report.checks.push(name);console.log('PASS '+name);};
const contexts=[];
async function pageWithWallet(wallet=true, extra={}) {
  const context=await browser.newContext({viewport:{width:1440,height:1050}});contexts.push(context);
  await context.route('**/*',async route=>{
    const req=route.request();
    if(req.url().startsWith(url)) return route.continue();
    if(manifest.network.rpcUrls.some(u=>req.url().replace(/\/$/,'')===u.replace(/\/$/,''))) {
      const request=req.postDataJSON();
      const reply=Array.isArray(request)?request.map(x=>({jsonrpc:'2.0',id:x.id,...rpc(x)})):{jsonrpc:'2.0',id:request.id,...rpc(request)};
      if(state.delayQuote && (Array.isArray(request)?request:[request]).some(x=>x.params?.[0]?.to?.toLowerCase()===manifest.network.uniswapV4.quoter.toLowerCase())) await new Promise(resolve=>setTimeout(resolve,state.delayQuote));
      return route.fulfill({contentType:'application/json',body:JSON.stringify(reply)});
    }
    return route.abort();
  });
  if(wallet) await context.addInitScript(({account,txHash,chain,extra})=>{
    const listeners={};
    const w={chain:'0x1',connected:false,unknown:true,reject:false,requests:[],sendCount:0,...extra};
    window.mockWallet=w;
    window.ethereum={isMetaMask:true,on(event,fn){(listeners[event]??=[]).push(fn);},removeListener(event,fn){listeners[event]=(listeners[event]||[]).filter(x=>x!==fn);},
      async request({method,params}) {
        w.requests.push({method,params});
        if(method==='eth_chainId') return w.chain;
        if(method==='eth_accounts') return w.connected?[w.account||account]:[];
        if(method==='eth_requestAccounts'){if(w.reject)throw {code:4001,message:'User rejected request'};w.connected=true;return [w.account||account];}
        if(method==='wallet_switchEthereumChain'){if(w.unknown)throw {code:4902,message:'Unknown chain'};w.chain=params[0].chainId;for(const fn of listeners.chainChanged||[]) fn(w.chain);return null;}
        if(method==='wallet_addEthereumChain'){w.unknown=false;return null;}
        if(method==='wallet_getCapabilities') return {};
        if(method==='eth_sendTransaction'){if(w.reject)throw {code:4001,message:'User rejected request'};w.sendCount++;return txHash;}
        if(method==='eth_estimateGas') return '0x493e0';
        if(method==='wallet_requestPermissions')return [{parentCapability:'eth_accounts'}];
        if(method==='wallet_revokePermissions')return null;
        throw Error('Unhandled wallet request '+method);
      }
    };
    w.emit=(event,value)=>{for(const fn of listeners[event]||[])fn(value);};
  },{account,txHash,chain:hex(manifest.chainId),extra});
  const page=await context.newPage();page.setDefaultTimeout(12000);await page.clock.install();
  page.on('pageerror',error=>report.consoleErrors.push(error.message));
  page.on('console',msg=>{if(msg.type()==='error') report.consoleErrors.push(msg.text());});
  page.on('response',res=>{if(res.url().startsWith(url)&&res.status()>=400)report.resourceFailures.push(`${res.status()} ${res.url()}`);});
  await page.goto(url);await page.getByRole('heading',{name:'Current jackpot'}).waitFor();
  return page;
}
async function waitForEnabled(button){await button.waitFor();await button.page().waitForFunction(el=>!el.disabled,await button.elementHandle(),{timeout:12000});}
async function quote(page){const button=page.getByRole('button',{name:/^(Get quote|Refresh quote)$/});await waitForEnabled(button);await button.click();await waitForEnabled(page.getByRole('button',{name:'Buy LBUY ↗'}));}
async function refresh(page){const b=page.getByRole('button',{name:'Refresh state ↻'});await waitForEnabled(b);await b.click();await page.getByRole('button',{name:'Refresh state ↻'}).waitFor();}
try {
  const page=await pageWithWallet();
  await page.getByText('12,485.62',{exact:false}).first().waitFor();
  assert(await page.getByRole('button',{name:'Get quote'}).isDisabled());
  assert(await page.getByRole('button',{name:'Claim jackpot'}).isDisabled());
  check('Disconnected: live public reads; buy and claim disabled');
  await page.keyboard.press('Tab'); assert.equal(await page.locator(':focus').textContent(),'Skip to content');
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  assert.match(await page.locator(':focus').textContent(),/Connect wallet/);
  await page.screenshot({path:'../docs/evidence/keyboard-focus.png'});report.screenshots.push('keyboard-focus.png');
  await page.keyboard.press('Enter');await page.getByRole('button',{name:'Switch to Sepolia'}).waitFor();
  assert(await page.getByRole('button',{name:'Get quote'}).isDisabled());
  check('Keyboard wallet connection; wrong-chain gate');
  await page.getByRole('button',{name:'Switch to Sepolia'}).click();
  await waitForEnabled(page.getByRole('button',{name:'Get quote'}));
  const requests=await page.evaluate(()=>window.mockWallet.requests);
  assert.deepEqual(requests.find(x=>x.method==='wallet_addEthereumChain').params,[manifest.walletAddChain]);
  assert.equal(requests.filter(x=>x.method==='wallet_switchEthereumChain').length,2);
  check('Unknown network: switch → exact wallet_addEthereumChain parameters → switch');
  await page.getByLabel('You pay').fill('0.0000000000000000001');await page.getByRole('button',{name:'Get quote'}).click();
  await page.getByText('Enter a positive amount with up to 18 decimal places.').waitFor();assert.equal(await page.locator(':focus').getAttribute('id'),'amount');
  await page.getByRole('button',{name:'0.005 ETH',exact:true}).click();
  await page.getByLabel('Slippage tolerance').fill('9');await page.getByRole('button',{name:'Get quote'}).click();
  await page.getByText('Use a slippage between 0.1% and 5%.',{exact:true}).waitFor();
  await page.getByLabel('Slippage tolerance').fill('0.5');
  check('Amount precision and slippage validation; field focus and preset amount');
  state.quoteFailure=true;await page.getByRole('button',{name:'Get quote'}).click();await page.getByText(/Refresh the quote to retry/).waitFor();assert.equal(await page.getByRole('button',{name:'Buy LBUY ↗'}).count(),0);state.quoteFailure=false;
  check('Failed quote reports a recoverable error and cannot be submitted');
  await quote(page);
  const quoterCalls=calls.filter(c=>c.method==='eth_call'&&c.params[0].to.toLowerCase()===manifest.network.uniswapV4.quoter.toLowerCase());assert(quoterCalls.length>0);
  assert.equal(await page.getByRole('button',{name:'Claim jackpot'}).isDisabled(),true);
  await page.screenshot({path:'../docs/evidence/desktop-mock.png',fullPage:true});report.screenshots.push('desktop-mock.png');
  report.contrast=await page.evaluate(()=>{
    const rgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number);
    const lum=values=>values.map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;}).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0);
    return ['.intro-copy','.brand-caption','.jackpot-caption','.jackpot-number','.hint','.buy-actions .primary'].map(selector=>{
      const element=document.querySelector(selector),foreground=getComputedStyle(element).color;
      let ancestor=element,background;
      while(ancestor){background=getComputedStyle(ancestor).backgroundColor;if(background!=='rgba(0, 0, 0, 0)')break;ancestor=ancestor.parentElement;}
      const a=lum(rgb(foreground)),b=lum(rgb(background));
      return {selector,foreground,background,ratio:Number(((Math.max(a,b)+.05)/(Math.min(a,b)+.05)).toFixed(2))};
    });
  });
  assert(report.contrast.every(pair=>pair.ratio>=4.5));
  const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
  report.accessibility={violations:axe.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)})),incomplete:axe.incomplete.map(v=>v.id)};
  assert.deepEqual(report.accessibility.violations,[]);
  check('Rendered connected quote: axe WCAG A/AA automated scan has no violations');
  for(const width of [1440,980,820,780,390,320]) {
    await page.setViewportSize({width,height:950});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Overflow at ${width}`);
    if([390,320,820].includes(width)) {const name=`width-${width}-mock.png`;await page.screenshot({path:`../docs/evidence/${name}`,fullPage:true});report.screenshots.push(name);}
  }
  check('No horizontal overflow at 1440, 980, 820, 780, 390, 320 CSS pixels');
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.getByRole('button',{name:'Buy LBUY ↗'}).evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
  await page.evaluate(()=>document.documentElement.style.fontSize='200%');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Text enlargement overflow');await page.evaluate(()=>document.documentElement.style.fontSize='');
  check('Reduced motion and 200% text enlargement at 390px');
  await page.setViewportSize({width:1440,height:1050});
  await page.clock.fastForward(31000);
  await page.getByText('Expired — refresh below',{exact:true}).waitFor();
  assert(await page.getByRole('button',{name:'Buy LBUY ↗'}).isDisabled());
  check('Expired quote disables purchase after 30 seconds');
  await quote(page);
  await page.evaluate(({leader})=>{window.mockWallet.account=leader;window.mockWallet.emit('accountsChanged',[leader]);},{leader});
  await page.getByText(`${leader.slice(0,6)}…${leader.slice(-4)}`,{exact:true}).first().waitFor();
  assert.equal(await page.getByRole('button',{name:'Buy LBUY ↗'}).count(),0);
  await page.evaluate(({account})=>{window.mockWallet.account=account;window.mockWallet.emit('accountsChanged',[account]);},{account});
  check('Account change discards the previous account’s quote');
  await quote(page);state.rejectSimulation=true;await page.getByRole('button',{name:'Buy LBUY ↗'}).click();await page.getByText(/price moved beyond your minimum/).waitFor();
  assert.equal(await page.evaluate(()=>window.mockWallet.sendCount),0);state.rejectSimulation=false;
  check('Buy simulation revert prevents a wallet send');
  await quote(page);await page.evaluate(()=>window.mockWallet.reject=true);await page.getByRole('button',{name:'Buy LBUY ↗'}).click();await page.getByText(/Request declined in your wallet/).waitFor();await page.evaluate(()=>window.mockWallet.reject=false);
  check('Wallet rejection is recoverable');
  await quote(page);await page.getByLabel('You pay').focus();for(let i=0;i<8;i++){await page.keyboard.press('Tab');if((await page.locator(':focus').textContent())==='Buy LBUY ↗')break;}assert.equal(await page.locator(':focus').textContent(),'Buy LBUY ↗');await page.keyboard.press('Enter');await page.getByText('Purchase confirmed. Round state is refreshing.',{exact:false}).waitFor();
  const send=await page.evaluate(()=>window.mockWallet.requests.filter(x=>x.method==='eth_sendTransaction').at(-1));
  const decoded=decodeFunctionData({abi:hookAbi,data:send.params[0].data});assert.equal(decoded.functionName,'buy');assert.equal(JSON.stringify(decoded.args[0]).toLowerCase(),JSON.stringify(poolKey).toLowerCase());assert.equal(decoded.args[1],parseEther('23623.75')*9950n/10000n);assert.equal(BigInt(send.params[0].value),parseEther('0.005'));assert.equal(send.params[0].to.toLowerCase(),hook.address.toLowerCase());
  assert(!await page.evaluate(()=>window.mockWallet.requests.some(x=>x.method==='eth_sendTransaction'&&x.params[0].data.startsWith('0x095ea7b3'))));
  check('Successful keyboard-driven mocked buy: exact hook, PoolKey, 0.005 ETH, net quote × 99.5% minOut, receipt and explorer link; no approval');
  state.lastBuyAt=seconds()-3601;await refresh(page);await waitForEnabled(page.getByRole('button',{name:'Claim jackpot'}));
  await page.getByText(`Anyone can claim. Payment goes to ${leader.slice(0,6)}…${leader.slice(-4)}.`).waitFor();
  state.rejectSimulation=true;await page.getByRole('button',{name:'Claim jackpot'}).click();await page.getByText(/new buy reset the timer/).waitFor();state.rejectSimulation=false;
  check('Claim at confirmed expiry; non-winner caller gets explicit recipient; timer-reset race blocks send');
  await page.getByRole('button',{name:'Claim jackpot'}).click();await page.getByText('Claim confirmed. The recorded leader received the jackpot.',{exact:false}).waitFor();
  const claim=await page.evaluate(()=>window.mockWallet.requests.filter(x=>x.method==='eth_sendTransaction').at(-1));assert.equal(decodeFunctionData({abi:hookAbi,data:claim.params[0].data}).functionName,'claim');assert(!claim.params[0].value || BigInt(claim.params[0].value)===0n);
  check('Successful mocked claim uses the intended PoolKey with no ETH value');
  state.leader=zeroAddress;state.jackpot=0n;state.noEvents=true;await refresh(page);await page.getByText('The seat is open').waitFor();assert(await page.getByRole('button',{name:'Claim jackpot'}).isDisabled());await page.getByText('No activity in the last 500 blocks. The next buy could be yours.').waitFor();
  check('Empty round and recent-events empty state');
  state.stale=true;await refresh(page);await page.getByText('State is stale · actions paused').waitFor();assert(await page.getByRole('button',{name:/^(Get quote|Refresh quote)$/}).isDisabled());state.stale=false;
  check('Stale block disables signing');
  state.failRpc=true;await refresh(page);await page.getByText('RPC unavailable · actions paused').waitFor();assert(await page.getByRole('button',{name:/^(Get quote|Refresh quote)$/}).isDisabled());state.failRpc=false;await refresh(page);
  check('RPC outage disables actions and recovers on refresh');
  const absent=await pageWithWallet(false);await absent.getByRole('button',{name:'Connect wallet'}).click();await absent.getByText(/No browser wallet found/).waitFor();check('Missing wallet instructions');
  const rejected=await pageWithWallet(true,{reject:true});await rejected.getByRole('button',{name:'Connect wallet'}).click();await rejected.getByText(/Request declined in your wallet/).waitFor();check('Connection rejection');
  state.emptyCode=true;const noCode=await pageWithWallet(false);await noCode.getByText(/No deployed code found/).waitFor();assert(await noCode.getByRole('button',{name:'Get quote'}).isDisabled());state.emptyCode=false;check('Empty deployed bytecode blocks actions');
  const badContext=await browser.newContext();contexts.push(badContext);await badContext.route(`**/abi/${hook.name}.json`,route=>route.fulfill({contentType:'application/json',body:'[]'}));const bad=await badContext.newPage();await bad.goto(url);await bad.getByRole('heading',{name:'Unable to verify deployment'}).waitFor();await bad.getByText(/failed its attested hash check/).waitFor();check('Tampered ABI fails closed before wallet or RPC setup');
  assert.deepEqual(report.resourceFailures,[]);assert.deepEqual(report.consoleErrors,[]);check('No production resource failures or uncaught browser/console errors');
  report.result='passed';
} catch(error) {report.result='failed';report.error=error.stack;report.pageText=await contexts[0]?.pages()[0]?.locator('body').innerText();console.error(report.pageText);throw error;}
finally {writeFileSync('../docs/evidence/browser.json',JSON.stringify(report,null,2)+'\n');await Promise.all(contexts.map(c=>c.close()));await browser.close();await new Promise(resolve=>server.close(resolve));}
