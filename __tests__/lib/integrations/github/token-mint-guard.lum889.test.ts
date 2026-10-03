/**
 * @jest-environment node
 */
/**
 * LUM-889 — the GitHub token-mint guard. Replaces the LUM-883 regex scan
 * (which missed aliased / dynamic / required imports, the unscoped helpers, a
 * hand-built access_tokens POST, and allowed whole files) with the AST audit
 * in test-utils/token-mint-audit.ts, applied to every runtime tree including
 * mcp/, cli/ and scripts/.
 */
jest.mock('@octokit/auth-app', () => ({ createAppAuth: jest.fn() }))
jest.mock('@/lib/db/prisma', () => ({ prisma: {} }))

import fs from 'fs'
import path from 'path'
import * as githubBarrel from '@/lib/integrations/github'
import type { RepoTokenPermissions } from '@/lib/integrations/github'
import {
  auditTokenMints,
  runtimeSourceFiles,
  type CallSiteAllowlist,
} from '@/test-utils/token-mint-audit'

const ROOT = path.resolve(__dirname, '../../../..')

/**
 * Every call site of an unchecked mint outside auth.ts, by function. The
 * install flow and the access recheck must see the whole installation; the
 * operator probes have no workspace row. Anything else goes through
 * getRepoToken / getRepoCloneToken, which check the confirmed list.
 */
const ALLOWED: CallSiteAllowlist = {
  'lib/integrations/github/app-installations.ts': {
    getGithubAppJwt: [
      'fetchAppInstallation',
      'findAppInstallationStatus',
      'deleteAppInstallation',
    ],
    createInstallationToken: ['listInstallationRepositories'],
  },
  'lib/services/github-access-recheck.service.ts': {
    createInstallationToken: ['sweep', 'recheckRepository'],
  },
  'scripts/analysis/lum886-token-permissions/probe.ts': {
    getGithubAppJwt: ['main'],
    createInstallationToken: ['mint'],
    createRepoTokenForInstallation: ['mint'],
  },
  'scripts/security/lum852-sandbox-probe.ts': {
    createRepoScopedToken: ['mintScopedToken'],
  },
}

describe('LUM-889 github barrel', () => {
  it('LUM-889 the github barrel does not export the unchecked repo mints', () => {
    const exported = Object.keys(githubBarrel)
    expect(exported).not.toContain('createRepoScopedToken')
    expect(exported).not.toContain('createRepoTokenForInstallation')
    // The checked mints stay public.
    expect(exported).toEqual(
      expect.arrayContaining(['getRepoToken', 'getRepoCloneToken'])
    )
    // And the audit agrees about the barrel source itself.
    const barrel = 'lib/integrations/github/index.ts'
    expect(
      auditTokenMints(
        barrel,
        fs.readFileSync(path.join(ROOT, barrel), 'utf8'),
        ALLOWED
      )
    ).toEqual([])

    // Permission names are a literal union: a misspelling is a type error
    // (enforced by `tsc --noEmit`, which type-checks this file).
    const ok: RepoTokenPermissions = { pull_requests: 'read' }
    // @ts-expect-error — `pull_request` is not a GitHub permission name.
    const typo: RepoTokenPermissions = { pull_request: 'read' }
    expect(Object.keys({ ...ok, ...typo })).toHaveLength(2)
  })
})

