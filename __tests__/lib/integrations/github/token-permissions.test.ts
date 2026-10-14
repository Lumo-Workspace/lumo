/**
 * @jest-environment node
 */
/**
 * LUM-886 — every repository token is minted with the minimum permissions its
 * caller needs, and never with a permission the production App lacks (GitHub
 * refuses such a mint with 422, which would take the caller down).
 *
 * The helpers run through the real `getRepoToken`; only the App signer, the
 * installation row and `fetch` are stubbed, so the assertion is on the exact
 * permissions GitHub would be asked for.
 */
// The SDK is only stubbed here, never imported: the handle lives in a
// `mock`-prefixed variable jest lets the hoisted factory close over.
const mockCreateAppAuth = jest.fn()
jest.mock('@octokit/auth-app', () => ({
  createAppAuth: (...args: unknown[]) => mockCreateAppAuth(...args),
}))
jest.mock('@/lib/repositories/github-app-installation.repository', () => ({
  githubAppInstallationRepository: { findByWorkspace: jest.fn() },
}))
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
// LUM-890: the access recheck runs for real; only its row store and the scrub
// it may trigger are stubbed.
jest.mock('@/lib/repositories', () => ({
  ...jest.requireActual('@/lib/repositories'),
  githubAppInstallationRepository: {
    findAllWithVerifier: jest.fn(),
    findAllByInstallationId: jest.fn(),
    findRecheckState: jest.fn(),
    updateRecheckIfUnchanged: jest.fn(),
    findAllForInstallationNarrowing: jest.fn().mockResolvedValue([]),
    clearTokenFailing: jest.fn(),
  },
}))
jest.mock('@/lib/services/github-app-install.service', () => ({
  scrubWorkspaceCode: jest.fn(),
}))

import * as fs from 'fs'
import * as path from 'path'
import { githubAppInstallationRepository } from '@/lib/repositories/github-app-installation.repository'
import {
  createInstallationToken,
  createRepoTokenForInstallation,
  getRepoToken,
} from '@/lib/integrations/github/auth'
import { listInstallationRepositories } from '@/lib/integrations/github/app-installations'
import { githubAppInstallationRepository as recheckRows } from '@/lib/repositories'
import { githubAccessRecheckService } from '@/lib/services/github-access-recheck.service'
import {
  fetchDefaultBranchHead,
  fetchPrDiff,
  fetchPrFiles,
  fetchPrHeadSha,
  fetchPrStats,
  fetchRepoVisibility,
  readRepoFile,
} from '@/lib/integrations/github/contents'
import {
  INSTALLATION_TOKEN_PERMISSIONS,
  PRODUCTION_APP_PERMISSIONS,
  REPO_TOKEN_PERMISSIONS,
  isWithinPermissions,
} from '@/lib/integrations/github/token-permissions'

const createAppAuthMock = mockCreateAppAuth
const findByWorkspace =
  githubAppInstallationRepository.findByWorkspace as jest.Mock
const authFn = jest.fn()
const ORIGINAL_ENV = process.env
const ORIGINAL_FETCH = global.fetch

/** A body that satisfies every helper's parser at once. */
const OK_BODY = {
  additions: 1,
  deletions: 1,
  changed_files: 1,
  head: { sha: 'abc' },
  default_branch: 'main',
  object: { sha: 'def' },
  check_runs: [],
  statuses: [],
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env = {
    ...ORIGINAL_ENV,
    GITHUB_APP_ID: '111',
    // the signer is stubbed; any non-empty value passes the env check
    GITHUB_APP_PRIVATE_KEY: 'stub-signing-key',
  }
  authFn.mockResolvedValue({ token: 'ghs_repo' })
  createAppAuthMock.mockReturnValue(authFn)
  findByWorkspace.mockResolvedValue({
    id: 'gai_1',
    workspaceId: 'ws_1',
    installationId: 42,
    repositories: ['acme/web'],
  })
  global.fetch = jest.fn(async (url: RequestInfo | URL) => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => (String(url).includes('/files') ? [] : OK_BODY),
    text: async () => 'diff --git a/x b/x',
  })) as unknown as typeof fetch
})
afterEach(() => {
  process.env = ORIGINAL_ENV
  global.fetch = ORIGINAL_FETCH
})

