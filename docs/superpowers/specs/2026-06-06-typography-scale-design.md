# Typography Scale & Semantic Tier System — Design [LUM-260]

**Milestone:** Design System Rework
**Date:** 2026-06-06
**Status:** Approved

## Problem

The app has no typographic hierarchy system. Audit of `app/` + `components/` (excl.
worktrees/node_modules):

| Dimension | Distribution |
| --------- | ------------ |
| Font size | `text-xs` 423 · `text-sm` 343 · all larger sizes (lg/xl/2xl/3xl/4xl/5xl) ~88 combined, mostly landing |
| Font weight | `font-medium` 228 · `font-semibold` 138 · `font-bold` 23 |
| `Typography*` components | used in only 4 business files |

App UI effectively lives in a tiny `xs/sm` × `medium/semibold` box, and every hierarchy
relationship is hand-assembled per call site (`text-sm font-medium text-foreground` here,
`text-xs text-muted-foreground` there). The existing `components/ui/typography.tsx` is the
stock shadcn marketing set (`TypographyH1` = `text-4xl font-extrabold`) — wrong altitude for
app-dense UI, which is why business code ignores it.

## Goal

Define a small set of **semantic typography tiers** carried as Tailwind v4 composite
utilities, document them, migrate the highest-frequency core pages onto them, and route the
existing `Typography*` components through the same tokens so the component family finally has
a reason to exist.

## Decisions (locked during brainstorming)

1. **Mechanism: `@theme text-*` tokens as primary.** Lowest-friction path — the 766
   `text-xs`/`text-sm` call sites can be migrated by mechanical class swap, dense UI (table
   cells, list rows) needs no JSX restructuring, and it matches the existing `@theme inline`
   color-token system in `app/globals.css`.
2. **Granularity: semantic composite utility.** Each tier bundles font-size + font-weight +
   line-height + letter-spacing in one class via Tailwind v4 `@utility`. One class pins the
   whole hierarchy relationship — directly serves the "consistent hierarchy, no more
   hand-rolling" acceptance criterion. **Color stays orthogonal** (applied separately as
   `text-muted-foreground` / `text-foreground` etc.) because color is contextual — a 12px
   bold badge is not muted, a 12px timestamp is.

## The Scale

Six semantic tiers. Color is NOT part of any tier.

| Utility            | size  | weight        | line-height | letter-spacing | Use                                                            |
| ------------------ | ----- | ------------- | ----------- | -------------- | ------------------------------------------------------------- |
| `text-caption`     | 12px  | medium (500)  | 1.4         | normal         | metadata, timestamps, labels, secondary table columns         |
| `text-body`        | 14px  | normal (400)  | 1.5         | normal         | **default body** — table cells, descriptions, most text       |
| `text-body-strong` | 14px  | semibold (600)| 1.5         | normal         | emphasized body, row titles, form labels                      |
| `text-title`       | 16px  | semibold (600)| 1.4         | -0.01em        | card titles, section titles                                   |
| `text-heading`     | 20px  | semibold (600)| 1.3         | -0.01em        | page / panel main heading                                     |
| `text-display`     | 30px  | bold (700)    | 1.2         | -0.02em        | hero, large empty-state copy (low frequency)                  |

### Migration mapping (mechanical)

| Existing                              | New tier            |
| ------------------------------------- | ------------------- |
| `text-xs` (+ optional `text-muted-*`) | `text-caption` (keep color class) |
| `text-sm` (plain body)                | `text-body`         |
| `text-sm font-medium` / `font-semibold` | `text-body-strong` |
| `text-base`/`text-lg` titles          | `text-title`        |
| `text-xl`/`text-2xl` headings         | `text-heading`      |
| `text-3xl`+ display                   | `text-display`      |

Weight classes (`font-medium`/`font-semibold`) become redundant on migrated elements and are
dropped when they match the tier's built-in weight. A call site that needs a non-default
weight (rare) overrides with an explicit `font-*` after the tier class.

## Implementation Surface

### 1. Token + utility definitions — `app/globals.css`

- Register `--text-caption … --text-display` plus their `--text-*--line-height`,
  `--text-*--font-weight`, `--text-*--letter-spacing` companion values inside `@theme inline`
  (Tailwind v4 reads these as font-size utility modifiers).
- Where the bundled weight/letter-spacing cannot ride on the font-size token alone, define
  the tier as an `@utility` block so one class emits all four properties.
- Add a comment block above the tier definitions documenting the scale and the migration
  mapping (single source of truth next to the code).

### 2. Typography component family — `components/ui/typography.tsx`

- Re-point the app-relevant components at the new utilities so the "component promotion" half
  of the task is real:
  - Keep the existing exports' prop contracts (LSP — callers must not break).
  - Internals switch from hand-coded `text-4xl font-extrabold` etc. to the tier classes.
- Heading components (`TypographyH1..H6`) map onto `text-display`/`text-heading`/`text-title`
  as appropriate; body/caption helpers (`TypographyP`, `TypographySmall`, `TypographyMuted`)
  map onto `text-body`/`text-caption`. Document-prose-specific styling (margins, list
  spacing) is retained — only the size/weight/leading source changes.

### 3. Core-page rollout (acceptance: at least task detail + list)

- **Task detail page** — the `app/(dashboard)/.../tasks/[id]` component tree.
- **Task list / my tasks** — the shared `TaskListView` component + `createTaskColumns`
  (covers all 3 list pages per the unified task-list work, LUM-251).
- Swap raw `text-xs/sm (+weight)` for the matching tier per the mapping table. No visual
  regression intended — the tiers are chosen to land on the same rendered size/weight the
  call sites already use; this is a semantic re-label, not a redesign.

### 4. Documentation

- One scale reference page under `docs/` (the canonical tier table + when-to-use + migration
  mapping).
- The `app/globals.css` comment block (above) as the in-code pointer.

## Explicitly out of scope (deferred to later Design-System-Rework tasks)

- Full `text-*` convergence on landing, the doc editor, settings, and other pages.
- A lint rule forbidding raw `text-xs/sm` (belongs to the "convergence layer" task).
- Any color-token changes — this task touches size/weight/leading only.

## Testing

- **`__tests__/styles/`** — a unit test asserting `app/globals.css` declares each of the six
  tier utilities (`text-caption … text-display`), mirroring the existing
  `globals-css-color-tokens.test.ts` guard, so the scale can't silently regress.
- **`__tests__/components/ui/typography.test.tsx`** — extend the existing test to assert the
  refactored components emit the new tier classes (and still honor their prop contracts:
  `align`, `balance`, `className` passthrough).
- **Visual non-regression** — verified by the size/weight mapping table; the preview browser
  cannot reach the local dev server in this environment (known infra limitation), so
  correctness rests on the rendered-size equivalence of the mapping + the jsdom class
  assertions.

## Risks / Notes

- **Tailwind v4 `@utility` + `@theme` interaction** — must confirm whether the bundled
  weight/letter-spacing can ride on `--text-*--*` font-size modifiers alone or need an
  explicit `@utility` block. The implementation plan resolves this against the actual
  Tailwind v4 build before mass migration.
- **token-lint** — new file(s) and migrated lines must use semantic tier + semantic color
  classes; no raw hex/zinc (per `lint:tokens`).
- **i18n** — pure styling change; no new user-facing strings expected.
