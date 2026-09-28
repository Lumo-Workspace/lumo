/**
 * @jest-environment node
 */
/**
 * LUM-883 — every installation token names one repository, and only a
 * repository on the workspace's confirmed list gets one. The confirmed list
 * used to guard the App webhook and the picker only; the token layer minted
 * for anything the installation reached.
 */
jest.mock('@octokit/auth-app', () => ({
  createAppAuth: jest.fn(),
}))
jest.mock('@/lib/repositories/github-app-installation.repository', () => ({
  githubAppInstallationRepository: { findByWorkspace: jest.fn() },
}))
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))

import * as fs from 'fs'
import * as path from 'path'
import { createAppAuth } from '@octokit/auth-app'
import { githubAppInstallationRepository } from '@/lib/repositories/github-app-installation.repository'
import { getRepoToken, getRepoCloneToken } from '@/lib/integrations/github/auth'
import {
  isConfirmedRepository,
  requireConfirmedRepository,
} from '@/lib/integrations/github/confirmed-repositories'
import {
  readRepoFile,
  fetchPrDiff,
  fetchPrFiles,
  fetchPrHeadSha,
  fetchPrStats,
  fetchDefaultBranchHead,
} from '@/lib/integrations/github/contents'
import {
  fetchCommitCiSignals,
  fetchPullNumbersForCommit,
} from '@/lib/integrations/github/checks'

const createAppAuthMock = createAppAuth as unknown as jest.Mock
const findByWorkspace =
  githubAppInstallationRepository.findByWorkspace as jest.Mock

const ORIGINAL_ENV = process.env
const ORIGINAL_FETCH = global.fetch
let authFn: jest.Mock
let fetchMock: jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  process.env = {
    ...ORIGINAL_ENV,
    GITHUB_APP_ID: '111',
    GITHUB_APP_PRIVATE_KEY: 'abc',
  }
  authFn = jest.fn().mockResolvedValue({ token: 'ghs_repo' })
  createAppAuthMock.mockReturnValue(authFn)
  fetchMock = jest.fn()
  global.fetch = fetchMock as unknown as typeof fetch
  findByWorkspace.mockResolvedValue({
    id: 'gai_1',
    workspaceId: 'ws_1',
    installationId: 42,
    repositories: ['Acme/Web'],
  })
})
afterEach(() => {
  process.env = ORIGINAL_ENV
  global.fetch = ORIGINAL_FETCH
})

describe('LUM-883 confirmed-list check', () => {
  it('matches repository names case-insensitively', () => {
    expect(isConfirmedRepository(['Acme/Web'], 'acme/web')).toBe(true)
    expect(isConfirmedRepository(['Acme/Web'], 'acme/web-internal')).toBe(false)
    expect(isConfirmedRepository([], 'acme/web')).toBe(false)
  })

  it('requireConfirmedRepository answers 400 without an installation', async () => {
    findByWorkspace.mockResolvedValue(null)
    await expect(
      requireConfirmedRepository('ws_1', 'acme/web')
    ).rejects.toMatchObject({ status: 400, code: 'app_not_installed' })
  })
})

describe('LUM-883 getRepoToken', () => {
  it('refuses to mint a token for an unconfirmed repository', async () => {
    await expect(
      getRepoToken('ws_1', 'acme/payroll', { pull_requests: 'read' })
    ).rejects.toMatchObject({
      status: 403,
      code: 'repo_not_confirmed',
    })
    await expect(
      getRepoCloneToken('ws_1', 'acme/payroll')
    ).rejects.toMatchObject({ status: 403, code: 'repo_not_confirmed' })
    // Refused before anything is signed.
    expect(createAppAuthMock).not.toHaveBeenCalled()
    expect(authFn).not.toHaveBeenCalled()
  })

  it('mints a token scoped to the one confirmed repository', async () => {
    await expect(
      getRepoToken('ws_1', 'acme/web', { pull_requests: 'read' })
    ).resolves.toBe('ghs_repo')
    expect(createAppAuthMock).toHaveBeenCalledWith(
      expect.objectContaining({ installationId: 42 })
    )
    expect(authFn).toHaveBeenCalledWith({
      type: 'installation',
      repositoryNames: ['web'],
      permissions: { pull_requests: 'read' },
    })
  })

  it('narrows the token to the permissions asked for', async () => {
    await getRepoToken('ws_1', 'ACME/WEB', { contents: 'read' })
    expect(authFn).toHaveBeenCalledWith({
      type: 'installation',
      repositoryNames: ['WEB'],
      permissions: { contents: 'read' },
    })
  })

  it('the clone token passes the same check before its one-repository mint', async () => {
    await expect(getRepoCloneToken('ws_1', 'acme/web')).resolves.toBe(
      'ghs_repo'
    )
    expect(authFn).toHaveBeenCalledWith({
      type: 'installation',
      repositoryNames: ['web'],
      permissions: { contents: 'read' },
    })
  })
})

