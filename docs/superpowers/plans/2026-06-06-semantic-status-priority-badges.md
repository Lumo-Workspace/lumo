# Semantic StatusBadge / PriorityBadge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land cva-light semantic `StatusBadge` / `PriorityBadge` driven by `--status-*` / new `--priority-*` tokens, migrate the core read-only list/detail surfaces to them, and delete the raw palette assembly.

**Architecture:** Add `--priority-*` design tokens to `globals.css` (mirroring `--status-*`). Token-ise `PRIORITY_CONFIG` and add an i18n label-id map. `StatusBadge` reuses the existing `StatusIcon`; `PriorityBadge` evolves in place with an `icon` (icon+label) and `bare` (icon-only) variant. Labels resolve via `react-intl` (status keys already exist; add 4 priority keys across all 16 locales). Migrate 4 sites.

**Tech Stack:** Next.js 14 (App Router), TypeScript (strict), Tailwind v4 (`@theme`), react-intl, Jest + @testing-library/react (jsdom).

**Branch:** `lumo/LUM-263-semantic-status-priority-badges` (already created).

---

## File Structure

| File                                                                    | Responsibility                                                        | Action |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------- | ------ |
| `app/globals.css`                                                       | `--priority-*` token defs (`:root` + `.dark`) + `@theme` registration | Modify |
| `__tests__/styles/globals-css-color-tokens.test.ts`                     | Guard: priority tokens present, oklch, per-mode divergence            | Modify |
| `app/workspace/[workspaceUrl]/components/fields/shared.tsx`             | `PRIORITY_CONFIG` token colors + new `PRIORITY_LABEL_ID`              | Modify |
| `app/workspace/[workspaceUrl]/components/fields/index.ts`               | Re-export `PRIORITY_LABEL_ID`                                         | Modify |
| `lib/i18n/*.json` (16 files)                                            | `priority.{urgent,high,medium,low}` labels                            | Modify |
| `app/workspace/[workspaceUrl]/components/PriorityBadge.tsx`             | `icon`/`bare` variant, i18n label, token color                        | Modify |
| `app/workspace/[workspaceUrl]/components/StatusBadge.tsx`               | New: StatusIcon + i18n label                                          | Create |
| `__tests__/components/PriorityBadge.test.tsx`                           | Variant + label render tests                                          | Create |
| `__tests__/components/StatusBadge.test.tsx`                             | Label render test                                                     | Create |
| `app/workspace/[workspaceUrl]/components/data-table/task-columns.tsx`   | Migrate status + priority read-only cells                             | Modify |
| `app/workspace/[workspaceUrl]/components/summary/RichReportContent.tsx` | Migrate inline priority enrichment                                    | Modify |
| `app/workspace/[workspaceUrl]/sprints/components/SprintSidebar.tsx`     | Migrate priority breakdown row                                        | Modify |

`SortableTaskCard.tsx` is intentionally **not** edited: it already renders `<PriorityBadge priority={...} />`, which keeps the new default `bare` variant — its icon color updates automatically through `PRIORITY_CONFIG`.

---

## Task 1: `--priority-*` design tokens

**Files:**

- Modify: `app/globals.css` (`:root` block near line 553, `.dark` block, `@theme inline` block near line 682)
- Modify: `__tests__/styles/globals-css-color-tokens.test.ts`

Values: light (`:root`) uses contrast-corrected shades (≥3:1 on `#fff`, the light-mode offender for graphics); dark keeps the bright shades (already pass on `#0a0a0a`). `urgent` (red) passes both modes, so it has a single `:root` def with no `.dark` override — mirroring how `--status-in-progress`/`--status-in-review` are shared. `high`/`medium`/`low` diverge per mode like `--status-todo`/`--status-done`.

- [ ] **Step 1: Add the guard expectations first (TDD for the token layer)**

