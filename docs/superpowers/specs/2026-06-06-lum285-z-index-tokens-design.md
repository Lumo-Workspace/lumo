# LUM-285 — z-index 分层体系 token (Design Spec)

**Task:** LUM-285 「建立 z-index 分层体系 token」
**Milestone:** Design System Rework
**Date:** 2026-06-06
**Branch:** `lumo/LUM-285-z-index-tokens`

## Problem

z-index values are scattered and have no shared semantics:

- Tailwind utilities: `z-50` ×36, `z-10` ×17, `z-20` ×5, `z-[1]` ×2, `z-[100]` ×1, `z-40` ×1.
- `app/globals.css` raw declarations: `z-index: 1` (code-block language select), `20`
  (table column-resize handle), `24` (table insert line), `25` (table insert handle) —
  each picked ad-hoc, no layering language.

Consequence: stacking conflicts between popovers / dropdowns / sticky chrome / drag
handles are easy to introduce and hard to reason about, because almost everything
floating sits at the same `z-50` and relies on Radix DOM-portal order to resolve ties.

## Goals

1. Define a semantic z-index scale (base / sticky / overlay / modal / dropdown / toast /
   max) as Tailwind v4 `@theme` tokens that emit `z-{tier}` utilities **and** are
   referenceable as `var(--z-index-{tier})` in raw CSS rules.
2. Migrate the app's scattered z values onto the scale.
3. Make z values single-source and explainable; eliminate arbitrary `z-[..]` utilities in
   app code.

## Non-goals

- **`components/landing/*`** (its own `landing.css` design system; `z-[1]`, `z-[100]`) is
  **out of scope** and stays allowlisted, consistent with how landing/vendored surfaces
  were treated in the LUM-264 color-token migration.
- No change to Sonner's internal behavior beyond optionally anchoring its toast layer to
  the new token (see Risks).

## The scale

Defined in `app/globals.css` inside `@theme inline`, using Tailwind v4's native
`--z-index-*` namespace. Non-mode-dependent (no light/dark split), so the values live
directly in `@theme inline` alongside the existing `--radius-*` / `--spacing-*` constants —
not in `:root` / `.dark`.

| Token              | Value  | Tier     | Purpose                                                              |
| ------------------ | ------ | -------- | ------------------------------------------------------------------- |
| `--z-index-base`   | `0`    | base     | normal flow / explicit reset to the page plane                      |
| `--z-index-sticky` | `10`   | sticky   | affixed page chrome: sticky table headers, sidebar shell, bulk bar  |
| `--z-index-overlay`| `40`   | overlay  | modal / dialog / drawer / sheet **backdrop** scrims                 |
| `--z-index-modal`  | `45`   | modal    | modal / dialog / drawer / sheet **panel** content                  |
| `--z-index-dropdown`| `50`  | dropdown | menus, selects, popovers, tooltips, hovercards, editor popups       |
| `--z-index-toast`  | `60`   | toast    | notifications / toasts                                              |
| `--z-index-max`    | `9999` | max      | deliberate escape hatch (rarely used; documented at the call site)  |

Generated utilities: `z-base`, `z-sticky`, `z-overlay`, `z-modal`, `z-dropdown`,
`z-toast`, `z-max`.

### Why these numbers

- **`dropdown (50) > modal (45) > overlay (40)` is the load-bearing relationship.**
  Selects / dropdowns / popovers open *inside* dialogs across the app (ShareDialog,
  MilestoneFormDialog, ProjectSlackDialog, MembersPage, `task-columns`, …). For an
  in-dialog menu to render above the dialog it was opened from, the dropdown tier must sit
  above the modal tier. Today this works only because everything is `z-50` and Radix
  portals the menu after the dialog in the DOM; the new scale makes it **deterministic**.
- **`dropdown = 50` is chosen deliberately** so all 36 existing `z-50` floating layers keep
  their exact numeric value — the bulk of the migration is a class rename with **zero**
  change in computed stacking. Dialog backdrops/panels move *down* (50 → 40/45), never up,
  so nothing that was on top of them stops being on top.
- `sticky = 10` matches the most common existing sticky value (`z-10`), so sticky table
  headers and the sidebar shell are unchanged.
- `toast = 60` sits above modal+dropdown; `max = 9999` is the only value that can cover a
  toast, by design.

## Layering policy: global tiers vs. local stacking contexts

The global scale governs **cross-component / portaled** layering — the actual source of
conflicts. A component that establishes its **own** stacking context and layers only its
**own children** within it does *not* belong on the global scale; collapsing such a
micro-stack onto a single global tier would destroy its internal order.

Two such local stacks exist and are treated as **documented local stacking**, not migrated
to global tiers:

1. **Sidebar rail** (`components/ui/sidebar/frame.tsx`): the rail (`absolute z-20`) layers
   against the sidebar shell's own children inside the `fixed z-10` shell's stacking
   context. The shell itself is global sticky chrome (→ `z-sticky`); the rail and the
   in-shell group buttons (`z-10`) are local to the shell.
2. **Editor table affordances** (`app/globals.css`): code-block language select (`1`),
   column-resize handle (`20`), insert line (`24`), insert handle (`25`) form a coupled
   local stack within the editor/table positioned ancestor. Their **relative** order
   (content < line < handle) is what matters; they never compete with portaled UI.