describe('LUM-889 the audit catches every known bypass form', () => {
  const lib = 'lib/services/some.service.ts'
  const cases: Array<[string, string, string]> = [
    [
      'aliased named import',
      `import { createInstallationToken as mint } from '@/lib/integrations/github'
       export const f = () => mint(1, { metadata: 'read' })`,
      'createInstallationToken used in f',
    ],
    [
      'internal path import of an unscoped helper',
      `import { createRepoScopedToken } from '@/lib/integrations/github/auth'
       export async function g() { return createRepoScopedToken(1, 'a/b') }`,
      'createRepoScopedToken used in g',
    ],
    [
      'relative import',
      `import { createRepoTokenForInstallation } from '../integrations/github/auth'
       export async function h() { return createRepoTokenForInstallation(1, 'a/b', { contents: 'read' }) }`,
      'createRepoTokenForInstallation used in h',
    ],
    [
      'namespace import member',
      `import * as gh from '@/lib/integrations/github'
       export async function k() { return gh.createInstallationToken(1, {}) }`,
      'createInstallationToken used in k',
    ],
    [
      'namespace import element access',
      `import * as gh from '@/lib/integrations/github'
       export async function k2() { return gh['createInstallationToken'](1, {}) }`,
      'createInstallationToken used in k2',
    ],
    [
      'namespace object escaping',
      `import * as gh from '@/lib/integrations/github'
       export function leak() { return Object.values(gh) }`,
      'whole github auth module escapes in leak',
    ],
    [
      'destructured dynamic import with alias',
      `export async function d() {
         const { createInstallationToken: m } = await import('@/lib/integrations/github/auth')
         return m(1, {})
       }`,
      'createInstallationToken used in d',
    ],
    [
      'dynamic import member read',
      `export async function d2() {
         return (await import('@/lib/integrations/github/auth')).getGithubAppJwt()
       }`,
      'getGithubAppJwt used in d2',
    ],
    [
      'dynamic import kept as a whole module',
      `export async function d3() {
         const m = await import('@/lib/integrations/github/auth')
         return m
       }`,
      'loads @/lib/integrations/github/auth as a whole module',
    ],
    [
      'require of the auth module',
      `const gh = require('@/lib/integrations/github/auth')
       export const r = () => gh.createRepoScopedToken(1, 'a/b')`,
      'loads @/lib/integrations/github/auth as a whole module',
    ],
    [
      'static import of @octokit/auth-app',
      `import { createAppAuth } from '@octokit/auth-app'
       export const a = createAppAuth`,
      'loads @octokit/auth-app',
    ],
    [
      'aliased import of @octokit/auth-app',
      `import { createAppAuth as make } from '@octokit/auth-app'
       export const a = make`,
      'loads @octokit/auth-app',
    ],
    [
      'dynamic import of @octokit/auth-app',
      `export async function x() { const { createAppAuth } = await import('@octokit/auth-app'); return createAppAuth }`,
      'loads @octokit/auth-app',
    ],
    [
      'require of @octokit/auth-app',
      `const { createAppAuth } = require('@octokit/auth-app')
       export const a = createAppAuth`,
      'loads @octokit/auth-app',
    ],
    [
      'another App-auth package',
      `import { App } from 'octokit'
       export const a = App`,
      'loads octokit',
    ],
    [
      'getGithubAppJwt plus a hand-built access_tokens POST',
      `import { getGithubAppJwt as jwt } from '@/lib/integrations/github'
       export async function mintByHand(id: number) {
         const t = await jwt()
         return fetch(\`https://api.github.com/app/installations/\${id}/access_tokens\`, {
           method: 'POST', headers: { Authorization: \`Bearer \${t}\` } })
       }`,
      'getGithubAppJwt used in mintByHand',
    ],
    [
      'hand-built access_tokens endpoint alone',
      `export const url = (id: number) => '/app/installations/' + id + '/access_tokens'`,
      'builds an installation access_tokens request',
    ],
    [
      're-export laundering an unscoped helper',
      `export { createRepoScopedToken as clone } from '@/lib/integrations/github/auth'`,
      're-exports createRepoScopedToken',
    ],
    [
      'export star from the auth module',
      `export * from '@/lib/integrations/github/auth'`,
      'export * from @/lib/integrations/github/auth',
    ],
    [
      'the removed workspace-wide helper',
      `import { getGithubInstallationToken } from '@/lib/integrations/github'
       export const z = getGithubInstallationToken`,
      'imports removed getGithubInstallationToken',
    ],
  ]

  it.each(cases)('flags %s', (_label, source, expected) => {
    expect(auditTokenMints(lib, source, ALLOWED)).toContain(
      `${lib}: ${expected}`
    )
  })

  it('allowlists by call site, not by file: a new function in an allowed file is flagged', () => {
    const file = 'lib/services/github-access-recheck.service.ts'
    const source = `import { createInstallationToken } from '@/lib/integrations/github'
      export async function recheckRepository() { return createInstallationToken(1, { metadata: 'read' }) }
      export async function sneaky() { return createInstallationToken(1, { contents: 'write' }) }`
    expect(auditTokenMints(file, source, ALLOWED)).toEqual([
      `${file}: createInstallationToken used in sneaky`,
    ])
  })

  it('ignores comments, type-only imports and the checked mints', () => {
    const source = `// createInstallationToken( and access_tokens in a comment
      import type { RepoTokenPermissions } from '@/lib/integrations/github/auth'
      import type { createAppAuth } from '@octokit/auth-app'
      import { getRepoToken } from '@/lib/integrations/github'
      export async function fine(p: RepoTokenPermissions) {
        const { getRepoCloneToken } = await import('@/lib/integrations/github/auth')
        return [await getRepoToken('w', 'a/b', p), await getRepoCloneToken('w', 'a/b')]
      }
      export type T = typeof createAppAuth`
    expect(auditTokenMints(lib, source, ALLOWED)).toEqual([])
  })
})

describe('LUM-889 the runtime tree passes the token-mint audit', () => {
  const topLevel = fs
    .readdirSync(ROOT)
    .filter(f => /\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(f))
  const SCAN = [
    'app',
    'lib',
    'shared',
    'mcp',
    'cli',
    'scripts',
    'components',
    'hooks',
    'extensions',
    'constants',
    'types',
    ...topLevel,
  ]

  it('no runtime file reaches an unchecked mint outside its allowlisted call sites', () => {
    const files = SCAN.flatMap(dir => runtimeSourceFiles(ROOT, dir))
    // Sanity: the walk reached every tree, so an empty result means clean.
    for (const expected of [
      'lib/integrations/github/auth.ts',
      'proxy.ts',
      'scripts/security/lum852-sandbox-probe.ts',
    ])
      expect(files).toContain(expected)
    expect(files.some(f => f.startsWith('mcp/'))).toBe(true)
    expect(files.some(f => f.startsWith('cli/src/'))).toBe(true)

    const offenders = files.flatMap(rel =>
      auditTokenMints(
        rel,
        fs.readFileSync(path.join(ROOT, rel), 'utf8'),
        ALLOWED
      )
    )
    expect(offenders).toEqual([])
  })

  it('every allowlisted call site still exists, so the list cannot rot into a blanket pass', () => {
    const unused: string[] = []
    for (const [file, mints] of Object.entries(ALLOWED)) {
      const source = fs.readFileSync(path.join(ROOT, file), 'utf8')
      for (const [mint, fns] of Object.entries(mints)) {
        for (const fn of fns ?? []) {
          // Drop this one site from the allowlist: the audit must then flag it.
          const narrowed: CallSiteAllowlist = {
            [file]: { ...mints, [mint]: (fns ?? []).filter(f => f !== fn) },
          }
          if (
            !auditTokenMints(file, source, narrowed).includes(
              `${file}: ${mint} used in ${fn}`
            )
          )
            unused.push(`${file}#${fn}:${mint}`)
        }
      }
    }
    expect(unused).toEqual([])
  })
})
