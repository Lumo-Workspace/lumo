# z-index Layering Tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace scattered raw z-index values with a single semantic 7-tier scale (`--z-index-base/sticky/overlay/modal/dropdown/toast/max`) defined in `app/globals.css` `@theme inline`, migrate all app usages onto it, and add guard + lint enforcement.

**Architecture:** Tailwind v4 native `--z-index-*` namespace emits `z-{tier}` utilities and is referenceable as `var(--z-index-{tier})` in raw CSS. The scale is numerically chosen so `dropdown(50) > modal(45) > overlay(40)` (in-dialog dropdowns must render above the dialog), and `dropdown=50` keeps all 36 existing `z-50` floating layers byte-identical in computed stacking. Cross-component/portaled layering uses the global scale; components that own a stacking context keep small local integers (documented). `components/landing/*` is out of scope.

**Tech Stack:** Tailwind CSS v4, TypeScript (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Jest + SWC, `tsx` lint script.

**Spec:** `docs/superpowers/specs/2026-06-06-lum285-z-index-tokens-design.md`

**Worktree:** Work happens in `.worktrees/LUM-285-z-index-tokens` on branch `lumo/LUM-285-z-index-tokens`. Run jest from **inside** the worktree (`cd` first) to avoid the `cli/package.json` haste collision. Do **not** run `git checkout/switch/reset/stash`.

---

## File structure

| File | Responsibility | Action |
| --- | --- | --- |
| `app/globals.css` | declares the 7 `--z-index-*` tokens in `@theme inline`; documents editor-table local stacking | Modify |
| `__tests__/styles/z-index-tokens.test.ts` | guards token presence + values + monotonic ordering | Create |
| `scripts/lint-tokens.ts` | adds `'zindex'` rule flagging arbitrary `z-[..]` utilities | Modify |
| `scripts/__tests__/lint-tokens.test.ts` (or existing test file) | unit-tests the new rule | Create/Modify |
| `scripts/lint-tokens.baseline.json` | re-snapshot after migration | Modify (generated) |
| `components/ui/{dropdown-menu,select,popover,tooltip,context-menu,hover-card}.tsx` | dropdown-family floating content | Modify |
| `components/ui/{dialog,alert-dialog,sheet}.tsx` | overlay/content split | Modify |
| `components/ui/sidebar/frame.tsx` | sidebar shell → sticky; rail stays local | Modify |
| app overlay components (Modal, TaskDrawer, DocumentHistoryModal, BatchExtractButton, ShareDialog, ProjectsPage) | dialog-like surfaces | Modify |
| editor popups (BubbleMenuBar, AlignMenu, ColorPicker, TableActionsMenu, TagInput, TagPicker, EditorSuggestionPopup) | floating menus → dropdown | Modify |
| sticky/menu sites (data-table, DocumentStatsFooter, DocumentCommentThread, BulkActionBar, InboxPage) | sticky chrome + one menu | Modify |
| `components/ui/dialog.test.tsx` (or co-located) | render test for overlay/modal tiers | Create |

**Left untouched (documented):** `components/ui/navigation-menu.tsx` (vendored, unused outside landing; its `z-[1]` is baselined), `components/ui/calendar.tsx` (`z-10` focus-ring is local, not arbitrary), `app/.../ProjectsSidebarGroup.tsx` (`z-10` buttons local to sidebar shell), all `components/landing/*`.

---

## Task 1: Define the z-index scale + guard test

**Files:**
- Create: `__tests__/styles/z-index-tokens.test.ts`
- Modify: `app/globals.css` (inside `@theme inline`, after the `--shadow-elevation-3` line)

- [ ] **Step 1: Write the failing guard test**

Create `__tests__/styles/z-index-tokens.test.ts`:

```typescript
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// LUM-285: the semantic z-index scale is carried by Tailwind v4 --z-index-*
// tokens in app/globals.css @theme inline. The numeric ORDER is load-bearing:
// dropdown must sit above modal (in-dialog menus), modal above its overlay.
// Guard against a tier being dropped/renamed or the ordering being inverted.
const EXPECTED: ReadonlyArray<readonly [string, number]> = [
  ['base', 0],
  ['sticky', 10],
  ['overlay', 40],
  ['modal', 45],
  ['dropdown', 50],
  ['toast', 60],
  ['max', 9999],
]

describe('app/globals.css z-index scale tokens', () => {
  const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8')

  it.each(EXPECTED)('declares --z-index-%s with value %i', (tier, value) => {
    expect(css).toMatch(new RegExp(`--z-index-${tier}:\\s*${value};`))
  })

  it('keeps the tiers in strictly increasing numeric order', () => {
    const values = EXPECTED.map(([tier]) => {
      const m = css.match(new RegExp(`--z-index-${tier}:\\s*(\\d+);`))
      if (!m) throw new Error(`missing --z-index-${tier}`)
      return Number(m[1])
    })
    const sorted = [...values].sort((a, b) => a - b)
    expect(values).toEqual(sorted)
    expect(new Set(values).size).toBe(values.length) // no duplicate tiers
  })

  it('enforces the load-bearing dropdown > modal > overlay relationship', () => {
    const get = (tier: string) => {
      const m = css.match(new RegExp(`--z-index-${tier}:\\s*(\\d+);`))
      return Number(m?.[1])
    }
    expect(get('dropdown')).toBeGreaterThan(get('modal'))
    expect(get('modal')).toBeGreaterThan(get('overlay'))
  })
})
```

- [ ] **Step 2: Run the test, verify it FAILS**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-285-z-index-tokens && npx jest __tests__/styles/z-index-tokens.test.ts`
Expected: FAIL — `--z-index-base` etc. not found in globals.css.

- [ ] **Step 3: Add the tokens to globals.css**

In `app/globals.css`, find this block inside `@theme inline` (around line 683):

```css
  /* Elevation utilities: generates .shadow-elevation-1/2/3 (LUM-261). */
  --shadow-elevation-1: var(--elevation-1);
  --shadow-elevation-2: var(--elevation-2);
  --shadow-elevation-3: var(--elevation-3);
```

Insert immediately after it:

```css

  /* ── Semantic z-index scale (LUM-285) ───────────────────────────────────
     Emits z-base / z-sticky / z-overlay / z-modal / z-dropdown / z-toast /
     z-max utilities; also referenceable as var(--z-index-{tier}) in raw CSS.
     The ORDER is load-bearing: dropdown(50) sits ABOVE modal(45) so menus /
     selects / popovers opened INSIDE a dialog render above it; modal(45) sits
     above its overlay(40). dropdown is pinned at 50 so the prior z-50 floating
     layers keep byte-identical stacking. This scale governs cross-component /
     portaled layering only — a component that owns its own stacking context
     may use small scoped integers for its own children (see the editor-table
     handles below and components/ui/sidebar/frame.tsx).
     Full reference: docs/superpowers/specs/2026-06-06-lum285-z-index-tokens-design.md */
  --z-index-base: 0;
  --z-index-sticky: 10;
  --z-index-overlay: 40;
  --z-index-modal: 45;
  --z-index-dropdown: 50;
  --z-index-toast: 60;
  --z-index-max: 9999;
```

(Comment contains no `{}` or the literal `@theme inline` — the styles guards parse the file as raw text and break on those, per repo memory.)

- [ ] **Step 4: Run the test, verify it PASSES**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-285-z-index-tokens && npx jest __tests__/styles/z-index-tokens.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the FULL styles suite (guards are comment-fragile)**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-285-z-index-tokens && npx jest __tests__/styles/`
Expected: all styles tests PASS (color-tokens, radius-elevation, status-color, typography-scale, z-index-tokens).

- [ ] **Step 6: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-285-z-index-tokens
git add app/globals.css __tests__/styles/z-index-tokens.test.ts
git commit -m "feat: add semantic z-index scale tokens [LUM-285]"
```

---

## Task 2: Add the `zindex` rule to lint-tokens.ts

**Files:**
- Modify: `scripts/lint-tokens.ts`
- Create/Modify: `scripts/__tests__/lint-tokens.test.ts` (if a test file already exists for the script, add to it; otherwise create)

- [ ] **Step 1: Check whether a lint-tokens test already exists**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-285-z-index-tokens && ls scripts/__tests__ 2>/dev/null; grep -rl "detectViolations" --include='*.test.ts' . 2>/dev/null | grep -v node_modules`
Expected: a path if a test exists, empty otherwise. Use the found path in the steps below; if none, create `scripts/__tests__/lint-tokens.test.ts`.

- [ ] **Step 2: Write the failing unit test**

Add to the test file (create with this content if none exists):

```typescript
import { detectViolations } from '../lint-tokens'

describe('lint-tokens zindex rule', () => {
  it('flags arbitrary z-[..] utilities in business code', () => {
    const v = detectViolations(
      'components/foo.tsx',
      `const a = <div className="z-[100] flex" />\nconst b = <div className="z-[1]" />`
    )
    const zindex = v.filter((x) => x.rule === 'zindex')
    expect(zindex.map((x) => x.match)).toEqual(['z-[100]', 'z-[1]'])
  })

  it('does NOT flag named z utilities', () => {
    const v = detectViolations(
      'components/foo.tsx',
      `<div className="z-50 z-dropdown z-modal z-10" />`
    )
    expect(v.filter((x) => x.rule === 'zindex')).toHaveLength(0)
  })

  it('respects the allowlist and skips test files', () => {
    expect(
      detectViolations('app/globals.css', 'z-[100]').filter((x) => x.rule === 'zindex')
    ).toHaveLength(0)
    expect(
      detectViolations('components/foo.test.tsx', 'z-[100]').filter((x) => x.rule === 'zindex')
    ).toHaveLength(0)
  })
})
```

- [ ] **Step 3: Run the test, verify it FAILS**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-285-z-index-tokens && npx jest lint-tokens.test`
Expected: FAIL — no `zindex` violations produced (rule not implemented).

- [ ] **Step 4: Implement the rule**

In `scripts/lint-tokens.ts`:

(a) Extend the `Rule` union (around line 33):

```typescript
export type Rule = 'hex' | 'palette' | 'radius' | 'shadow' | 'zindex'
```

(b) Add the regex next to the other rule regexes (after `SHADOW_RE`, around line 110):

```typescript
// Arbitrary Tailwind z-index utility (z-[1], z-[100], z-[calc(...)]). Named
// tiers (z-dropdown / z-modal / ...) and the default scale (z-10/z-50) are
// allowed; only the arbitrary escape hatch bypasses the semantic z scale.
const Z_ARBITRARY_RE = /\bz-\[[^\]]+\]/g
```

(c) Add the detection loop inside `detectViolations`, after the `SHADOW_RE` while-loop (around line 175):

```typescript
    Z_ARBITRARY_RE.lastIndex = 0
    while ((m = Z_ARBITRARY_RE.exec(line)) !== null) {
      out.push({
        file: relPath,
        line: i + 1,
        col: m.index + 1,
        match: m[0],
        rule: 'zindex',
      })
    }
