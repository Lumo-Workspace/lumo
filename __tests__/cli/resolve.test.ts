/**
 * @jest-environment node
 */
import {
  isUuid,
  resolveProjectId,
  resolveMilestoneId,
  slugify,
} from '@/cli/src/lib/resolve'

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

describe('slugify', () => {
  it('matches the server implementation', () => {
    expect(slugify('foo.bar')).toBe('foobar')
    expect(slugify('a_b')).toBe('ab')
    expect(slugify('v1.2')).toBe('v12')
    expect(slugify('My Cool Project')).toBe('my-cool-project')
    expect(slugify('  spaced  out  ')).toBe('spaced-out')
    expect(slugify('UPPER-case')).toBe('upper-case')
  })
})

describe('isUuid', () => {
  it('returns true for canonical UUIDs', () => {
    expect(isUuid('11111111-2222-3333-4444-555555555555')).toBe(true)
  })
  it('returns false for non-UUIDs', () => {
    expect(isUuid('Q3 Launch')).toBe(false)
    expect(isUuid('lumo')).toBe(false)
  })
})

describe('resolveProjectId', () => {
  it('auto-selects the only project when ref is undefined', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        projects: [{ id: 'p-1', name: 'Lumo', isIdea: false }],
      })
    )
    const id = await resolveProjectId('http://x', 'tok', undefined)
    expect(id).toBe('p-1')
  })

  it('throws when multiple projects exist and ref is undefined', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        projects: [
          { id: 'p-1', name: 'Lumo', isIdea: false },
          { id: 'p-2', name: 'Other', isIdea: false },
        ],
      })
    )
    await expect(
      resolveProjectId('http://x', 'tok', undefined)
    ).rejects.toThrow(/multiple projects/)
  })

  it('matches by slug case-insensitively', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        projects: [
          { id: 'p-1', name: 'My Cool Project', isIdea: false },
          { id: 'p-2', name: 'Other', isIdea: false },
        ],
      })
    )
    const id = await resolveProjectId('http://x', 'tok', 'my-cool-project')
    expect(id).toBe('p-1')
  })

  it('throws when ref does not match any project', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ projects: [{ id: 'p-1', name: 'Lumo', isIdea: false }] })
    )
    await expect(
      resolveProjectId('http://x', 'tok', 'missing')
    ).rejects.toThrow(/not found/)
  })
})

describe('resolveMilestoneId', () => {
  it('returns the identifier directly when it is a UUID', async () => {
    const result = await resolveMilestoneId(
      'http://x',
      'tok',
      '11111111-2222-3333-4444-555555555555',
      undefined
    )
    expect(result.id).toBe('11111111-2222-3333-4444-555555555555')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('resolves a name within an auto-selected single project', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          projects: [{ id: 'p-1', name: 'Lumo', isIdea: false }],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          milestones: [
            { id: 'm-1', name: 'Q3 Launch', status: 'ACTIVE' },
            { id: 'm-2', name: 'Q4 Plan', status: 'PLANNED' },
          ],
        })
      )
    const result = await resolveMilestoneId(
      'http://x',
      'tok',
      'q3 launch',
      undefined
    )
    expect(result).toEqual({
      id: 'm-1',
      name: 'Q3 Launch',
      projectId: 'p-1',
    })
  })

  it('throws when name is not found in the resolved project', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          projects: [{ id: 'p-1', name: 'Lumo', isIdea: false }],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ milestones: [] }))
    await expect(
      resolveMilestoneId('http://x', 'tok', 'missing', undefined)
    ).rejects.toThrow(/no milestone matches/)
  })

  it('throws an ambiguous error when a name matches more than one milestone', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          projects: [{ id: 'p-1', name: 'Lumo', isIdea: false }],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          milestones: [
            { id: 'm-1', name: 'Beta', status: 'ACTIVE' },
            { id: 'm-2', name: 'Beta', status: 'PLANNED' },
          ],
        })
      )
    await expect(
      resolveMilestoneId('http://x', 'tok', 'beta', undefined)
    ).rejects.toThrow(/ambiguous/i)
  })

  it('resolves a milestone by its cuid id against the fetched list', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          projects: [{ id: 'p-1', name: 'Lumo', isIdea: false }],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          milestones: [{ id: 'cm123abc', name: 'Q3 Launch', status: 'ACTIVE' }],
        })
      )
    const result = await resolveMilestoneId(
      'http://x',
      'tok',
      'cm123abc',
      undefined
    )
    expect(result).toEqual({
      id: 'cm123abc',
      name: 'Q3 Launch',
      projectId: 'p-1',
    })
  })
})

describe('resolveProjectId network failure', () => {
  it('wraps fetch errors with the api-url context', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'))
    await expect(
      resolveProjectId('http://x', 'tok', undefined)
    ).rejects.toThrow(/Could not reach Lumo API at http:\/\/x/)
  })

  it('throws auth error message on 401', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'x' }, 401))
    await expect(
      resolveProjectId('http://x', 'tok', undefined)
    ).rejects.toThrow(/API key invalid or revoked/)
  })
})
