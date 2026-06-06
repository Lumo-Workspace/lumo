# LUM-258 — Semantic feedback color tokens (success / warning / info / danger)

**Date:** 2026-06-06
**Milestone:** Design System Rework (语义层)
**Depends on:** LUM-257 (oklch color model unification) — **DONE**, merged as #338.

## Problem

Feedback color is currently underspecified and duplicated:

- The only feedback token is `--destructive`. There is no `success` / `warning` / `info` token.
- The callout block (`app/globals.css:195-241`) hardcodes its info / warning / success / error palette as raw hex, **written twice** — once for light and once again for `.dark`. ~46 lines, no single source of truth.

LUM-257 migrated all base tokens to a single oklch model, which makes native alpha
modifiers and `color-mix(... , transparent)` valid — so a tinted surface can be
derived from one accent token instead of being hand-written per mode.

## Goal

Add a semantic feedback color layer (`--info` / `--warning` / `--success` / `--danger`),
each with a `-foreground`, `-subtle`, and `-border` variant, as the single source of
truth. Expose them through `@theme inline` so utilities (`text-info`, `bg-success-subtle`,
`border-warning-border`, …) are generated. Re-drive the callout's five variants from these
tokens and delete the duplicated `.dark` callout palette.

## Scope

**In scope**

- New CSS tokens in `app/globals.css` (`:root` + `.dark`) and their `@theme inline` registrations.
- Callout variant rules rewritten to consume the tokens; the duplicated `.dark` callout palette removed.
- Test coverage extended in `__tests__/styles/globals-css-color-tokens.test.ts`.

**Out of scope** (explicitly deferred to **LUM-264** — raw-color convergence)

- `sentry.service.ts:147` `#ef4444` (a DB-persisted "bug" tag color — data, not CSS).
- `member.service.ts:39` / `AssigneeSelect.tsx:56` `#6366f1` (the default **avatar** color — indigo,
  not a feedback color at all; semantically belongs to a different palette).
