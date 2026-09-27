import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { getWalletClient } from 'wagmi/actions';
import { formatUnits, zeroAddress, type EIP1193Provider, type Hash } from 'viem';
import type { Runtime } from './config';
import { amountFromInput, canClaim, displayAmount, message, quoteBuy, readActivity, readGame, short, slippageBps, verifyChain, type Quote } from './chain';

export function App({ runtime: r }: { runtime: Runtime }) {
  const { address, chainId, connector, isConnected } = useAccount();
  const { connectors, connectAsync, isPending: connecting } = useConnect();
  const { disconnect } = useDisconnect();
  const [now, setNow] = useState(Date.now());
  const [amount, setAmount] = useState('0.001'), [slippage, setSlippage] = useState('0.5');
  const [quote, setQuote] = useState<Quote>(), [quoteError, setQuoteError] = useState('');
  const [walletError, setWalletError] = useState(''), [txError, setTxError] = useState('');
  const [status, setStatus] = useState(''), [busy, setBusy] = useState(false), [quoting, setQuoting] = useState(false);
  const [hash, setHash] = useState<Hash>(), [switching, setSwitching] = useState(false);
  const [invalidField, setInvalidField] = useState('');
  const inputRef = useRef<HTMLInputElement>(null), slipRef = useRef<HTMLInputElement>(null);
  const operation = useRef(false), quoteVersion = useRef(0);
  const d = r.deployment, network = d.network;
  const verified = useQuery({ queryKey: ['verification'], queryFn: () => verifyChain(r), staleTime: 60000, refetchInterval: 60000 });
  const game = useQuery({ queryKey: ['game', address], queryFn: () => readGame(r, address), enabled: verified.data === true, refetchInterval: 12000 });
  const activity = useQuery({ queryKey: ['activity'], queryFn: () => readActivity(r), enabled: verified.data === true, refetchInterval: 24000 });
  const g = game.data;
  const wrongChain = isConnected && chainId !== d.chainId;
  const fresh = !!g && now - g.receivedAt < 45000 && now / 1000 - g.timestamp < 180;
  const ready = isConnected && !wrongChain && verified.data === true && !verified.isError && !game.isError && fresh;
  const tokenSymbol = g?.symbol ?? d.token.symbol;
  const native = network.nativeCurrency;
  const hasLeader = g && g.lastBuyer !== zeroAddress;
  const remaining = g && hasLeader ? Math.max(0, Number(g.claimableAt) - (g.timestamp + Math.max(0, Math.floor((now - g.receivedAt) / 1000)))) : 0;
  const timer = hasLeader ? [Math.floor(remaining / 3600), Math.floor(remaining / 60) % 60, remaining % 60].map(v => String(v).padStart(2, '0')).join(':') : '— : — : —';
  const validQuote = !!quote && now - quote.createdAt < 30000 && quote.account.toLowerCase() === address?.toLowerCase();
  const error = verified.error ?? game.error;
  const explorer = (kind: 'address'|'tx'|'block', value: string) => `${network.explorer}/${kind}/${value}`;
  const format = (value: bigint) => displayAmount(value, g?.decimals ?? d.token.decimals);
  const invalidateQuote = () => { quoteVersion.current++; setQuote(undefined); setQuoteError(''); setInvalidField(''); };
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  useEffect(() => { quoteVersion.current++; setQuote(undefined); setQuoteError(''); }, [address, chainId]);

  async function connectWallet() {
    setWalletError('');
    try {
      const choice = connectors[0];
      if (!choice || !await choice.getProvider()) throw Error('No browser wallet found. Install an Ethereum wallet or open this page in its browser, then try again.');
      await connectAsync({ connector: choice });
    } catch (e) { setWalletError(message(e)); }
  }
  async function switchNetwork() {
    if (!connector) return;
    setSwitching(true); setWalletError('');
    try {
      const provider = await connector.getProvider() as EIP1193Provider;
      const params = { chainId: d.walletAddChain.chainId as `0x${string}` };
      try { await provider.request({ method: 'wallet_switchEthereumChain', params: [params] }); }
      catch (error) {
        const e = error as { code?: number; message?: string; data?: { originalError?: { code?: number } } };
        if (e.code !== 4902 && e.data?.originalError?.code !== 4902 && !/unknown chain|unrecognized chain|not added/i.test(e.message ?? '')) throw e;
        await provider.request({ method: 'wallet_addEthereumChain', params: [{ ...d.walletAddChain, chainId: params.chainId }] });
        await provider.request({ method: 'wallet_switchEthereumChain', params: [params] });
      }
      invalidateQuote();
    } catch (e) { setWalletError(message(e)); }
    finally { setSwitching(false); }
  }
  async function getQuote(event: React.FormEvent) {
    event.preventDefault(); if (!ready || !address || operation.current) return;
    invalidateQuote(); setTxError('');
    let input: bigint, bps: bigint;
    try { input = amountFromInput(amount, native.decimals); }
    catch (e) { setQuoteError(message(e)); setInvalidField('amount'); inputRef.current?.focus(); return; }
    try { bps = slippageBps(slippage); }
    catch (e) { setQuoteError(message(e)); setInvalidField('slippage'); slipRef.current?.focus(); return; }
    if (g && input >= g.ethBalance) { setQuoteError('Leave some ETH for network gas. Enter less than your balance.'); setInvalidField('amount'); inputRef.current?.focus(); return; }
    const version = quoteVersion.current; setQuoting(true);
    try { const result = await quoteBuy(r, address, input, bps); if (version === quoteVersion.current) setQuote(result); }
    catch (e) { if (version === quoteVersion.current) setQuoteError(`${message(e)} Refresh the quote to retry.`); }
    finally { setQuoting(false); }
  }
  async function transact(kind: 'buy' | 'claim') {
    if (!ready || !address || operation.current || (kind === 'buy' && !validQuote) || (kind === 'claim' && (!g || !canClaim(g)))) return;
    operation.current = true; setBusy(true); setTxError(''); setHash(undefined); setStatus('Simulating transaction…');
    try {
      await verifyChain(r);
      const wallet = await getWalletClient(r.wagmi, { chainId: d.chainId });
      const expectedAccount = address.toLowerCase();
      const checkWallet = async () => {
        if (await wallet.getChainId() !== d.chainId || (await wallet.getAddresses())[0]?.toLowerCase() !== expectedAccount) throw Error('Wallet account or network changed. Reconnect and try again.');
      };
      await checkWallet();
      if (kind === 'buy' && (!quote || Date.now() - quote.createdAt >= 30000)) throw Error('Quote expired. Refresh the quote before buying.');
      const simulation = await r.client.simulateContract({ ...r.hook, account: address, functionName: kind,
        args: kind === 'buy' ? [r.poolKey, quote!.minimum] : [r.poolKey], ...(kind === 'buy' ? { value: quote!.input } : {}) });
      await checkWallet();
      if (kind === 'buy' && Date.now() - quote!.createdAt >= 30000) throw Error('Quote expired during simulation. Refresh the quote.');
      setStatus(kind === 'buy' ? 'Confirm the LBUY purchase in your wallet.' : 'Confirm the payout to the recorded leader in your wallet.');
      const tx = await wallet.writeContract(simulation.request);
      setHash(tx); setStatus('Transaction submitted. Waiting for confirmation…');
      const receipt = await r.client.waitForTransactionReceipt({ hash: tx, timeout: 120000 });
      if (receipt.status !== 'success') throw Error('Transaction reverted. Refresh the round and quote before trying again.');
      setStatus(kind === 'buy' ? 'Purchase confirmed. Round state is refreshing.' : 'Claim confirmed. The recorded leader received the jackpot.');
      invalidateQuote();
      await Promise.all([game.refetch(), activity.refetch()]);
    } catch (e) { setTxError(message(e)); setStatus(''); }
    finally { operation.current = false; setBusy(false); }
  }

  return <>
    <a className="skip" href="#main">Skip to content</a>
    <div className="test-strip">A Sepolia test toy. Test tokens only, no real value.</div>
    <header className="site-header shell">
      <a className="brand" href="#main"><img src="./mark.svg" width="38" height="38" alt=""/><span>Last Buyer<span className="brand-caption">The onchain waiting game</span></span></a>
      <div className="wallet-area"><span className="network-tag"><i aria-hidden="true"/>{network.name}</span>
        {isConnected ? <><span className="wallet-address" title={address}>{short(address!)}</span><button className="small" onClick={() => disconnect()} disabled={busy}>Disconnect</button></> : <button className="wallet-button" onClick={connectWallet} disabled={connecting}>{connecting ? 'Connecting…' : 'Connect wallet'}<span aria-hidden="true"> ↗</span></button>}
      </div>
    </header>
    <main id="main" className="shell">
      <section className="intro"><div><p className="eyebrow">One pool. One clock. One last buyer.</p><h1>Good things come<br/>to the last buyer.</h1><p className="intro-copy">Buy LBUY. Reset the clock. Stay the last buyer for an hour<br className="desktop-break"/> and the jackpot is yours to claim.</p></div><div className="intro-stamp" aria-hidden="true"><span>LAST</span><span className="stamp-hourglass">⌛</span><span>BUYER</span></div></section>
      {walletError && <div className="notice error" role="alert">{walletError}</div>}
      {wrongChain && <div className="notice network-notice"><span>Your wallet is on a different network. Switch to {network.name} to buy or claim.</span><button onClick={switchNetwork} disabled={switching || busy}>{switching ? 'Switching…' : `Switch to ${network.name}`}</button></div>}
      <div className="sync-row"><span className="sync-status"><i className={error || !fresh ? 'dot neutral' : 'dot'} aria-hidden="true"/>{error ? 'RPC unavailable · actions paused' : !g ? 'Reading the pool…' : !fresh ? 'State is stale · actions paused' : `Live from ${network.name}`}</span><button className="text-button" disabled={game.isFetching || verified.isFetching} onClick={() => { void verified.refetch(); void game.refetch(); void activity.refetch(); }}>{game.isFetching || verified.isFetching ? 'Refreshing…' : 'Refresh state ↻'}</button></div>
      {error && <p className="notice error" role="alert">{message(error)} Use “Refresh state” to retry.</p>}
      <div className="game-grid">
        <section className="jackpot-panel" aria-labelledby="jackpot-heading">
          <div className="panel-top"><h2 id="jackpot-heading">Current jackpot</h2><span className="round-tag">Round {g ? String(g.round + 1n).padStart(2, '0') : '—'}</span></div>
          <p className="jackpot-number" title={g ? `${formatUnits(g.jackpot,g.decimals)} ${tokenSymbol}` : undefined}>{g ? format(g.jackpot) : '—'} <span>{tokenSymbol}</span></p>
          <p className="jackpot-caption">{g ? `${Number(g.fee) / 100}%` : '1%'} of every exact-input ETH buy feeds the pot.</p>
          <div className="timer-block"><div className="timer-heading"><span>Time until claim</span><span className="timer-state">{!g ? 'Loading' : !hasLeader ? 'Waiting for a buyer' : remaining === 0 ? 'Awaiting settlement' : 'Clock is running'}</span></div>
            <div className="countdown" role="timer" aria-live="off" aria-label={hasLeader ? `${Math.floor(remaining / 3600)} hours ${Math.floor(remaining/60)%60} minutes ${remaining%60} seconds until claim` : 'No active countdown'}>{timer}</div>
            <div className="timer-track" aria-hidden="true"><div style={{width: hasLeader && g ? `${Math.min(100,remaining / Number(g.delay) * 100)}%` : '0%'}}/></div>
            <p className="timer-note">{hasLeader ? 'A qualifying buy starts the one-hour clock again.' : 'The first qualifying buy starts the one-hour clock.'}</p>
          </div>
          <div className="leader"><div className="leader-icon" aria-hidden="true">♜</div><div><span className="label">Last buyer</span>{hasLeader ? <a className="leader-address" href={explorer('address',g!.lastBuyer)} target="_blank" rel="noreferrer" aria-label={`Last buyer ${g!.lastBuyer} on explorer`}>{short(g!.lastBuyer)} ↗</a> : <strong>{g ? 'The seat is open' : 'Reading leader…'}</strong>}</div><span className="leader-description">{hasLeader ? (g!.lastBuyer.toLowerCase() === address?.toLowerCase() ? 'You hold the lead' : 'Current leader') : 'Could be you'}</span></div>
          <div className="claim-area"><button className="claim-button" onClick={() => void transact('claim')} disabled={!ready || !g || !canClaim(g) || busy || quoting}>Claim jackpot <span aria-hidden="true">↗</span></button><p>{!isConnected ? 'Connect a wallet to settle an expired round.' : hasLeader && g && canClaim(g) ? `Anyone can claim. Payment goes to ${short(g.lastBuyer)}.` : 'Available once the chain confirms the timer has ended.'}</p></div>
        </section>
        <section className="buy-panel" aria-labelledby="buy-heading"><div className="panel-top"><h2 id="buy-heading">Take the lead</h2><span className="step-label">ETH → LBUY</span></div><p className="buy-intro">One buy can change the round.</p>
          <form onSubmit={getQuote} noValidate>
            <div className="field-heading"><label htmlFor="amount">You pay</label><span>{g && address ? `${displayAmount(g.ethBalance,native.decimals)} ${native.symbol} available` : `Pay with ${native.symbol}`}</span></div>
            <div className={`amount-field ${invalidField === 'amount' ? 'invalid' : ''}`}><input ref={inputRef} id="amount" name="amount" type="text" inputMode="decimal" autoComplete="off" value={amount} onChange={e => { setAmount(e.target.value); invalidateQuote(); }} disabled={busy} aria-invalid={invalidField === 'amount'} aria-describedby={invalidField === 'amount' ? 'quote-error' : 'amount-hint'}/><span><span className="eth-symbol" aria-hidden="true">♦</span>{native.symbol}</span></div>
            <div className="presets">{['0.001','0.005','0.01'].map(v => <button type="button" key={v} disabled={busy} aria-pressed={amount === v} onClick={() => {setAmount(v); invalidateQuote();}}>{v} ETH</button>)}</div>
            <p id="amount-hint" className="hint">{g ? formatUnits(g.minBuy,native.decimals) : '0.001'} ETH or more takes the lead. Smaller buys only feed the pot.</p>
            <div className="slippage-row"><label htmlFor="slippage">Slippage tolerance</label><div className="slippage-field"><input ref={slipRef} id="slippage" name="slippage" type="text" inputMode="decimal" value={slippage} onChange={e=>{setSlippage(e.target.value);invalidateQuote();}} disabled={busy} aria-invalid={invalidField === 'slippage'} aria-describedby={invalidField === 'slippage' ? 'quote-error' : 'slippage-hint'}/><span>%</span></div></div>
            <span id="slippage-hint" className="sr-only">From 0.1% to 5%. The purchase reverts if net output is below the minimum.</span>
            <div className="quote-details"><div><span>Estimated received</span><strong>{quote ? format(quote.output) : '—'} {tokenSymbol}</strong></div><div><span>Minimum received</span><span title={quote ? formatUnits(quote.minimum,g?.decimals ?? d.token.decimals) : undefined}>{quote ? format(quote.minimum) : '—'} {tokenSymbol}</span></div><div><span>Pool fee / jackpot fee</span><span>{d.pool.fee / 10000}% / {g ? Number(g.fee)/100 : 1}%</span></div>{quote && <div><span>Quote</span><span>{validQuote ? `Expires in ${Math.max(0,30-Math.floor(Math.max(0,now-quote.createdAt)/1000))}s` : 'Expired — refresh below'}</span></div>}</div>
            {quote && <p className="hint">Net of both fees. 1 ETH ≈ {displayAmount(quote.output * 10n ** BigInt(native.decimals) / quote.input,g?.decimals ?? d.token.decimals)} {tokenSymbol}. Unspent ETH is refunded.</p>}
            <p id="quote-error" role="alert" className={quoteError ? 'inline-error' : 'sr-only'}>{quoteError}</p>
            <div className="buy-actions"><button className={validQuote ? 'secondary full' : 'primary full'} type="submit" disabled={!ready || busy || quoting}>{quoting ? 'Getting quote…' : quote ? 'Refresh quote' : 'Get quote'}</button>{quote && <button type="button" className="primary full" disabled={!ready || !validQuote || busy || quoting} onClick={() => void transact('buy')}>{busy ? 'Transaction in progress…' : `Buy ${tokenSymbol} ↗`}</button>}</div>
            <p className="form-footnote">{!isConnected ? 'Connect your wallet above to get a live quote.' : wrongChain ? `Switch to ${network.name} to continue.` : !ready ? 'Waiting for verified, fresh pool state.' : 'Buy directly through the hook. No token approval needed.'}</p>
          </form>
          {address && g && <div className="balance-row"><span>Wallet balance</span><strong>{format(g.tokenBalance)} {tokenSymbol}</strong></div>}
        </section>
      </div>
      <div className="transaction-status" role="status">{status}{hash && <a href={explorer('tx',hash)} target="_blank" rel="noreferrer">View transaction ↗</a>}</div>
      {txError && <p className="notice error" role="alert">{txError}</p>}
      <section className="how-it-works" aria-labelledby="rules-heading"><div><p className="eyebrow">The rules are simple</p><h2 id="rules-heading">Buy. Wait. Claim.</h2></div><ol><li><span className="rule-number">01</span><h3>Make a qualifying buy</h3><p>Spend at least {g ? formatUnits(g.minBuy,native.decimals) : '0.001'} ETH to become the last buyer. Every exact-input buy adds 1% of its LBUY output to the pot.</p></li><li><span className="rule-number">02</span><h3>Keep the lead for an hour</h3><p>Each qualifying buy resets the timer. Another buyer can take the lead, even after the clock runs out and before a claim lands.</p></li><li><span className="rule-number">03</span><h3>Settle the round</h3><p>Anyone can submit the claim. The jackpot goes to the recorded last buyer, and a new round begins. The caller pays gas.</p></li></ol></section>
      <section className="activity" aria-labelledby="activity-heading"><div className="section-heading"><h2 id="activity-heading">Around the pool</h2><span>Recent activity · last 500 blocks</span></div>
        {activity.isError ? <p className="activity-empty">Recent events could not be loaded. Use “Refresh state” to retry. Current round values come from contract reads.</p> : !activity.data ? <p className="activity-empty">Reading recent pool events…</p> : !activity.data.length ? <p className="activity-empty">No activity in the last 500 blocks. The next buy could be yours.</p> : <ul className="event-list">{activity.data.map(event => <li key={`${event.transactionHash}-${event.index}`}><span className="event-icon" aria-hidden="true">{event.name === 'NewLeader' ? '↗' : event.name === 'JackpotClaimed' ? '✓' : '+'}</span><div><strong>{event.name === 'NewLeader' ? 'A new buyer takes the lead' : event.name === 'JackpotClaimed' ? 'Jackpot claimed' : 'Jackpot grows'}</strong><span>{event.person ? short(event.person) : `${format(event.amount ?? 0n)} ${tokenSymbol} added`}{event.name === 'JackpotClaimed' ? ` · ${format(event.amount ?? 0n)} ${tokenSymbol}` : ''}</span></div><a href={explorer('tx',event.transactionHash)} target="_blank" rel="noreferrer" aria-label={`View ${event.name} transaction ${event.transactionHash}`}>Block {String(event.block)} ↗</a></li>)}</ul>}
      </section>
      <details className="deployment-details"><summary>Pool & deployment details</summary><dl><dt>Pool ID</dt><dd className="mono">{r.poolId}</dd><dt>Last read</dt><dd>{g ? <a href={explorer('block',String(g.block))} target="_blank" rel="noreferrer">Block {String(g.block)} · {new Date(g.timestamp*1000).toISOString()}</a> : 'Not yet available'}</dd><dt>Claim opens at</dt><dd>{g && hasLeader ? new Date(Number(g.claimableAt)*1000).toISOString() : 'No qualifying buyer yet'}</dd><dt>Source commit</dt><dd className="mono">{d.sourceCommit}</dd><dt>Attestation</dt><dd className="mono">{d.attestationHash}</dd>{d.contracts.map(c=><div key={c.name} className="contract-detail"><dt>{c.name}</dt><dd><a className="mono" href={explorer('address',c.address)} target="_blank" rel="noreferrer">{c.address} ↗</a></dd></div>)}</dl><p>Countdown is an estimate between blocks. Claims become available only after a fresh block confirms expiry. Router purchases can name another leader; this form calls the hook’s authenticated buy().</p><a href="./imd-deployment.json" target="_blank" rel="noreferrer">View deployment manifest ↗</a></details>
    </main>
    <footer className="shell"><span>Last Buyer <span className="footer-dot">/</span> lab-jackpot-hook</span><span>Built on Uniswap v4 · {network.name} testnet</span></footer>
  </>;
}