const repo = { workspaceId: 'ws_1', fullName: 'acme/web' }

describe('LUM-886 getRepoToken', () => {
  it('getRepoToken refuses to mint without an explicit permission set', async () => {
    await expect(getRepoToken('ws_1', 'acme/web', {})).rejects.toThrow(
      /explicit permission set/
    )
    await expect(
      // @ts-expect-error — the permission set is a required argument
      getRepoToken('ws_1', 'acme/web')
    ).rejects.toThrow(/explicit permission set/)
    // Refused before the installation is even looked up.
    expect(findByWorkspace).not.toHaveBeenCalled()
    expect(authFn).not.toHaveBeenCalled()
  })
})

describe('LUM-886 createRepoTokenForInstallation', () => {
  it('mints one repository with the given permission set and refuses an empty one', async () => {
    await expect(
      createRepoTokenForInstallation(42, 'acme/web', { checks: 'read' })
    ).resolves.toBe('ghs_repo')
    expect(createAppAuthMock).toHaveBeenCalledWith(
      expect.objectContaining({ installationId: 42 })
    )
    expect(authFn).toHaveBeenCalledWith({
      type: 'installation',
      repositoryNames: ['web'],
      permissions: { checks: 'read' },
    })
    authFn.mockClear()
    await expect(
      createRepoTokenForInstallation(42, 'acme/web', {})
    ).rejects.toThrow(/explicit permission set/)
    expect(authFn).not.toHaveBeenCalled()
  })
})

describe('LUM-890 createInstallationToken', () => {
  it('createInstallationToken refuses to mint without an explicit permission set', async () => {
    await expect(createInstallationToken(42, {})).rejects.toThrow(
      /explicit permission set/
    )
    await expect(
      // @ts-expect-error — the permission set is a required argument
      createInstallationToken(42)
    ).rejects.toThrow(/explicit permission set/)
    expect(authFn).not.toHaveBeenCalled()
  })

  const recheckRow = {
    workspaceId: 'ws_1',
    installationId: 42,
    repositories: ['acme/web'],
    verifierLogin: 'octo',
    verifierGithubId: null,
    verifiedAt: new Date('2026-09-27T00:00:00Z'),
    accessCheckCursor: null,
  }
  const cases: Array<[string, () => Promise<unknown>]> = [
    ['listInstallationRepositories', () => listInstallationRepositories(42)],
    [
      'access-recheck sweep',
      async () => {
        ;(recheckRows.findAllWithVerifier as jest.Mock).mockResolvedValue([
          recheckRow,
        ])
        return githubAccessRecheckService.sweep()
      },
    ],
    [
      'repository-event recheck',
      async () => {
        ;(recheckRows.findAllByInstallationId as jest.Mock).mockResolvedValue([
          recheckRow,
        ])
        return githubAccessRecheckService.recheckRepository(42, 'acme/web')
      },
    ],
  ]

  it.each(cases)(
    'installation-wide mints request only metadata read: %s',
    async (_name, call) => {
      await call()
      expect(authFn).toHaveBeenCalledTimes(1)
      // No repositoryNames: the whole installation, but metadata only.
      expect(authFn).toHaveBeenCalledWith({
        type: 'installation',
        permissions: { metadata: 'read' },
      })
    }
  )

  it('installation-wide mints request only metadata read: every named set', () => {
    for (const set of Object.values(INSTALLATION_TOKEN_PERMISSIONS)) {
      expect(set).toEqual({ metadata: 'read' })
    }
  })
})

