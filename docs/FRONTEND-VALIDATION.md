# Frontend validation — Last Buyer

## Scope and assumptions

Worker self-validation of the one-page jackpot frontend, source under `web/` and static export under `dist/`, ready for submission. The deployed contracts and original ABI exports remain unchanged. This report carries no independent network certification.

The supplied workflow requires **direct hook buys**; the form therefore calls `buy(PoolKey,minOut)` instead of routing through Universal Router. Quotes use the supplied network's v4 quoter. There are no ERC20 approvals for native ETH input. Claim remains permissionless and explicitly pays the recorded leader. No sell, liquidity, admin, token-transfer or protocol-callback UI was added.

The overriding write allowlist conflicts with the requested root `DESIGN.md`. Its complete contents are delivered as `docs/DESIGN.md`, with the exception documented here and in `web/README.md`. Only the explicitly permitted `web/.gitignore` is added as an ignore file. No root configuration, Solidity, vendored libraries, deployment or workflow files are modified.

## Reproducible checks

Commands were run from `web/` unless stated otherwise. The cache used for the offline install was populated by the initial authorized dependency installation and moved into non-submitted `test/scratch/` before reinstalling.

| Command / check | Result | Evidence |
| --- | --- | --- |
| `npm ci --offline --no-audit --no-fund --cache ../test/scratch/npm-cache` | Passed, 529 packages installed from the lockfile/cache | `evidence/install.log` |
| `npm run build` | Passed; runs `tsc --noEmit`, Vite, then ABI/manifest export | `evidence/build.log` |
| `npm test` | Passed on the actual production export under `/preview/` | `evidence/interactions.log`, `evidence/browser.json` |
| `npm run verify` | Passed; exact handoff fields, network, ABI hashes and complete final asset inventory | `evidence/integrity.log` |
| `npm run check:chain` | Passed read-only Sepolia chain/code/state and quote calls | `evidence/chain.json` |

The supplied browser MCP returned `Transport closed`; its managed preview file was absent. Validation used locally installed Chromium headless shell with Playwright instead. The script owned both preview server and browser for one bounded foreground command, then closed them. The full Chrome binary initially failed to start its crashpad handler; the installed headless-shell binary worked. No remote debugging or long-lived shell server was left running.

Vite reports a main-chunk size warning (~605 KB uncompressed; ~186 KB gzip) and harmless third-party pure-comment warnings. npm reports transitive connector package deprecations. These are not build failures. The app uses only injected-wallet connection at runtime. The complete export is under 700 KB, far below the 32 MiB export ceiling with overhead and the 8 MiB per-file ceiling. The final asset count is seven, excluding the manifest itself.

## Deployment and live read evidence

Pinned deployed source: `f3b915d1da3cace45aa18c40d42713227afe25c7`.

Canonical ABI Keccak hashes confirmed from `git show <sourceCommit>:docs/abi/<Contract>.json`:

- LaunchToken: `f36d2fe28b62f817a4fba0b78bb501b41895eada3982280273c063ad8183f577`.
- LastBuyerJackpotHook: `e25cf78509cb8f8c3f98c94d55ee34a64794f4f0ab7bdd4d81ee2a5ccbb79262`.

The runtime manifest preserves the handoff identifiers, addresses and exact two-contract set; its network and wallet-add objects match the supplied network file. Every non-manifest exported file, including index and both ABI arrays, has a lowercase SHA-256 entry. The browser loads that manifest and both arrays; altering the hook ABI caused the tested fail-closed deployment error.

The live read-only check at `2026-09-27T06:28:42.669Z` used the configured publicnode endpoint and pinned subsequent calls to block `0xb3ecb3`. It confirmed chain 11155111, 1,753 bytes of token code and 8,049 bytes of hook code, and the expected PoolManager. Pool ID was `0xea86ed139968f778be24e937d8d2cdea8707f809ba2cde063b9716622efdb2aa`. The round was empty: jackpot 0, zero leader, round 0, no expiry. A 0.001 ETH quoter `eth_call` returned net output `49130814300943727796417` base units. These observations are pinned evidence, not current-balance promises. The script reproduces the calls and records their exact block in `evidence/chain.json`.

No wallet-funded purchase, claim, approval, deployment or other real transaction was broadcast. Publication, IPFS, named-site resolution and control-plane HTTP/RPC checks are later service responsibilities and were not claimed as completed.

## Interaction coverage

The browser suite uses deterministic mocked RPC and an injected EIP-1193 provider, while serving the **real built files**. Mock requests remain inside the test process. Its decoded-call assertions verify:

- Public reads before connection; actions disabled while disconnected or on the wrong network.
- Keyboard wallet connection, missing-wallet guidance, rejected connection, exact switch/add/switch requests using supplied chain parameters.
- Input precision, preset amount, gas-balance guard in source, slippage range and invalid-field focus.
- Failed quote recovery; quote requests to the manifest's quoter; expiry after 30 seconds; account changes discard quotes.
- Buy simulation failure makes no wallet send; wallet rejection is recoverable; a successful mocked purchase sends the intended PoolKey, 0.005 ETH and integer-floor net-output minimum at 0.5% slippage to the hook. No token approval is requested. The purchase control also has a keyboard path.
- Receipt success and transaction explorer link; subsequent state/event refresh.
- Active countdown disables claim; a confirmed expired round enables it; a non-winner caller is told who receives funds; a `TooEarly` simulation prevents signing after a timer reset; successful mocked claim sends the correct PoolKey with no ETH value.
- Empty round, bounded recent-event empty state, stale block, unavailable RPC, recovery, missing bytecode, and ABI tampering.
- No local production resource failures or uncaught browser/console errors in the final mocked run.