```

(d) Add the label to `RULE_LABELS` (around line 185):

```typescript
const RULE_LABELS: Record<Rule, string> = {
  hex: 'hex literal  ',
  palette: 'palette class',
  radius: 'bare rounded ',
  shadow: 'raw shadow   ',
  zindex: 'arbitrary z  ',
}
```

- [ ] **Step 5: Run the test, verify it PASSES**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-285-z-index-tokens && npx jest lint-tokens.test`
Expected: PASS.

- [ ] **Step 6: Re-snapshot the baseline (absorbs pre-existing landing + vendored z-[..])**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-285-z-index-tokens && npm run lint:tokens:update`
Then verify clean: `npm run lint:tokens`
Expected: lint passes; `git diff scripts/lint-tokens.baseline.json` shows added counts only for `components/landing/*` and `components/ui/navigation-menu.tsx` (the out-of-scope z-[..]). If any **app** file under `app/` gained a zindex count, that's a file still to migrate — note it for later tasks.

- [ ] **Step 7: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-285-z-index-tokens
git add scripts/lint-tokens.ts scripts/lint-tokens.baseline.json scripts/__tests__/lint-tokens.test.ts
git commit -m "feat: lint-tokens rule flagging arbitrary z-[..] utilities [LUM-285]"
```

---

## Task 3: Migrate dropdown-family shadcn primitives (`z-50` → `z-dropdown`)

**Files (each: replace the `z-50` token in the content className with `z-dropdown`):**
- `components/ui/dropdown-menu.tsx:50`, `:68`
- `components/ui/select.tsx:78`
- `components/ui/popover.tsx:24`
- `components/ui/tooltip.tsx:49`, `:55` (content + arrow)
- `components/ui/context-menu.tsx:49`, `:65`
- `components/ui/hover-card.tsx:21`

- [ ] **Step 1: Apply the replacements**

For each file/line above, change the standalone `z-50` utility to `z-dropdown`. Example (dropdown-menu.tsx:50): `'z-50 min-w-[8rem] ...'` → `'z-dropdown min-w-[8rem] ...'`. The tooltip arrow (tooltip.tsx:55) `z-50` → `z-dropdown` too (same tier as its content).

- [ ] **Step 2: Verify no stray `z-50` remains in these files**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-285-z-index-tokens && grep -nE '\bz-50\b' components/ui/dropdown-menu.tsx components/ui/select.tsx components/ui/popover.tsx components/ui/tooltip.tsx components/ui/context-menu.tsx components/ui/hover-card.tsx`
Expected: no output.

- [ ] **Step 3: Typecheck**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-285-z-index-tokens && npx tsc --noEmit`
Expected: no errors (if `TaskArtifact`/prisma errors appear, run `npx prisma generate` once then re-run — stale shared client, per repo memory).

- [ ] **Step 4: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-285-z-index-tokens
git add components/ui/dropdown-menu.tsx components/ui/select.tsx components/ui/popover.tsx components/ui/tooltip.tsx components/ui/context-menu.tsx components/ui/hover-card.tsx
git commit -m "refactor: dropdown-family primitives use z-dropdown tier [LUM-285]"
```

---

## Task 4: Split dialog-family primitives (overlay → `z-overlay`, content → `z-modal`)

**Files:**
- `components/ui/dialog.tsx` — overlay `:22` `z-50` → `z-overlay`; content `:39` `z-50` → `z-modal`
- `components/ui/alert-dialog.tsx` — overlay `:22` `z-50` → `z-overlay`; content `:32` `z-50` → `z-modal`
- `components/ui/sheet.tsx` — overlay `:24` `z-50` → `z-overlay`; content `:34` `z-50` → `z-modal`

- [ ] **Step 1: Apply the replacements**

In each file, the `*Overlay` className (the `fixed inset-0 ... bg-*` scrim) gets `z-overlay`; the `*Content` className (the `fixed ... grid`/panel) gets `z-modal`. Confirm by the className context: overlay lines contain `inset-0` + a background tint; content lines contain `translate`/panel layout.

- [ ] **Step 2: Verify**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-285-z-index-tokens && grep -nE '\bz-50\b' components/ui/dialog.tsx components/ui/alert-dialog.tsx components/ui/sheet.tsx && echo "STRAY z-50 FOUND" || echo "clean"`
Expected: `clean`. Also confirm each file now has exactly one `z-overlay` and one `z-modal`: `grep -cE 'z-overlay|z-modal' components/ui/dialog.tsx` → `2`.

- [ ] **Step 3: Typecheck**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-285-z-index-tokens && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-285-z-index-tokens
git add components/ui/dialog.tsx components/ui/alert-dialog.tsx components/ui/sheet.tsx
git commit -m "refactor: dialog-family split into z-overlay + z-modal tiers [LUM-285]"
```

---

## Task 5: Migrate hand-rolled app overlays

**Files & mapping** (these are app-level dialog/drawer surfaces, not Radix):
- `app/workspace/[workspaceUrl]/components/Modal.tsx:43` — `fixed inset-0 z-50` (this wrapper holds both scrim + centered panel) → `z-modal` (single combined surface; it is the modal layer, panel-and-scrim together)
- `app/workspace/[workspaceUrl]/components/TaskDrawer.tsx:99` — backdrop `fixed inset-0 z-40` → `z-overlay`; `:103` — panel `fixed right-0 ... z-50` → `z-modal`
- `app/workspace/[workspaceUrl]/components/documents/DocumentHistoryModal.tsx:63` — `fixed inset-0 z-50 ... bg-black/40` (scrim+panel combined) → `z-modal`
- `app/workspace/[workspaceUrl]/components/extract/BatchExtractButton.tsx:128` — `fixed inset-0 z-50 ... bg-black/30` (scrim+panel combined) → `z-modal`
- `app/workspace/[workspaceUrl]/components/document/ShareDialog.tsx:361` — `absolute ... z-50` autocomplete dropdown INSIDE the dialog → `z-dropdown` (must stay above the modal)
- `app/workspace/[workspaceUrl]/components/pages/ProjectsPage.tsx:257` — `absolute ... z-50` dropdown → `z-dropdown`

> Note: `Modal.tsx`, `DocumentHistoryModal.tsx`, `BatchExtractButton.tsx` use one `fixed inset-0` element that is both the dimmed backdrop and the flex-centering container for the panel — there is no separate overlay node, so they map to the single `z-modal` tier (the dim is part of the same element). This preserves their current single-layer behavior.

- [ ] **Step 1: Apply the replacements** per the mapping above.

- [ ] **Step 2: Verify no stray raw z remains**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-285-z-index-tokens && grep -nE '\bz-(40|50)\b' app/workspace/\[workspaceUrl\]/components/Modal.tsx app/workspace/\[workspaceUrl\]/components/TaskDrawer.tsx app/workspace/\[workspaceUrl\]/components/documents/DocumentHistoryModal.tsx app/workspace/\[workspaceUrl\]/components/extract/BatchExtractButton.tsx app/workspace/\[workspaceUrl\]/components/document/ShareDialog.tsx app/workspace/\[workspaceUrl\]/components/pages/ProjectsPage.tsx`
Expected: no output (note ProjectsPage still has a `z-20` bulk bar + `z-10` thead handled in Task 7 — those are not `z-40|z-50`).

- [ ] **Step 3: Typecheck**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-285-z-index-tokens && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-285-z-index-tokens
git add app/workspace/\[workspaceUrl\]/components/Modal.tsx app/workspace/\[workspaceUrl\]/components/TaskDrawer.tsx app/workspace/\[workspaceUrl\]/components/documents/DocumentHistoryModal.tsx app/workspace/\[workspaceUrl\]/components/extract/BatchExtractButton.tsx app/workspace/\[workspaceUrl\]/components/document/ShareDialog.tsx app/workspace/\[workspaceUrl\]/components/pages/ProjectsPage.tsx
git commit -m "refactor: app overlays use z-overlay/z-modal/z-dropdown tiers [LUM-285]"
```

---

## Task 6: Migrate editor floating popups (`z-50` → `z-dropdown`)

**Files (each `z-50` → `z-dropdown`):**
- `app/workspace/[workspaceUrl]/components/BubbleMenuBar.tsx:388`, `:532`
- `app/workspace/[workspaceUrl]/components/bubble-menu/AlignMenu.tsx:71`
- `app/workspace/[workspaceUrl]/components/bubble-menu/ColorPicker.tsx:95`
- `app/workspace/[workspaceUrl]/components/bubble-menu/TableActionsMenu.tsx:125`
- `app/workspace/[workspaceUrl]/components/document/TagInput.tsx:89`
- `app/workspace/[workspaceUrl]/components/document/TagPicker.tsx:206`
- `app/workspace/[workspaceUrl]/components/EditorSuggestionPopup.tsx:59`

- [ ] **Step 1: Apply the replacements.**

- [ ] **Step 2: Verify**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-285-z-index-tokens && grep -rnE '\bz-50\b' app/workspace/\[workspaceUrl\]/components/BubbleMenuBar.tsx app/workspace/\[workspaceUrl\]/components/bubble-menu/ app/workspace/\[workspaceUrl\]/components/document/TagInput.tsx app/workspace/\[workspaceUrl\]/components/document/TagPicker.tsx app/workspace/\[workspaceUrl\]/components/EditorSuggestionPopup.tsx`
Expected: no output.

- [ ] **Step 3: Run any existing tests for these components**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-285-z-index-tokens && npx jest BubbleMenu AlignMenu ColorPicker TableActionsMenu TagInput TagPicker EditorSuggestion 2>&1 | tail -20`
Expected: existing tests still PASS (these are className-only changes; tests asserting button counts / behavior are unaffected). If a test snapshots className, update the snapshot.

- [ ] **Step 4: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-285-z-index-tokens
git add app/workspace/\[workspaceUrl\]/components/BubbleMenuBar.tsx app/workspace/\[workspaceUrl\]/components/bubble-menu app/workspace/\[workspaceUrl\]/components/document/TagInput.tsx app/workspace/\[workspaceUrl\]/components/document/TagPicker.tsx app/workspace/\[workspaceUrl\]/components/EditorSuggestionPopup.tsx
git commit -m "refactor: editor floating popups use z-dropdown tier [LUM-285]"
```

---

## Task 7: Migrate sticky chrome + the comment menu

**Files & mapping:**
- `app/workspace/[workspaceUrl]/components/data-table/data-table.tsx:210` — `sticky top-0 z-10` → `z-sticky`
- `app/workspace/[workspaceUrl]/components/pages/ProjectsPage.tsx:361` — `thead sticky ... z-10` → `z-sticky`
- `app/workspace/[workspaceUrl]/components/document/DocumentStatsFooter.tsx:48` — `sticky bottom-0 z-10` → `z-sticky`
- `components/ui/sidebar/frame.tsx:103` — sidebar shell `fixed inset-y-0 z-10` → `z-sticky`
- `app/workspace/[workspaceUrl]/components/task-list/BulkActionBar.tsx:50` — `absolute inset-0 z-20` → `z-sticky` (and update the doc-comment on `:38` from `` `absolute inset-0 z-20` `` to `` `absolute inset-0 z-sticky` ``)
- `app/workspace/[workspaceUrl]/components/pages/ProjectsPage.tsx:299` — bulk bar `absolute inset-0 z-20` → `z-sticky`
- `app/workspace/[workspaceUrl]/components/pages/InboxPage.tsx:374` — `absolute inset-y-0 -left-1 -right-1 z-10` → `z-sticky`
- `app/workspace/[workspaceUrl]/components/document/comments/DocumentCommentThread.tsx:157` — menu `absolute right-0 z-20` → `z-dropdown` (it is a menu, must float above chrome); `:152` — click-away scrim `fixed inset-0 z-10` → `z-sticky`

> **Left untouched (local stacking, per spec policy):** `components/ui/sidebar/frame.tsx:169` rail `z-20` (layers inside the shell's own context); `ProjectsSidebarGroup.tsx:215,236` `z-10` buttons; `components/ui/navigation-menu.tsx:21` root `z-10`; `components/ui/calendar.tsx:204` focus-ring `z-10`. Add a one-line comment at frame.tsx:169 noting the rail is intentionally local: `// z-20: local to the fixed sidebar shell's stacking context (LUM-285)`.

- [ ] **Step 1: Apply the replacements** and add the frame.tsx:169 comment.

- [ ] **Step 2: Verify the migrated sites + confirm local sites preserved**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-285-z-index-tokens && grep -nE '\bz-(10|20)\b' app/workspace/\[workspaceUrl\]/components/data-table/data-table.tsx app/workspace/\[workspaceUrl\]/components/document/DocumentStatsFooter.tsx app/workspace/\[workspaceUrl\]/components/task-list/BulkActionBar.tsx app/workspace/\[workspaceUrl\]/components/pages/InboxPage.tsx`
Expected: no output for these fully-migrated files. (frame.tsx:169 rail `z-20`, calendar/nav/sidebar-group `z-10` intentionally remain.)

- [ ] **Step 3: Typecheck**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-285-z-index-tokens && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run affected component tests**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-285-z-index-tokens && npx jest data-table BulkActionBar DocumentCommentThread 2>&1 | tail -20`
Expected: PASS (update className snapshots if any).

- [ ] **Step 5: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-285-z-index-tokens
git add app/workspace components/ui/sidebar/frame.tsx
git commit -m "refactor: sticky chrome uses z-sticky tier, comment menu z-dropdown [LUM-285]"
```

---

## Task 8: Document the editor-table local stack in globals.css

**Files:**
- Modify: `app/globals.css` (lines ~45-49 code-block lang select; ~436-470 table handles)

The four raw `z-index` rules form a coupled local stack within the editor's positioned ancestor and never compete with portaled UI. Keep their values (relative order content < line(24) < handle(25); resize(20); lang-select(1) is its own code-block control) but document them so each value is explainable.

- [ ] **Step 1: Add an explanatory comment above `.code-block-language-select`**

Find (around line 45):

```css
.code-block-language-select {
  position: absolute;
  top: 0.375rem;
  right: 0.375rem;
  z-index: 1;
```

Insert a comment directly above the `z-index: 1;` line (keep it on its own line, no `{}` in the text):

```css
  /* local: lifts the language control above the code block's own content
     only; not part of the global z scale (LUM-285). */
  z-index: 1;
