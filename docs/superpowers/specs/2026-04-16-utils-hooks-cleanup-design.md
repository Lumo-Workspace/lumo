# Utils + Hooks Cleanup Design Spec

**Date:** 2026-04-16
**Task ID:** LUM-TBD
**Goal:** Delete dead `utils/` directory and 5 unused hooks (~4,176 lines), consolidate universal helpers in `lib/utils/`, and replace the ambiguous `app/workspace/[workspaceUrl]/utils.ts` file with a well-organized `utils/` directory behind a barrel export.

This is the **first** sub-project in a broader refactoring sequence (E → B → A → C → D). It is a pure cleanup: **zero behavior change**. Its only purpose is to reduce surface area and remove confusion before the riskier later phases (service tests, API-route slimming, WorkspaceApp split, large-component split) land.

---

## 1. Scope

### In scope

1. Delete the root `/utils/` directory entirely (6 files, 2,252 lines, zero importers).
2. Delete 5 unused hooks (1,824 lines, zero importers).
3. Remove the `@/utils/*` path alias from `tsconfig.json`.
4. Move 4 universal helpers from `app/workspace/[workspaceUrl]/utils.ts` into `lib/utils/`, each as its own file.
5. Rename `slugifyProjectName` → `slugify` during the move.
6. Split the remaining (domain-specific) contents of `app/workspace/[workspaceUrl]/utils.ts` into a `utils/` directory with a barrel `index.ts` that preserves all existing `from '../utils'` import paths.
7. Add minimal unit tests for the 4 new `lib/utils/` files (CLAUDE.md: "Every new function needs at least one test").

### Out of scope

