/**
 * @jest-environment node
 */
/**
 * LUM-1255 — a local scan reports exactly what the PR scan's stage A would:
 * same scanner code, same added lines, same fingerprints. The server path is
 * the one `pr-security-scan.service.ts` takes (`addedLinesWithNumbers` on the
 * PR diff → `scanSecrets`, imported from `lib/`); the CLI path is
 * `collectLocalDiff` on a real git checkout → the scanner imported from
 * `shared/`.
 */
import * as fs from 'fs'
import * as path from 'path'
import { addedLinesWithNumbers as serverParse } from '@/lib/diff/diff-lines'
import { scanSecrets as serverScan } from '@/lib/security-scan/scan-secrets'
import { secretFingerprint as serverFingerprint } from '@/lib/security-scan/redact'
import { addedLinesWithNumbers as sharedParse } from '@/shared/src/diff-lines'
import { scanSecrets as sharedScan } from '@/shared/src/secret-scan/scan-secrets'
import { secretFingerprint as sharedFingerprint } from '@/shared/src/secret-scan/redact'
import { collectLocalDiff } from '../../cli/src/lib/local-diff'
import {
  git,
  isolateGitEnv,
  makeSandbox,
  type Sandbox,
} from '../../cli/test-support/real-git'
import {
  fakeAwsKeyId,
  fakeGithubToken,
} from '../../cli/test-support/fake-secrets'

describe('lumo scan secrets ↔ PR scan stage A parity', () => {
  let restore: () => void
  let sb: Sandbox

  beforeAll(() => {
    restore = isolateGitEnv()
  })
  afterAll(() => restore())

  beforeEach(() => {
    sb = makeSandbox('main')
    git(sb.main, 'checkout', '-q', '-b', 'feature')
    fs.mkdirSync(path.join(sb.main, 'src'))
    fs.writeFileSync(
      path.join(sb.main, 'src/config.ts'),
      [
        'export const region = "us-east-1"',
        `export const awsKey = "${fakeAwsKeyId()}"`,
        `const gh = '${fakeGithubToken()}'`,
        '',
      ].join('\n')
    )
    fs.writeFileSync(
      path.join(sb.main, 'README.md'),
      `hello\nexample key: ${fakeAwsKeyId('DOCSEXAMPLEKEYZZ')}\n`
    )
    git(sb.main, 'add', '-A')
    git(sb.main, 'commit', '-q', '-m', 'add config')
  })
  afterEach(() => sb.cleanup())

  it('the lib modules the PR scan imports are the shared ones (one source)', () => {
    expect(serverScan).toBe(sharedScan)
    expect(serverParse).toBe(sharedParse)
    expect(serverFingerprint).toBe(sharedFingerprint)
  })

  it('finds the same findings, with the same fingerprints, as the server path', () => {
    // What GitHub serves as the PR diff: merge-base(base, head)..head.
    const base = git(sb.main, 'merge-base', 'HEAD', 'origin/main')
    const prDiff = git(sb.main, 'diff', base, 'HEAD')
    const server = serverScan(serverParse(prDiff))

    const local = collectLocalDiff({ kind: 'default' }, sb.main)
    const cli = sharedScan(local.files)

    expect(server.length).toBeGreaterThanOrEqual(2)
    expect(cli).toEqual(server)
    expect(cli.map(f => f.fingerprint).sort()).toEqual(
      server.map(f => f.fingerprint).sort()
    )
  })
})