```

- [ ] **Step 2: Add a grouped comment above the table-handle rules**

Find the `.table-insert-handle` / `.table-insert-line` block (around lines 451-470). Add, immediately above the first of the three (`.editor` table column-resize at line ~436 `z-index: 20`, insert-line `z-index: 24`, insert-handle `z-index: 25`), a single block comment naming the local stack:

```css
/* Editor-table hover affordances form a self-contained local stacking group
   within the table's positioned ancestor (LUM-218); they never overlap
   portaled UI, so they stay as scoped integers rather than global z tiers:
   column-resize(20) < insert-line(24) < insert-handle(25). See LUM-285. */
```

(Place it above whichever of these rules appears first in the file; the exact line is whatever the resize-handle rule at `z-index: 20` belongs to — verify with `grep -nE 'z-index: (20|24|25);' app/globals.css` first.)

- [ ] **Step 3: Run the FULL styles suite (comments can break the raw-text guards)**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-285-z-index-tokens && npx jest __tests__/styles/`
Expected: all PASS. If any guard fails, the new comment introduced a `{`/`}` or the `@theme inline` sentinel — reword it.

- [ ] **Step 4: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-285-z-index-tokens
git add app/globals.css
git commit -m "docs: annotate editor-table local z-index stack [LUM-285]"
```

---

## Task 9: Render test for the dialog overlay/modal tiers

**Files:**
- Create: `components/ui/__tests__/dialog-zindex.test.tsx` (or co-locate per repo convention — check where other `components/ui` tests live first)

- [ ] **Step 1: Confirm test location convention**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-285-z-index-tokens && find . -path ./node_modules -prune -o -name '*.test.tsx' -print | grep -iE 'components/ui|dialog|dropdown' | head`
Use the directory pattern you find (e.g. `__tests__/` sibling or co-located). Default to `components/ui/__tests__/dialog-zindex.test.tsx`.