In `__tests__/styles/globals-css-color-tokens.test.ts`, add the four tokens to the `COLOR_TOKENS` array, immediately after the `'danger-foreground',` line:

```ts
  'danger-foreground',
  // LUM-263 priority colors (oklch; light contrast-corrected, dark bright).
  'priority-urgent',
  'priority-high',
  'priority-medium',
  'priority-low',
] as const
```

Then append this block at the end of the file:

```ts
// LUM-263: priority colors mirror the status approach — light mode is the
// contrast offender for small graphics, so high/medium/low are darkened in
// :root and kept bright in .dark. urgent (red) passes both modes (single def).
describe('priority color tokens (globals.css)', () => {
  const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8')
  const darkBlock = css.slice(
    css.indexOf('.dark {'),
    css.indexOf('@theme inline')
  )

  it.each(['priority-high', 'priority-medium', 'priority-low'])(
    '.dark redefines --%s (brighter on the dark background)',
    token => {
      expect(darkBlock).toMatch(new RegExp(`--${token}:\\s*oklch\\(`))
    }
  )

  it('--priority-urgent has no .dark override (red passes both modes)', () => {
    expect(darkBlock).not.toMatch(/--priority-urgent:/)
  })
})
```

Note: `readFileSync` and `join` are already imported at the top of this file.

- [ ] **Step 2: Run the guard test to verify it fails**

Run: `npx jest __tests__/styles/globals-css-color-tokens.test.ts --no-coverage`
Expected: FAIL — `--priority-*` not yet defined (`is defined at least once` and `.dark redefines` assertions fail).

- [ ] **Step 3: Add the `:root` token defs**

In `app/globals.css`, immediately after the `--danger-border: …;` line (end of the feedback block, ~line 553) and before the blank line preceding `--font-inter`, insert:

```css
/* Semantic priority colors (LUM-263). Single source for PriorityBadge /
     PriorityIcon / PrioritySelect (was raw text-red-500/orange-500/yellow-500/
     zinc-400). Like the status tokens, LIGHT mode is the graphics-contrast
     offender, so high/medium/low are darkened here to clear WCAG 3:1 on #fff;
     the bright dark-mode counterparts live in the .dark block. urgent (red)
     passes both modes, so it has no .dark override. */
--priority-urgent: oklch(
  0.6369 0.2079 25.334
); /* #ef4444 red-500, 3.7:1 on #fff */
--priority-high: oklch(0.646 0.222 41.116); /* #ea580c orange-600, ~3.4:1 */
--priority-medium: oklch(0.681 0.162 75.834); /* #ca8a04 yellow-600, ~3.1:1 */
--priority-low: oklch(0.552 0.016 285.938); /* #71717b zinc-500, ~4.6:1 */
```

(Guard constraint: no `{` `}` or the literal `@theme inline` inside these comments.)

- [ ] **Step 4: Add the `.dark` overrides**

In `app/globals.css`, inside the `.dark { … }` block, immediately after the dark feedback accents (the `--danger: oklch(0.7106 0.1662 22.222);` line, ~line 663) and before the block's closing `}`, insert:

```css
/* Priority — bright shades on the dark background (#0a0a0a); these already
     clear 3:1 there, so they restore the original light/dark-identical look the
     raw Tailwind classes had. urgent is shared from :root. */
--priority-high: oklch(0.705 0.213 47.604); /* orange-500 */
--priority-medium: oklch(0.795 0.184 86.047); /* yellow-500 */
--priority-low: oklch(0.705 0.015 286.067); /* zinc-400 */
```

- [ ] **Step 5: Register the `@theme` utilities**

In `app/globals.css`, in the `@theme inline { … }` block, immediately after the `--color-danger-border: var(--danger-border);` line (~line 699), insert:

```css
/* Semantic priority utilities: generates .text-priority-urgent / etc. */
--color-priority-urgent: var(--priority-urgent);
--color-priority-high: var(--priority-high);
--color-priority-medium: var(--priority-medium);
--color-priority-low: var(--priority-low);
```

- [ ] **Step 6: Run the full styles guard suite**

Run: `npx jest __tests__/styles/ --no-coverage`
Expected: PASS (all four files green — color-tokens, status-color-tokens, radius-elevation, typography-scale).

- [ ] **Step 7: Commit**

```bash
git add app/globals.css __tests__/styles/globals-css-color-tokens.test.ts
git commit -m "feat: add --priority-* design tokens [LUM-263]"
```

---

## Task 2: Token-ise `PRIORITY_CONFIG` + i18n label keys

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/fields/shared.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/fields/index.ts`
- Modify: `lib/i18n/*.json` (16 files)

- [ ] **Step 1: Swap `iconColor` to tokens and add `PRIORITY_LABEL_ID`**

In `shared.tsx`, replace the `PRIORITY_CONFIG` object's `iconColor` values and add the label-id map. Replace the existing `PRIORITY_CONFIG` block with:

```ts
export const PRIORITY_CONFIG: Record<
  ApiPriority,
  {
    label: string
    Icon: ComponentType<{ className?: string }>
    iconColor: string
  }
> = {
  URGENT: {
    label: 'Urgent',
    Icon: BatteryWarning,
    iconColor: 'text-priority-urgent',
  },
  HIGH: {
    label: 'High',
    Icon: BatteryLow,
    iconColor: 'text-priority-high',
  },
  MEDIUM: {
    label: 'Medium',
    Icon: BatteryMedium,
    iconColor: 'text-priority-medium',
  },
  LOW: {
    label: 'Low',
    Icon: BatteryFull,
    iconColor: 'text-priority-low',
  },
}

/** react-intl message ids for priority labels (LUM-263). `label` above stays
 *  the English fallback consumed by the inline selects. */
export const PRIORITY_LABEL_ID: Record<ApiPriority, string> = {
  URGENT: 'priority.urgent',
  HIGH: 'priority.high',
  MEDIUM: 'priority.medium',
  LOW: 'priority.low',
}
```

- [ ] **Step 2: Re-export `PRIORITY_LABEL_ID` from the barrel**

In `app/workspace/[workspaceUrl]/components/fields/index.ts`, add `PRIORITY_LABEL_ID` to the `from './shared'` re-export block:

```ts
export {
  FIELD_TRIGGER_CLS,
  FieldValueSkeleton,
  SeparatorDot,
  PriorityIcon,
  PRIORITY_CONFIG,
  PRIORITY_LABEL_ID,
  MemberAvatar,
} from './shared'
```

- [ ] **Step 3: Add the four priority keys to `lib/i18n/en.json`**

Insert these keys (alphabetical placement near the existing `priority.*` keys, after `"priority.aiRecommended"`):

```json
  "priority.high": "High",
  "priority.low": "Low",
  "priority.medium": "Medium",
  "priority.urgent": "Urgent",
```

(JSON keys are sorted; place each in its sorted position. The exact ordering only needs to keep the file valid JSON — `npm run i18n:check` validates key parity, not order.)

- [ ] **Step 4: Add the four keys to the other 15 locales with real translations**

Add `priority.high`, `priority.low`, `priority.medium`, `priority.urgent` to each file with these values (NO `[TODO:…]` placeholders — CLAUDE.md forbids shipping them):

| file          | urgent     | high    | medium     | low     |
| ------------- | ---------- | ------- | ---------- | ------- |
| `zh-CN.json`  | 紧急       | 高      | 中         | 低      |
| `zh-TW.json`  | 緊急       | 高      | 中         | 低      |
| `en-GB.json`  | Urgent     | High    | Medium     | Low     |
| `en-AU.json`  | Urgent     | High    | Medium     | Low     |
| `es.json`     | Urgente    | Alta    | Media      | Baja    |
| `es-419.json` | Urgente    | Alta    | Media      | Baja    |
| `fr.json`     | Urgent     | Élevée  | Moyenne    | Faible  |
| `de.json`     | Dringend   | Hoch    | Mittel     | Niedrig |
| `ja.json`     | 緊急       | 高      | 中         | 低      |
| `ko.json`     | 긴급       | 높음    | 보통       | 낮음    |
| `hi.json`     | अत्यावश्यक | उच्च    | मध्यम      | निम्न   |
| `ru.json`     | Срочный    | Высокий | Средний    | Низкий  |
| `vi.json`     | Khẩn cấp   | Cao     | Trung bình | Thấp    |
| `id.json`     | Mendesak   | Tinggi  | Sedang     | Rendah  |
| `ms.json`     | Penting    | Tinggi  | Sederhana  | Rendah  |

- [ ] **Step 5: Verify locale parity + drift**

Run: `npm run i18n:check`
Expected: no drift reported (all locales have the 4 new keys, non-empty).

Run: `npx jest __tests__/i18n-locale-parity.test.ts --no-coverage`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "app/workspace/[workspaceUrl]/components/fields/shared.tsx" "app/workspace/[workspaceUrl]/components/fields/index.ts" lib/i18n/
git commit -m "feat: token-ise PRIORITY_CONFIG + add priority label keys (16 locales) [LUM-263]"
```

---

## Task 3: `PriorityBadge` — `icon` / `bare` variants

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/PriorityBadge.tsx`
- Test: `__tests__/components/PriorityBadge.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/PriorityBadge.test.tsx`:

```tsx
/** @jest-environment jsdom */

const enMessages: Record<string, string> = {
  'priority.urgent': 'Urgent',
  'priority.high': 'High',
  'priority.medium': 'Medium',
  'priority.low': 'Low',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => enMessages[id] ?? id,
  }),
}))

