# Utils + Hooks Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete ~4,176 lines of dead code (5 unused hooks + entire `/utils/` directory), promote 4 universal helpers from `app/workspace/[workspaceUrl]/utils.ts` into `lib/utils/`, rename `slugifyProjectName` → `slugify`, and split the workspace `utils.ts` file into a `utils/` directory with a barrel.

**Architecture:** Pure cleanup — zero behavior change. Function bodies move verbatim. Import paths are either preserved (via a workspace barrel `index.ts`) or rewritten in bulk. Each commit is a standalone unit that passes all three gates (`npx tsc --noEmit`, `npm test`, `npm run build`).

**Tech Stack:** TypeScript strict mode, Next.js 14 App Router, Jest (jsdom env), Prettier.

**Spec:** [docs/superpowers/specs/2026-04-16-utils-hooks-cleanup-design.md](../specs/2026-04-16-utils-hooks-cleanup-design.md)

---

## Prerequisites

- Working directory: `/Users/chaoli/Desktop/lumo/lumo`
- Start from a clean `main` (no uncommitted changes, pulled latest)
- Node/npm installed, `npm install` already run
- The spec has been read and approved

---

## Branch Strategy

All tasks run on a single branch. Create it once at the start:

```bash
git checkout main
git pull
git checkout -b lumo/LUM-TBD-utils-hooks-cleanup
```

Each task ends in one commit. Commit messages use the pattern:

```
<type>: <description> [LUM-TBD]
```

Where `<type>` is `chore` (deletions), `refactor` (moves/renames), or `test` (new tests).

---

## Task 1: Pre-flight verification

**Files:** none modified — this task only runs checks.

**Purpose:** Confirm the grep-based assumptions from the spec are still valid on the current `main`. If any assumption fails (e.g., someone added a new import of a supposedly dead hook), the executor must pause and re-check the spec before deleting anything.

- [ ] **Step 1: Confirm working tree is clean and on main**

Run:

```bash
git status
git rev-parse --abbrev-ref HEAD
```

Expected: `nothing to commit, working tree clean` and branch `main`.

- [ ] **Step 2: Create the working branch**

Run:

```bash
git checkout -b lumo/LUM-TBD-utils-hooks-cleanup
```

Expected: `Switched to a new branch 'lumo/LUM-TBD-utils-hooks-cleanup'`.

- [ ] **Step 3: Verify the 5 "dead" hooks have zero importers outside `hooks/`**

Run:

```bash
grep -rn "useTaskManagement\|useReact19Optimized\|usePerformance\|useLazyLoad\|useMeasurePerformance\|useOptimizedState\|useOptimizedReducer\|useOptimizedCallback" --include="*.ts" --include="*.tsx" app components lib __tests__ tests 2>/dev/null | grep -v "^hooks/"
```

Expected: **no output**. If any file is listed, STOP — one of the hooks is actually in use. Update the spec before proceeding.

- [ ] **Step 4: Verify the root `/utils/` directory has zero importers**

Run:

```bash
grep -rn "from ['\"]@/utils\|from ['\"]\\.\\./\\.\\./\\.\\./\\.\\./utils\\b\|from ['\"]\\.\\./\\.\\./\\.\\./\\.\\./\\.\\./utils\\b" --include="*.ts" --include="*.tsx" app components lib hooks __tests__ tests 2>/dev/null
```

Expected: **no output**. (The `@/utils` alias and any relative import reaching the repo root.) If anything matches, STOP and revisit.

- [ ] **Step 5: Record the baseline file counts to sanity-check the final diff**

Run:

```bash
find utils -type f 2>/dev/null | wc -l
find hooks -maxdepth 1 -name 'use-*.ts' 2>/dev/null | wc -l
wc -l app/workspace/\[workspaceUrl\]/utils.ts
```

Expected:

- 6 files under `utils/`
- 13 files under `hooks/` (matches ls earlier)
- 196 lines in `app/workspace/[workspaceUrl]/utils.ts`

Record these numbers. After the final task, the respective counts should be: 0 (directory gone), 8 (5 hooks removed), and the file should no longer exist.

- [ ] **Step 6: Run all three verification gates on pristine `main` to establish a green baseline**

Run in parallel (3 terminals) or sequentially:

```bash
npx tsc --noEmit
npm test
npm run build
```

Expected: all three exit 0. **If any fails before we've touched anything, STOP** — the issue is pre-existing and not this plan's concern. Report to the user.

---

## Task 2: Delete 5 unused hooks

**Files:**

- Delete: `hooks/use-task-management.ts`
- Delete: `hooks/use-task-management-v2.ts`
- Delete: `hooks/use-react19-optimized.ts`
- Delete: `hooks/use-performance.ts`
- Delete: `hooks/use-optimized-state.ts`

This is a pure deletion task. No TDD cycle — there's no new code to drive with tests.

- [ ] **Step 1: Delete the 5 hook files**

Run:

```bash
rm hooks/use-task-management.ts \
   hooks/use-task-management-v2.ts \
   hooks/use-react19-optimized.ts \
   hooks/use-performance.ts \
   hooks/use-optimized-state.ts
```

- [ ] **Step 2: Verify TypeScript still compiles**

Run: `npx tsc --noEmit`

Expected: exit 0, no errors.

- [ ] **Step 3: Verify all tests still pass**

Run: `npm test`

Expected: exit 0, all tests pass.

- [ ] **Step 4: Verify Next.js build still succeeds**