- [ ] **Step 2: Write the test**

```tsx
import { render } from '@testing-library/react'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'

// LUM-285: dialog overlay must sit on z-overlay, panel on z-modal. The numeric
// ordering (dropdown > modal > overlay) is guarded separately in
// __tests__/styles/z-index-tokens.test.ts; this asserts the components emit the
// right tier utilities. jsdom can't compute real stacking, so we assert classes.
describe('Dialog z-index tiers', () => {
  it('renders overlay at z-overlay and content at z-modal', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>hi</DialogTitle>
        </DialogContent>
      </Dialog>
    )
    expect(document.querySelector('.z-overlay')).not.toBeNull()
    expect(document.querySelector('.z-modal')).not.toBeNull()
    // No raw z-50 leaks from the dialog primitives anymore.
    expect(document.querySelector('.z-50')).toBeNull()
  })
})
```

- [ ] **Step 3: Run the test**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-285-z-index-tokens && npx jest dialog-zindex`
Expected: PASS. If Radix Dialog content does not portal/render in jsdom for this setup (no content found), wrap with the project's existing test providers (check an existing dialog test) or query the portal root `document.body`; the overlay+content render into `document.body` via Radix portal by default.

- [ ] **Step 4: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-285-z-index-tokens
git add components/ui/__tests__/dialog-zindex.test.tsx
git commit -m "test: assert dialog overlay/modal z-index tiers [LUM-285]"
```

