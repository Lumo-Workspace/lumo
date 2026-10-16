import { apiCall, apiContext } from '../lib/test-case-api'
import { splitCaseHandle } from '../lib/test-case-handle'
import {
  downloadRunsEvidence,
  type DownloadableRun,
} from '../lib/test-case-download'
import { sanitizeField } from '../lib/sanitize'
import { taskScope, type TestCaseScope } from '../lib/test-case-scope'

/**
 * LUM-1185: `lumo task testcase download <task/case> <dir>` (and the milestone
 * twin) — save the Lumo-hosted evidence of every run of one case into
 * `<dir>/<run>/` with the CLI's API key.
 *
 * A separate command rather than a `show --download` flag: Codex rules match
 * command names, not flags, so a flag that writes local files would force the
 * read-only `show` into the sandbox too. This command is the only one in the
 * "writes local files" class; `show` stays server-only.
 */
interface DetailResponse {
  testCase: { number: number; title: string }
  runs: DownloadableRun[]
}

export async function taskTestCaseDownload(
  handle: string | undefined,
  dir: string | undefined
): Promise<number | void> {
  const usage = 'lumo task testcase download LUM-42/TC3 ./evidence'
  if (!handle) {
    console.error(`Error: missing <task/case>. Usage: ${usage}`)
    return 1
  }
  const split = splitCaseHandle(handle)
  if (!split) {
    console.error(
      `Error: invalid handle "${handle}". Expected <task>/TC<n>, e.g. LUM-42/TC3.`
    )
    return 1
  }
  if (!dir || !dir.trim()) {
    console.error(`Error: missing <dir>. Usage: ${usage}`)
    return 1
  }
  return testCaseDownloadInScope(taskScope(split.task), split.caseRef, dir)
}

export async function testCaseDownloadInScope(
  scope: TestCaseScope,
  caseRef: string,
  dir: string
): Promise<number | void> {
  if (!dir.trim()) {
    console.error('Error: missing <dir>, e.g. ./evidence')
    return 1
  }
  const ctx = apiContext()
  if (!ctx) return 1

  const r = await apiCall<DetailResponse>(
    ctx,
    `${scope.basePath}/test-cases/${encodeURIComponent(caseRef)}`,
    {},
    'test case download'
  )
  if (!r.ok || !r.data) return 1

  const { testCase: c, runs } = r.data
  console.log(`${scope.label}/TC${c.number}  ${sanitizeField(c.title)}`)
  if (runs.length === 0) {
    console.log('  never run, so no evidence to download')
    return
  }
  const ok = await downloadRunsEvidence(ctx, runs, dir)
  if (!ok) return 1
}