describe('LUM-886 helpers mint with the narrowed permission set', () => {
  const cases: Array<[string, () => Promise<unknown>, object]> = [
    [
      'readRepoFile',
      () => readRepoFile({ ...repo, path: 'package.json' }),
      { contents: 'read' },
    ],
    [
      'fetchDefaultBranchHead',
      () => fetchDefaultBranchHead(repo),
      { contents: 'read' },
    ],
    // The `.diff` media type is served under `contents`, not `pull_requests`.
    [
      'fetchPrDiff',
      () => fetchPrDiff({ ...repo, prNumber: 7 }),
      { contents: 'read' },
    ],
    [
      'fetchPrFiles',
      () => fetchPrFiles({ ...repo, prNumber: 7 }),
      { pull_requests: 'read' },
    ],
    [
      'fetchPrStats',
      () => fetchPrStats({ ...repo, prNumber: 7 }),
      { pull_requests: 'read' },
    ],
    [
      'fetchPrHeadSha',
      () => fetchPrHeadSha({ ...repo, prNumber: 7 }),
      { pull_requests: 'read' },
    ],
    // LUM-1134: the repository record is served under metadata.
    [
      'fetchRepoVisibility',
      () => fetchRepoVisibility(repo),
      { metadata: 'read' },
    ],
  ]

  it.each(cases)(
    'mints with the narrowed permission set: %s',
    async (_name, call, expected) => {
      await call()
      expect(authFn).toHaveBeenCalledTimes(1)
      expect(authFn).toHaveBeenCalledWith({
        type: 'installation',
        repositoryNames: ['web'],
        permissions: expected,
      })
    }
  )

  /**
   * The services that mint through `getRepoToken` directly are pinned by
   * source: each call names the set its endpoints need, and no call is left
   * without one. (Their behaviour is covered by their own suites.)
   */
  const SERVICE_SETS: Record<string, string[]> = {
    'lib/services/task-pr-link.service.ts': ['pullRequestRead'],
    'lib/services/task-pr-sync.service.ts': ['pullRequestRead'],
    'lib/services/stale-pr-reconcile.service.ts': ['pullRequestRead'],
    'lib/services/pr-comment-mirror.service.ts': [
      'pullRequestWrite',
      'pullRequestWrite',
      'pullRequestWrite',
      'pullRequestWrite',
    ],
    // The security plugin's PR review service is pinned the same way in
    // __tests__/ee/security/lib/integrations/github/token-permissions.test.ts.
  }

  it('mints with the narrowed permission set: services (source table)', () => {
    const root = path.resolve(__dirname, '../../../..')
    for (const [file, sets] of Object.entries(SERVICE_SETS)) {
      const src = fs.readFileSync(path.join(root, file), 'utf8')
      const calls = [
        ...src.matchAll(/getRepoToken\(([^()]*?)\)(?:\.catch)?/g),
      ].map(m => m[1] ?? '')
      const named = calls.map(
        args => /REPO_TOKEN_PERMISSIONS\.(\w+)/.exec(args)?.[1] ?? 'NONE'
      )
      expect({ file, sets: named }).toEqual({ file, sets })
    }
  })
})

describe('LUM-886 production App boundary', () => {
  it('every requested permission set fits inside the production App', () => {
    const requested = [
      ...Object.values(REPO_TOKEN_PERMISSIONS),
      ...Object.values(INSTALLATION_TOKEN_PERMISSIONS),
      // the sandbox clone token (createRepoScopedToken)
      { contents: 'read' as const },
    ]
    for (const set of requested) {
      expect({
        set,
        fits: isWithinPermissions(set, PRODUCTION_APP_PERMISSIONS),
      }).toEqual({ set, fits: true })
    }
  })

  it('isWithinPermissions: write covers read, read never covers write, absent is outside', () => {
    const granted = { contents: 'write', checks: 'read' } as const
    expect(isWithinPermissions({ contents: 'read' }, granted)).toBe(true)
    expect(isWithinPermissions({ contents: 'write' }, granted)).toBe(true)
    expect(isWithinPermissions({ checks: 'write' }, granted)).toBe(false)
    expect(isWithinPermissions({ issues: 'read' }, granted)).toBe(false)
    expect(isWithinPermissions({}, granted)).toBe(true)
  })
})
