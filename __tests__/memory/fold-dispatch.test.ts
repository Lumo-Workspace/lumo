/**
 * @jest-environment node
 *
 * LUM-555 — dispatchProjectFold: the post-task-completion handoff that sends one
 * project's fold to the dedicated foreground worker (POST /api/internal/fold)
 * instead of running the heavy LLM fold inline in the cramped task-route
 * waitUntil. Best-effort: a dispatch failure must never throw (it cannot roll
 * back task completion).
 */
import { dispatchProjectFold } from '@/lib/services/memory/fold-dispatch'

const realFetch = global.fetch

afterEach(() => {
  global.fetch = realFetch
})

describe('dispatchProjectFold (LUM-555)', () => {
  it('dispatchProjectFold posts to the internal fold endpoint with the bearer secret', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com'
    process.env.CRON_SECRET = 'sek'
    const fetchMock = jest.fn().mockResolvedValue({ ok: true })
    global.fetch = fetchMock as never

    await dispatchProjectFold('proj-1', 'sess-1')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://app.example.com/api/internal/fold')
    expect(init.method).toBe('POST')
    expect(init.headers.authorization).toBe('Bearer sek')
    expect(JSON.parse(init.body)).toEqual({
      projectId: 'proj-1',
      sourceSessionId: 'sess-1',
    })
  })

  it('swallows a dispatch failure and never throws', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com'
    global.fetch = jest.fn().mockRejectedValue(new Error('network')) as never
    await expect(dispatchProjectFold('p', null)).resolves.toBeUndefined()
  })
})