Run: `npm run build`

Expected: exit 0, production build completes.

- [ ] **Step 5: Commit**

```bash
git add -A hooks/
git commit -m "chore: remove unused hooks [LUM-TBD]

Five hooks had zero importers outside the hooks/ directory:
- use-task-management.ts (42 lines)
- use-task-management-v2.ts (553 lines)
- use-react19-optimized.ts (417 lines)
- use-performance.ts (411 lines)
- use-optimized-state.ts (401 lines)

Verified by grep across app/, components/, lib/, __tests__/, tests/
before deletion. -1,824 lines."
```

---

## Task 3: Delete `/utils/` directory and `@/utils/*` alias

**Files:**

- Delete: `utils/` (entire directory — 6 files)
- Modify: `tsconfig.json` (remove `@/utils/*` path entry)

- [ ] **Step 1: Delete the `/utils/` directory**

Run:

```bash
rm -rf utils/
```

- [ ] **Step 2: Remove `@/utils/*` from `tsconfig.json`**

Open `tsconfig.json`. In the `compilerOptions.paths` object, remove the single line:

```json
"@/utils/*": ["./utils/*"],
```

The resulting `paths` block looks like:

```json
"paths": {
  "@/*": ["./*"],
  "@/components/*": ["./components/*"],
  "@/hooks/*": ["./hooks/*"],
  "@/types/*": ["./types/*"],
  "@/constants/*": ["./constants/*"],
  "@/lib/*": ["./lib/*"]
},
```

- [ ] **Step 3: Verify TypeScript still compiles**

Run: `npx tsc --noEmit`

Expected: exit 0.

- [ ] **Step 4: Verify all tests still pass**

Run: `npm test`

Expected: exit 0.

- [ ] **Step 5: Verify Next.js build still succeeds**

Run: `npm run build`

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add -A utils/ tsconfig.json
git commit -m "chore: remove unused utils/ directory and @/utils alias [LUM-TBD]

The root utils/ directory (6 files, 2,252 lines) had zero importers
across app/, components/, lib/, hooks/, __tests__/, and tests/.
The @/utils/* tsconfig alias pointed at it and was likewise unused.

Removed files:
- utils/index.ts (514 lines)
- utils/dom.ts (479 lines)
- utils/validation.ts (444 lines)
- utils/performance.ts (416 lines)
- utils/error-handling.ts (370 lines)
- utils/kanban-utils.ts (129 lines)

Net -2,252 lines."
```

---

## Task 4: Add `lib/utils/keyboard.ts` with test

**Files:**

- Create: `lib/utils/keyboard.ts`
- Create: `__tests__/lib/utils/keyboard.test.ts`

Note: this task creates a file that no production code imports yet. The test imports it, so it's not orphaned. Call-site migration happens in Task 8 via the workspace barrel, which re-exports from this file.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/utils/keyboard.test.ts` with this content:

```ts
import type { KeyboardEvent } from 'react'
import { isMac, submitModLabel, isSubmitShortcut } from '@/lib/utils/keyboard'

describe('keyboard helpers', () => {
  it('isMac is a boolean', () => {
    expect(typeof isMac).toBe('boolean')
  })

  it('submitModLabel is "⌘" on Mac and "Ctrl" elsewhere', () => {
    expect(submitModLabel).toBe(isMac ? '⌘' : 'Ctrl')
  })
})

describe('isSubmitShortcut', () => {
  function makeEvent(
    overrides: Partial<{
      key: string
      metaKey: boolean
      ctrlKey: boolean
    }>
  ): KeyboardEvent {
    return {
      key: overrides.key ?? 'Enter',
      metaKey: overrides.metaKey ?? false,
      ctrlKey: overrides.ctrlKey ?? false,
    } as KeyboardEvent
  }

  it('returns false when key is not Enter', () => {
    expect(isSubmitShortcut(makeEvent({ key: 'a', metaKey: true }))).toBe(false)
  })

  it('returns true on Enter + correct modifier for current OS', () => {
    const e = makeEvent(isMac ? { metaKey: true } : { ctrlKey: true })
    expect(isSubmitShortcut(e)).toBe(true)
  })

  it('returns false on Enter with no modifier', () => {
    expect(isSubmitShortcut(makeEvent({}))).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/lib/utils/keyboard.test.ts`

Expected: FAIL with `Cannot find module '@/lib/utils/keyboard'` (the source file doesn't exist yet).

- [ ] **Step 3: Create the source file**

Create `lib/utils/keyboard.ts` with this content:

```ts
import type { KeyboardEvent } from 'react'

/** Returns true if the user is on macOS / iOS */
export const isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform)

/** The submit modifier key label for the current OS */
export const submitModLabel = isMac ? '⌘' : 'Ctrl'

/** Returns true when the submit shortcut (Cmd/Ctrl + Enter) is pressed */
export function isSubmitShortcut(e: KeyboardEvent): boolean {
  return e.key === 'Enter' && (isMac ? e.metaKey : e.ctrlKey)
}
```

Note: the original in `workspace/utils.ts` used `React.KeyboardEvent` relying on an ambient React namespace. This version imports the type explicitly, which is cleaner and removes any dependence on ambient types. Behavior is identical.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/lib/utils/keyboard.test.ts`

Expected: PASS (5 tests).

- [ ] **Step 5: Verify full TypeScript compile**

Run: `npx tsc --noEmit`

Expected: exit 0.

