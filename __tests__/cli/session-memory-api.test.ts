/**
 * @jest-environment node
 */
import {
  fetchMemoryDraft,
  applyMemoryReview,
  type ServerMemoryDraft,
} from '@/cli/src/lib/session-memory-api'

const creds = { token: 't', apiUrl: 'https://x', workspaceSlug: 'lumo' }

beforeEach(() => {
  ;(global as { fetch?: unknown }).fetch = jest.fn()
})

it('GETs the session-memories endpoint with bearer auth', async () => {
  const draft: ServerMemoryDraft = { taskIdentifier: 'LUM-42', memories: [], watermark: null }
  ;(global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200, json: async () => draft })
  const r = await fetchMemoryDraft(creds, 'sess_1')
  expect(r).toEqual(draft)
  const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
  expect(url).toBe('https://x/api/sessions/sess_1/session-memories')
  expect(init.headers.Authorization).toBe('Bearer t')
})

it('throws on non-200 draft fetch', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
  await expect(fetchMemoryDraft(creds, 'sess_1')).rejects.toThrow(/HTTP 500/)
})

it('POSTs the review payload and returns counts', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200, json: async () => ({ deleted: 1, promoted: 2 }) })
  const r = await applyMemoryReview(creds, 'sess_1', {
    watermark: '2026-06-01T10:00:00.000Z', deleteIds: ['m1'], promoteIds: ['m2', 'm3'],
  })
  expect(r).toEqual({ deleted: 1, promoted: 2 })
  const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
  expect(url).toBe('https://x/api/sessions/sess_1/memory-review')
  expect(init.method).toBe('POST')
  expect(JSON.parse(init.body)).toEqual({
    watermark: '2026-06-01T10:00:00.000Z', deleteIds: ['m1'], promoteIds: ['m2', 'm3'],
  })
})

it('surfaces the server error message on non-2xx apply', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: 'Session not found' }) })
  await expect(
    applyMemoryReview(creds, 'sess_1', { watermark: '2026-06-01T10:00:00.000Z', deleteIds: [], promoteIds: [] })
  ).rejects.toThrow('Session not found')
})