---

## Task 10: Final verification, baseline, and PR

- [ ] **Step 1: Confirm zero arbitrary z-[..] in live app code**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-285-z-index-tokens && grep -rnE '\bz-\[' --include='*.tsx' app components | grep -v 'components/landing/' | grep -v 'components/ui/navigation-menu.tsx'`
Expected: no output.

- [ ] **Step 2: Confirm no stray `z-50` / `z-40` in migrated app+ui code**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-285-z-index-tokens && grep -rnE '\bz-(40|50)\b' --include='*.tsx' app components | grep -v 'components/landing/' | grep -v 'components/ui/navigation-menu.tsx'`
Expected: no output (calendar/sidebar-group/nav-root `z-10` and sidebar rail `z-20` are the only intentional remaining defaults — verify each is in the "left untouched" list).

- [ ] **Step 3: Re-snapshot baseline & run full lint**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-285-z-index-tokens && npm run lint:tokens:update && npm run lint:tokens`
Expected: passes; `git diff scripts/lint-tokens.baseline.json` shows zindex counts only for landing + navigation-menu (and any net color-count changes from edited files should be zero or shrink).

- [ ] **Step 4: Atomic prisma generate + full typecheck**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-285-z-index-tokens && npx prisma generate && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Full styles suite + targeted component tests**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-285-z-index-tokens && npx jest __tests__/styles/ dialog-zindex lint-tokens.test`
Expected: all PASS.

