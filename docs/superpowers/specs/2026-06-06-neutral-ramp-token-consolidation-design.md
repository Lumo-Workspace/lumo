# Neutral ramp token consolidation — design

**Date:** 2026-06-06
**Status:** Draft (awaiting review)
**Task:** [LUM-294](https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-294) — branch `lumo/LUM-294-neutral-ramp-tokens` off fresh `origin/main`.

## Goal

Collapse the app's neutral (grayscale) color tokens into a single **primitive
neutral ramp** seed, and rewrite every neutral semantic token as a derivation
(`var(--gray-N)`) of that ramp. After this change, retuning the entire neutral
character of the app — overall lightness, surface separation, the cool/warm
cast — means editing ~13 ramp seeds, not ~20 scattered, independently-authored
`oklch()` literals across two mode blocks.

This is a **two-tier design-token** restructuring (primitives → semantic
aliases), the standard pattern used by Radix / GitHub Primer.

### Explicitly out of scope (YAGNI)

- **Chromatic semantic colors** (`status-*`, `priority-*`, `info/warning/success/danger`,
  `chart-*`, `hljs-*`) stay exactly as they are. They are hand-tuned per mode to
  clear WCAG 3:1 / 4.5:1 thresholds and are guarded by `feedback-contrast.test.ts`;
  forcing them through a single brand seed would risk those guards for no real
  maintenance win. They remain genuinely "necessary" distinct values.
- **Fonts.** Already a clean 2-seed system: `--font-inter` (sans) + `--font-source-code-pro`
  (mono), exposed via `--font-sans` / `--font-mono`, with the LUM-260 typography
  scale (`text-caption … text-display`) deriving size/line-height/weight/letter-spacing.
  Nothing to consolidate. Documented here as the "font core" for completeness only.
- **`landing.css`** tokens — a separately-governed fork (LUM-288). Not touched.
- **Focus ring** (`--focus-ring` → `--ring` / `--sidebar-ring`) — already a
  single-source seed (LUM-262). Left as-is; it joins the "seed layer" conceptually.

## The two tiers

### Tier 1 — Primitive neutral ramp (NEW)

A single mode-independent grayscale ramp, defined once in `:root`, **no `.dark`
override** (primitives are raw values, identical in both schemes — the _semantic_
layer is what remaps per mode). One cool neutral hue (255) with a gentle chroma
taper (0 at the extremes, ~0.02–0.03 mid-tones) so surfaces read as a coherent,
very slightly cool gray rather than the current slate/zinc/pure-neutral mix.

| Step        | oklch (proposed, tuned at impl) | ≈hex    | Primary consumers                                                           |
| ----------- | ------------------------------- | ------- | --------------------------------------------------------------------------- |
| `--gray-0`  | `oklch(1 0 0)`                  | #ffffff | light bg/card/popover/input; light/dark \*-foreground (white side)          |
| `--gray-1`  | `oklch(0.984 0.004 255)`        | #f7f8fb | light secondary, sidebar                                                    |
| `--gray-2`  | `oklch(0.967 0.006 255)`        | #eff1f5 | light muted, accent, sidebar-accent; dark accent-foreground                 |
| `--gray-3`  | `oklch(0.928 0.010 255)`        | #e1e5ec | light border, sidebar-border                                                |
| `--gray-4`  | `oklch(0.845 0.013 255)`        | #c9cfd9 | headroom (hairline/disabled)                                                |
| `--gray-5`  | `oklch(0.705 0.020 255)`        | #98a1b0 | headroom                                                                    |
| `--gray-6`  | `oklch(0.627 0.022 255)`        | #7e8796 | dark muted-foreground                                                       |
| `--gray-7`  | `oklch(0.554 0.030 255)`        | #67707f | light muted-foreground                                                      |
| `--gray-8`  | `oklch(0.370 0.018 255)`        | #414751 | headroom                                                                    |
| `--gray-9`  | `oklch(0.283 0.010 255)`        | #2a2d32 | dark accent, border, sidebar-border                                         |
| `--gray-10` | `oklch(0.218 0.006 255)`        | #1c1e22 | light foreground/primary; dark popover/secondary/muted/input/sidebar-accent |
| `--gray-11` | `oklch(0.172 0.004 255)`        | #141519 | dark card, sidebar                                                          |
| `--gray-12` | `oklch(0.145 0.002 255)`        | #0c0d10 | dark background; dark primary-foreground                                    |

`--gray-4 / -5 / -8` are intentional, currently-unconsumed headroom steps that
keep the ramp perceptually even — standard for a 13-step scale. Exact oklch
values are finalized during implementation against the contrast checks below.

### Tier 2 — Semantic neutral aliases (REWRITTEN)

Each existing neutral token becomes a `var(--gray-N)` reference, with `:root`
picking a light-end step and `.dark` picking a dark-end step. (This naturally
satisfies the `:root ↔ .dark` parity guard — each has a real per-mode override.)

