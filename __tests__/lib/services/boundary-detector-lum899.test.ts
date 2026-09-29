/**
 * LUM-899 — LUM-893 regression: a vendor-prefixed key written to a committed
 * `.env.test` / tracked `.env.local` must block DONE again. The hook's git probe
 * wins over the env filename; the filename heuristic (old CLI, no probe) only
 * downgrades broad-shape rules. Credential-shaped values are assembled at
 * runtime (no literal).
 */
import {
  detectCrossings,
  WRITTEN_PATH_IGNORED_FIELD,
} from '@/lib/services/boundary-detector.service'
import { isShapeRule } from '@/lib/security-scan'

jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: { create: jest.fn() },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))

const stripeLive = 'sk_' + 'live_' + 'Qm7Tz4Lw9Kp2Xc8Vb5Nr3Hy6'
const stripeTest = 'sk_' + 'test_' + 'Qm7Tz4Lw9Kp2Xc8Vb5Nr3Hy6'
const dbPassword = 'DB_PASSWORD' + '=Qm7Tz4Lw9Kp2'
const pgPassword = 'PGPASSWORD' + '=Qm7Tz4Lw9Kp2'
const awsKeyId = 'AKIA' + 'QM7TZ4LW9KP2XC8V'
const githubToken = 'ghp' + '_' + 'Qm7Tz4Lw9Kp2Xc8Vb5Nr3Hy6Gf1Dj0Sa4Pe7Ab'
const pemBlock = [
  '-----BEGIN ' + 'RSA PRIVATE KEY-----',
  'Ab3'.repeat(21) + 'x',
  'Qm7'.repeat(21) + 'y',
  '-----END ' + 'RSA PRIVATE KEY-----',
].join('\n')

const write = (
  filePath: string,
  content: string,
  extra: Record<string, unknown> = {}
) => ({
  toolName: 'Write',
  filePath,
  payload: { tool_input: { file_path: filePath, content }, ...extra },
})

const secrets = (filePath: string, content: string, extra = {}) =>
  detectCrossings(write(filePath, content, extra)).filter(
    c => c.category === 'HARDCODED_SECRET'
  )

const blocking = (filePath: string, content: string, extra = {}) =>
  secrets(filePath, content, extra).filter(c => c.advisory !== true)

const tracked = { [WRITTEN_PATH_IGNORED_FIELD]: false }
const ignored = { [WRITTEN_PATH_IGNORED_FIELD]: true }

