import { resolveWorktreeTaskId } from '../src/lib/worktree-ref'
import * as config from '../src/lib/config'

jest.mock('../src/lib/config', () => {
  const actual = jest.requireActual('../src/lib/config')
  return { ...actual, readCredentials: jest.fn() }
})

const readCredentials = config.readCredentials as jest.MockedFunction<
  typeof config.readCredentials
>

const creds = {
  token: 'tok',
  apiUrl: 'https://api.example.com',
  userId: 'u',
  email: 'e',
  workspaceId: 'w',
  workspaceSlug: 's',
  workspaceName: 'n',
  apiKeyId: 'k',
  apiKeyName: 'kn',
  apiKeyPrefix: 'kp',
} as ReturnType<typeof config.readCredentials>

describe('resolveWorktreeTaskId', () => {
  const fetchMock = jest.fn()
  beforeEach(() => {
    jest.clearAllMocks()
    ;(global as unknown as { fetch: jest.Mock }).fetch = fetchMock
    readCredentials.mockReturnValue(creds)
  })

  function teamsResponse(teams: unknown[]) {
    return { ok: true, status: 200, json: async () => ({ teams }) }
  }

  it('resolves a bare number via the workspace default team prefix', async () => {
    fetchMock.mockResolvedValueOnce(
      teamsResponse([
        { id: 't1', name: 'Spec', identifier: 'SPEC', isDefault: true },
        { id: 't2', name: 'Lumo', identifier: 'LUM', isDefault: false },
      ])
    )
    await expect(resolveWorktreeTaskId('267')).resolves.toBe('SPEC-267')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![0]).toContain('/api/teams')
  })

  it('resolves a bare number for a single-team workspace even without an explicit default flag', async () => {
    fetchMock.mockResolvedValueOnce(
      teamsResponse([{ id: 't1', name: 'Proj', identifier: 'PROJ' }])
    )
    await expect(resolveWorktreeTaskId('42')).resolves.toBe('PROJ-42')
  })

  it('passes an explicit non-LUM prefix through without any network call', async () => {
    await expect(resolveWorktreeTaskId('spec-9')).resolves.toBe('SPEC-9')
    await expect(resolveWorktreeTaskId('LUM-267')).resolves.toBe('LUM-267')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns null for input that is not a task-id shape at all', async () => {
    await expect(resolveWorktreeTaskId('foo')).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws a helpful error on a bare number when no default team can be determined', async () => {
    fetchMock.mockResolvedValueOnce(
      teamsResponse([
        { id: 't1', name: 'A', identifier: 'AAA' },
        { id: 't2', name: 'B', identifier: 'BBB' },
      ])
    )
    await expect(resolveWorktreeTaskId('7')).rejects.toThrow(/explicit/i)
  })

  it('throws when a bare number is used but the user is not logged in', async () => {
    readCredentials.mockReturnValue(null)
    await expect(resolveWorktreeTaskId('7')).rejects.toThrow(
      /auth login|explicit/i
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