| Semantic token                 | `:root` (light) | `.dark`     |
| ------------------------------ | --------------- | ----------- |
| `--background`                 | `--gray-0`      | `--gray-12` |
| `--foreground`                 | `--gray-10`     | `--gray-0`  |
| `--card`                       | `--gray-0`      | `--gray-11` |
| `--card-foreground`            | `--gray-10`     | `--gray-0`  |
| `--popover`                    | `--gray-0`      | `--gray-10` |
| `--popover-foreground`         | `--gray-10`     | `--gray-0`  |
| `--primary`                    | `--gray-10`     | `--gray-0`  |
| `--primary-foreground`         | `--gray-0`      | `--gray-12` |
| `--secondary`                  | `--gray-1`      | `--gray-10` |
| `--secondary-foreground`       | `--gray-10`     | `--gray-0`  |
| `--muted`                      | `--gray-2`      | `--gray-10` |
| `--muted-foreground`           | `--gray-7`      | `--gray-6`  |
| `--accent`                     | `--gray-2`      | `--gray-9`  |
| `--accent-foreground`          | `--gray-10`     | `--gray-2`  |
| `--border`                     | `--gray-3`      | `--gray-9`  |
| `--input`                      | `--gray-0`      | `--gray-10` |
| `--sidebar`                    | `--gray-1`      | `--gray-11` |
| `--sidebar-foreground`         | `--gray-10`     | `--gray-0`  |
| `--sidebar-primary`            | `--gray-10`     | `--gray-0`  |
| `--sidebar-primary-foreground` | `--gray-0`      | `--gray-12` |
| `--sidebar-accent`             | `--gray-2`      | `--gray-10` |
| `--sidebar-accent-foreground`  | `--gray-10`     | `--gray-0`  |
| `--sidebar-border`             | `--gray-3`      | `--gray-9`  |

`--destructive` / `--destructive-foreground` are **red**, not neutral — they stay
as their own oklch literals (out of scope, like the other chromatic tokens).

## Accepted visual change (per decision: "clean uniform ramp")

Snapping to one uniform ramp deliberately drops the current incidental
slate-vs-zinc-vs-pure-neutral tint mix. Most shifts are sub-perceptual. The
notable ones to expect and accept:

- **Secondary text** (`muted-foreground`, light) goes from slate `#64748b`
  (chroma ~0.04) to a grayer `--gray-7` (chroma ~0.03) — the single most visible
  shift. Lightness held at ~0.55 so contrast on white stays ~4.6:1.
- Several near-duplicate dark surfaces collapse onto shared steps (e.g. dark
  `popover`/`secondary`/`muted`/`input` were all `#1a1a1a` already → `--gray-10`;
  dark `card` `#111` and `sidebar` `#0f0f0f` → `--gray-11`). Surface separation
  (bg `--gray-12` < card `--gray-11` < popover `--gray-10`) is preserved.
- Body text picks up a barely-perceptible cool cast (`--gray-10` carries chroma
  0.006 vs the old pure-neutral `#1a1a1a`).

## Guard tests — required updates

Both are intentional contract updates, not regressions:

1. **`__tests__/styles/globals-css-color-tokens.test.ts`** — currently asserts
   _every_ `COLOR_TOKENS` entry (incl. all neutrals) is a literal `oklch(...)`.
   Split the contract:
   - **Neutral subset** (background, foreground, card(-foreground), popover(-foreground),
     primary(-foreground), secondary(-foreground), muted(-foreground),
     accent(-foreground), border, input, sidebar\*) → assert each definition is
     `var(--gray-N)`, **not** an oklch literal.
   - **Chromatic subset** (destructive*, status-*, info/warning/success/danger*,
     priority-*) → keep the existing "is `oklch(`, no hex" assertion.
   - **New:** assert the ramp steps `--gray-0 … --gray-12` are each defined once
     as a literal `oklch(...)` (no `.dark` override).

2. **`__tests__/styles/token-parity.test.ts`** — add `gray-0 … gray-12` to
   `SINGLE_SOURCE_ALLOWLIST`, reason: _"primitive neutral ramp step,
   mode-independent raw value (LUM-294)"_. The semantic neutral aliases need no
   allowlisting — they keep real `.dark` overrides. The `no orphan dark-only
tokens` and allowlist-hygiene assertions continue to pass (ramp steps exist in
   `:root`, absent from `.dark`).

## Verification checklist (implementation)

- [ ] `npm test -- __tests__/styles` green (parity, color-tokens, contrast,
      typography, status, chart, hljs, motion, control-size, z-index,
      reduced-motion, **design-system-catalog-parity**).
- [ ] Manually recompute WCAG: `muted-foreground` vs `background` ≥ 4.5:1 (both
      modes); `border` vs adjacent surface still visible; foreground vs background
      ≥ ~16:1 (unchanged).
- [ ] `npm run lint:tokens` clean (no new raw-color offenders; ramp lives in
      globals.css source, which is the sanctioned token home).
- [ ] `npx tsc --noEmit` clean.
- [ ] `/design-system` catalog renders the new ramp if it enumerates neutrals;
      update the catalog + its parity test if so.
- [ ] `npm run build` (the only CI gate is the Vercel build).

## Files touched

- `app/globals.css` — add Tier-1 ramp in `:root`; rewrite ~22 neutral semantic
  tokens in `:root` + `.dark` as `var(--gray-N)`. (No `@theme inline` change —
  the `--color-*` registrations already point at the semantic tokens.)
- `__tests__/styles/globals-css-color-tokens.test.ts` — split contract (above).
- `__tests__/styles/token-parity.test.ts` — allowlist ramp steps.
- `app/(...)/design-system/*` + `design-system-catalog-parity.test.ts` — only if
  the catalog enumerates neutral tokens (verify during impl).

## Rollback

Single-file revert of `app/globals.css` (plus the two test files) restores the
prior token literals; no data, schema, or API surface involved.