- Email-template colors (email clients don't read `:root`; needs TS constants, separate concern).

Rationale: these are server-side / data-layer hex strings, not stylesheet declarations.
A CSS custom property (oklch) cannot be consumed by DB rows, Slack payloads, or email HTML,
and `#6366f1` is not in the success/warning/info/danger family. Tokenizing them here would
be a semantic mismatch; they are the proper subject of LUM-264.

## Design

### Token structure — "Hybrid" (approach C)

Per feedback color `<c>` ∈ { info, warning, success, danger }:

| Token              | Form                                              | Light                          | Dark                                                         | Role                                  |
| ------------------ | ------------------------------------------------- | ------------------------------ | ------------------------------------------------------------ | ------------------------------------- |
| `--<c>`            | oklch (solid)                                     | base accent                    | brighter accent (`.dark` override)                           | left border, icon, emphasis           |
| `--<c>-foreground` | oklch (solid)                                     | near-black `oklch(0.2178 0 0)` | same (no override)                                           | text/icon **on** a solid `--<c>` fill |
| `--<c>-subtle`     | `color-mix(in srgb, var(--<c>) 10%, transparent)` | defined once in `:root`        | auto-recomputes (translucent composites over `--background`) | soft surface background               |
| `--<c>-border`     | `color-mix(in srgb, var(--<c>) 28%, transparent)` | defined once in `:root`        | auto-recomputes                                              | hairline border on a subtle surface   |

Key properties:

- **`--<c>` accent** is overridden in `.dark` to the brighter shade, mirroring the callout's
  existing deliberate dark-mode brightening.
- **`--<c>-subtle` / `--<c>-border`** are translucent `color-mix` of the accent, **defined once**
  in `:root`. Because they reference `var(--<c>)` (which re-resolves in `.dark`) and composite
  over `--background` (which flips), they adapt to dark mode automatically — this is what lets us
  delete the duplicated `.dark` callout palette.
- **`--<c>-foreground`** is a fixed near-black in **both** modes (never `var(--foreground)`, which
  would flip to white and fail on a light accent). Contrast-verified below.

### Palette (oklch, exact equivalents of the existing callout hex)

`:root` accents:

```
--info:    oklch(0.6231 0.1880 259.813); /* #3b82f6 */
--warning: oklch(0.7686 0.1647 70.073);  /* #f59e0b */
--success: oklch(0.7227 0.1920 149.577); /* #22c55e */
--danger:  oklch(0.6369 0.2079 25.334);  /* #ef4444 */
```

`.dark` accent overrides (brighter, matching the current dark callout):

```
--info:    oklch(0.7137 0.1433 254.621); /* #60a5fa */
--warning: oklch(0.8369 0.1644 84.421);  /* #fbbf24 */
--success: oklch(0.8003 0.1821 151.707); /* #4ade80 */
--danger:  oklch(0.7106 0.1662 22.222);  /* #f87171 */
```

`-foreground` (both modes): `oklch(0.2178 0 0)` /_ #1a1a1a _/ for all four.

`--danger` carries the same red as `--destructive` but stays a **distinct** token (no `var()`
alias): `--destructive` = a destructive **action** (button), `--danger` = a feedback **state**.
Keeping them separate lets either evolve without dragging the other.

### Contrast verification (chroma-js, WCAG ratio)

Near-black `-foreground` on a solid accent fill, light mode:

| color   | ratio | AA (≥4.5) |
| ------- | ----- | --------- |
| info    | 4.73  | ✓         |
| warning | 8.10  | ✓         |
| success | 7.64  | ✓         |
| danger  | 4.62  | ✓         |

Dark mode accents are lighter, so near-black foreground passes by a wider margin. White
foreground was rejected: it scores 3.7 (info/danger) / 2.x (warning/success) and fails AA.

Callout **body** text uses the default `--foreground` over `--<c>-subtle`. Since subtle is an
~10% accent tint over `--background`, this is effectively `--foreground` on `--background`,
already AA-verified by LUM-257. The accent is used only for the (non-text) left border and the
emoji icon, so it carries no text-contrast requirement.

### @theme inline registrations

For each `<c>` and each variant, register the matching `--color-*`:

```
--color-info: var(--info);
--color-info-foreground: var(--info-foreground);
--color-info-subtle: var(--info-subtle);
--color-info-border: var(--info-border);
/* …warning, success, danger identically… */
```

This generates `text-info`, `bg-info-subtle`, `border-info-border`, `text-danger-foreground`, etc.

### Callout rewrite

The five `data-variant` rules become token-driven, and the entire `.dark .callout[...]` block
is deleted:

```css
.callout[data-variant='info'] {
  background-color: var(--info-subtle);
  border-color: var(--info-border);
  border-left-color: var(--info);
}
/* warning → --warning*, success → --success*, error → --danger* */
.callout[data-variant='note'] {
  /* unchanged: neutral, no new token */
  background-color: var(--muted);
  border-color: var(--border);
  border-left-color: var(--muted-foreground);
}
```

`error` maps to the `danger` token family. `note` stays neutral on existing `--muted`/`--border`.

## Testing

Extend `__tests__/styles/globals-css-color-tokens.test.ts`:

1. Add `info`, `info-foreground`, `warning`, `warning-foreground`, `success`,
   `success-foreground`, `danger`, `danger-foreground` to the `COLOR_TOKENS` list — these are
   solid oklch values, so the existing "every definition is `oklch()`, never hex" assertion applies.
   - **Not** added to that list: `-subtle` / `-border` (they are `color-mix`, not `oklch`).
2. New test: each `--<c>-subtle` and `--<c>-border` is defined exactly once and its value is a
   `color-mix(in srgb, var(--<c>) …%, transparent)` (asserts the single-source, mode-adaptive form).
3. The existing "never wrap a CSS var in hsl()/rgb()" guard already covers the new lines.
4. New test: the `.dark` block defines the four accent overrides (regression guard so the
   dark-mode brightening isn't lost).

Acceptance commands: `npx tsc --noEmit`, `npm test`, `npm run lint:tokens` all green.
(`app/globals.css` is already on the lint allowlist, so the new hex **comments** are fine.)

## Acceptance criteria (from the task)

- [x] callout's five variants are token-driven → callout rewrite above.
- [x] new tokens at the lint allowlist definition site → they live in `app/globals.css`, already allowlisted.
- [x] light/dark contrast meets target → chroma-js verification above; duplicated `.dark` callout palette removed.

## Risks / notes

- The unified `color-mix` subtle/border percentages (10% / 28%) won't be byte-identical to the
  old hand-tuned per-mode hex, so the callout tint may shift by a hair. This is intended (single
  source over pixel-exact reproduction); visual no-regression is checked in both modes.
- No new npm packages. `chroma-js` is used only at design time for verification, not shipped.