Policy statement to land in code comments: *the `--z-index-*` scale is for cross-component
and portaled layering; a component that owns its stacking context may use small scoped
integers for its own children, documented with a comment naming the context.*

## Migration mapping

### Tailwind utilities (`app/`, `components/` — excluding `components/landing/`)

| From       | To                          | Sites                                                                                                   |
| ---------- | --------------------------- | ------------------------------------------------------------------------------------------------------ |
| `z-50`     | `z-dropdown`                | dropdown-menu, select, popover, tooltip, context-menu, hover-card, navigation-menu, TagPicker, TagInput, ColorPicker, TableActionsMenu, BatchExtractButton, AlignMenu, BubbleMenuBar, EditorSuggestionPopup, default.tsx (≈ menus/popovers) |
| `z-50`     | `z-overlay` + `z-modal`     | dialog, alert-dialog, sheet, Modal, TaskDrawer, ShareDialog, DocumentHistoryModal, ProjectsPage modal — split: backdrop → `z-overlay`, panel → `z-modal` |
| `z-40`     | `z-overlay`                 | TaskDrawer backdrop                                                                                     |
| `z-20`     | `z-sticky`                  | BulkActionBar, ProjectsPage bulk bar                                                                    |
| `z-20`     | `z-dropdown`                | DocumentCommentThread menu (it is a menu, not chrome)                                                   |
| `z-20`     | *local* (sidebar rail)      | `components/ui/sidebar/frame.tsx` rail — keep local per policy, add comment                             |
| `z-10`     | `z-sticky`                  | sticky table headers (data-table, calendar), sidebar shell (frame.tsx), InboxPage, DocumentStatsFooter |
| `z-10`     | *local* (sidebar children)  | ProjectsSidebarGroup buttons — local to sidebar shell context                                           |
| `z-[1]`, `z-[100]`, `z-10` in `components/landing/*` | **untouched** | allowlisted                                                                       |

Exact per-file classification is finalized during implementation; each non-trivial
reclassification (e.g. comment menu `z-20 → z-dropdown`) is verified by reading the
component's stacking context.

### `app/globals.css` raw rules

- Editor-table local stack (`1` / `20` / `24` / `25`): kept as local integers per the
  layering policy, with an explanatory comment block naming the context and the
  content < line < handle ordering. (They are CSS declarations, not Tailwind utilities, and
  never compete with the global scale.)
- If review prefers, these can instead be re-expressed as `calc(var(--z-index-base) + n)`
  to visibly anchor them to the scale; default is documented local integers (lighter, and
  avoids implying global comparability).

## Enforcement

1. **Guard test** — `__tests__/styles/z-index-tokens.test.ts`, mirroring
   `globals-css-radius-elevation.test.ts` and `typography-scale-tokens.test.ts`:
   - parse `app/globals.css`, assert all 7 `--z-index-*` tokens are declared inside the
     `@theme inline` block with the expected values;
   - assert the monotonic ordering base < sticky < overlay < modal < dropdown < toast < max;
   - (the existing styles guards parse the file as raw text and are comment-fragile — keep
     any new globals.css comments free of `{}` and the `@theme inline` sentinel, and run the
     **full** `__tests__/styles/` suite after editing.)
2. **lint-tokens.ts** — add a `'z-index'` rule to the `Rule` union that flags arbitrary
   `z-[..]` Tailwind utilities in business code, baseline-gated exactly like the existing
   `hex` / `palette` / `radius` / `shadow` rules. `components/landing/landing.css` and the
   landing components stay on the existing `ALLOWLIST` (extend the allowlist with the two
   landing `.tsx` files carrying `z-[..]` if needed). After migration, the app's z-index
   baseline is zero; run `lint:tokens:update` to snapshot.

## Testing & verification

- Component tests: dialog renders backdrop at `z-overlay` and panel at `z-modal`; a
  representative in-dialog dropdown asserts the dropdown class resolves above the modal
  (class-presence assertion — jsdom can't compute real stacking, see the Radix-Select
  jsdom limitation noted in repo memory).
- `npx tsc --noEmit` (run prisma generate + tsc atomically once at the end, per worktree
  guidance).
- `npm run lint:tokens` green against the updated baseline.
- Full `__tests__/styles/` suite green (guards are comment-fragile).
- Manual/preview not required — change is purely stacking-order with values preserved for
  the dominant case; rely on tsc + jsdom component tests + lint.

## Rollout

Single PR from the `lumo/LUM-285-z-index-tokens` worktree off `origin/main`. No schema
change, no new npm package. Title: `feat: z-index layering tokens [LUM-285]`.

## Risks

- **Sonner toast alignment**: Sonner self-manages a very high inline
  z-index. Default plan keeps Sonner as-is and treats `--z-index-toast` as the token for
  our own toast-like surfaces; optionally we anchor Sonner to `var(--z-index-toast)` so the
  scale is authoritative. The optional alignment is the one behavioral change and must be
  verified (toast still above modal+dropdown). Default: leave Sonner untouched.
- **z-20 → z-sticky demotions** (BulkActionBar, sidebar rail): verify each still covers its
  intended siblings; the rail is handled via the local-stacking carve-out specifically to
  avoid a regression here.
- Vendored shadcn primitives are edited in place (the repo already customizes them); future
  upstream re-syncs must re-apply the tier classes — noted in the PR description.