## Better Interface consolidated review

The pinned workflow and the core principles of all six domains were read before implementation. The implementation documentation section was read before writing `DESIGN.md`. The attribution and source revisions are preserved in that document.

| Domain | Coverage | Findings / limitations |
| --- | --- | --- |
| Accessibility | **Checked**: native buttons/links/inputs/disclosure, labels, field focus, skip link, visible keyboard outline, transaction/error regions, timer role, reduced motion, automated axe scan | Automated A/AA scan found no violations in the connected quoted state. It is not a full accessibility certification or a screen-reader session. Disabled controls are intentional prerequisites. |
| Layout | **Checked**: production screenshots and overflow checks at 1440, 980, 820, 780, 390 and 320px; 200% text enlargement at 390px; DOM order and logical properties | Initial enlarged countdown overflow was fixed and rechecked. Native browser zoom, RTL and additional locale variants were not tested. English is the sole supported locale. |
| Writing | **Checked**: all primary labels and error messages reviewed against handlers; testnet/no-value label; leader payout and race explanations; empty-state next steps | Custom contract errors now explain recovery. Recent activity is explicitly bounded to 500 blocks. |
| Typography | **Checked**: hierarchy, actual screenshots, wrapping, tabular numbers, input sizes, full deployment values and bounded timer scaling | System fonts vary by host. No font-download or installed-face claim is made. Exact numeric values use standard decimal formatting before compact display. |
| Colors | **Checked**: role tokens, rendered foreground/background sampling, measured ratios, axe contrast scan | Sampled pairs are listed below; measurements do not establish every hover/disabled/focus combination. No alternate theme is implemented. |
| UI | **Checked**: normal, focus, disabled, quote/loading, error, empty and confirmation states; border/surface grouping; responsive controls; reduced-motion media check | 150ms press/hover transitions have static state cues. Animation-panel 10% playback and physical-device touch tests were not performed. |

Measured opaque rendered pairs from the final browser report:

| Foreground / background | Use | Ratio |
| --- | --- | --- |
| `#65705f` / `#f6f5ef` | Intro and brand caption | 4.76:1 |
| `#65705f` / `#fffefb` | Form hint | 5.16:1 |
| `#c5cdbd` / `#222b22` | Jackpot caption | 8.94:1 |
| `#f6f5ef` / `#222b22` | Jackpot amount | 13.38:1 |
| `#222b22` / `#c9e77b` | Observed primary button hover | 10.58:1 |

The exact browser-computed pairs are retained in `evidence/browser.json`; ratios use relative sRGB luminance. Some axe checks remain marked incomplete (recorded in that file), requiring manual assessment; no full WCAG-conformance claim is made.

## Findings and corrections

| Severity / source | Reproduction and impact | Correction and recheck |
| --- | --- | --- |
| Medium — `web/src/style.css:67`, `:159` | At 390px with root text enlarged to 200%, the fixed rem countdown overflowed the page. | Added an inline-size container and capped the clock at `19cqw`. Final enlargement and all six normal-width checks pass. |
| Medium — `web/src/chain.ts:4` | A simulated custom buy revert produced only a generic contract-function error, hiding the recovery action. | Walk viem's error cause to `ContractFunctionRevertedError.data.errorName`; `InsufficientOutput` and `TooEarly` now explain quote refresh / round refresh. Both rejected simulations pass without wallet sends. |
| Low — `web/src/App.tsx:146` | A quote created just after the current UI tick briefly displayed 31 seconds remaining. | Clamp negative elapsed time to zero. Rebuilt screenshots display at most 30 seconds; expiry is separately tested. |
| Low — `web/src/style.css:150` | Offscreen positioning alone let the hidden skip link appear in scrolled full-page screenshot capture. | Clip the link until focused; retain its normal first keyboard stop. Final screenshot and keyboard focus rechecked. |
| Medium — `web/src/App.tsx:131` | Source review found an accessible name on a generic countdown div, whose semantics were unreliable. | Added `role="timer"` and `aria-live="off"`; the label is retained without announcing every tick. Final automated scan rerun. |

Screenshots were opened and visually inspected: `evidence/desktop-mock.png`, `evidence/width-820-mock.png`, `evidence/width-390-mock.png`, `evidence/width-320-mock.png` and `evidence/keyboard-focus.png`. Values in these screenshots are **mock data**, not the live round. The final production app contains no demonstration balances or fixture wallet.

## Completion and remaining limits

**Implementation and validation complete; Git commit blocked by the environment.** `git add web dist docs` failed with `Unable to create .git/index.lock: Read-only file system`. The worker could not stage or commit, and did not bypass the read-only Git boundary. All requested source, lockfile, static export, manifest, design record and evidence files remain in the allowed workspace paths for the submission service to capture. The root design-document path conflict is resolved by delivering `docs/DESIGN.md`. No protected-file changes or submodule are introduced. Dependency/cache directories are ignored and must remain outside the submission.

Remaining unperformed checks: real wallet extension/mobile wallet behavior, funded transaction execution and replacement/cancellation, real-chain claim races, browser-direct public-RPC CORS/reliability across all endpoints, Firefox/Safari, assistive-technology sessions, native 200% browser zoom, physical devices and later publication checks. Read-only `curl` success does not prove browser networking on every host. Public reads use three configured endpoints; there is no wallet-RPC fallback. Source review verifies receipt failure/timeout handling, but those receipt outcomes were not browser-mocked in this suite. Mainnet use is not supported.
