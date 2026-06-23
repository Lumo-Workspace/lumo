/**
 * @jest-environment node
 *
 * LUM-576 — dispatchRunSummaries: the post-task-completion handoff that sends
 * one task's run-summary generation to the dedicated foreground worker
 * (POST /api/internal/run-summary) instead of running the sequential per-session
 * LLM calls inline in the cramped ~15s task-route waitUntil (where they silently
 * ran out of time). Best-effort: a dispatch failure must never throw (it cannot
 * roll back task completion).
 */
import { dispatchRunSummaries } from '@/lib/services/run-summary-dispatch'

const realFetch = global.fetch
const realAppUrl = process.env.NEXT_PUBLIC_APP_URL
const realCronSecret = process.env.CRON_SECRET

const restore = (key: string, value: string | undefined) => {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

afterEach(() => {
  global.fetch = realFetch
  // Don't leak env across suites — a stray NEXT_PUBLIC_APP_URL makes
  // dispatchRunSummaries attempt a real fetch in other suites' waitUntil
  // flushes (it hung task-state-layer2-trigger when this leaked).
  restore('NEXT_PUBLIC_APP_URL', realAppUrl)
  restore('CRON_SECRET', realCronSecret)
})

describe('run-summary dispatch (LUM-576)', () => {
  it('run-summary dispatch posts to the internal worker with the bearer secret', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com'
    process.env.CRON_SECRET = 'sek'
    const fetchMock = jest.fn().mockResolvedValue({ ok: true })
    global.fetch = fetchMock as never

    await dispatchRunSummaries('task-1')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://app.example.com/api/internal/run-summary')
    expect(init.method).toBe('POST')
    expect(init.headers.authorization).toBe('Bearer sek')
    expect(JSON.parse(init.body)).toEqual({ taskId: 'task-1' })
  })

  it('run-summary dispatch swallows a fetch failure and never throws', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com'
    global.fetch = jest.fn().mockRejectedValue(new Error('network')) as never
    await expect(dispatchRunSummaries('task-1')).resolves.toBeUndefined()
  })

  it('run-summary dispatch skips (no throw) when the app URL is unset', async () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    const fetchMock = jest.fn()
    global.fetch = fetchMock as never
    await expect(dispatchRunSummaries('task-1')).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
