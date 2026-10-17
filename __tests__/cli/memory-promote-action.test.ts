/** @jest-environment node */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: () => ({
    token: 'tok',
    apiUrl: 'https://x',
    workspaceSlug: 'ws',
  }),
}))
jest.mock('../../cli/src/lib/session-id', () => ({
  resolveSessionId: async () => process.env.CLAUDE_CODE_SESSION_ID,
  AmbiguousSessionError: class extends Error {},
}))

import { memoryPromote } from '@/cli/src/commands/memory-promote'
import { memoryRm } from '@/cli/src/commands/memory-rm'

afterEach(() => jest.restoreAllMocks())

it('PATCHes scope=PROJECT and reports success', async () => {
  const out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  let captured: any
  jest.spyOn(global, 'fetch').mockImplementation(((url: any, init: any) => {
    captured = { url: String(url), init }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ memory: { id: 'm1' } }),
    } as Response)
  }) as any)
  const code = await memoryPromote('m1')
  expect(code).toBeUndefined()
  expect(captured.url).toContain('/api/memories/m1')
  expect(captured.init.method).toBe('PATCH')
  expect(JSON.parse(captured.init.body)).toEqual({ scope: 'PROJECT' })
  expect(out).toHaveBeenCalledWith(
    expect.stringMatching(/Promoted m1 to PROJECT/)
  )
})

it('surfaces 409 already-project', async () => {
  const err = jest.spyOn(console, 'error').mockImplementation(() => {})
  jest
    .spyOn(global, 'fetch')
    .mockResolvedValue({ ok: false, status: 409 } as Response)
  expect(await memoryPromote('m1')).toBe(1)
  expect(err).toHaveBeenCalledWith(
    expect.stringMatching(/already project-scoped/)
  )
})

it('surfaces 404 not found on promote', async () => {
  const err = jest.spyOn(console, 'error').mockImplementation(() => {})
  jest
    .spyOn(global, 'fetch')
    .mockResolvedValue({ ok: false, status: 404 } as Response)
  expect(await memoryPromote('mX')).toBe(1)
  expect(err).toHaveBeenCalledWith(expect.stringMatching(/not found/))
})

it('promote errors on missing id (no network)', async () => {
  const fetchSpy = jest.spyOn(global, 'fetch')
  const err = jest.spyOn(console, 'error').mockImplementation(() => {})
  expect(await memoryPromote(undefined)).toBe(1)
  expect(fetchSpy).not.toHaveBeenCalled()
  expect(err).toHaveBeenCalledWith(expect.stringMatching(/missing <memory>/))
})

it('rm without --confirm: fetches the card, exits 4 with the envelope, sends no DELETE (LUM-755)', async () => {
  const out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  const err = jest.spyOn(console, 'error').mockImplementation(() => {})
  const calls: { url: string; method: string }[] = []
  jest.spyOn(global, 'fetch').mockImplementation(((url: any, init: any) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET' })
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({
        memory: { id: 'm1', category: 'TRAP', content: { situation: 'x' } },
      }),
    } as Response)
  }) as any)
  expect(await memoryRm('m1', {})).toBe(4)
  expect(calls).toEqual([{ url: 'https://x/api/memories/m1', method: 'GET' }])
  expect(err).not.toHaveBeenCalled()
  const printed = out.mock.calls.map(c => String(c[0])).join('')
  expect(printed).toContain('confirmation_required')
  expect(printed).toContain('Will hard-delete memory m1 [TRAP]')
})

it('rm DELETEs with --yes (204)', async () => {
  const out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  let captured: any
  jest.spyOn(global, 'fetch').mockImplementation(((url: any, init: any) => {
    captured = { url: String(url), init }
    return Promise.resolve({ ok: true, status: 204 } as Response)
  }) as any)
  const code = await memoryRm('m1', { yes: true })
  expect(code).toBeUndefined()
  expect(captured.url).toContain('/api/memories/m1')
  expect(captured.init.method).toBe('DELETE')
  expect(out).toHaveBeenCalledWith(expect.stringMatching(/Deleted memory m1/))
})

it('rm surfaces 404', async () => {
  const err = jest.spyOn(console, 'error').mockImplementation(() => {})
  jest
    .spyOn(global, 'fetch')
    .mockResolvedValue({ ok: false, status: 404 } as Response)
  expect(await memoryRm('mX', { yes: true })).toBe(1)
  expect(err).toHaveBeenCalledWith(expect.stringMatching(/not found/))
})
