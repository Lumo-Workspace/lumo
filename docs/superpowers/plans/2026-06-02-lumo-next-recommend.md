# `lumo next` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `lumo next [-n, --count <N>]` CLI command that ranks the caller's open tasks (priority → active sprint → due date → in-flight status) and prints the top N with a per-row reason.

**Architecture:** Pure CLI orchestration. The command chains two existing bearer-auth endpoints (`GET /api/me/active-sprints`, `GET /api/tasks/me`), filters out DONE, then ranks and formats client-side. Two pure functions (`rankTasks`, `formatNextOutput`) carry all the logic and are unit-tested; the thin orchestration layer is covered by build + a smoke run. No server or schema changes.

**Tech Stack:** TypeScript (CLI package `cli/`, CommonJS, `noUncheckedIndexedAccess` on), commander for arg parsing, root `jest` (next/jest) running CLI tests from `__tests__/cli/` with the `@/` → repo-root module mapper.

**Branch:** `lumo/LUM-154-next-recommend` (already created).

---

## Reference: existing patterns to mirror

- Command shape / fetch / error handling: `cli/src/commands/task-list.ts`, `cli/src/commands/session-attach.ts`.
- Pure formatter + dynamic column widths + sanitize: `formatTaskListTable` in `cli/src/lib/format.ts` (identifier = `` `${teamIdentifier}-${number}` ``).
- Test style: `__tests__/cli/doc-list-format.test.ts` (pure formatter) and `__tests__/cli/task-list-milestone-flag.test.ts` (`@jest-environment node` + `@/cli/src/...` import).
- Output sanitization: `sanitizeField` in `cli/src/lib/sanitize.ts` — apply to free text (title) only, NOT to ids/enums/identifiers.

## File Structure

| File                                      | Responsibility                                                                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `cli/src/lib/rank-tasks.ts` (new)         | `NextTask` / `RankedTask` types, priority weight map, `rankTasks(tasks, activeSprintIds, now)` comparator, reason derivation. Pure, no I/O. |
| `cli/src/commands/next.ts` (new)          | `nextCommand(opts)` orchestration (two fetches, filter, slice, print) + pure `formatNextOutput(ranked, totalOpen)`.                         |
| `cli/src/index.ts` (modify)               | Register top-level `program.command('next')`.                                                                                               |
| `__tests__/cli/rank-tasks.test.ts` (new)  | Unit tests for `rankTasks` ordering + reasons.                                                                                              |
| `__tests__/cli/next-format.test.ts` (new) | Unit tests for `formatNextOutput`.                                                                                                          |
| `.claude/skills/lumo/SKILL.md` (modify)   | New `lumo next` section + description triggers (CLAUDE.md hard rule).                                                                       |

---

## Task 1: `rank-tasks.ts` — ranking + reasons (pure)

**Files:**

- Create: `cli/src/lib/rank-tasks.ts`
- Test: `__tests__/cli/rank-tasks.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/cli/rank-tasks.test.ts`:

