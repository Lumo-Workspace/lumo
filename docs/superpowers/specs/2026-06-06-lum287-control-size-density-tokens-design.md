# LUM-287 — Control size / density tier tokens

**Task:** LUM-287 「建立 spacing / sizing 密度档位 token」
**Milestone:** Design System Rework
**Date:** 2026-06-06
**Branch:** `lumo/LUM-287-spacing-sizing-density-tokens`

## Problem

The codebase has only two spacing tokens (`--spacing-container`, `--spacing-container-lg`).
Control heights are hardcoded everywhere (`h-8` / `h-9` / `h-10`) and inline padding is
literal (`px-3` / `px-4` / `px-8`). There is no semantic source for control sizing or
density, so "make the UI denser" or "bump control height" cannot be done in one place.

Current atomic-component sizing (the source of truth we are extracting from):

| Component | Height | Inline padding | Notes |
|---|---|---|---|
| Button `default` | `h-9` (36px) | `px-4` (16px) | also vestigial `py-2` |
| Button `sm` | `h-8` (32px) | `px-3` (12px) | bundles `text-xs` |
| Button `lg` | `h-10` (40px) | `px-8` (32px) | |
| Button `icon` | `h-9 w-9` | — | square |
| Input | `h-9` (36px) | `px-3` (12px) | height md, padding sm (mismatch) |
| Badge | none (content) | `px-2.5` (10px) | pill, `py-0.5`, `text-xs` |

Usage scope (not migrated this PR): `h-8`/`h-9`/`h-10` appear across 20/13/9 files;
Button has 121 `size='sm'`, 25 `size='icon'`, 4 `size='lg'` call sites.

## Goals / acceptance

- Atomic controls draw their height + inline padding from a **single semantic source**.
- Density is **adjustable in one place** (edit the token, every control follows).
- Established precedent followed: this mirrors the LUM-260 typography scale
  (`@theme` tokens + `docs/design-system/*.md` + `__tests__/styles/*` guard).

## Scope (decided)

**In:** define the tokens, wire `button` / `input` / `badge`, add a doc + guard test +
component render tests.

**Out:** sweeping the 20+ files that hardcode `h-8/9/10` and the 121 `size='sm'` call
sites. Those keep working unchanged; converging them is follow-up work.

## Design

### 1. Tokens (added to the `@theme inline` block in `app/globals.css`)

Two **independent** token groups — height and inline-padding are separate axes because
the real data is misaligned (Input is height-md but padding-sm). Both live in the
Tailwind v4 `--spacing-*` namespace, so each emits standard spacing utilities.

**Height tiers** — 1:1 extraction of current values, zero visual change:

| Token | Value | = current | Emits |
|---|---|---|---|
| `--spacing-control-sm` | `2rem` | `h-8` / 32px | `h-control-sm` |
| `--spacing-control-md` | `2.25rem` | `h-9` / 36px | `h-control-md`, `w-control-md` |
| `--spacing-control-lg` | `2.5rem` | `h-10` / 40px | `h-control-lg` |

**Inline-padding tiers:**

| Token | Value | = current | Emits |
|---|---|---|---|
| `--spacing-control-inset-sm` | `0.75rem` | `px-3` / 12px | `px-control-inset-sm` |
| `--spacing-control-inset-md` | `1rem` | `px-4` / 16px | `px-control-inset-md` |
| `--spacing-control-inset-lg` | `2rem` | `px-8` / 32px | `px-control-inset-lg` |

**Naming rationale:** height tiers stay clean (`control-{tier}` → `h-control-md`).
Padding tiers carry an `inset` qualifier so the utility reads `px-control-inset-md`
rather than the doubled-up `px-control-px-md` a `*-px-*` token name would produce.

**Axes deliberately NOT tokenized** (kept as literals, with reason):
- `gap-2` (icon↔label gap) — uniform across sizes, not a density tier.
- `text-xs` / `text-sm` — owned by the typography scale (LUM-260), orthogonal to density.
- `py-*` (button `py-2`, input `py-1`, badge `py-0.5`) — vertical padding; height tiers
  already fix the box height, so these stay per-component constants.

### 2. Component wiring

Zero visual change everywhere **except badge** (the one accepted change).

**Button** (`components/ui/button.tsx`, `size` variants):
- `default`: `h-9 px-4 py-2` → `h-control-md px-control-inset-md py-2`
- `sm`: `h-8 rounded-md px-3 text-xs` → `h-control-sm rounded-md px-control-inset-sm text-xs`
- `lg`: `h-10 rounded-md px-8` → `h-control-lg rounded-md px-control-inset-lg`
- `icon`: `h-9 w-9` → `h-control-md w-control-md`

**Input** (`components/ui/input.tsx`): `h-9 … px-3` → `h-control-md … px-control-inset-sm`.

**Badge** (`components/ui/badge.tsx`): `px-2.5` → `px-control-inset-sm`
(+2px per side, the sole visual change); `py-0.5` retained.

### 3. Documentation + guard

- `docs/design-system/control-size-scale.md` — mirrors `typography-scale.md`: tier table,
  current→token mapping, and guidance for future call-site convergence.
- `__tests__/styles/control-size-tokens.test.ts` — mirrors
  `typography-scale-tokens.test.ts`: asserts every `--spacing-control-{sm,md,lg}` and
  `--spacing-control-inset-{sm,md,lg}` is declared with a `rem` value, guarding against a
  tier being dropped or renamed.
- A `button` / `badge` render test asserting the new utility classes appear in the emitted
  `className`, locking the wiring.

## Verification

- `npx tsc --noEmit` clean (run from inside the worktree).
- `npm test` for the new guard + render tests, plus existing `__tests__/styles/` suite
  (globals.css edits must not break the text-parsing guards — keep comments free of `{}`
  and the `@theme inline` sentinel per the known globals.css guard fragility).
- `npm run lint:tokens` — the new utilities are spacing, not color, so no baseline change
  is expected.

## Out of scope / follow-up

- Converging the 20+ files' raw `h-8/9/10` and Button `size='sm'` call sites onto the
  density system.
- Any `gap` / vertical-padding density tiers (only add if a real need appears).