describe('LUM-899 env-file secrets', () => {
  it('LUM-899 git probe answer overrides the env filename', () => {
    // The task's table: committed/tracked env files, probe says "not ignored".
    const rows: Array<[string, string]> = [
      ['.env.test', `STRIPE_SECRET_KEY=${stripeLive}`],
      ['.env.test', `AWS_ACCESS_KEY_ID=${awsKeyId}`],
      ['.env.local', `STRIPE_SECRET_KEY=${stripeLive}`],
      ['config/.env.production.local', `STRIPE_SECRET_KEY=${stripeLive}`],
    ]
    for (const [path, content] of rows) {
      const hits = blocking(path, content, tracked)
      expect({ path, n: hits.length, sev: hits[0]?.severity }).toEqual({
        path,
        n: 1,
        sev: 'HIGH',
      })
    }
    // A tracked env file is judged like any file: a broad shape stays advisory
    // on its own rule, but is not waved through by the filename.
    const shape = secrets('.env.local', dbPassword, tracked)
    expect(shape).toHaveLength(1)
    expect(shape[0]!.advisory).toBe(true)
    expect(shape[0]!.detail).not.toContain('local env file')
    // A gitignored .env.local stays advisory, even for a live key.
    for (const path of ['.env.local', '.env.test', '.env']) {
      const hits = secrets(path, `STRIPE_SECRET_KEY=${stripeLive}`, ignored)
      expect({ path, n: hits.length, advisory: hits[0]?.advisory }).toEqual({
        path,
        n: 1,
        advisory: true,
      })
      expect(hits[0]!.detail).toContain('gitignored file')
    }
  })

  it('LUM-899 filename heuristic never downgrades vendor-prefixed keys', () => {
    // Old CLI: no probe field at all.
    const paths = ['.env.test', '.env.local', 'config/.env.production.local']
    const keys: Array<[string, string]> = [
      ['stripe', `STRIPE_SECRET_KEY=${stripeLive}`],
      ['aws', `AWS_ACCESS_KEY_ID=${awsKeyId}`],
      ['github', `GITHUB_TOKEN=${githubToken}`],
      ['pem', `PRIVATE_KEY="${pemBlock}"`],
    ]
    for (const path of paths) {
      for (const [name, content] of keys) {
        expect({ path, name, n: blocking(path, content).length }).toEqual({
          path,
          name,
          n: 1,
        })
      }
    }
    // A broad shape in a local env file is still advisory and says why.
    const shape = secrets('.env.local', dbPassword)
    expect(shape).toHaveLength(1)
    expect(shape[0]!.advisory).toBe(true)
    expect(shape[0]!.detail).toContain('local env file')
    // A malformed probe field reads as "no answer", never as ignored.
    expect(
      blocking('.env.local', `STRIPE_SECRET_KEY=${stripeLive}`, {
        [WRITTEN_PATH_IGNORED_FIELD]: 'true',
      })
    ).toHaveLength(1)
  })

  it('LUM-899 test-mode key suffix is distinct from broad shape', () => {
    const testKey = secrets('lib/billing.ts', `const k = "${stripeTest}"`)
    expect(testKey).toHaveLength(1)
    expect(testKey[0]!.advisory).toBe(true)
    expect(testKey[0]!.detail).toContain('test-mode key')
    expect(testKey[0]!.detail).not.toContain('broad credential shape')
    const shape = secrets('scripts/dev.sh', `${pgPassword} psql`)
    expect(shape).toHaveLength(1)
    expect(shape[0]!.detail).toContain('broad credential shape')
  })

  it('LUM-899 MultiEdit edits are scanned for secrets', () => {
    const filePath = 'lib/billing.ts'
    const hits = detectCrossings({
      toolName: 'MultiEdit',
      filePath,
      payload: {
        tool_input: {
          file_path: filePath,
          edits: [
            { old_string: 'a', new_string: 'const x = 1' },
            { old_string: 'b', new_string: `const k = "${stripeLive}"` },
          ],
        },
      },
    }).filter(c => c.category === 'HARDCODED_SECRET')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.advisory).toBeUndefined()
    expect(hits[0]!.severity).toBe('HIGH')
  })

  it('LUM-899 checkout parent directories never trigger the path downgrade', () => {
    const cwd = '/Users/me/docs/acme'
    const content = `const k = "${stripeLive}"`
    // Production code in a checkout that happens to live under docs/ / tests/.
    for (const [root, file] of [
      [cwd, `${cwd}/lib/billing.ts`],
      ['/home/ci/tests/acme', '/home/ci/tests/acme/src/pay.ts'],
    ] as const) {
      const hits = blocking(file, content, { cwd: root })
      expect({ file, n: hits.length }).toEqual({ file, n: 1 })
    }
    // Absolute path with no known checkout root: no path downgrade on a guess.
    expect(
      blocking('/Users/me/docs/acme/lib/billing.ts', content)
    ).toHaveLength(1)
    // A real test file inside the checkout is still downgraded.
    const inTests = secrets(`${cwd}/__tests__/billing.test.ts`, content, {
      cwd,
    })
    expect(inTests).toHaveLength(1)
    expect(inTests[0]!.advisory).toBe(true)
    // Relative paths keep working as before.
    expect(secrets('__tests__/billing.test.ts', content)[0]!.advisory).toBe(
      true
    )
  })

  it('LUM-899 isShapeRule separates broad shapes from prefixed keys', () => {
    expect(isShapeRule('env-assignment')).toBe(true)
    expect(isShapeRule('secret:url-credentials')).toBe(true)
    expect(isShapeRule('stripe-key')).toBe(false)
    expect(isShapeRule('stripe-clerk-test-key')).toBe(false)
    expect(isShapeRule('no-such-rule')).toBe(false)
  })
})