```ts
/**
 * @jest-environment node
 */
import { rankTasks, type NextTask } from '@/cli/src/lib/rank-tasks'

function task(over: Partial<NextTask>): NextTask {
  return {
    id: 'c' + (over.number ?? 1),
    number: 1,
    title: 'T',
    status: 'TODO',
    priority: 'MEDIUM',
    teamIdentifier: 'LUM',
    sprintId: null,
    dueDate: null,
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...over,
  }
}

const NOW = new Date('2026-06-02T00:00:00.000Z')

describe('rankTasks ordering', () => {
  it('orders by priority first (URGENT before LOW)', () => {
    const r = rankTasks(
      [
        task({ number: 1, priority: 'LOW' }),
        task({ number: 2, priority: 'URGENT' }),
      ],
      new Set(),
      NOW
    )
    expect(r.map(x => x.identifier)).toEqual(['LUM-2', 'LUM-1'])
  })

  it('active-sprint membership breaks priority ties', () => {
    const r = rankTasks(
      [
        task({ number: 1, priority: 'HIGH', sprintId: null }),
        task({ number: 2, priority: 'HIGH', sprintId: 's1' }),
      ],
      new Set(['s1']),
      NOW
    )
    expect(r.map(x => x.identifier)).toEqual(['LUM-2', 'LUM-1'])
  })

  it('earlier dueDate wins after priority and sprint tie; null due sorts last', () => {
    const r = rankTasks(
      [
        task({
          number: 1,
          priority: 'HIGH',
          dueDate: '2026-06-10T00:00:00.000Z',
        }),
        task({
          number: 2,
          priority: 'HIGH',
          dueDate: '2026-06-03T00:00:00.000Z',
        }),
        task({ number: 3, priority: 'HIGH', dueDate: null }),
      ],
      new Set(),
      NOW
    )
    expect(r.map(x => x.identifier)).toEqual(['LUM-2', 'LUM-1', 'LUM-3'])
  })

  it('in-flight status nudges ahead of TODO on remaining tie', () => {
    const r = rankTasks(
      [
        task({ number: 1, priority: 'LOW', status: 'TODO' }),
        task({ number: 2, priority: 'LOW', status: 'IN_PROGRESS' }),
      ],
      new Set(),
      NOW
    )
    expect(r.map(x => x.identifier)).toEqual(['LUM-2', 'LUM-1'])
  })

  it('tiebreaks by updatedAt desc', () => {
    const r = rankTasks(
      [
        task({ number: 1, updatedAt: '2026-05-01T00:00:00.000Z' }),
        task({ number: 2, updatedAt: '2026-06-01T00:00:00.000Z' }),
      ],
      new Set(),
      NOW
    )
    expect(r.map(x => x.identifier)).toEqual(['LUM-2', 'LUM-1'])
  })
})

describe('rankTasks reasons', () => {
  it('includes priority always, plus active sprint / overdue due / status when present', () => {
    const [r] = rankTasks(
      [
        task({
          number: 7,
          priority: 'URGENT',
          status: 'IN_PROGRESS',
          sprintId: 's1',
          dueDate: '2026-06-01T00:00:00.000Z',
        }),
      ],
      new Set(['s1']),
      NOW
    )
    expect(r!.reasons).toEqual([
      'URGENT',
      'active sprint',
      'due 2026-06-01 (overdue)',
      'in progress',
    ])
  })

  it('marks a future due date without (overdue)', () => {
    const [r] = rankTasks(
      [task({ number: 8, dueDate: '2026-06-10T00:00:00.000Z' })],
      new Set(),
      NOW
    )
    expect(r!.reasons).toContain('due 2026-06-10')
    expect(r!.reasons.join(' ')).not.toContain('overdue')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/cli/rank-tasks.test.ts`
Expected: FAIL — `Cannot find module '@/cli/src/lib/rank-tasks'`.

- [ ] **Step 3: Write the implementation**

Create `cli/src/lib/rank-tasks.ts`:

