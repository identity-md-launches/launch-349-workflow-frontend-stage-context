# Last Buyer frontend

A single static page for the deployed Last Buyer jackpot on Sepolia. This is a test toy with no real value. The app displays the LBUY jackpot, leader, block-based countdown, wallet balances, and recent events. Its two transaction actions are the hook's authenticated `buy(PoolKey,minOut)` and permissionless `claim(PoolKey)`.

## Install, build, serve

Use Node 22 and npm 10. All frontend configuration and the lockfile live in this directory.

```sh
cd web
npm ci --no-audit --no-fund
npm run build
npm run preview
```

For an already populated npm cache, dependency installation also works with `npm ci --offline --cache <cache-directory>`. The build itself requires no network; it reads local Git objects, source ABIs, configuration and installed packages. No npm cache or dependencies are delivered. `npm run build` includes TypeScript checking, Vite production export and manifest generation, in that order. `npm run dev` runs the development server, but the production preview is the supported complete preview: Vite's development server does not emit the runtime manifest.

The build needs the Git object for deployed source commit `f3b915d1da3cace45aa18c40d42713227afe25c7`. Keep that commit available in shallow checkouts. Its implementation-derived arrays at `docs/abi/LaunchToken.json` and `docs/abi/LastBuyerJackpotHook.json` remain unchanged.

Publish the contents of repository-root `dist/` as plain files. Vite uses `base: './'`. The app has one page and fragment links; it works from a gateway subpath without rewrites. Fonts, favicon and JavaScript are local. Public RPC reads and the visitor's injected wallet are runtime network operations, with no backend.

## Configuration and provenance

`config/deployment.json` and `config/network.json` preserve the supplied handoffs as build inputs. They are not imported into the JavaScript bundle. `scripts/export.mjs`:

1. Reads ABI bytes from the pinned Git commit and confirms the working ABI files are identical.
2. Recursively sorts JSON object keys (preserving array order), serializes compact JSON and checks Keccak-256 against each handoff `abiHash`.
3. Exports the original ABI arrays into `dist/abi/`.
4. Generates `dist/imd-deployment.json`, copying all required identifiers and the exact contract set. The supplied `network` and `walletAddChain` objects are preserved. Extra pool, token and deployment-block metadata comes from the same handoff.
5. Enumerates **every** exported file except the manifest and records SHA-256 of the final bytes. The script enforces the 128-asset / 8 MiB-per-file limits; `npm run verify` additionally verifies the complete inventory and export total.

At runtime `src/config.ts` fetches that same manifest and its referenced ABI JSON. It verifies ABI canonical hashes before creating clients. No separate address, chain or RPC map exists in the application. The minimal infrastructure quoter interface is centralized there; its address comes only from `network.uniswapV4.quoter`. All ABI arrays for the deployed contracts are implementation-derived.

Pool ID is `keccak256(abi.encode(PoolKey))`, using the handoff's native paired currency, deployed LBUY address, fee, tick spacing and hook. Reads, logs, quotes and transactions bind to that full key. State views are pinned to one block per refresh. Events cover a bounded recent 500-block window, filtered to the same PoolId; they are not a complete historical index.

## Wallet and transactions

Wagmi's injected browser-wallet connector is available without a project ID. No WalletConnect credentials are supplied or needed. With multiple injected providers, the first discovered connector is used. A wallet chooser and WalletConnect support are not included. Connections are explicit rather than automatically restored on page load.

The UI shows missing-wallet instructions, connected address, wrong network, rejection, simulation, signature request, submitted transaction and receipt states. On unknown-chain error 4902, switching offers `wallet_addEthereumChain` with the handoff's exact parameters, then switches again. Three supplied public RPCs are tried in order. Signing stays in the visitor's wallet; reads do not use the wallet as an RPC fallback.

Before enabling transactions, the app verifies RPC chain ID, nonempty code for token/hook/PoolManager/quoter, hook PoolManager binding and token decimals/symbol. Code existence is not a runtime-bytecode audit. Failed reads or a snapshot older than 45 seconds pause actions; a chain block older than 180 seconds also pauses them. Device-clock errors can conservatively disable actions. Refresh is always available after a request finishes.

The form accepts ETH amounts with at most native-token precision and slippage from 0.1% to 5% (default 0.5%). It reserves room for gas by rejecting an amount at or above the visible ETH balance; the wallet still estimates actual gas. `quoteExactInputSingle` is simulated at the configured quoter with the intended key and `abi.encode(account)` hook data. Its amountOut is already net of the afterSwap fee. The minimum is integer-floor `netOutput * (10000 - slippageBps) / 10000`; the fee is not subtracted a second time. Quotes expire after 30 seconds and are discarded after input, account or chain changes.

Purchases simulate `buy(key,minOut)` on the deployed hook, then send exactly the ETH input to that hook with the simulated arguments. Account and chain are rechecked before signing. This assignment explicitly requires direct hook buys, so the Universal Router / Permit2 swap path is not used. ETH purchases require no token approvals. Unspent ETH is refunded by the hook. The hook authenticates `msg.sender`; router hookData outside this app can gift leadership to a different address.

The countdown interpolates from the latest block timestamp. Claim becomes available only when a fresh **block** confirms expiry and a leader exists. Any wallet may submit; payment always goes to the stored leader, which is stated next to the button. Claim is simulated again before signing. A qualifying buy can reset the timer even after displayed expiry and before a claim is mined. A successful simulation does not reserve a price or winner.

Receipts are checked for success, and pool state/events are refetched afterwards. The transaction explorer link persists for inspection. After a receipt timeout, check that link before retrying; an unresolved transaction may still land. No administrative callbacks, arbitrary token transfers, sell controls or liquidity actions are exposed because they are outside this assignment.

## Validation

```sh
cd web
npm run typecheck
npm run build
npm test
npm run verify
npm run check:chain
```

`npm test` starts its own bounded foreground HTTP server under `/preview/`, opens Chromium, tests the production export, writes evidence to `docs/evidence/`, then closes browser and server. It uses mocked JSON-RPC and an injected EIP-1193 wallet; it never broadcasts. Use `BROWSER_EXECUTABLE=/path/to/chromium npm test` to select an installed browser; otherwise it uses the worker's headless-shell location if present, falling back to Playwright's default browser. Outside the worker, install a matching Playwright Chromium if needed.

`npm run check:chain` makes read-only calls through `curl`, pins state/quote/code reads to the returned latest block and records responses in `docs/evidence/chain.json`. It sends no transactions. A successful live quote does not establish that a wallet-funded buy or payout has been tested.

See [validation](../docs/FRONTEND-VALIDATION.md) for actual checks, limitations and Better Interface review; [design](../docs/DESIGN.md) for implemented tokens and responsive patterns. Root `DESIGN.md` is intentionally absent: the assignment's overriding path allowlist permits documentation only under `docs/` or `web/`. The frontend adds only `web/.gitignore`, the explicitly budgeted ignore path. No other dotfile or root build configuration is modified.
