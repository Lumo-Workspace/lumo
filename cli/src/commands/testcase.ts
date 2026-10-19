import { EXIT_USAGE } from '../lib/exit-codes'
import { apiContext } from '../lib/test-case-api'
import {
  milestoneScope,
  taskScope,
  type TestCaseScope,
} from '../lib/test-case-scope'
import { splitCaseHandle } from '../lib/test-case-handle'
import { resolveBoundTaskIdentifier } from '../lib/resolve-bound-task'
import {
  testCaseAddInScope,
  type TestCaseAddOptions,
} from './task-testcase-add'
import {
  testCaseListInScope,
  type TestCaseListOptions,
} from './task-testcase-list'
import {
  testCaseShowInScope,
  type TestCaseShowOptions,
} from './task-testcase-show'
import { testCaseDownloadInScope } from './task-testcase-download'
import {
  testCaseUpdateInScope,
  type TestCaseUpdateOptions,
} from './task-testcase-update'
import {
  testCaseDeleteInScope,
  type TestCaseDeleteOptions,
} from './task-testcase-delete'
import {
  testCaseRunInScope,
  type TestCaseRunOptions,
} from './task-testcase-run'
import {
  testCaseDispositionInScope,
  type TestCaseDispositionOptions,
} from './task-testcase-disposition'

/**
 * LUM-1233 batch 3a — one test-case command set for both parents.
 * `lumo task testcase …` and `lumo milestone testcase …` share these
 * functions: same verbs, same flags, same output. Every per-case command
 * takes one handle, `<parent>/TC<n>` — `LUM-42/TC3` for a task case,
 * `<milestone-slug>/TC3` for a milestone case (decision Q3,
 * docs/cli-command-structure.md).
 *
 * The only differences are the parent itself: a task `add` / `list` may
 * leave the task out (the session-bound task fills it, AR-2); a milestone is
 * always named, and `--project` narrows its lookup (task refs are unique in
 * the workspace, so a task command accepts `--project` and ignores it).
 * `--pr` names the PR a task run exercised; a milestone spans many PRs, so a
 * milestone run refuses it (exit 2) and records the commit instead.
 */
export type TestCaseParentKind = 'task' | 'milestone'

const EXAMPLE_PARENT: Record<TestCaseParentKind, string> = {
  task: 'LUM-42',
  milestone: 'headless-web-cli',
}

/** `LUM-42/TC3` / `headless-web-cli/TC3` — the handle example in errors. */
export function exampleHandle(kind: TestCaseParentKind): string {
  return `${EXAMPLE_PARENT[kind]}/TC3`
}

type WithProject<T> = T & { project?: string | undefined }

/** The scope for a parent ref, or the exit code (an error was printed). */
async function scopeFor(
  kind: TestCaseParentKind,
  parent: string | undefined,
  usage: string,
  project: string | undefined
): Promise<TestCaseScope | number> {
  const ctx = apiContext()
  if (!ctx) return 1
  if (kind === 'task') {
    const id = parent ?? (await resolveBoundTaskIdentifier(ctx.base, ctx.token))
    if (!id) {
      console.error(
        `Error: no task given and this session is not attached. Usage: ${usage}`
      )
      return EXIT_USAGE
    }
    return taskScope(id)
  }
  if (!parent) {
    console.error(`Error: missing <milestone>. Usage: ${usage}`)
    return EXIT_USAGE
  }
  return (await milestoneScope(ctx, parent, project)) ?? 1
}

/** Split `<parent>/TC<n>`, printing the usage error when it is not one. */
export function parseHandle(
  kind: TestCaseParentKind,
  handle: string | undefined,
  usage: string
): { parent: string; caseRef: string } | null {
  if (!handle) {
    console.error(`Error: missing <${kind}/case>. Usage: ${usage}`)
    return null
  }
  const split = splitCaseHandle(handle)
  if (!split) {
    console.error(
      `Error: invalid handle "${handle}". Expected <${kind}>/TC<n>, e.g. ${exampleHandle(kind)}.`
    )
    return null
  }
  return { parent: split.task, caseRef: split.caseRef }
}

/** Resolve a handle to its scope + case, or the exit code. */
async function caseScope(
  kind: TestCaseParentKind,
  handle: string | undefined,
  usage: string,
  project: string | undefined
): Promise<{ scope: TestCaseScope; caseRef: string } | number> {
  const parsed = parseHandle(kind, handle, usage)
  if (!parsed) return EXIT_USAGE
  const scope = await scopeFor(kind, parsed.parent, usage, project)
  if (typeof scope === 'number') return scope
  return { scope, caseRef: parsed.caseRef }
}