```ts
/**
 * Pure ranking logic for `lumo next`. Given the caller's open tasks plus the
 * set of ACTIVE sprint ids, produce a recommendation order and a per-task list
 * of human-readable reason factors.
 *
 * Ordering is lexicographic (explainable over a tunable magic score), honoring
 * "priority first": priority → active-sprint membership → dueDate → in-flight
 * status → updatedAt desc tiebreak.
 */

/** Subset of the /api/tasks/me task shape that ranking needs. */
export interface NextTask {
  id: string
  number: number
  title: string
  status: string
  priority: string
  teamIdentifier: string
  sprintId: string | null
  dueDate: string | null
  updatedAt: string
}

export interface RankedTask {
  task: NextTask
  /** e.g. "LUM-42" */
  identifier: string
  /** factor labels for the reason line, in display order */
  reasons: string[]
}

const PRIORITY_WEIGHT: Record<string, number> = {
  URGENT: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
}

function priorityWeight(priority: string): number {
  return PRIORITY_WEIGHT[priority] ?? 99
}

/** Earlier due first; missing/invalid dueDate sorts last. */
function dueValue(dueDate: string | null): number {
  if (!dueDate) return Number.POSITIVE_INFINITY
  const t = new Date(dueDate).getTime()
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t
}

const IN_FLIGHT = new Set(['IN_PROGRESS', 'IN_REVIEW'])

/** in-flight (0) before TODO (1) before anything else (2). */
function statusRank(status: string): number {
  if (IN_FLIGHT.has(status)) return 0
  if (status === 'TODO') return 1
  return 2
}

function inActiveSprint(task: NextTask, activeSprintIds: Set<string>): boolean {
  return task.sprintId !== null && activeSprintIds.has(task.sprintId)
}

function deriveReasons(
  task: NextTask,
  activeSprintIds: Set<string>,
  now: Date
): string[] {
  const reasons: string[] = [task.priority]

  if (inActiveSprint(task, activeSprintIds)) {
    reasons.push('active sprint')
  }

  if (task.dueDate) {
    const day = task.dueDate.slice(0, 10)
    const due = new Date(task.dueDate).getTime()
    const overdue = !Number.isNaN(due) && due < now.getTime()
    reasons.push(overdue ? `due ${day} (overdue)` : `due ${day}`)
  }

  if (task.status === 'IN_PROGRESS') reasons.push('in progress')
  else if (task.status === 'IN_REVIEW') reasons.push('in review')

  return reasons
}

export function rankTasks(
  tasks: NextTask[],
  activeSprintIds: Set<string>,
  now: Date
): RankedTask[] {
  const sorted = [...tasks].sort((a, b) => {
    const pw = priorityWeight(a.priority) - priorityWeight(b.priority)
    if (pw !== 0) return pw

    const sa = inActiveSprint(a, activeSprintIds) ? 0 : 1
    const sb = inActiveSprint(b, activeSprintIds) ? 0 : 1
    if (sa !== sb) return sa - sb

    const dv = dueValue(a.dueDate) - dueValue(b.dueDate)
    if (dv !== 0) return dv

    const st = statusRank(a.status) - statusRank(b.status)
    if (st !== 0) return st

    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })

  return sorted.map(task => ({
    task,
    identifier: `${task.teamIdentifier}-${task.number}`,
    reasons: deriveReasons(task, activeSprintIds, now),
  }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/cli/rank-tasks.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/src/lib/rank-tasks.ts __tests__/cli/rank-tasks.test.ts
git commit -m "feat: add rankTasks ranking logic for lumo next [LUM-154]"
```

---

## Task 2: `formatNextOutput` — the rendered recommendation block (pure)

**Files:**

- Create: `cli/src/commands/next.ts` (formatter only this task; command added in Task 3)
- Test: `__tests__/cli/next-format.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/cli/next-format.test.ts`:

```ts
/**
 * @jest-environment node
 */
import { formatNextOutput } from '@/cli/src/commands/next'
import type { RankedTask } from '@/cli/src/lib/rank-tasks'

function ranked(
  over: Partial<RankedTask> & { identifier: string }
): RankedTask {
  return {
    task: {
      id: 'c1',
      number: 1,
      title: 'A title',
      status: 'TODO',
      priority: 'MEDIUM',
      teamIdentifier: 'LUM',
      sprintId: null,
      dueDate: null,
      updatedAt: '2026-06-01T00:00:00.000Z',
    },
    reasons: ['MEDIUM'],
    ...over,
  }
}

describe('formatNextOutput', () => {
  it('renders header, numbered rows with reason lines, and a Next footer', () => {
    const out = formatNextOutput(
      [
        ranked({
          identifier: 'LUM-42',
          task: {
            id: 'c42',
            number: 42,
            title: 'Fix Slack OAuth redirect',
            status: 'IN_PROGRESS',
            priority: 'URGENT',
            teamIdentifier: 'LUM',
            sprintId: 's1',
            dueDate: '2026-06-03T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
          },
          reasons: ['URGENT', 'active sprint', 'due 2026-06-03', 'in progress'],
        }),
        ranked({ identifier: 'LUM-48', reasons: ['HIGH'] }),
      ],
      12
    )
    expect(out).toContain('Top 2 recommended tasks (of 12 open):')
    expect(out).toContain('1. LUM-42')
    expect(out).toContain(
      '↳ URGENT · active sprint · due 2026-06-03 · in progress'
    )
    expect(out).toContain('2. LUM-48')
    expect(out).toContain(
      'Next: lumo session attach LUM-42 && lumo task context LUM-42'
    )
    expect(out).toContain('（也可换成列表里任意一个 LUM-N）')
  })

  it('uses singular wording and omits the "pick any" note for a single task', () => {
    const out = formatNextOutput([ranked({ identifier: 'LUM-7' })], 1)
    expect(out).toContain('Top 1 recommended task (of 1 open):')
    expect(out).not.toContain('（也可换成列表里任意一个 LUM-N）')
  })

  it('returns the empty-state line when there are no tasks', () => {
    expect(formatNextOutput([], 0)).toBe('No open tasks assigned to you. 🎉')
  })

  it('strips control characters from the title', () => {
    const out = formatNextOutput(
      [
        ranked({
          identifier: 'LUM-9',
          task: {
            ...ranked({ identifier: 'LUM-9' }).task,
            title: 'Ti\x1b[31mtle',
          },
        }),
      ],
      1
    )
    expect(out).not.toMatch(/\x1b/)
    expect(out).toContain('Ti[31mtle')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/cli/next-format.test.ts`