import { render, screen } from '@testing-library/react'
import { PriorityBadge } from '@/app/workspace/[workspaceUrl]/components/PriorityBadge'

describe('PriorityBadge', () => {
  it('icon variant renders the localized label', () => {
    render(<PriorityBadge priority='URGENT' variant='icon' />)
    expect(screen.getByText('Urgent')).toBeInTheDocument()
  })

  it('bare variant renders no visible label text', () => {
    render(<PriorityBadge priority='HIGH' variant='bare' />)
    expect(screen.queryByText('High')).not.toBeInTheDocument()
  })

  it('defaults to bare (preserves existing icon-only call sites)', () => {
    render(<PriorityBadge priority='LOW' />)
    expect(screen.queryByText('Low')).not.toBeInTheDocument()
  })

  it('icon variant honors a label override', () => {
    render(<PriorityBadge priority='MEDIUM' variant='icon' label='P2' />)
    expect(screen.getByText('P2')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/PriorityBadge.test.tsx --no-coverage`
Expected: FAIL — current `PriorityBadge` has no `variant`/`label` props and always renders icon-only (the `icon variant renders the localized label` case fails).

- [ ] **Step 3: Rewrite `PriorityBadge.tsx`**

Replace the full contents of `app/workspace/[workspaceUrl]/components/PriorityBadge.tsx` with:

```tsx
'use client'

import { useIntl } from 'react-intl'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { ApiPriority } from '../types'
import { PRIORITY_CONFIG, PRIORITY_LABEL_ID } from './fields'

export type PriorityBadgeVariant = 'icon' | 'bare'

/**
 * Semantic priority indicator (LUM-263).
 * - `bare` (default): icon only + tooltip — the historical behavior, kept for
 *   dense surfaces (board cards).
 * - `icon`: icon + visible localized label, for list/detail read-only cells.
 * Color comes from --priority-* tokens via PRIORITY_CONFIG.iconColor.
 */
export function PriorityBadge({
  priority,
  variant = 'bare',
  label,
}: {
  priority: ApiPriority
  variant?: PriorityBadgeVariant
  label?: string
}) {
  const intl = useIntl()
  const { Icon, iconColor } =
    PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG.MEDIUM
  const text = label ?? intl.formatMessage({ id: PRIORITY_LABEL_ID[priority] })

  if (variant === 'bare') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn(iconColor)}>
            <Icon className='size-4' />
          </span>
        </TooltipTrigger>
        <TooltipContent>{text}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <span className='inline-flex items-center gap-1.5 text-caption'>
      <span className={cn(iconColor)}>
        <Icon className='size-4' />
      </span>
      {text}
    </span>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/components/PriorityBadge.test.tsx --no-coverage`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add "app/workspace/[workspaceUrl]/components/PriorityBadge.tsx" __tests__/components/PriorityBadge.test.tsx
git commit -m "feat: PriorityBadge icon/bare variants + i18n label [LUM-263]"
```

---

## Task 4: `StatusBadge` — icon + label

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/StatusBadge.tsx`
- Test: `__tests__/components/StatusBadge.test.tsx`

StatusBadge has a single shape (icon + label) — for a bare icon, callers use `StatusIcon` directly (no redundant `bare` variant). Reuses the existing `status.*` i18n keys (already present in all 16 locales).

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/StatusBadge.test.tsx`:

```tsx
/** @jest-environment jsdom */

const enMessages: Record<string, string> = {
  'status.todo': 'Todo',
  'status.inProgress': 'In Progress',
  'status.inReview': 'In Review',
  'status.done': 'Done',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => enMessages[id] ?? id,
  }),
}))

import { render, screen } from '@testing-library/react'
import { StatusBadge } from '@/app/workspace/[workspaceUrl]/components/StatusBadge'

describe('StatusBadge', () => {
  it('renders the localized label for each status', () => {
    render(<StatusBadge status='IN_PROGRESS' />)
    expect(screen.getByText('In Progress')).toBeInTheDocument()
  })

  it('honors a label override', () => {
    render(<StatusBadge status='DONE' label='Shipped' />)
    expect(screen.getByText('Shipped')).toBeInTheDocument()
  })

  it('falls back to todo label for an unknown status', () => {
    render(<StatusBadge status='WAT' />)
    expect(screen.getByText('Todo')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/components/StatusBadge.test.tsx --no-coverage`
Expected: FAIL — module `StatusBadge` does not exist.

- [ ] **Step 3: Create `StatusBadge.tsx`**

```tsx
'use client'

import { useIntl } from 'react-intl'
import { StatusIcon } from './StatusIcon'

/** react-intl message ids for task-status labels (keys already exist in all
 *  16 locales — also used by <StatusIcon> aria-labels). */
const STATUS_LABEL_ID: Record<string, string> = {
  TODO: 'status.todo',
  IN_PROGRESS: 'status.inProgress',
  IN_REVIEW: 'status.inReview',
  DONE: 'status.done',
}

/**
 * Semantic status indicator (LUM-263): the canonical StatusIcon + a localized
 * label. For a bare icon, use <StatusIcon> directly. Color flows from the
 * --status-* tokens through StatusIcon.
 */
export function StatusBadge({
  status,
  label,
  size = 14,
}: {
  status: string
  label?: string
  size?: number
}) {
  const intl = useIntl()
  const text =
    label ??
    intl.formatMessage({ id: STATUS_LABEL_ID[status] ?? 'status.todo' })
  return (
    <span className='inline-flex items-center gap-1.5 text-caption'>
      <StatusIcon status={status} size={size} />
      {text}
    </span>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/components/StatusBadge.test.tsx --no-coverage`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add "app/workspace/[workspaceUrl]/components/StatusBadge.tsx" __tests__/components/StatusBadge.test.tsx
git commit -m "feat: StatusBadge (StatusIcon + i18n label) [LUM-263]"
```

---

## Task 5: Migrate the four call sites

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/data-table/task-columns.tsx`
- Modify: `app/workspace/[workspaceUrl]/components/summary/RichReportContent.tsx`
- Modify: `app/workspace/[workspaceUrl]/sprints/components/SprintSidebar.tsx`

- [ ] **Step 1: task-columns — status read-only cell → `StatusBadge`**

In `task-columns.tsx`, add the import (top of file, alongside the other component imports):

```ts
import { StatusBadge } from '../StatusBadge'
```

Replace the status read-only return:

```tsx
return (
  <div className='flex items-center gap-2 text-muted-foreground'>
    <span className='text-caption'>
      {API_STATUS_LABEL[task.status] ?? task.status}
    </span>
  </div>
)
```

with:

```tsx
return <StatusBadge status={task.status} />
```

- [ ] **Step 2: task-columns — priority read-only cell → `PriorityBadge`**

Ensure `PriorityBadge` is imported (top of file):

```ts
import { PriorityBadge } from '../PriorityBadge'
```

Replace the priority read-only return:

```tsx
return (
  <span className='text-caption text-muted-foreground'>{task.priority}</span>
)
```

with:

```tsx
return <PriorityBadge priority={task.priority} variant='icon' />
```

- [ ] **Step 3: Remove the now-unused `API_STATUS_LABEL` import if orphaned**

Run: `grep -n "API_STATUS_LABEL" "app/workspace/[workspaceUrl]/components/data-table/task-columns.tsx"`
If the only remaining reference is the import line, delete that import line. If it's used elsewhere in the file, leave it.

- [ ] **Step 4: RichReportContent — inline priority enrichment → `PriorityBadge variant="icon"`**

In `RichReportContent.tsx`, replace:

```tsx
return (
  <span key={`p-${i}`} className='inline-flex items-center gap-0.5'>
    <PriorityBadge priority={priority} />
    <span className='text-xs font-medium'>{match}</span>
  </span>
)
```

with:

```tsx
return <PriorityBadge key={`p-${i}`} priority={priority} variant='icon' />
```

(The visible text changes from the raw matched keyword to the localized label — an intended improvement.)

- [ ] **Step 5: SprintSidebar — priority breakdown row → `PriorityBadge variant="icon"`**

In `SprintSidebar.tsx`, add the import:

```ts
import { PriorityBadge } from '../../components/PriorityBadge'
```

Replace:

```tsx
<span className='flex items-center gap-1.5'>
  <PriorityIcon priority={bucket.priority} />
  <span>{PRIORITY_CONFIG[bucket.priority].label}</span>
</span>
```

with:

```tsx
<PriorityBadge priority={bucket.priority} variant='icon' />
```

Then remove any now-unused `PriorityIcon` / `PRIORITY_CONFIG` imports in this file (check with grep below).

Run: `grep -nE "PriorityIcon|PRIORITY_CONFIG" "app/workspace/[workspaceUrl]/sprints/components/SprintSidebar.tsx"`
Delete from the import only the names with no remaining usage.

- [ ] **Step 6: Verify the import path for SprintSidebar**

`SprintSidebar.tsx` lives at `app/workspace/[workspaceUrl]/sprints/components/`; `PriorityBadge` lives at `app/workspace/[workspaceUrl]/components/`. The relative path is `../../components/PriorityBadge`. Confirm:

Run: `ls "app/workspace/[workspaceUrl]/components/PriorityBadge.tsx"`
Expected: the file exists (path is correct).

- [ ] **Step 7: Typecheck + token lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint:tokens`
Expected: passes; violation count drops (the priority `text-red-500`/`orange-500`/`yellow-500`/`zinc-400` classes are gone) with no new violations. If the tool reports the count, note the before/after in the PR.

- [ ] **Step 8: Run the affected component tests**

Run: `npx jest __tests__/components/ __tests__/styles/ __tests__/i18n-locale-parity.test.ts --no-coverage`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add "app/workspace/[workspaceUrl]/components/data-table/task-columns.tsx" "app/workspace/[workspaceUrl]/components/summary/RichReportContent.tsx" "app/workspace/[workspaceUrl]/sprints/components/SprintSidebar.tsx"
git commit -m "refactor: migrate status/priority read-only surfaces to semantic badges [LUM-263]"
```

---

## Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: PASS (no regressions). If a pre-existing unrelated failure appears, capture it and confirm it also fails on `origin/main` before treating it as out of scope.

- [ ] **Step 3: Token lint final**

Run: `npm run lint:tokens`
Expected: passes; confirm the net violation reduction.

- [ ] **Step 4: i18n drift final**

Run: `npm run i18n:check`
Expected: no drift.

- [ ] **Step 5: Confirm no `prisma/migrations/` deletions in the diff**

Run: `git diff --stat origin/main...HEAD -- prisma/migrations/`
Expected: empty output (this task touches no migrations; guards against the stale-branch false-deletion trap).

- [ ] **Step 6: Open the PR**

```bash
git push -u origin lumo/LUM-263-semantic-status-priority-badges
gh pr create --title "feat: semantic StatusBadge/PriorityBadge + --priority-* tokens [LUM-263]" --body "$(cat <<'EOF'
## Summary
- Add `--priority-*` design tokens (oklch; light contrast-corrected, dark bright), mirroring `--status-*`.
- Token-ise `PRIORITY_CONFIG` (drops raw `text-red-500`/`orange-500`/`yellow-500`/`zinc-400`).
- `PriorityBadge`: `icon`/`bare` variants + react-intl label (default `bare` preserves existing call sites).
- `StatusBadge`: new — `StatusIcon` + react-intl label.
- Add `priority.{urgent,high,medium,low}` across all 16 locales (real translations).
- Migrate read-only surfaces: data-table status + priority cells, RichReportContent, SprintSidebar.

## Out of scope
Sprint state badge, AgentStatusBadge (different enums), ProjectsPage status-count, BoardView header (already token-ised), generic badge.tsx/button.tsx, `dot`/`pill` variants (no consumer yet — cva structured for later addition).

## Checklist
- [x] Tests written and passing (StatusBadge, PriorityBadge, styles guards, i18n parity)
- [x] No TypeScript errors (npx tsc --noEmit)
- [x] No console.log
- [x] Branch follows lumo/{task-id}-{description}
- [x] No new npm packages; no migrations
- [x] lint:tokens violation count reduced
EOF
)"
```

(No `cli/src/commands/` changes → SKILL.md update not required.)

---

## Self-Review

**Spec coverage:**

- Token layer (`--priority-*`, `:root`+`.dark`+`@theme`, guard) → Task 1 ✓
- Component layer (StatusBadge reuses StatusIcon; PriorityBadge `icon`/`bare`; cva-light container; YAGNI variant trim) → Tasks 3, 4 ✓
- i18n (priority keys × 16 locales, real translations, `label?` override; status keys reused) → Tasks 2, 3, 4 ✓
- Migration (5 sites; SortableTaskCard no-op documented) → Task 5 ✓
- Testing & guards (jsdom render, full `__tests__/styles/`, tsc, lint:tokens, i18n:check) → Tasks 1–6 ✓
- Out of scope honored (no sprint/agent/ProjectsPage/BoardView/badge.tsx edits) ✓

**Placeholder scan:** No TBD/TODO; all code blocks complete; i18n values are real, not `[TODO:…]`.

**Type consistency:** `PriorityBadgeVariant = 'icon' | 'bare'`, prop `variant`/`label` used consistently across component + tests; `PRIORITY_LABEL_ID` / `STATUS_LABEL_ID` names match between definition (Task 2 / Task 4) and use; `iconColor` token classes match the `@theme` registrations from Task 1.