- [ ] **Step 6: Guard against a stale-base migration-deletion diff**

Run: `cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-285-z-index-tokens && git fetch origin --quiet && git merge origin/main --no-edit && git diff --stat origin/main...HEAD | grep -i 'prisma/migrations' && echo "CHECK: migration touched" || echo "no migration changes (good)"`
Expected: `no migration changes (good)`. If a merge conflict occurs, resolve it (likely globals.css or baseline.json); re-run Steps 3-5 after.

- [ ] **Step 7: Commit any merge result, push, open PR**

```bash
cd /Users/chaoli/Desktop/lumo/lumo/.worktrees/LUM-285-z-index-tokens
git push -u origin lumo/LUM-285-z-index-tokens
gh pr create --title "feat: z-index layering tokens [LUM-285]" --body "$(cat <<'EOF'
## Summary
Introduces a semantic 7-tier z-index scale (`--z-index-base/sticky/overlay/modal/dropdown/toast/max`) in `app/globals.css` `@theme inline` and migrates all in-app z usages onto it. `dropdown(50) > modal(45) > overlay(40)` so in-dialog menus render above dialogs; `dropdown=50` keeps the 36 prior `z-50` layers byte-identical.

## Scope
- shadcn primitives (dropdown/select/popover/tooltip/context-menu/hover-card → `z-dropdown`; dialog/alert-dialog/sheet split into `z-overlay`+`z-modal`)
- app overlays, editor popups, sticky chrome, comment menu
- editor-table local stack documented (kept as scoped integers)
- guard test `__tests__/styles/z-index-tokens.test.ts` + new `zindex` rule in `lint-tokens.ts`

## Out of scope (documented)
- `components/landing/*` (own design system) and vendored unused `components/ui/navigation-menu.tsx` — their `z-[..]` are baselined, not migrated.

## Verification
- `tsc --noEmit` clean, `lint:tokens` green, full `__tests__/styles/` + dialog render test pass.
- No schema change; no new npm package.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 8: Update task tracker** — set LUM-285 to in_review once the PR is open:

Run: `lumo task update LUM-285 --status in_review` (then `lumo session wrap` at end of session).

---

## Self-review notes (for the executor)

- **Spec coverage:** scale (Task 1) ✓, layering policy (Tasks 7-8 + comments) ✓, migration mapping (Tasks 3-7) ✓, globals.css raw rules (Task 8) ✓, guard test (Task 1) ✓, lint rule (Task 2) ✓, testing (Tasks 1,9,10) ✓, landing/vendored exclusion (baseline, Task 2/10) ✓, Sonner left untouched (no task needed — default per spec) ✓.
- **Type names:** the lint `Rule` value is `'zindex'` everywhere (union, detection, `RULE_LABELS`, tests). The tier tokens are `--z-index-{tier}` → utilities `z-{tier}` everywhere.
- If subagent-driven: every implementer/reviewer prompt MUST forbid `git checkout/switch/reset/stash` (worktree safety) and run jest with `cd` into the worktree.