Expected: FAIL — `Cannot find module '@/cli/src/commands/next'`.

- [ ] **Step 3: Write the formatter**

Create `cli/src/commands/next.ts` with the formatter (the command function is added in Task 3):

```ts
import { sanitizeField } from '../lib/sanitize'
import type { RankedTask } from '../lib/rank-tasks'

/**
 * Render the ranked recommendation block. `ranked` is already sliced to the
 * requested count; `totalOpen` is the count of all non-DONE tasks (for the
 * "(of N open)" header). Pure — no I/O.
 */
export function formatNextOutput(
  ranked: RankedTask[],
  totalOpen: number
): string {
  const first = ranked[0]
  if (!first) return 'No open tasks assigned to you. 🎉'

  const widths = {
    identifier: Math.max(...ranked.map(r => r.identifier.length)),
    status: Math.max(...ranked.map(r => r.task.status.length)),
    priority: Math.max(...ranked.map(r => r.task.priority.length)),
  }

  const plural = ranked.length === 1 ? '' : 's'
  const lines: string[] = [
    `Top ${ranked.length} recommended task${plural} (of ${totalOpen} open):`,
    '',
  ]

  ranked.forEach((r, i) => {
    lines.push(
      `${i + 1}. ${r.identifier.padEnd(widths.identifier)}  ` +
        `${r.task.status.padEnd(widths.status)}  ` +
        `${r.task.priority.padEnd(widths.priority)}  ` +
        sanitizeField(r.task.title)
    )
    lines.push(`     ↳ ${r.reasons.join(' · ')}`)
  })

  lines.push('')
  lines.push(
    `Next: lumo session attach ${first.identifier} && lumo task context ${first.identifier}`
  )
  if (ranked.length > 1) {
    lines.push('（也可换成列表里任意一个 LUM-N）')
  }

  return lines.join('\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/cli/next-format.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/next.ts __tests__/cli/next-format.test.ts
git commit -m "feat: add formatNextOutput renderer for lumo next [LUM-154]"
```

---

## Task 3: `nextCommand` orchestration + register the command

**Files:**

- Modify: `cli/src/commands/next.ts` (add the command function above the formatter)
- Modify: `cli/src/index.ts` (import + register)

- [ ] **Step 1: Add the orchestration function to `cli/src/commands/next.ts`**

Add these imports at the top of the file (keep the existing `sanitizeField` / `RankedTask` imports):

```ts
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { rankTasks, type NextTask } from '../lib/rank-tasks'
```

Add the command function (place it above `formatNextOutput`):