- Merging any live helpers between `lib/utils/` files (`buildTaskUrl`, `getInitials`, `markdown`, etc. are left untouched).
- Touching the 16-commit modular refactor already on `main` (it's done).
- Anything affecting behavior or the runtime bundle beyond removing dead code.
- Any work from sub-projects B–D in the sequence.

---

## 2. Dead Code Removal

All grep-verified to have zero importers from `app/`, `components/`, `lib/`, `hooks/`, `__tests__/`, or `tests/` (the only matches are the files themselves and references inside `docs/superpowers/` plan markdown).

### 2.1 Hooks (5 files, 1,824 lines)

| File                              | Lines | Verification                                                                             |
| --------------------------------- | ----- | ---------------------------------------------------------------------------------------- |
| `hooks/use-task-management.ts`    | 42    | `useTaskManagement` has no non-hooks/ importer                                           |
| `hooks/use-task-management-v2.ts` | 553   | same                                                                                     |
| `hooks/use-react19-optimized.ts`  | 417   | `useReact19Optimized` has zero importers                                                 |
| `hooks/use-performance.ts`        | 411   | `usePerformance` / `useLazyLoad` / `useMeasurePerformance` have zero importers           |
| `hooks/use-optimized-state.ts`    | 401   | `useOptimizedState` / `useOptimizedReducer` / `useOptimizedCallback` have zero importers |

### 2.2 Utils directory (6 files, 2,252 lines)

| File                      | Lines |
| ------------------------- | ----- |
| `utils/index.ts`          | 514   |
| `utils/dom.ts`            | 479   |
| `utils/validation.ts`     | 444   |
| `utils/performance.ts`    | 416   |
| `utils/error-handling.ts` | 370   |
| `utils/kanban-utils.ts`   | 129   |

**Verification:** No file in `app/`, `components/`, `lib/`, `hooks/`, `__tests__/`, or `tests/` imports from `@/utils` or reaches `/utils/` via relative path. The `@/utils/*` alias in `tsconfig.json` is unused in source code.

### 2.3 Config

Remove from `tsconfig.json`:

```json
"@/utils/*": ["./utils/*"],
```

---

## 3. Universal Helper Extraction (workspace → lib/utils)

Four exports from `app/workspace/[workspaceUrl]/utils.ts` and `app/workspace/[workspaceUrl]/utils/copyLink.ts` have zero task/project/workspace-domain dependencies. They move to `lib/utils/`, one file per concern.

| New file                       | Extracted exports                             | Source                        |
| ------------------------------ | --------------------------------------------- | ----------------------------- |
| `lib/utils/keyboard.ts`        | `isMac`, `submitModLabel`, `isSubmitShortcut` | `workspace/utils.ts`          |
| `lib/utils/formatTimestamp.ts` | `formatTimestamp`                             | `workspace/utils.ts`          |
| `lib/utils/slugify.ts`         | `slugify` (renamed from `slugifyProjectName`) | `workspace/utils.ts`          |
| `lib/utils/copyLink.ts`        | `copyLink`                                    | `workspace/utils/copyLink.ts` |

**Function bodies are moved verbatim.** The only change is `slugifyProjectName` → `slugify`:

- Signature unchanged: `(name: string) => string`
- Rationale: the body is a generic string slugifier — the `ProjectName` suffix was misleading.
- All call sites update the imported symbol name.

---

## 4. Workspace utils restructure

`app/workspace/[workspaceUrl]/utils.ts` (the file, 196 lines) is **replaced** by a `utils/` directory containing per-concern files plus a barrel `index.ts`. The existing `utils/` directory (3 files: `copyLink.ts`, `filterCompletedTasks.ts`, `sortTasks.ts`) is preserved; `copyLink.ts` is removed from it (moved to `lib/utils/`).

### 4.1 Final structure

```
app/workspace/[workspaceUrl]/utils/
├── index.ts                     # NEW barrel
├── flattenTasks.ts              # NEW (from utils.ts)
├── taskStatus.ts                # NEW: API_STATUS_LABEL
├── dueDate.ts                   # NEW: formatDueDate, isOverdue
├── pageToPath.ts                # NEW: pageToPath
├── filterCompletedTasks.ts      # UNCHANGED
└── sortTasks.ts                 # UNCHANGED
```

### 4.2 Barrel contents

`app/workspace/[workspaceUrl]/utils/index.ts`:

```ts
export { flattenTasks } from './flattenTasks'
export { API_STATUS_LABEL } from './taskStatus'
export { formatDueDate, isOverdue } from './dueDate'
export { pageToPath } from './pageToPath'

// Re-export universal helpers from lib/utils so callers
// can keep using `from '../utils'` without churn.
export { isMac, submitModLabel, isSubmitShortcut } from '@/lib/utils/keyboard'
export { formatTimestamp } from '@/lib/utils/formatTimestamp'
```

`slugify` and `copyLink` are **intentionally NOT** re-exported through this barrel. Their call sites are rewritten to import directly from `@/lib/utils/slugify` and `@/lib/utils/copyLink`:

- `slugify` — because renaming `slugifyProjectName` → `slugify` is the whole point of the rename; re-exporting it under the old name through the barrel would defeat that. Call sites update both the import path and the symbol name.
- `copyLink` — because it was never part of the `workspace/utils.ts` file's exports (it lived in `workspace/utils/copyLink.ts`). Promoting it to `@/lib/utils/copyLink` is cleaner than routing it through a workspace barrel.

### 4.3 File deletion

After contents are redistributed:

- `app/workspace/[workspaceUrl]/utils.ts` → delete
- `app/workspace/[workspaceUrl]/utils/copyLink.ts` → delete (moved to `lib/utils/copyLink.ts`)

---

## 5. Import Path Migration

### 5.1 Stays the same (barrel preserves it)

All imports of `flattenTasks`, `API_STATUS_LABEL`, `formatDueDate`, `isOverdue`, `pageToPath`, `isMac`, `submitModLabel`, `isSubmitShortcut`, `formatTimestamp` that currently look like:

```ts
import { isSubmitShortcut, submitModLabel } from '../../utils'
```

**keep working unchanged** thanks to the barrel.

### 5.2 Rewritten: `slugifyProjectName` → `slugify`

Every call site importing `slugifyProjectName` updates to:

```ts
import { slugify } from '@/lib/utils/slugify'
```

and the usage site updates `slugifyProjectName(x)` → `slugify(x)`.

**Affected files (14 total, verified by grep):**

```
app/workspace/[workspaceUrl]/components/CommentSection.tsx
app/workspace/[workspaceUrl]/components/DuplicateConfirm.tsx
app/workspace/[workspaceUrl]/components/DuplicateWarning.tsx
app/workspace/[workspaceUrl]/components/SubtasksSection.tsx
app/workspace/[workspaceUrl]/components/TaskDetailComments.tsx
app/workspace/[workspaceUrl]/components/TaskDetailHeader.tsx
app/workspace/[workspaceUrl]/components/TaskDetailPanel.tsx
app/workspace/[workspaceUrl]/components/TaskDrawer.tsx
app/workspace/[workspaceUrl]/components/pages/ProjectDetailStandalonePage.tsx
app/workspace/[workspaceUrl]/components/pages/ProjectsPage.tsx
app/workspace/[workspaceUrl]/components/pages/TaskDetailPage.tsx
app/workspace/[workspaceUrl]/hooks/useTaskDetailState.ts
app/workspace/[workspaceUrl]/my-tasks/[identifier]/page.tsx
app/workspace/[workspaceUrl]/project/[slug]/page.tsx
```

One of these (`TaskDetailPage.tsx`) also imports `pageToPath` from the same line — that stays with the barrel import. The `slugifyProjectName` token on that line moves to a separate `@/lib/utils/slugify` import.

Call sites that currently have a combined import:

```ts
import { slugifyProjectName, pageToPath } from '../../utils'
```

become:

```ts
import { slugify } from '@/lib/utils/slugify'
import { pageToPath } from '../../utils'
```

### 5.3 Rewritten: `copyLink`

Currently imported as:

```ts
import { copyLink } from '../utils/copyLink' // or
import { copyLink } from '../../utils/copyLink'
```

All such call sites rewrite to:

```ts
import { copyLink } from '@/lib/utils/copyLink'
```

**Affected files (6 total, verified by grep):**

```
app/workspace/[workspaceUrl]/components/CommentSection.tsx
app/workspace/[workspaceUrl]/components/TaskDetailComments.tsx
app/workspace/[workspaceUrl]/components/TaskDrawer.tsx
app/workspace/[workspaceUrl]/components/pages/ProjectDetailStandalonePage.tsx
app/workspace/[workspaceUrl]/components/pages/ProjectsPage.tsx
app/workspace/[workspaceUrl]/hooks/useTaskDetailActions.ts
```

---

## 6. New Unit Tests

Per CLAUDE.md ("Every new function needs at least one test"), add minimal Jest tests for the 4 new `lib/utils/` files. The functions themselves are not new (they're moved), but the new file paths are, and this is cheap insurance.

### 6.1 Test files to add

| Test file                                     | Cases                                                                                                                                                                              |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `__tests__/lib/utils/keyboard.test.ts`        | `isMac` returns boolean; `submitModLabel` is `'⌘'` or `'Ctrl'`; `isSubmitShortcut` returns true on Enter+metaKey (Mac) / Enter+ctrlKey (non-Mac), false otherwise                  |
| `__tests__/lib/utils/formatTimestamp.test.ts` | "just now" (<60s), "Nm ago" (<60min), "Today 2:23 PM" (same day), "Yesterday" (1 day prior), month+day (this year), month+day+year (older); custom i18n messages override defaults |
| `__tests__/lib/utils/slugify.test.ts`         | basic conversion ("My Project" → "my-project"), strips punctuation, collapses runs of dashes, trims leading/trailing dashes, handles empty string                                  |
| `__tests__/lib/utils/copyLink.test.ts`        | calls `navigator.clipboard.writeText` with the URL; shows success toast on resolve; shows error toast on reject. Mock `navigator.clipboard` and `sonner`                           |

Each test file has ≤5 test cases. Total new test code target: ~200 lines.

### 6.2 Tests NOT added

- No tests added for dead code being deleted (it's dead).
- No new tests for functions staying in `workspace/utils/` (they didn't have tests before this refactor; adding tests is out of scope for a pure cleanup).

### 6.3 Existing tests that transit through the refactor

Two existing test files reference the workspace utils namespace and must remain green without modification:

| Test file                           | Imports                                                                | Why it still works                                                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `__tests__/due-date-utils.test.ts`  | `formatDueDate, isOverdue` from `@/app/workspace/[workspaceUrl]/utils` | After refactor, `@/app/workspace/[workspaceUrl]/utils` resolves to `utils/index.ts` (barrel), which re-exports both from `./dueDate` |
| `__tests__/utils/sortTasks.test.ts` | `sortTasks` from `@/app/workspace/[workspaceUrl]/utils/sortTasks`      | `sortTasks.ts` is unchanged at its existing path                                                                                     |

Gate 2 (`npm test`) catches any regression in either file.

---

## 7. Verification Gates

Each commit (see §8) must pass all three before proceeding:

| Gate       | Command            | Catches                                                               |
| ---------- | ------------------ | --------------------------------------------------------------------- |
| TypeScript | `npx tsc --noEmit` | broken imports, missing types, renamed symbol leaks                   |
| Tests      | `npm test`         | behavior changes, broken test imports                                 |
| Build      | `npm run build`    | Next.js-specific issues (routing, RSC boundaries, bundler resolution) |

The TypeScript gate is the most important — it will catch every stale import path.

---

## 8. Commit Structure

Work proceeds on a single branch (`lumo/LUM-TBD-utils-hooks-cleanup`) with the commits listed below. Each commit is individually green against all three gates. Order matters — later commits depend on earlier ones.

| #   | Commit                                                                                           | Roughly                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `chore: remove unused hooks [LUM-TBD]`                                                           | Delete 5 hook files. −1,824 lines.                                                                                                                                                        |
| 2   | `chore: remove unused utils/ directory and @/utils alias [LUM-TBD]`                              | Delete `utils/` dir + tsconfig alias. −2,252 lines, −1 alias entry.                                                                                                                       |
| 3   | `refactor: add lib/utils/keyboard.ts with OS helpers [LUM-TBD]`                                  | New file + test. No call-site changes yet.                                                                                                                                                |
| 4   | `refactor: add lib/utils/formatTimestamp.ts [LUM-TBD]`                                           | New file + test. No call-site changes yet.                                                                                                                                                |
| 5   | `refactor: add lib/utils/copyLink.ts, migrate 6 call sites [LUM-TBD]`                            | New file + test. Rewrite 6 imports. Delete `workspace/utils/copyLink.ts`.                                                                                                                 |
| 6   | `refactor: add lib/utils/slugify.ts, rename slugifyProjectName, migrate 14 call sites [LUM-TBD]` | New file + test. Rewrite 14 imports + usage sites.                                                                                                                                        |
| 7   | `refactor: split workspace utils.ts into utils/ directory [LUM-TBD]`                             | Create `flattenTasks.ts`, `taskStatus.ts`, `dueDate.ts`, `pageToPath.ts`, and barrel `index.ts`. Delete `workspace/utils.ts`. Existing `from '../utils'` imports keep working via barrel. |

Commits 3 and 4 create files without any call-site changes because the barrel in commit 7 is what actually routes `from '../utils'` imports to `@/lib/utils/keyboard` and `@/lib/utils/formatTimestamp`. This means commits 3–4 introduce momentarily-unreferenced `lib/utils/` files, which is fine — tests cover them and gate 1 (tsc) passes.

Alternatively, commits 3 and 4 can be folded into commit 7 if the LUM-TBD task preference is fewer commits. The split above optimizes for atomic rollback.

---

## 9. Success Criteria

This refactor succeeds if, on the final commit:

- [ ] `utils/` (root) directory no longer exists.
- [ ] `app/workspace/[workspaceUrl]/utils.ts` no longer exists.
- [ ] `app/workspace/[workspaceUrl]/utils/copyLink.ts` no longer exists.
- [ ] 5 dead hook files no longer exist.
- [ ] `tsconfig.json` no longer contains `"@/utils/*"`.
- [ ] `lib/utils/` contains: `keyboard.ts`, `formatTimestamp.ts`, `slugify.ts`, `copyLink.ts` (plus all pre-existing files untouched).
- [ ] `app/workspace/[workspaceUrl]/utils/` contains: `index.ts`, `flattenTasks.ts`, `taskStatus.ts`, `dueDate.ts`, `pageToPath.ts`, `filterCompletedTasks.ts`, `sortTasks.ts`.
- [ ] Zero occurrences of `slugifyProjectName` in source code (the symbol is renamed everywhere).
- [ ] Zero imports resolve through `@/utils/...` (alias is gone and nothing used it anyway).
- [ ] `npx tsc --noEmit` exits 0.
- [ ] `npm test` exits 0.
- [ ] `npm run build` exits 0.
- [ ] Diff summary shows a net deletion of ≥3,800 lines of source code (dead code removed minus new tests + file-header boilerplate).

---

## 10. Risks and Mitigations

| Risk                                                                                                 | Likelihood | Mitigation                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A dynamic import or string-based `require` references `/utils/` that static grep missed              | Low        | Run `npm run build` (gate 3) — Next.js bundler traces dynamic imports and fails if unresolvable. Also grep for `require('./utils')`-style strings — already done, zero matches. |
| `noUnusedLocals` / `noUnusedParameters` in `tsconfig.json` trips on intermediate commits             | Low        | The tsconfig has both strict flags enabled, but deletions and moves don't leave unused locals behind (we delete at file granularity). Per-commit tsc gate catches any slip.     |
| `slugifyProjectName` appears in a generated file, migration, or `.planning/` doc that wasn't grepped | Very low   | `.planning/`, `docs/`, and migration files are not runtime code. Any reference there is documentation drift at worst — left as a deliberate follow-up.                          |
| Barrel re-export breaks tree-shaking                                                                 | Very low   | Next.js + modern bundlers tree-shake named re-exports fine; the barrel only contains named exports, no side effects.                                                            |

---

## 11. What happens next

After this ships and merges to `main`, the sequence resumes with **B (补 14 个 Service 的测试)** as its own brainstorm → spec → plan → implementation cycle.
