/**
 * @jest-environment node
 */
import { resolveSprintId } from '@/cli/src/lib/resolve'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

describe('resolveSprintId', () => {
  const origFetch = global.fetch
  afterEach(() => {
    global.fetch = origFetch
  })

  it('returns identifier as-is for a UUID (no fetch)', async () => {
    const fetchSpy = jest.fn()
    global.fetch = fetchSpy as unknown as typeof fetch
    const out = await resolveSprintId(
      'http://x',
      'tok',
      '00000000-1111-2222-3333-444444444444',
      undefined,
      'lumo'
    )
    expect(out).toEqual({
      id: '00000000-1111-2222-3333-444444444444',
      number: 0,
      name: '',
      teamId: '',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('resolves a number via /api/sprints/by-number', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        sprint: { id: 'sp-3', number: 3, name: 'Sprint 3', teamId: 'tm-a' },
        progress: { done: 1, total: 5 },
      })
    ) as unknown as typeof fetch
    const out = await resolveSprintId('http://x', 'tok', '3', undefined, 'lumo')
    expect(out).toEqual({
      id: 'sp-3',
      number: 3,
      name: 'Sprint 3',
      teamId: 'tm-a',
    })
    expect(global.fetch).toHaveBeenCalledWith(
      'http://x/api/sprints/by-number?workspaceUrl=lumo&number=3',
      expect.objectContaining({
        headers: { Authorization: 'Bearer tok' },
      })
    )
  })

  it('errors with a useful hint on number 404', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: 'Sprint not found' }, 404)
      ) as unknown as typeof fetch
    await expect(
      resolveSprintId('http://x', 'tok', '99', undefined, 'lumo')
    ).rejects.toThrow(/sprint #99 not found/i)
  })

  it('rejects non-positive-integer identifiers', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch
    await expect(
      resolveSprintId('http://x', 'tok', '0', undefined, 'lumo')
    ).rejects.toThrow(/positive integer or a UUID/)
    await expect(
      resolveSprintId('http://x', 'tok', 'abc', undefined, 'lumo')
    ).rejects.toThrow(/positive integer or a UUID/)
  })
})
