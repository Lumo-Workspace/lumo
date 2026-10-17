import { EXIT_USAGE } from '../lib/exit-codes'
import { apiContext } from '../lib/test-case-api'
import { milestoneScope } from '../lib/test-case-scope'
import {
  testCaseAddInScope,
  type TestCaseAddOptions,
} from './task-testcase-add'
import { testCaseListInScope } from './task-testcase-list'
import { testCaseShowInScope } from './task-testcase-show'
import { testCaseDownloadInScope } from './task-testcase-download'
import {
  testCaseUpdateInScope,
  type TestCaseUpdateOptions,
} from './task-testcase-update'
import { testCaseRmInScope, type TestCaseRmOptions } from './task-testcase-rm'
import {
  testCaseRunInScope,
  type TestCaseRunOptions,
} from './task-testcase-run'
import {
  testCaseDispositionInScope,
  type TestCaseDispositionOptions,
} from './task-testcase-disposition'

/**
 * LUM-1135: `lumo milestone testcase …` — the milestone close contract.
 * Thin wrappers: resolve the milestone, then run the shared task-case bodies.
 */
type WithProject<T> = T & { project?: string | undefined }

async function scopeFor(
  milestone: string | undefined,
  usage: string,
  project?: string
) {
  if (!milestone) {
    console.error(`Error: missing <milestone>. Usage: ${usage}`)
    return null
  }
  const ctx = apiContext()
  if (!ctx) return null
  return milestoneScope(ctx, milestone, project)
}

function needCase(
  caseRef: string | undefined,
  usage: string
): caseRef is string {
  if (caseRef) return true
  console.error(`Error: missing <case> (e.g. TC3). Usage: ${usage}`)
  return false
}

export async function milestoneTestCaseAdd(
  milestone: string | undefined,
  o: WithProject<TestCaseAddOptions>
): Promise<number | void> {
  const scope = await scopeFor(
    milestone,
    'lumo milestone testcase add "<milestone>" --title "…" --step "…" --expected "…"',
    o.project
  )
  return scope ? testCaseAddInScope(scope, o) : 1
}

export async function milestoneTestCaseList(
  milestone: string | undefined,
  o: { project?: string | undefined; json?: boolean | undefined }
): Promise<number | void> {
  const scope = await scopeFor(
    milestone,
    'lumo milestone testcase list "<milestone>"',
    o.project
  )
  return scope ? testCaseListInScope(scope, { json: o.json }) : 1
}

export async function milestoneTestCaseShow(
  milestone: string | undefined,
  caseRef: string | undefined,
  o: { project?: string | undefined; json?: boolean | undefined }
): Promise<number | void> {
  const usage = 'lumo milestone testcase show "<milestone>" TC3'
  if (!needCase(caseRef, usage)) return 1
  const scope = await scopeFor(milestone, usage, o.project)
  return scope ? testCaseShowInScope(scope, caseRef, { json: o.json }) : 1
}

/** LUM-1185: save the case's Lumo-hosted evidence into `<dir>/<run>/`. */
export async function milestoneTestCaseDownload(
  milestone: string | undefined,
  caseRef: string | undefined,
  dir: string | undefined,
  o: { project?: string | undefined }
): Promise<number | void> {
  const usage = 'lumo milestone testcase download "<milestone>" TC3 ./evidence'
  if (!needCase(caseRef, usage)) return 1
  if (!dir || !dir.trim()) {
    console.error(`Error: missing <dir>. Usage: ${usage}`)
    return EXIT_USAGE
  }
  const scope = await scopeFor(milestone, usage, o.project)
  return scope ? testCaseDownloadInScope(scope, caseRef, dir) : 1
}

export async function milestoneTestCaseUpdate(
  milestone: string | undefined,
  caseRef: string | undefined,
  o: WithProject<TestCaseUpdateOptions>
): Promise<number | void> {
  const usage = 'lumo milestone testcase update "<milestone>" TC3 --title "…"'
  if (!needCase(caseRef, usage)) return 1
  const scope = await scopeFor(milestone, usage, o.project)
  return scope ? testCaseUpdateInScope(scope, caseRef, o) : 1
}

export async function milestoneTestCaseRm(
  milestone: string | undefined,
  caseRef: string | undefined,
  o: WithProject<TestCaseRmOptions>
): Promise<number | void> {
  const usage = 'lumo milestone testcase rm "<milestone>" TC3'
  if (!needCase(caseRef, usage)) return 1
  const scope = await scopeFor(milestone, usage, o.project)
  return scope ? testCaseRmInScope(scope, caseRef, o) : 1
}

export async function milestoneTestCaseRun(
  milestone: string | undefined,
  caseRef: string | undefined,
  o: WithProject<TestCaseRunOptions>
): Promise<number | void> {
  const usage =
    'lumo milestone testcase run "<milestone>" TC3 --result pass --env production'
  if (!needCase(caseRef, usage)) return 1
  if (o.pr !== undefined) {
    console.error(
      'Error: --pr does not apply to a milestone run (a milestone spans many PRs); the commit is recorded instead.'
    )
    return EXIT_USAGE
  }
  const scope = await scopeFor(milestone, usage, o.project)
  return scope ? testCaseRunInScope(scope, caseRef, o) : 1
}

export async function milestoneTestCaseDisposition(
  milestone: string | undefined,
  caseRef: string | undefined,
  o: WithProject<TestCaseDispositionOptions>
): Promise<number | void> {
  const usage =
    'lumo milestone testcase disposition "<milestone>" TC3 --known-defect'
  if (!needCase(caseRef, usage)) return 1
  const scope = await scopeFor(milestone, usage, o.project)
  return scope ? testCaseDispositionInScope(scope, caseRef, o) : 1
}
