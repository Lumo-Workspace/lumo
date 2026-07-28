/**
 * @jest-environment node
 */
import { resolveTeamId } from '@/cli/src/lib/resolve'

const mockFetch = jest.fn()
beforeEach(() => {
  ;(global as any).fetch = mockFetch
  mockFetch.mockReset()
})

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

describe('resolveTeamId', () => {
  it('auto-selects the only team when ref is undefined', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        teams: [{ id: 't-1', name: 'Engineering', identifier: 'engineering' }],
      })
    )
    const result = await resolveTeamId('http://x', 'tok', undefined)
    expect(result).toEqual({ id: 't-1', name: 'Engineering' })
  })

  it('throws when multiple teams exist and ref is undefined', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        teams: [
          { id: 't-1', name: 'Engineering', identifier: 'engineering' },
          { id: 't-2', name: 'Design', identifier: 'design' },
        ],
      })
    )
    await expect(resolveTeamId('http://x', 'tok', undefined)).rejects.toThrow(
      /multiple teams/
    )
  })

  it('matches by name case-insensitively', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        teams: [
          { id: 't-1', name: 'Engineering', identifier: 'engineering' },
          { id: 't-2', name: 'Design', identifier: 'design' },
        ],
      })
    )
    const result = await resolveTeamId('http://x', 'tok', 'engineering')
    expect(result).toEqual({ id: 't-1', name: 'Engineering' })
  })

  it('matches by identifier (slug) case-insensitively', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        teams: [
          { id: 't-1', name: 'My Cool Team', identifier: 'my-cool-team' },
          { id: 't-2', name: 'Design', identifier: 'design' },
        ],
      })
    )
    const result = await resolveTeamId('http://x', 'tok', 'my-cool-team')
    expect(result).toEqual({ id: 't-1', name: 'My Cool Team' })
  })

  it('passes through a UUID ref directly without fetching', async () => {
    const result = await resolveTeamId(
      'http://x',
      'tok',
      '11111111-2222-3333-4444-555555555555'
    )
    expect(result).toEqual({
      id: '11111111-2222-3333-4444-555555555555',
      name: '',
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('throws when ref does not match any team', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        teams: [{ id: 't-1', name: 'Engineering', identifier: 'engineering' }],
      })
    )
    await expect(resolveTeamId('http://x', 'tok', 'missing')).rejects.toThrow(
      /not found/
    )
  })

  it('throws when no teams exist and ref is undefined', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ teams: [] }))
    await expect(resolveTeamId('http://x', 'tok', undefined)).rejects.toThrow(
      /no teams/i
    )
  })
})