describe('LUM-883 read helpers go through the check', () => {
  const unconfirmed = { workspaceId: 'ws_1', fullName: 'acme/payroll' }
  const calls: Array<[string, () => Promise<unknown>]> = [
    ['readRepoFile', () => readRepoFile({ ...unconfirmed, path: 'CLAUDE.md' })],
    ['fetchPrDiff', () => fetchPrDiff({ ...unconfirmed, prNumber: 1 })],
    ['fetchPrFiles', () => fetchPrFiles({ ...unconfirmed, prNumber: 1 })],
    ['fetchPrHeadSha', () => fetchPrHeadSha({ ...unconfirmed, prNumber: 1 })],
    ['fetchPrStats', () => fetchPrStats({ ...unconfirmed, prNumber: 1 })],
    ['fetchDefaultBranchHead', () => fetchDefaultBranchHead(unconfirmed)],
    [
      'fetchCommitCiSignals',
      () => fetchCommitCiSignals({ ...unconfirmed, sha: 'abc' }),
    ],
    [
      'fetchPullNumbersForCommit',
      () => fetchPullNumbersForCommit({ ...unconfirmed, sha: 'abc' }),
    ],
  ]

  it.each(calls)(
    '%s refuses an unconfirmed repository without calling GitHub',
    async (_name, call) => {
      await expect(call()).rejects.toMatchObject({
        status: 403,
        code: 'repo_not_confirmed',
      })
      expect(fetchMock).not.toHaveBeenCalled()
      expect(authFn).not.toHaveBeenCalled()
    }
  )

  it('readRepoFile reads a confirmed repository with a contents-read token for it', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      text: async () => 'x',
    })
    await expect(
      readRepoFile({ workspaceId: 'ws_1', fullName: 'acme/web', path: 'a' })
    ).resolves.toBe('x')
    expect(authFn).toHaveBeenCalledWith({
      type: 'installation',
      repositoryNames: ['web'],
      permissions: { contents: 'read' },
    })
  })
})

/**
 * Anti-regression: runtime code must not mint an installation-wide token.
 * Only the install flow and the access recheck list the whole installation
 * (before anything is confirmed, or to re-check what was); everything else
 * goes through getRepoToken / getRepoCloneToken.
 */
describe('LUM-883 no installation-wide tokens in runtime code', () => {
  const ROOT = path.resolve(__dirname, '../../../..')
  const SCAN_DIRS = ['app', 'lib', 'shared']
  const WHOLE_INSTALLATION_ALLOWED = new Set([
    'lib/integrations/github/auth.ts',
    'lib/integrations/github/app-installations.ts',
    'lib/services/github-access-recheck.service.ts',
  ])

  function sourceFiles(dir: string): string[] {
    const abs = path.join(ROOT, dir)
    if (!fs.existsSync(abs)) return []
    const out: string[] = []
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue
      const rel = path.join(dir, entry.name)
      if (entry.isDirectory()) out.push(...sourceFiles(rel))
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(rel)
    }
    return out
  }

  it('no runtime code mints a repo-less installation token', () => {
    const files = SCAN_DIRS.flatMap(sourceFiles)
    // Sanity: the walk found the tree, so an empty result means clean.
    expect(files).toContain('lib/integrations/github/auth.ts')

    const offenders: string[] = []
    for (const rel of files) {
      const text = fs.readFileSync(path.join(ROOT, rel), 'utf8')
      if (/getGithubInstallationToken/.test(text)) {
        offenders.push(`${rel}: getGithubInstallationToken`)
      }
      if (
        /createInstallationToken\s*\(/.test(text) &&
        !WHOLE_INSTALLATION_ALLOWED.has(rel)
      ) {
        offenders.push(`${rel}: createInstallationToken`)
      }
      if (
        /from ['"]@octokit\/auth-app['"]/.test(text) &&
        rel !== 'lib/integrations/github/auth.ts'
      ) {
        offenders.push(`${rel}: @octokit/auth-app import`)
      }
    }
    expect(offenders).toEqual([])
  })
})
