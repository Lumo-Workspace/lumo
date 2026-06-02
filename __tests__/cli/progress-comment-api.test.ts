/**
 * @jest-environment node
 */
import {
  fetchProgressDraft,
  postProgressComment,
  type ServerProgressDraft,
} from '@/cli/src/lib/progress-comment-api'

const creds = { token: 't', apiUrl: 'https://x', workspaceSlug: 'lumo' }

beforeEach(() => {
  ;(global as { fetch?: unknown }).fetch = jest.fn()
})

it('GETs the turn-summaries endpoint with bearer auth', async () => {
  const draft: ServerProgressDraft = { taskIdentifier: 'LUM-42', taskTitle: 'T', summaries: [], watermark: null }
  ;(global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200, json: async () => draft })
  const r = await fetchProgressDraft(creds, 'sess_1')
  expect(r).toEqual(draft)
  const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
  expect(url).toBe('https://x/api/sessions/sess_1/turn-summaries')
  expect(init.headers.Authorization).toBe('Bearer t')
})

it('throws a useful error on non-200 draft fetch', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
  await expect(fetchProgressDraft(creds, 'sess_1')).rejects.toThrow(/HTTP 500/)
})

it('POSTs body + watermark and returns the commentId', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValue({ status: 201, json: async () => ({ commentId: 'c1' }) })
  const r = await postProgressComment(creds, 'sess_1', { body: 'hi', watermark: '2026-06-01T10:00:00.000Z' })
  expect(r).toEqual({ commentId: 'c1' })
  const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
  expect(url).toBe('https://x/api/sessions/sess_1/progress-comment')
  expect(init.method).toBe('POST')
  expect(JSON.parse(init.body)).toEqual({ body: 'hi', watermark: '2026-06-01T10:00:00.000Z' })
})

it('surfaces the server error message on non-201 post', async () => {
  ;(global.fetch as jest.Mock).mockResolvedValue({ status: 409, json: async () => ({ error: 'not bound' }) })
  await expect(
    postProgressComment(creds, 'sess_1', { body: 'hi', watermark: '2026-06-01T10:00:00.000Z' })
  ).rejects.toThrow('not bound')
})
