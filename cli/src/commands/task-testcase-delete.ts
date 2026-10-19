import { apiContext, apiCall } from '../lib/test-case-api'
import { sanitizeField } from '../lib/sanitize'
import type { TestCaseScope } from '../lib/test-case-scope'
import {
  emitConfirmation,
  isConfirmed,
  type ConfirmFlags,
} from '../lib/confirmation'

export type TestCaseDeleteOptions = ConfirmFlags

interface ShowResponse {
  testCase: { number: number; title: string }
  runs: unknown[]
}

/** The changes[] block for the confirmation envelope. */
export function describeTestCaseDelete(
  handle: string,
  testCase: { number: number; title: string },
  runCount: number
): string[] {
  const title = sanitizeField(testCase.title).replace(/"/g, '\\"')
  return [
    `Will remove test case ${handle} "${title}"`,
    runCount > 0
      ? `Its ${runCount} run record(s) stay readable — the case is soft-deleted, not erased`
      : 'The case has no run records yet',
    'The case disappears from the test-case list; recording new runs against it is no longer possible',
  ]
}

export async function testCaseDeleteInScope(
  scope: TestCaseScope,
  caseRef: string,
  options: TestCaseDeleteOptions
): Promise<number | void> {
  const handle = `${scope.label}/${caseRef}`
  const ctx = apiContext()
  if (!ctx) return 1

  const path = `${scope.basePath}/test-cases/${encodeURIComponent(caseRef)}`

  // 没有 --confirm 时先查出它是什么，把信封打给用户，然后停——不发 DELETE。
  // agent 不得自己补 --confirm：那个 flag 的含义是「用户已确认」。
  if (!isConfirmed(options)) {
    const look = await apiCall<ShowResponse>(ctx, path, {}, 'test case lookup')
    if (!look.ok || !look.data) return 1
    return emitConfirmation({
      command: `${scope.kind} testcase delete`,
      changes: describeTestCaseDelete(
        handle,
        look.data.testCase,
        look.data.runs.length
      ),
    })
  }

  const r = await apiCall<{ ok: true }>(
    ctx,
    path,
    { method: 'DELETE' },
    'test case delete'
  )
  if (!r.ok) return 1

  console.log(`Deleted ${handle} (soft delete — its run history is preserved)`)
}
