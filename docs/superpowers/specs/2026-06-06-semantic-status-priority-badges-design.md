# LUM-263 — Semantic atomic components: StatusBadge / PriorityBadge

**Date:** 2026-06-06
**Milestone:** Design System Rework (统一颜色模型、补齐语义 token、沉淀原子组件、收敛 raw 颜色)
**Depends on (done):** LUM-257 oklch color model · LUM-258 feedback tokens · LUM-259 status-\* tokens

## Problem

`badge.tsx` / `button.tsx` are still stock shadcn variants with no product-level
semantic variants. Every page hand-rolls its own status / priority labels from raw
palette classes (`bg-green-*`, `text-red-500`, `text-zinc-400`, …), which is a direct
source of the milestone's 1896 token-lint violations.

Current state from the inventory:

- **status tokens exist** — `--status-{todo,in-progress,in-review,done}` in `globals.css`
  (oklch, with `.dark` overrides), plus `.text-status-*` utilities. `StatusIcon` is the
  canonical consumer.
- **feedback tokens exist** — `--{info,warning,success,danger}` + `-foreground/-subtle/-border`.
- **NO priority tokens** — priority colors are hardcoded Tailwind (`text-red-500` /
  `orange-500` / `yellow-500` / `zinc-400`) in `PRIORITY_CONFIG`.
- **`PriorityBadge` exists but is icon-only** (battery icon + tooltip); no `StatusBadge`.
- **Scattered shapes** — icon-only, dot+count, plain text, icon+label.
- Labels are hardcoded EN maps (`API_STATUS_LABEL`, `PRIORITY_CONFIG.label`); CLAUDE.md
  requires react-intl across all 16 locales.

## Goal / Acceptance

Land cva-based semantic `StatusBadge` / `PriorityBadge` that reference status / priority
tokens, migrate the core list/detail surfaces to them, and delete the corresponding raw
palette assembly.

## Design

### 1. Token layer — new `--priority-*`

In `app/globals.css`, mirroring the `--status-*` pattern:

- `:root`: `--priority-urgent`, `--priority-high`, `--priority-medium`, `--priority-low`
  (oklch, matching the current red/orange/yellow/grey feel but holding ≥3:1 contrast).
- `.dark`: brighten the low-chroma `low`/`medium` for dark backgrounds (same approach as
  `--status-done`'s dark override).
- `@theme`: register `.text-priority-*` utilities.
- **Guard constraints** (from prior incidents): no `{}` or the literal `@theme inline`
  inside CSS comments; run the **full** `__tests__/styles/` set after any `globals.css`
  edit. Extend the color-tokens guard test to assert `--priority-*` are present
  (oklch-aware regex).

### 2. Component layer

Location: `app/workspace/[workspaceUrl]/components/` — alongside `StatusIcon` and the
existing `PriorityBadge` (domain components, not generic `components/ui`).

- **Shared cva** for the container (gap / `text-caption` / alignment), keyed by `variant`.
- **`StatusBadge`** — props `status` + optional `label?` + `variant`. Internally reuses
  `StatusIcon` (no duplicate icon).
- **`PriorityBadge`** — evolve the existing one in place. Props `priority` + optional
  `label?` + `variant`. Reuses `PRIORITY_CONFIG`'s battery icons; color switches to
  `text-priority-*` tokens.

**Variant set (YAGNI-trimmed):** implement **`icon`** (icon + label) and **`bare`**
(icon only) only.

- `bare` preserves `PriorityBadge`'s current icon-only + tooltip behavior in
  `SortableTaskCard`.
- `StatusBadge` has no `bare` — for a bare icon, use `StatusIcon` directly.
- The cva is structured so `dot` / `pill` are pure additions later (OCP). They are
  deferred because no in-scope consumer needs them (dot's only consumer, ProjectsPage,
  is out of scope; pill has no consumer). When added: status `pill` background must use
  `color-mix(in srgb, var(--status-*) 12%, transparent)` — never `hsl(var())` — because
  status tokens have no `-subtle`/`-foreground` companions.

### 3. i18n layer

- New flat keys: `task.status.{todo,inProgress,inReview,done}`,
  `task.priority.{urgent,high,medium,low}`.
- Components resolve labels via `useIntl`; `label?` prop is an override.
- Backfill **real** translations across all 16 locales (no `[TODO:…]` placeholders before
  shipping). `npm run i18n:sync` to scaffold, then replace placeholders; pass
  `i18n-locale-parity`.

### 4. Migration (first-tier, 5 sites)

1. `data-table/task-columns.tsx` status read-only cell → `<StatusBadge variant="icon">`
2. `data-table/task-columns.tsx` priority read-only cell → `<PriorityBadge variant="icon">`
3. `SortableTaskCard.tsx` → `<PriorityBadge variant="bare">` (behavior unchanged)
4. `RichReportContent.tsx` priority assembly → `<PriorityBadge variant="icon">`
5. `SprintSidebar.tsx` priority breakdown → `<PriorityBadge variant="icon">`

Delete the replaced raw palette assembly; replace the hardcoded `PRIORITY_CONFIG.iconColor`
red/orange/yellow/zinc with `text-priority-*` tokens. `PrioritySelect` / `AiPrioritySelect`
still consume `PRIORITY_CONFIG`; their icon colors get token-ised as a side benefit (not a
migration target).

### 5. Testing & guards

- jsdom render tests for `StatusBadge` / `PriorityBadge` (each variant; assert i18n label
  text).
- Full `__tests__/styles/` set + color-tokens guard extended to cover `--priority-*`.
- `tsc --noEmit`, `lint:tokens` (confirm violations drop, none added), `i18n:check`.

### Out of scope

Sprint state badge & `AgentStatusBadge` (different enums), ProjectsPage status-count
indicator, BoardView column header (already token-ised via `StatusIcon`),
`dot`/`pill` variants, generic `badge.tsx`/`button.tsx` refactor.
