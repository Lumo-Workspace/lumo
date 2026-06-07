# Design System Catalog — Design (LUM-291)

**Task**: 搭建组件可视化目录（Storybook 或轻量 catalog）
**Milestone**: Design System Rework
**Date**: 2026-06-06

## Problem

There is no Storybook and no `.stories` files. `docs/design-system.md` (20KB) is
text-only — tokens and component variants cannot be visually reviewed. Newcomers
have nothing to compare against, and variant regressions are caught by eye. The
milestone ("Design System Rework") needs a runnable surface where every token
and component variant can be seen at a glance, in both light and dark mode.

## Decisions (locked during brainstorming)

1. **Carrier**: a lightweight in-`/app` preview route — **not** Storybook. Zero
   new runtime deps (Storybook is flagged by CLAUDE.md Forbidden), reuses the
   exact `globals.css` / Tailwind v4 pipeline so tokens render identically, no
   Next 16 / Turbopack vs Storybook-builder compatibility risk.
2. **Location & gating**: top-level `app/design-system/`, **dev-only** —
   `notFound()` in production. No auth, no workspace data required.
3. **CI visual regression**: out of scope this round (acceptance says
   "optional"). A separate task can add Chromatic/Playwright screenshot diff.
4. **Token-parity guard**: **in scope** — a `__tests__/styles/` guard asserts
   every `--color-*` token in `globals.css` is enumerated in the catalog data,
   matching this repo's existing token-guard culture.
5. **Scope correction**: the task names `StatusBadge` / `PriorityBadge` /
   `Callout`, but these are **not** standalone reusable UI components today
   (`Callout` is a tiptap editor node; `StatusIcon` does not exist; status /
   priority are rendered ad-hoc). The catalog covers the components that
   actually exist and renders status/priority as **token swatches**, rather
   than fabricating new components.

## Components & tokens that actually exist (verified)

- `components/ui/button.tsx` — `Button`, 6 variants (default/destructive/
  outline/secondary/ghost/link) × 4 sizes (default/sm/lg/icon).
- `components/ui/badge.tsx` — `Badge`, 4 variants (default/secondary/
  destructive/outline).
- `components/ui/input.tsx` — `Input` (+ `Label`, `Textarea` adjacent).
- `components/ui/typography.tsx` — `TypographyH1`…`H6`, `P`, `Lead`, `Large`,
  `Small`, `Muted`, `Blockquote`, `InlineCode`, etc.
- `components/task/agent/AgentStatusBadge.tsx` — the one real status component.
- `app/globals.css` token groups: core palette, `--status-*`, `--priority-*`,
  feedback (`info/warning/success/danger` each with `-subtle/-border/
  -foreground`), `sidebar-*`, radius (sm/md/lg/xl), `shadow-elevation-1/2/3`,
  `ease-standard/-emphasized`, `animate-appear*`, `control-*` spacing.
- Dark mode: `next-themes`; root `app/layout.tsx` already wraps all pages in
  `<Providers>` (ThemeProvider) → `/design-system` inherits it for free.

## Architecture

### Route

`app/design-system/page.tsx` — server component:

```
if (process.env.NODE_ENV === 'production') notFound()
return <DesignSystemCatalog />
```

No auth, no data fetching. Inherits the root `Providers`/ThemeProvider.

### File organization (SRP, small focused files)

```
components/design-system/            # only imported by the dev route
  DesignSystemCatalog.tsx            # 'use client': sticky section nav + theme toggle
  data/tokens.ts                     # plain data: token name → group/label (single enumeration)
  primitives/Section.tsx             # titled section with anchor id
  primitives/Swatch.tsx              # color chip: name + utility class + (optional) computed value
  primitives/VariantGrid.tsx         # labeled grid of variants
  sections/ColorTokens.tsx           # core palette / status / priority / feedback / sidebar
  sections/TypographyScale.tsx       # text tiers + Typography* components
  sections/Elevation.tsx             # shadow-elevation-1/2/3 + radius tiers
  sections/Motion.tsx                # ease / animate-appear* demos
  sections/Spacing.tsx               # control sizes (h-control-*/px-control-inset-*) + container
  sections/Buttons.tsx               # Button 6 variants × 4 sizes + disabled
  sections/Badges.tsx                # Badge 4 variants
  sections/Inputs.tsx                # Input default/disabled/aria-invalid + Label/Textarea
  sections/StatusAndPriority.tsx     # AgentStatusBadge real states + status/priority token chips
```

### Data flow

- Static data arrays in `data/tokens.ts` → section components map them to
  swatches / specimens.
- Theme toggle = `next-themes` `useTheme()` client state (reuse the existing
  `components/landing/ui/mode-toggle.tsx` pattern).
- `Swatch` may resolve the actual computed oklch value via
  `getComputedStyle` **inside `useEffect`** (never during render — honors the
  React Purity rules in CLAUDE.md).

### Theme toggle

A light/dark switch at the top so every token and component can be reviewed in
both modes without leaving the page.

## Testing

- **Render test (required)**: render `<DesignSystemCatalog />` in jsdom; assert
  the key section headings are present and a `Button` / `Badge` renders without
  throwing — proves the route is runnable (acceptance: "可运行的组件目录").
- **Token-parity guard (required, in `__tests__/styles/`)**: parse
  `globals.css` for `--color-*` tokens and assert each appears in
  `data/tokens.ts`, so the catalog cannot silently drift from the source of
  truth. (Mirrors the existing `__tests__/styles/` guard suite — keep
  `globals.css` comments free of `{}` / `@theme inline` sentinels per the known
  parser fragility.)

## Constraints & compliance

- **No new npm dependencies.** PR description must state: dev-only route,
  `notFound()` in production.
- TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
  are on) — run `tsc --noEmit` before claiming done.
- Run jest from **inside** the worktree (haste-collision gotcha).
- Use semantic tokens only in the catalog chrome (no raw zinc/hex) so it passes
  `lint:tokens`.

## Out of scope

- CI visual regression (Chromatic / Playwright screenshot diff) — separate task.
- Creating new `StatusBadge` / `PriorityBadge` / `Callout` UI components.
- Any change to existing component source.
```
