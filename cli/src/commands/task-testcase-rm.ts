import { apiContext, apiCall } from '../lib/test-case-api'
import { splitCaseHandle } from '../lib/test-case-handle'
import { sanitizeField } from '../lib/sanitize'
import {
  emitConfirmation,
  isConfirmed,
  type ConfirmFlags,
} from '../lib/confirmation'

export type TestCaseRmOptions = ConfirmFlags

interface ShowResponse {
  testCase: { number: number; title: string }
  runs: unknown[]
}

/** The changes[] block for the confirmation envelope. */
export function describeTestCaseRm(
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
    'The case disappears from the task list; recording new runs against it is no longer possible',
  ]
}

export async function taskTestCaseRm(
  handle: string | undefined,
  options: TestCaseRmOptions
): Promise<number | void> {
  if (!handle) {
    console.error(
      'Error: missing <task/case>. Usage: lumo task testcase rm LUM-42/TC3 --confirm'
    )
    return 1
  }
  const split = splitCaseHandle(handle)
  if (!split) {
    console.error(
      `Error: invalid handle "${handle}". Expected <task>/TC<n>, e.g. LUM-42/TC3.`
    )
    return 1
  }
  const ctx = apiContext()
  if (!ctx) return 1

  const path = `/api/tasks/${encodeURIComponent(split.task)}/test-cases/${encodeURIComponent(split.caseRef)}`

  // 没有 --confirm 时先查出它是什么，把信封打给用户，然后停——不发 DELETE。
  // agent 不得自己补 --confirm：那个 flag 的含义是「用户已确认」。
  if (!isConfirmed(options)) {
    const look = await apiCall<ShowResponse>(ctx, path, {}, 'test case lookup')
    if (!look.ok || !look.data) return 1
    return emitConfirmation({
      command: 'task testcase rm',
      changes: describeTestCaseRm(
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
    'test case remove'
  )
  if (!r.ok) return 1

  console.log(`Removed ${handle} (soft delete — its run history is preserved)`)
}