- [ ] **Step 6: Verify full test suite**

Run: `npm test`

Expected: exit 0, all tests pass.

- [ ] **Step 7: Verify Next.js build**

Run: `npm run build`

Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add lib/utils/keyboard.ts __tests__/lib/utils/keyboard.test.ts
git commit -m "refactor: add lib/utils/keyboard.ts with OS helpers [LUM-TBD]

Introduces lib/utils/keyboard.ts with isMac, submitModLabel, and
isSubmitShortcut. Same behavior as the originals in
app/workspace/[workspaceUrl]/utils.ts, but with an explicit
import type { KeyboardEvent } from 'react' instead of relying on
the ambient React namespace.

Call-site migration happens in task 8 via the workspace barrel.
A minimal Jest test covers boolean typing, Mac/non-Mac label, and
the three branches of isSubmitShortcut."
```

---

## Task 5: Add `lib/utils/formatTimestamp.ts` with test

**Files:**

- Create: `lib/utils/formatTimestamp.ts`
- Create: `__tests__/lib/utils/formatTimestamp.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/utils/formatTimestamp.test.ts`:

```ts
import { formatTimestamp } from '@/lib/utils/formatTimestamp'

describe('formatTimestamp', () => {
  const NOW = new Date('2026-04-16T14:00:00.000Z')

  beforeAll(() => {
    jest.useFakeTimers()
    jest.setSystemTime(NOW)
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  it('returns "just now" when less than 60 seconds ago', () => {
    const d = new Date(NOW.getTime() - 30_000)
    expect(formatTimestamp(d)).toBe('just now')
  })

  it('returns "Nm ago" between 1 and 59 minutes ago', () => {
    const d = new Date(NOW.getTime() - 23 * 60_000)
    expect(formatTimestamp(d)).toBe('23m ago')
  })

  it('returns "Today HH:MM AM/PM" earlier the same day', () => {
    const d = new Date(NOW.getTime() - 6 * 60 * 60 * 1000) // 6h ago
    const result = formatTimestamp(d, 'en-US')
    expect(result.startsWith('Today ')).toBe(true)
  })

  it('returns "Yesterday" for the prior day', () => {
    const d = new Date(NOW.getTime() - 30 * 60 * 60 * 1000) // 30h ago
    expect(formatTimestamp(d)).toBe('Yesterday')
  })

  it('returns "Mon DD" for older dates in the same year', () => {
    const d = new Date('2026-02-01T12:00:00.000Z')
    expect(formatTimestamp(d, 'en-US')).toMatch(/^\w{3} \d+$/)
  })

  it('returns "Mon DD, YYYY" for older dates in prior years', () => {
    const d = new Date('2024-02-01T12:00:00.000Z')
    expect(formatTimestamp(d, 'en-US')).toMatch(/^\w{3} \d+, 2024$/)
  })

  it('accepts custom i18n messages', () => {
    const d = new Date(NOW.getTime() - 10_000)
    expect(formatTimestamp(d, 'en-US', { justNow: '刚刚' })).toBe('刚刚')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/lib/utils/formatTimestamp.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Create the source file**

Create `lib/utils/formatTimestamp.ts`:

```ts
/**
 * Format a timestamp according to the app's display rules:
 *  < 1 min         → "just now"
 *  1–59 min        → "23m ago"
 *  same day        → "Today 2:23 PM"
 *  yesterday       → "Yesterday"
 *  this year       → "Mar 21"
 *  older           → "Mar 21, 2025"
 */
export function formatTimestamp(
  date: Date | string,
  locale: string = 'en',
  messages?: {
    justNow?: string
    mAgo?: (m: number) => string
    today?: string
    yesterday?: string
  }
): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffMs / 60000)

  const justNow = messages?.justNow ?? 'just now'
  const mAgo = messages?.mAgo ?? ((m: number) => `${m}m ago`)
  const todayLabel = messages?.today ?? 'Today'
  const yesterdayLabel = messages?.yesterday ?? 'Yesterday'

  if (diffSec < 60) return justNow
  if (diffMin < 60) return mAgo(diffMin)

  const sameDate = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()

  if (sameDate(d, now)) {
    const time = d.toLocaleTimeString(locale, {
      hour: 'numeric',
      minute: '2-digit',
    })
    return `${todayLabel} ${time}`
  }

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (sameDate(d, yesterday)) return yesterdayLabel

  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
  }

  return d.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/lib/utils/formatTimestamp.test.ts`

Expected: PASS (7 tests).

- [ ] **Step 5: Verify full TypeScript compile**

Run: `npx tsc --noEmit`

Expected: exit 0.

- [ ] **Step 6: Verify full test suite**

Run: `npm test`

Expected: exit 0.

- [ ] **Step 7: Verify Next.js build**

Run: `npm run build`

Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add lib/utils/formatTimestamp.ts __tests__/lib/utils/formatTimestamp.test.ts
git commit -m "refactor: add lib/utils/formatTimestamp.ts [LUM-TBD]

Moves formatTimestamp verbatim from
app/workspace/[workspaceUrl]/utils.ts into lib/utils/formatTimestamp.ts.

Call-site migration happens in task 8 via the workspace barrel.
A Jest test using fake timers covers all six display branches
(just now / Nm ago / Today HH:MM / Yesterday / Mon DD / Mon DD, YYYY)
plus custom-message override."
```

---

## Task 6: Add `lib/utils/copyLink.ts`, migrate 6 call sites, delete `workspace/utils/copyLink.ts`

**Files:**

- Create: `lib/utils/copyLink.ts`
- Create: `__tests__/lib/utils/copyLink.test.ts`
- Modify: 6 call sites (import path rewrites)
- Delete: `app/workspace/[workspaceUrl]/utils/copyLink.ts`

Unlike tasks 4–5, this task migrates call sites in the same commit because `copyLink` was imported directly from `'../utils/copyLink'` (NOT through the barrel), and the workspace `utils/copyLink.ts` file is being deleted now.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/utils/copyLink.test.ts`:

```ts
import { copyLink } from '@/lib/utils/copyLink'
import { toast } from 'sonner'

jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}))

describe('copyLink', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn(),
      },
    })
  })

  it('writes the URL to the clipboard', async () => {
    ;(navigator.clipboard.writeText as jest.Mock).mockResolvedValue(undefined)
    await copyLink('https://example.com/foo')
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'https://example.com/foo'
    )
  })

  it('shows a success toast on resolve', async () => {
    ;(navigator.clipboard.writeText as jest.Mock).mockResolvedValue(undefined)
    await copyLink('https://example.com')
    expect(toast.success).toHaveBeenCalledWith('Link copied')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('shows an error toast on reject', async () => {
    ;(navigator.clipboard.writeText as jest.Mock).mockRejectedValue(
      new Error('nope')
    )
    await copyLink('https://example.com')
    expect(toast.error).toHaveBeenCalledWith('Failed to copy link')
    expect(toast.success).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/lib/utils/copyLink.test.ts`

Expected: FAIL — `@/lib/utils/copyLink` not found.

- [ ] **Step 3: Create the source file**

Create `lib/utils/copyLink.ts`:

```ts
import { toast } from 'sonner'

export async function copyLink(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url)
    toast.success('Link copied')
  } catch {
    toast.error('Failed to copy link')
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/lib/utils/copyLink.test.ts`

Expected: PASS (3 tests).

- [ ] **Step 5: Migrate the 6 call sites**

Each file has one line to rewrite. For each file below, find the import line matching the "Old" pattern and replace it with the "New" line.

**5.1** `app/workspace/[workspaceUrl]/components/CommentSection.tsx`

Old:

```ts
import { copyLink } from '../utils/copyLink'
```

New:

```ts
import { copyLink } from '@/lib/utils/copyLink'
```

**5.2** `app/workspace/[workspaceUrl]/components/TaskDetailComments.tsx`

Old:

```ts
import { copyLink } from '../utils/copyLink'
```

New:

```ts
import { copyLink } from '@/lib/utils/copyLink'
```

**5.3** `app/workspace/[workspaceUrl]/components/TaskDrawer.tsx`

Old:

```ts
import { copyLink } from '../utils/copyLink'
```

New:

```ts
import { copyLink } from '@/lib/utils/copyLink'
```

**5.4** `app/workspace/[workspaceUrl]/components/pages/ProjectDetailStandalonePage.tsx`

Old:

```ts
import { copyLink } from '../../utils/copyLink'
```

New:

```ts
import { copyLink } from '@/lib/utils/copyLink'
```

**5.5** `app/workspace/[workspaceUrl]/components/pages/ProjectsPage.tsx`

Old:

```ts
import { copyLink } from '../../utils/copyLink'
```

New:

```ts
import { copyLink } from '@/lib/utils/copyLink'
```

**5.6** `app/workspace/[workspaceUrl]/hooks/useTaskDetailActions.ts`

Old:

```ts
import { copyLink } from '../utils/copyLink'
```

New:

```ts
import { copyLink } from '@/lib/utils/copyLink'
```

- [ ] **Step 6: Delete the old workspace `copyLink.ts`**

Run:

```bash
rm app/workspace/\[workspaceUrl\]/utils/copyLink.ts
```

- [ ] **Step 7: Verify no stale imports remain**

Run:

```bash
grep -rn "from ['\"].*utils/copyLink['\"]" --include="*.ts" --include="*.tsx" app components lib hooks __tests__ tests 2>/dev/null | grep -v "@/lib/utils/copyLink"
```

Expected: **no output**. Every `copyLink` import now points at `@/lib/utils/copyLink`.

- [ ] **Step 8: Verify full TypeScript compile**

Run: `npx tsc --noEmit`

Expected: exit 0.

- [ ] **Step 9: Verify full test suite**

Run: `npm test`

Expected: exit 0.

- [ ] **Step 10: Verify Next.js build**

Run: `npm run build`

Expected: exit 0.

- [ ] **Step 11: Commit**

```bash
git add lib/utils/copyLink.ts \
        __tests__/lib/utils/copyLink.test.ts \
        app/workspace/\[workspaceUrl\]/ \
        -u  # captures the copyLink.ts deletion

git status  # sanity-check: 6 modified + 1 new src + 1 new test + 1 deleted
git commit -m "refactor: add lib/utils/copyLink.ts, migrate 6 call sites [LUM-TBD]

Promotes copyLink (clipboard + toast wrapper) from
app/workspace/[workspaceUrl]/utils/copyLink.ts to lib/utils/copyLink.ts
so non-workspace code can reuse it.

6 call sites rewritten to import from '@/lib/utils/copyLink':
- components/CommentSection.tsx
- components/TaskDetailComments.tsx
- components/TaskDrawer.tsx
- components/pages/ProjectDetailStandalonePage.tsx
- components/pages/ProjectsPage.tsx
- hooks/useTaskDetailActions.ts

Jest test covers clipboard success + error paths with mocked
navigator.clipboard and sonner toast."
```

---

## Task 7: Add `lib/utils/slugify.ts`, rename `slugifyProjectName` → `slugify`, migrate 14 call sites

**Files:**

- Create: `lib/utils/slugify.ts`
- Create: `__tests__/lib/utils/slugify.test.ts`
- Modify: 14 call sites (import + usage rewrite)

This task makes two coupled changes — a new file and a rename — so they ship together. After this task, **zero occurrences of `slugifyProjectName` remain in source code**.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/utils/slugify.test.ts`:

```ts
import { slugify } from '@/lib/utils/slugify'

describe('slugify', () => {
  it('lowercases and replaces spaces with dashes', () => {
    expect(slugify('My Project')).toBe('my-project')
  })

  it('strips punctuation', () => {
    expect(slugify('My Cool Project!')).toBe('my-cool-project')
  })

  it('collapses runs of dashes', () => {
    expect(slugify('foo  —  bar')).toBe('foo-bar')
  })

  it('trims leading and trailing dashes', () => {
    expect(slugify('  -foo-  ')).toBe('foo')
  })

  it('returns empty string for empty input', () => {
    expect(slugify('')).toBe('')
  })

  it('handles digits and alphanumerics', () => {
    expect(slugify('Project 2026 v2')).toBe('project-2026-v2')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/lib/utils/slugify.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Create the source file**

Create `lib/utils/slugify.ts`:

```ts
/**
 * Convert a string to a URL-safe slug.
 * e.g. "My Cool Project!" → "my-cool-project"
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/lib/utils/slugify.test.ts`

Expected: PASS (6 tests).

- [ ] **Step 5: Migrate the 14 call sites**

Each file has ONE `import { ..., slugifyProjectName, ... } from '...'` line and one or more usage sites. For each file:

1. Add `import { slugify } from '@/lib/utils/slugify'` (as a new line, keep it sorted alphabetically with the other `@/lib/*` imports if possible).
2. Remove `slugifyProjectName` from whatever existing import it's currently on. If that import becomes empty, delete the entire line.
3. Inside the file, replace every occurrence of `slugifyProjectName(` with `slugify(`.

Apply this transformation to each of the 14 files below. Three of them also import `copyLink` (already migrated in Task 6) — just confirm those lines already changed.

**5.1** `app/workspace/[workspaceUrl]/components/CommentSection.tsx`

Current (line 6):

```ts
import { slugifyProjectName } from '../utils'
```

After:

```ts
import { slugify } from '@/lib/utils/slugify'
```

Find every `slugifyProjectName(` in the file and change to `slugify(`.

**5.2** `app/workspace/[workspaceUrl]/components/DuplicateConfirm.tsx`

Current (line 6):

```ts
import { slugifyProjectName } from '../utils'
```

After:

```ts
import { slugify } from '@/lib/utils/slugify'
```

Replace `slugifyProjectName(` → `slugify(` throughout the file.

**5.3** `app/workspace/[workspaceUrl]/components/DuplicateWarning.tsx`

Current (line 13):

```ts
import { slugifyProjectName } from '../utils'
```

After:

```ts
import { slugify } from '@/lib/utils/slugify'
```

Replace usages.

**5.4** `app/workspace/[workspaceUrl]/components/SubtasksSection.tsx`

Current (line 23):

```ts
import { slugifyProjectName } from '../utils'
```

After:

```ts
import { slugify } from '@/lib/utils/slugify'
```

Replace usages.

**5.5** `app/workspace/[workspaceUrl]/components/TaskDetailComments.tsx`

Current (line 14):

```ts
import { slugifyProjectName } from '../utils'
```

After:

```ts
import { slugify } from '@/lib/utils/slugify'
```

Replace usages.

**5.6** `app/workspace/[workspaceUrl]/components/TaskDetailHeader.tsx`

Current (line 29):

```ts
import { slugifyProjectName } from '../utils'
```

After:

```ts
import { slugify } from '@/lib/utils/slugify'
```

Replace usages.

**5.7** `app/workspace/[workspaceUrl]/components/TaskDetailPanel.tsx`

Current (line 6):

```ts
import { slugifyProjectName } from '../utils'
```

After:

```ts
import { slugify } from '@/lib/utils/slugify'
```

Replace usages.

**5.8** `app/workspace/[workspaceUrl]/components/TaskDrawer.tsx`

Current (line 14):

```ts
import { slugifyProjectName } from '../utils'
```

After:

```ts
import { slugify } from '@/lib/utils/slugify'
```

Replace usages.

**5.9** `app/workspace/[workspaceUrl]/components/pages/ProjectDetailStandalonePage.tsx`

Current (line 22):

```ts
import { slugifyProjectName } from '../../utils'
```

After:

```ts
import { slugify } from '@/lib/utils/slugify'
```

Replace usages.

**5.10** `app/workspace/[workspaceUrl]/components/pages/ProjectsPage.tsx`

Current (line 29):

```ts
import { slugifyProjectName } from '../../utils'
```

After:

```ts
import { slugify } from '@/lib/utils/slugify'
```

Replace usages.

**5.11** `app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx`

This one has a COMBINED import. Current (line 29):

```ts
import { slugifyProjectName, pageToPath } from '../../utils'
```

Split into two lines:

```ts
import { slugify } from '@/lib/utils/slugify'
import { pageToPath } from '../../utils'
```

Then replace `slugifyProjectName(` → `slugify(` in the file body.

**5.12** `app/workspace/[workspaceUrl]/hooks/useTaskDetailState.ts`

Current (line 8):

```ts
import { slugifyProjectName } from '../utils'
```

After:

```ts
import { slugify } from '@/lib/utils/slugify'
```

Replace usages.

**5.13** `app/workspace/[workspaceUrl]/my-tasks/[identifier]/page.tsx`

Current (line 5):

```ts
import { slugifyProjectName } from '../../utils'
```

After:

```ts
import { slugify } from '@/lib/utils/slugify'
```

Replace usages.

**5.14** `app/workspace/[workspaceUrl]/project/[slug]/page.tsx`

Current (line 5):

```ts
import { slugifyProjectName } from '../../utils'
```

After:

```ts
import { slugify } from '@/lib/utils/slugify'
```

Replace usages.

- [ ] **Step 6: Verify no `slugifyProjectName` reference remains**

Run:

```bash
grep -rn "slugifyProjectName" --include="*.ts" --include="*.tsx" app components lib hooks __tests__ tests 2>/dev/null
```

Expected: **no output**. The symbol is fully renamed. (The symbol still exists inside `app/workspace/[workspaceUrl]/utils.ts` at this point, because Task 8 is where that file is deleted. So one result is expected inside `utils.ts` — that's fine, not a problem.)

Adjusted expectation:

```bash
grep -rn "slugifyProjectName" --include="*.ts" --include="*.tsx" app components lib hooks __tests__ tests 2>/dev/null | grep -v "app/workspace/\[workspaceUrl\]/utils.ts"
```

Expected: **no output**. Only the still-present definition inside `utils.ts` (which Task 8 deletes) remains.

- [ ] **Step 7: Verify full TypeScript compile**

Run: `npx tsc --noEmit`

Expected: exit 0.

The `noUnusedLocals` flag will catch the case where `slugifyProjectName` is imported but not used. But the `tsc` run here also catches the opposite: any call site that still uses `slugifyProjectName(` but imports `slugify` will fail with "Cannot find name 'slugifyProjectName'".

- [ ] **Step 8: Verify full test suite**

Run: `npm test`

Expected: exit 0.

- [ ] **Step 9: Verify Next.js build**

Run: `npm run build`

Expected: exit 0.

- [ ] **Step 10: Commit**

```bash
git add lib/utils/slugify.ts \
        __tests__/lib/utils/slugify.test.ts \
        app/workspace/\[workspaceUrl\]/

git commit -m "refactor: add lib/utils/slugify.ts, rename slugifyProjectName, migrate 14 call sites [LUM-TBD]

Promotes the generic string-slugifier from
app/workspace/[workspaceUrl]/utils.ts to lib/utils/slugify.ts
and renames slugifyProjectName → slugify (the function body was
already domain-neutral; the old name was misleading).

14 call sites updated to import { slugify } from '@/lib/utils/slugify'
and call slugify(x) instead of slugifyProjectName(x).

Jest test covers typical inputs, punctuation stripping, dash
collapsing, whitespace trimming, empty string, and alphanumerics."
```

---

## Task 8: Split workspace `utils.ts` into `utils/` directory + barrel

**Files:**

- Create: `app/workspace/[workspaceUrl]/utils/index.ts` (barrel)
- Create: `app/workspace/[workspaceUrl]/utils/flattenTasks.ts`
- Create: `app/workspace/[workspaceUrl]/utils/taskStatus.ts`
- Create: `app/workspace/[workspaceUrl]/utils/dueDate.ts`
- Create: `app/workspace/[workspaceUrl]/utils/pageToPath.ts`
- Delete: `app/workspace/[workspaceUrl]/utils.ts`

At this point, the `utils/` directory already exists (it holds `filterCompletedTasks.ts` and `sortTasks.ts`; `copyLink.ts` was removed in Task 6). We add 5 new files to it (4 content + 1 barrel), then delete the sibling `utils.ts` file.

After `utils.ts` is deleted, TypeScript's module resolution will transparently route `import ... from '../utils'` to `utils/index.ts`. All 20-odd call sites that use the barrel-style import continue working unchanged.

- [ ] **Step 1: Create `utils/flattenTasks.ts`**

Create `app/workspace/[workspaceUrl]/utils/flattenTasks.ts`:

```ts
import { ApiTask } from '../types'

export function flattenTasks(
  nodes: (ApiTask & { children?: ApiTask[] })[]
): ApiTask[] {
  const result: ApiTask[] = []
  function walk(list: (ApiTask & { children?: ApiTask[] })[]) {
    for (const node of list) {
      const { children, ...task } = node
      result.push(task)
      if (children?.length) walk(children)
    }
  }
  walk(nodes)
  return result
}
```

- [ ] **Step 2: Create `utils/taskStatus.ts`**

Create `app/workspace/[workspaceUrl]/utils/taskStatus.ts`:

```ts
export const API_STATUS_LABEL: Record<string, string> = {
  TODO: 'Todo',
  IN_PROGRESS: 'In Progress',
  IN_REVIEW: 'In Review',
  DONE: 'Done',
}
```

- [ ] **Step 3: Create `utils/dueDate.ts`**

Create `app/workspace/[workspaceUrl]/utils/dueDate.ts`:

```ts
/**
 * Format a due date for display.
 * Returns: "Today", "Tomorrow", "Apr 10", "Apr 10, 2027", or "" if null.
 */
export function formatDueDate(
  date: string | null | undefined,
  locale: string = 'en',
  messages?: { today?: string; tomorrow?: string }
): string {
  if (!date) return ''
  const d = new Date(date)
  const now = new Date()

  const todayLabel = messages?.today ?? 'Today'
  const tomorrowLabel = messages?.tomorrow ?? 'Tomorrow'

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()

  if (sameDay(d, now)) return todayLabel

  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (sameDay(d, tomorrow)) return tomorrowLabel

  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
  }

  return d.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Returns true if the given due date is strictly before today.
 */
export function isOverdue(date: string | null | undefined): boolean {
  if (!date) return false
  const d = new Date(date)
  const today = new Date()
  d.setHours(0, 0, 0, 0)
  today.setHours(0, 0, 0, 0)
  return d.getTime() < today.getTime()
}
```

- [ ] **Step 4: Create `utils/pageToPath.ts`**

Create `app/workspace/[workspaceUrl]/utils/pageToPath.ts`:

```ts
import { Page } from '../types'
import { slugify } from '@/lib/utils/slugify'

/**
 * Convert a Page to its URL path.
 * Used by WorkspaceApp for pushState and by TaskDetailPage for navigation.
 */
export function pageToPath(
  workspaceUrl: string,
  page: Page,
  project?: { name: string; id?: string } | null
): string {
  const base = `/workspace/${workspaceUrl}`
  switch (page) {
    case 'dashboard':
      return `${base}/dashboard`
    case 'my-tasks':
      return `${base}/my-tasks`
    case 'inbox':
      return `${base}/inbox`
    case 'projects':
      return `${base}/projects`
    case 'project-detail':
      return project
        ? `${base}/projects/${slugify(project.name)}`
        : `${base}/projects`
    case 'documents':
      return `${base}/documents`
    case 'document-editor':
      return `${base}/documents/${project?.id ?? ''}`
    case 'drafts':
      return `${base}/drafts`
    default:
      return `${base}/my-tasks`
  }
}
```

Note: the original called `slugifyProjectName(project.name)`. Task 7 renamed that function to `slugify` and moved it to `@/lib/utils/slugify`, so this new file imports `slugify` directly. Behavior is identical.

- [ ] **Step 5: Create the barrel `utils/index.ts`**

Create `app/workspace/[workspaceUrl]/utils/index.ts`:

```ts
export { flattenTasks } from './flattenTasks'
export { API_STATUS_LABEL } from './taskStatus'
export { formatDueDate, isOverdue } from './dueDate'
export { pageToPath } from './pageToPath'

// Re-export universal helpers from lib/utils so callers can keep
// using `from '../utils'` without churn.
export { isMac, submitModLabel, isSubmitShortcut } from '@/lib/utils/keyboard'
export { formatTimestamp } from '@/lib/utils/formatTimestamp'
```

- [ ] **Step 6: Delete `app/workspace/[workspaceUrl]/utils.ts`**

Run:

```bash
rm app/workspace/\[workspaceUrl\]/utils.ts
```

- [ ] **Step 7: Verify no call site is broken**

Run: `npx tsc --noEmit`

Expected: exit 0.

This gate catches every broken import in a single pass. The barrel re-exports ALL symbols that were in `utils.ts` (plus the lib/utils re-exports from tasks 4-5), so no external caller needs to change anything.

If tsc reports missing exports, one of the split files (`flattenTasks.ts`, `taskStatus.ts`, `dueDate.ts`, `pageToPath.ts`) is missing a named export — re-check its content against the original `utils.ts`.

- [ ] **Step 8: Verify specific symbols still resolve**

Run:

```bash
grep -rn "from ['\"]\\.\\./utils['\"]" --include="*.ts" --include="*.tsx" app | head -20
```

Expected: call sites exist and import named members. Sanity check that `flattenTasks`, `API_STATUS_LABEL`, `formatDueDate`, `isOverdue`, `pageToPath`, `isMac`, `submitModLabel`, `isSubmitShortcut`, `formatTimestamp` all appear as import targets somewhere.

- [ ] **Step 9: Verify full test suite**

Run: `npm test`

Expected: exit 0. In particular:

- `__tests__/due-date-utils.test.ts` imports `formatDueDate`, `isOverdue` from `@/app/workspace/[workspaceUrl]/utils` → now resolves to `utils/index.ts` (barrel), which re-exports both from `./dueDate`. Must still pass.
- `__tests__/utils/sortTasks.test.ts` imports from `/utils/sortTasks` (unchanged). Must still pass.

- [ ] **Step 10: Verify Next.js build**

Run: `npm run build`

Expected: exit 0.

- [ ] **Step 11: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/utils/
git add -u app/workspace/\[workspaceUrl\]/utils.ts  # captures the deletion
git commit -m "refactor: split workspace utils.ts into utils/ directory [LUM-TBD]

Replaces app/workspace/[workspaceUrl]/utils.ts (single 196-line file)
with a utils/ directory containing per-concern files plus a barrel
index.ts. No call-site changes required — all existing
'from ../utils' imports resolve transparently through the barrel.

New files:
- utils/index.ts              (barrel: re-exports all local + lib/utils helpers)
- utils/flattenTasks.ts       (ApiTask tree flattening)
- utils/taskStatus.ts         (API_STATUS_LABEL)
- utils/dueDate.ts            (formatDueDate, isOverdue)
- utils/pageToPath.ts         (Page → URL mapping)

Deleted: app/workspace/[workspaceUrl]/utils.ts

The barrel also re-exports keyboard helpers and formatTimestamp from
lib/utils/, so imports like
  import { isSubmitShortcut, submitModLabel } from '../../utils'
continue working unchanged."
```

---

## Task 9: Final verification

**Files:** none modified — this task only validates the overall end-state.

- [ ] **Step 1: Verify the success criteria from the spec**

Run each of these and confirm the expected output:

```bash
# (1) /utils/ directory gone
ls utils/ 2>/dev/null && echo "FAIL: utils/ still exists" || echo "OK: utils/ removed"

# (2) workspace utils.ts gone
ls app/workspace/\[workspaceUrl\]/utils.ts 2>/dev/null && echo "FAIL" || echo "OK: utils.ts removed"

# (3) workspace utils/copyLink.ts gone
ls app/workspace/\[workspaceUrl\]/utils/copyLink.ts 2>/dev/null && echo "FAIL" || echo "OK: workspace copyLink removed"

# (4) 5 hook files gone
for f in use-task-management use-task-management-v2 use-react19-optimized use-performance use-optimized-state; do
  ls hooks/$f.ts 2>/dev/null && echo "FAIL: hooks/$f.ts still exists" || echo "OK: $f removed"
done

# (5) @/utils alias gone
grep '"@/utils/\*"' tsconfig.json && echo "FAIL" || echo "OK: @/utils alias removed"

# (6) lib/utils has the 4 new files
for f in keyboard formatTimestamp slugify copyLink; do
  ls lib/utils/$f.ts && echo "OK: lib/utils/$f.ts exists" || echo "FAIL"
done

# (7) workspace utils/ has all 7 expected files
ls app/workspace/\[workspaceUrl\]/utils/

# Expected listing:
#   dueDate.ts
#   filterCompletedTasks.ts
#   flattenTasks.ts
#   index.ts
#   pageToPath.ts
#   sortTasks.ts
#   taskStatus.ts

# (8) Zero slugifyProjectName occurrences
grep -rn "slugifyProjectName" --include="*.ts" --include="*.tsx" app components lib hooks __tests__ tests 2>/dev/null && echo "FAIL: stale refs" || echo "OK: no stale refs"

# (9) Zero imports through @/utils alias (should never have been any)
grep -rn "from ['\"]@/utils" --include="*.ts" --include="*.tsx" app components lib hooks __tests__ tests 2>/dev/null && echo "FAIL" || echo "OK: no @/utils imports"
```

Each must print the `OK: ...` line; any `FAIL` line means a task was incomplete.

- [ ] **Step 2: Final gate run — all three together**

```bash
npx tsc --noEmit
npm test
npm run build
```

All three must exit 0.

- [ ] **Step 3: Net line count check**

```bash
git diff --shortstat main
```

Expected: net deletion ≥ 3,800 lines. (Roughly: −1,824 hooks −2,252 utils/ −196 workspace utils.ts = −4,272 raw deletion, minus new lib/utils/_ files (~100 lines), new workspace utils/_ files (~200 lines), and new tests (~200 lines) = net ≈ −3,800.)

If the number is significantly lower, something was missed.

- [ ] **Step 4: Review the commit log**

```bash
git log main..HEAD --oneline
```

Expected 7 commits in this order:

1. `chore: remove unused hooks [LUM-TBD]`
2. `chore: remove unused utils/ directory and @/utils alias [LUM-TBD]`
3. `refactor: add lib/utils/keyboard.ts with OS helpers [LUM-TBD]`
4. `refactor: add lib/utils/formatTimestamp.ts [LUM-TBD]`
5. `refactor: add lib/utils/copyLink.ts, migrate 6 call sites [LUM-TBD]`
6. `refactor: add lib/utils/slugify.ts, rename slugifyProjectName, migrate 14 call sites [LUM-TBD]`
7. `refactor: split workspace utils.ts into utils/ directory [LUM-TBD]`

- [ ] **Step 5: Push branch and open PR (when user instructs)**

```bash
git push -u origin lumo/LUM-TBD-utils-hooks-cleanup
```

Open the PR with title:

```
refactor: utils + hooks cleanup [LUM-TBD]
```

PR body: link the spec (`docs/superpowers/specs/2026-04-16-utils-hooks-cleanup-design.md`) and summarize the 7 commits.

---

## Rollback Guidance

Every task produces exactly one commit. To roll back any single task without losing later work:

```bash
git rebase -i main   # drop or edit individual commit
```

To roll back all tasks and return to the branch start:

```bash
git reset --hard main
```

Safe because the commits have not been pushed until Task 9 Step 5.

---

## Out-of-Scope Reminders

If during execution the engineer notices any of the following, they should **add a note** rather than acting on it:

- API route files still over 100 lines — that's sub-project **A**, not this one.
- Service files missing tests — that's sub-project **B**.
- `WorkspaceApp.tsx` or `CommentSection.tsx` being large — those are sub-projects **C** and **D**.
- Lingering `any`s, `console.log`s, duplicate `formatDate` helpers — documented in the audit, not in this plan's scope.
- `utils.ts` references remaining inside `.planning/`, `docs/`, or markdown — these are documentation, not runtime code. Leave them alone.

Stick to the 7 commits defined above. Nothing else.