```ts
export interface NextOptions {
  count?: string
}

interface ActiveSprintsResponse {
  sprintIds: string[]
}

interface TasksMeResponse {
  tasks: NextTask[]
}

/**
 * `lumo next [-n, --count <N>]` — recommend the next task(s) to work on.
 *
 * Chains two read-only endpoints: active sprint ids (for a ranking boost) and
 * "my tasks". The active-sprints call is non-fatal — if it fails we warn and
 * rank without the sprint boost rather than aborting.
 */
export async function nextCommand(opts: NextOptions): Promise<number | void> {
  const count = opts.count !== undefined ? parseInt(opts.count, 10) : 3
  if (Number.isNaN(count) || count < 1) {
    console.error(
      `Error: invalid --count "${opts.count}" (expected a positive integer)`
    )
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }

  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)
  const authHeaders = { Authorization: `Bearer ${creds.token}` }

  // 1. Active sprint ids — non-fatal. Failure just drops the sprint boost.
  let activeSprintIds = new Set<string>()
  try {
    const res = await fetch(`${base}/api/me/active-sprints`, {
      headers: authHeaders,
    })
    if (res.ok) {
      const data = (await res.json()) as ActiveSprintsResponse
      activeSprintIds = new Set(data.sprintIds)
    } else {
      console.error(
        `Warning: could not load active sprints (HTTP ${res.status}); ranking without sprint boost.`
      )
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(
      `Warning: could not load active sprints (${msg}); ranking without sprint boost.`
    )
  }

  // 2. My tasks — fatal on failure.
  let res: Response
  try {
    res = await fetch(`${base}/api/tasks/me`, { headers: authHeaders })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return 1
  }

  if (res.status === 401) {
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }
  if (!res.ok) {
    console.error(`Error: task fetch failed (HTTP ${res.status})`)
    return 1
  }

  const data = (await res.json()) as TasksMeResponse
  const open = data.tasks.filter(t => t.status !== 'DONE')
  const ranked = rankTasks(open, activeSprintIds, new Date()).slice(0, count)

  process.stdout.write(formatNextOutput(ranked, open.length) + '\n')
}
```

- [ ] **Step 2: Register the command in `cli/src/index.ts`**

Add the import alongside the other command imports near the top of the file:

```ts
import { nextCommand } from './commands/next'
```

Register it as a top-level command (place it near the other top-level `program.command(...)` registrations, e.g. just before the `session` group). Mirror the `wrap(...)` pattern used by every other command:

```ts
program
  .command('next')
  .description(
    'Recommend the next task(s) to work on, ranked by priority, active sprint, and due date. Prints top N (default 3); pick one and run `session attach` + `task context`.'
  )
  .option('-n, --count <N>', 'Number of tasks to recommend (default 3)')
  .action(wrap(options => nextCommand(options as { count?: string })))
```

- [ ] **Step 3: Type-check and build the CLI**

Run: `cd cli && npx tsc --noEmit && cd ..`
Expected: no errors. (Watch for `noUncheckedIndexedAccess` — `ranked[0]` is guarded by the `first` check; `PRIORITY_WEIGHT[...]` by `?? 99`.)

- [ ] **Step 4: Re-run the unit tests**

Run: `npx jest __tests__/cli/rank-tasks.test.ts __tests__/cli/next-format.test.ts`
Expected: PASS (11 tests total).

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/next.ts cli/src/index.ts
git commit -m "feat: wire up lumo next command + registration [LUM-154]"
```

---

## Task 4: Smoke-test against the live API

**Files:** none (manual verification).

- [ ] **Step 1: Build and run the command locally**

Run:

```bash
cd cli && npm run build && cd ..
node cli/dist/cli/src/index.js next
node cli/dist/cli/src/index.js next --count 1
node cli/dist/cli/src/index.js next --count 0
```

Expected:

- `next` prints up to 3 ranked rows with reason lines and the `Next:` footer (or `No open tasks assigned to you. 🎉` if the account has none).
- `--count 1` prints exactly one row, singular header, no "pick any" note.
- `--count 0` prints `Error: invalid --count "0" (expected a positive integer)` and exits non-zero.

- [ ] **Step 2: Sanity-check the ranking**

Confirm the top row is the highest-priority open task, that any active-sprint task is boosted within its priority band, and that the reason line matches the row's priority/sprint/due/status. If anything looks off, revisit `rank-tasks.ts` (it is the single pure function to tune).

No commit (verification only).

---

## Task 5: Sync `SKILL.md` (CLAUDE.md hard rule)

**Files:**

- Modify: `.claude/skills/lumo/SKILL.md`

- [ ] **Step 1: Add the `lumo next` section**

Add a new `### lumo next` subsection under the Task-related commands area (near `task list` / `task context`, since `next` feeds into the attach → context flow). Use this content:

