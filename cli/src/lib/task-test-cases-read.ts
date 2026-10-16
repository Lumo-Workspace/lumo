import { trimTrailingSlash } from './api'
import type { ListRow } from '../commands/task-testcase-list'

/**
 * LUM-1186: what `lumo task status --full` read from the task's test cases —
 * the same `GET /api/tasks/[id]/test-cases` payload `lumo task testcase list`
 * prints (cases + latest run with server-derived ceiling / stepReport, and the
 * server-computed `summary`).
 *
 * Fails closed like the crossings read: a transport / HTTP / parse failure is
 * `{ status: 'error' }` so the report says "could not read", never an empty
 * "no test cases" — and it never throws into the primary status read.
 */
export type TaskTestCasesResult =
  | { status: 'ok'; testCases: ListRow[]; summary: unknown }
  | { status: 'error'; reason: string }

export async function fetchTaskTestCases(
  apiUrl: string,
  token: string,
  taskIdentifier: string
): Promise<TaskTestCasesResult> {
  const url = `${trimTrailingSlash(apiUrl)}/api/tasks/${encodeURIComponent(
    taskIdentifier
  )}/test-cases`
  let res: Response
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  } catch (err) {
    return {
      status: 'error',
      reason: err instanceof Error ? err.message : 'network error',
    }
  }
  if (!res.ok) return { status: 'error', reason: `HTTP ${res.status}` }
  let data: { testCases?: unknown; summary?: unknown }
  try {
    data = (await res.json()) as { testCases?: unknown; summary?: unknown }
  } catch {
    return { status: 'error', reason: 'invalid response body' }
  }
  if (!data || !Array.isArray(data.testCases))
    return { status: 'error', reason: 'invalid response body' }
  return {
    status: 'ok',
    testCases: data.testCases as ListRow[],
    summary: data.summary,
  }
}