const usageOf = (kind: TestCaseParentKind, rest: string) =>
  `lumo ${kind} testcase ${rest}`

export async function testCaseAdd(
  kind: TestCaseParentKind,
  parent: string | undefined,
  o: WithProject<TestCaseAddOptions>
): Promise<number | void> {
  const usage = usageOf(
    kind,
    `add ${EXAMPLE_PARENT[kind]} --title "…" --step "…" --expected "…"`
  )
  const scope = await scopeFor(kind, parent, usage, o.project)
  return typeof scope === 'number' ? scope : testCaseAddInScope(scope, o)
}

export async function testCaseList(
  kind: TestCaseParentKind,
  parent: string | undefined,
  o: WithProject<TestCaseListOptions> = {}
): Promise<number | void> {
  const usage = usageOf(kind, `list ${EXAMPLE_PARENT[kind]}`)
  const scope = await scopeFor(kind, parent, usage, o.project)
  return typeof scope === 'number'
    ? scope
    : testCaseListInScope(scope, { json: o.json })
}

export async function testCaseShow(
  kind: TestCaseParentKind,
  handle: string | undefined,
  o: WithProject<TestCaseShowOptions> = {}
): Promise<number | void> {
  const r = await caseScope(
    kind,
    handle,
    usageOf(kind, `show ${exampleHandle(kind)}`),
    o.project
  )
  return typeof r === 'number'
    ? r
    : testCaseShowInScope(r.scope, r.caseRef, { json: o.json })
}

/** LUM-1185: save the case's Lumo-hosted evidence into `<dir>/<run>/`. */
export async function testCaseDownload(
  kind: TestCaseParentKind,
  handle: string | undefined,
  dir: string | undefined,
  o: { project?: string | undefined } = {}
): Promise<number | void> {
  const usage = usageOf(kind, `download ${exampleHandle(kind)} ./evidence`)
  if (handle && (!dir || !dir.trim())) {
    console.error(`Error: missing <dir>. Usage: ${usage}`)
    return EXIT_USAGE
  }
  const r = await caseScope(kind, handle, usage, o.project)
  return typeof r === 'number'
    ? r
    : testCaseDownloadInScope(r.scope, r.caseRef, dir as string)
}

export async function testCaseUpdate(
  kind: TestCaseParentKind,
  handle: string | undefined,
  o: WithProject<TestCaseUpdateOptions>
): Promise<number | void> {
  const r = await caseScope(
    kind,
    handle,
    usageOf(kind, `update ${exampleHandle(kind)} --title "…"`),
    o.project
  )
  return typeof r === 'number'
    ? r
    : testCaseUpdateInScope(r.scope, r.caseRef, o)
}

export async function testCaseDelete(
  kind: TestCaseParentKind,
  handle: string | undefined,
  o: WithProject<TestCaseDeleteOptions>
): Promise<number | void> {
  const r = await caseScope(
    kind,
    handle,
    usageOf(kind, `delete ${exampleHandle(kind)} --confirm`),
    o.project
  )
  return typeof r === 'number'
    ? r
    : testCaseDeleteInScope(r.scope, r.caseRef, o)
}

export async function testCaseRun(
  kind: TestCaseParentKind,
  handle: string | undefined,
  o: WithProject<TestCaseRunOptions>
): Promise<number | void> {
  const usage = usageOf(
    kind,
    `run ${exampleHandle(kind)} --result pass --env local`
  )
  if (kind === 'milestone' && o.pr !== undefined) {
    console.error(
      'Error: --pr does not apply to a milestone run (a milestone spans many PRs); the commit is recorded instead.'
    )
    return EXIT_USAGE
  }
  const r = await caseScope(kind, handle, usage, o.project)
  return typeof r === 'number' ? r : testCaseRunInScope(r.scope, r.caseRef, o)
}

export async function testCaseDisposition(
  kind: TestCaseParentKind,
  handle: string | undefined,
  o: WithProject<TestCaseDispositionOptions> = {}
): Promise<number | void> {
  const r = await caseScope(
    kind,
    handle,
    usageOf(kind, `disposition ${exampleHandle(kind)} --known-defect`),
    o.project
  )
  return typeof r === 'number'
    ? r
    : testCaseDispositionInScope(r.scope, r.caseRef, o)
}