````markdown
### `lumo next [--count <N>]` — recommend the next task to work on

Ranks the tasks assigned to you and prints the top N (default 3), each with a
one-line reason. Read-only — it does **not** bind or load context. Pick one from
the list, then run `lumo session attach <LUM-N>` + `lumo task context <LUM-N>`.

Ranking is lexicographic: **priority** (URGENT→LOW) first, then **active-sprint
membership**, then **due date** (earlier first), then in-flight status
(IN_PROGRESS / IN_REVIEW ahead of TODO). DONE tasks are excluded. The active
sprint lookup is best-effort — if it fails the command still recommends, just
without the sprint boost.

| Flag              | Type    | Notes                                                                   |
| ----------------- | ------- | ----------------------------------------------------------------------- |
| `-n, --count <N>` | integer | How many tasks to recommend. Defaults to 3. Must be a positive integer. |

```bash
lumo next
lumo next --count 1
```
````

Output:

​```
Top 3 recommended tasks (of 12 open):

1. LUM-42 IN_PROGRESS URGENT Fix Slack OAuth redirect
   ↳ URGENT · active sprint · due 2026-06-03 (overdue) · in progress
2. LUM-48 TODO HIGH Investigate slow query
   ↳ HIGH · active sprint
3. LUM-12 TODO MEDIUM Add rate limiting
   ↳ MEDIUM · due 2026-06-10

Next: lumo session attach LUM-42 && lumo task context LUM-42
​```

When to suggest: the user asks "what should I work on", "what's next", "推荐下一个任务", "pick my next task", or starts a session without a task in mind. After they choose, run `session attach` + `task context` for the picked task.

````

(When pasting, drop the leading zero-width markers on the inner ``` fences — they are only here to nest the code block inside this plan.)

- [ ] **Step 2: Update the frontmatter `description` triggers**

In the `SKILL.md` frontmatter `description:`, add trigger phrases so the skill activates on next-task requests. Append to the existing trigger list:

````

"lumo next", "next task", "what's next", "what should I work on", "recommend a task", "推荐下一个任务", "pick my next task"

````

- [ ] **Step 3: Verify the doc matches behavior**

Re-read the new section against `cli/src/commands/next.ts`: flag name (`-n, --count`), default (3), empty-state text, the non-fatal active-sprint behavior, and the exact footer string. Fix any drift.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/lumo/SKILL.md
git commit -m "docs: document lumo next in SKILL.md [LUM-154]"
````

---

## Task 6: Full verification

**Files:** none.

- [ ] **Step 1: Full type-check**

Run: `cd cli && npx tsc --noEmit && cd ..`
Expected: no errors.

- [ ] **Step 2: Run the full CLI test suite**

Run: `npx jest __tests__/cli/`
Expected: PASS — including the two new files (11 new tests) and no regressions in existing CLI tests.

- [ ] **Step 3: Confirm no `console.log` in production code**

Run: `grep -rn "console.log" cli/src/commands/next.ts cli/src/lib/rank-tasks.ts`
Expected: no matches. (Status/error output uses `console.error`; the recommendation block uses `process.stdout.write`.)

- [ ] **Step 4: Final commit if anything changed**

If steps 1–3 surfaced fixes, commit them:

```bash
git add -A
git commit -m "chore: lumo next verification fixups [LUM-154]"
```

Otherwise proceed — the feature is complete.

---

## Notes for the executor

- **Do not** run `git checkout`, `git switch`, `git reset`, or `git stash` — stay on `lumo/LUM-154-next-recommend`.
- **CLI version bump + publish are deliberately NOT in this plan.** Per the project's publish workflow a user-facing `cli/src` change needs a `cli/package.json` minor bump and a manual `npm publish`. Surface that to the user at the end as a follow-up decision — do not bump or publish unprompted.
- No new npm packages are added. No schema/migration changes. No server changes.

```

```
