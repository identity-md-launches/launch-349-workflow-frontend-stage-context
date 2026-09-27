# Last Buyer design

## Overview

Last Buyer is a small Sepolia experiment for people buying LBUY or settling the last-buyer round. The implemented direction is a quiet, cream page with a dark jackpot panel, a light purchase form and a single lime primary action. A large serif heading introduces the waiting game; the pot and clock carry the strongest numeric hierarchy. This is an inferred direction for a new page, not a separately approved brand system.

The source of truth is `web/src/style.css`; page patterns are in `web/src/App.tsx`. The production export is `dist/`. This document lives under `docs/` to honor the assignment's overriding write scope, which prohibits the requested root `DESIGN.md`.

## Colors

All values use sRGB hex. Primitive neutral/lime/green/red variables feed semantic roles at the top of `style.css`. There is one light theme and a deliberately dark jackpot surface, not an alternate dark theme.

| Semantic token | Value | Use |
| --- | --- | --- |
| `--bg` | `#f6f5ef` | Page background and amount field |
| `--surface` | `#fffefb` | Form and neutral controls |
| `--subtle` | `#efeee6` | Testnet strip, selected preset, notices |
| `--text` / `--panel` | `#222b22` | Main text / jackpot background |
| `--muted` | `#65705f` | Secondary text |
| `--border` | `#c8ccc1` | Structural dividers and secondary controls |
| `--accent` / `--accent-hover` | `#dbf29a` / `#c9e77b` | Primary action fill |
| `--positive` | `#476441` | Live-state dot, accompanied by text |
| `--on-panel` | `#f6f5ef` | Main jackpot-panel text |
| `--on-panel-muted` | `#c5cdbd` | Secondary jackpot-panel text and timer track fill |
| `--panel-line` / `--panel-button` | `#4b5847` / `#35432f` | Dark-panel separators and claim control |
| `--focus` | `#4a6925` | Light-surface keyboard outline |
| `--error` / `--error-bg` | `#9a3029` / `#fff0ed` | Errors, with readable recovery text |

Dark-panel controls use the lime accent for focus, ensuring an outline visible against the panel. Input borders use the darker muted color to remain distinct. Computed opaque foreground/background pairs and measured contrast ratios are recorded in `docs/evidence/browser.json`; that evidence is not a claim about every possible state.

## Typography

No fonts are downloaded. `--body` requests Arial, Helvetica, sans-serif; `--display` requests Georgia, Times New Roman, serif; `--mono` requests SFMono-Regular, Consolas, Liberation Mono, monospace. Actual installed system fallback faces vary by device. `font-synthesis: none` avoids synthetic faces; body weights are 400/600 with some 500 roles mapped by available system fonts. No custom font files or verified variable axes exist.

`--small` is 0.8125rem; `--label` 0.875rem; `--base` 1rem; `--section` 1.5rem. The hero is `clamp(2.75rem,4.6vw,4rem)` at wide widths, 3.25rem below 780px, 2.75rem below 560px; line-height 1.04 and tracking −0.05em. The rules heading is 32px serif. Panel headings are 18px; supporting section heading is 20px; rule titles are 1rem. Semantic heading levels follow page outline rather than metric sizes.

Body line-height is 1.5; descriptions use 1.6–1.65. Headings balance wrapping; prose uses `text-wrap: pretty`. Longer explanations are capped at 60–75ch. Eyebrows are 10–11px uppercase with 0.12em tracking. Captions use 11–13px, while all editable text is at least 16px. The amount input is 30px.

Jackpot values use tabular numerals and responsive sizing. The countdown uses monospace, tabular numerals and `font-size: min(4.1rem,19cqw)` inside an inline-size container. That cap lets enlarged text fit without clipping the clock. Exact contract addresses, hashes and dates wrap in the deployment disclosure; shortened leader links expose the full value in their accessible name and explorer destination.

## Layout

`.shell` limits content to 1160px with 48px margins; margins become 32px below 980px, 20px below 780px and 16px below 560px. The header wraps at small widths. The testnet strip stays at the top of normal flow; there is no sticky transaction bar.

The game grid is 1.23fr / 1fr with a 24px gap, shifting to 1.1fr / 1fr and 18px gap below 980px, then stacking jackpot before form at 780px. Panels have 32px padding, reducing to 24px and finally 24px vertically / 20px horizontally. The rules are three columns with 36px gaps, then one column below 560px. Related form controls use 8–12px gaps; content groups use 22–35px separation. Large sections use 44–62px spacing.

The decorative stamp disappears below 560px. The network name remains visible in the live-state text and footer when the compact header hides its redundant badge. Event rows and footer wrap; no primary control is fixed to the viewport. Logical inline/block properties are used for layout directions. English is the supported language; RTL is not a claimed localization.

Browser checks cover 1440, 980, 820, 780, 390 and 320 CSS-pixel widths, with no horizontal overflow. The final 200% text enlargement check at 390px also passes. This is distinct from native browser 200% zoom, which was not performed.

## Elevation & Depth

The interface is flat: tonal surfaces and structural borders provide grouping. No shadows, modals, overlays or gradients are used. The skip link alone has an elevated stacking level and becomes visible on keyboard focus.

## Shapes

Panels use 20px corners, reduced to 16px on small screens. Buttons use 8px, amount fields 10px, slippage fields 7px, round tags 6px. The leader marker and decorative stamp are circles. Structural borders are 1px; keyboard outlines are 3px with a 4px offset.

## Components

These are patterns within `App`, not a standalone exported component library:

| Pattern / class | Behavior |
| --- | --- |
| `.site-header`, `.wallet-area` | Connect, address and disconnect; wrapping at narrow widths; visible network-switch notice when needed |
| `.jackpot-panel` | Pot, one-based display round, countdown, leader and secondary claim action |
| `.buy-panel` | ETH amount, three preset buttons, slippage, quote summary, primary buy action and wallet token balance |
| `.primary`, `.secondary`, `.claim-button` | One lime primary action: Get quote before a quote, Buy after one; unavailable prerequisites use native `disabled` |
| `.amount-field`, `.slippage-field` | Native labeled inputs, decimal input mode, field-specific errors and invalid-field focus |
| `.notice`, `.inline-error`, `.transaction-status` | Persistent recovery information; status uses a polite live region and errors use alert semantics |
| `.event-list`, `.activity-empty` | Bounded recent events, explorer links and distinct loading/empty/unavailable copy |
| `.deployment-details` | Native `details` / `summary` with full pool/contract/provenance data |

All actions use buttons, navigation uses anchors and the first keyboard stop is a skip link. Buttons aim for 44px minimum height (primary actions 48px); the compact refresh control is 36px. Browser focus evidence is saved in `docs/evidence/keyboard-focus.png`. A screen-reader session was not performed.

Interaction transitions are restricted to button background/transform, 150ms with `cubic-bezier(0.2,0,0,1)`. Press scale is 0.96. They apply only under `prefers-reduced-motion: no-preference`; reduced motion removes them entirely. There is no entrance animation or flashing countdown.

## Do's and Don'ts

- Start a new section with `.shell`, existing semantic colors and the current type families. Keep labels in sentence case and give recovery instructions where an action fails.
- Reserve the lime fill for the next primary action. Use dark-panel focus colors only on dark surfaces.
- Preserve normal reading order and wrap long values. Use tabular numbers for changing values and a container cap for large timers.
- Keep real data distinguishable from loading, stale and empty states. Never insert example balances in the shipped UI.
- Preserve deployment loading and transaction gates. Do not create another address map or convert an implementation callback into a wallet control.
- For another static page, reuse the header, `.shell` and footer patterns and export the actual HTML path; do not add a route requiring server rewrites.

Design guidance applied from Jakub Krehel's **Better Interface** (MIT), pinned commit `267330e1adfc66a718fb65fa6918c1f06d0a689e`. Documentation method adapted from Paul Bakaus's **Impeccable** (Apache-2.0), pinned commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`. Sources: <https://github.com/jakubkrehel/skills/tree/267330e1adfc66a718fb65fa6918c1f06d0a689e/skills/better-interface> and <https://github.com/pbakaus/impeccable/blob/9d715cc4f5564a990ca8345abfdd5df6dc9b41c8/skill/reference/document.md>. The upstream guides were supplied as read-only reference material and are not redistributed here.
