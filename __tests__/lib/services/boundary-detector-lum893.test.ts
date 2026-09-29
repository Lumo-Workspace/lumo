/**
 * LUM-893 — the LUM-887 redaction rules must not turn ordinary customer writes
 * into DONE-blocking HARDCODED_SECRET crossings, while a real hardcoded key
 * still blocks. Credential-shaped values are assembled at runtime (no literal).
 */
import {
  detectCrossings,
  WRITTEN_PATH_IGNORED_FIELD,
} from '@/lib/services/boundary-detector.service'

jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: { create: jest.fn() },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))

const clerkTest = 'sk_' + 'test_' + 'Qm7Tz4Lw9Kp2Xc8Vb5Nr3Hy6'
const openaiKey = 'sk-' + 'proj-' + 'Qm7Tz4Lw9Kp2Xc8Vb5Nr3Hy6Gf1Dj0Sa4Pe7'
const stripeLive = 'sk_' + 'live_' + 'Qm7Tz4Lw9Kp2Xc8Vb5Nr3Hy6'
const githubToken = 'ghp' + '_' + 'Qm7Tz4Lw9Kp2Xc8Vb5Nr3Hy6Gf1Dj0Sa4Pe7Ab'
const awsKeyId = 'AKIA' + 'QM7TZ4LW9KP2XC8V'
const gitlabPat = 'glpat-' + 'Qm7Tz4Lw9Kp2Xc8Vb5Nr3'
const dbPassword = 'DB_PASSWORD' + '=Qm7Tz4Lw9Kp2'
const hfToken = 'hf_' + 'Qm7Tz4Lw9Kp2Xc8Vb5Nr3Hy6Gf1Dj0Sa4P'

const write = (
  filePath: string,
  content: string,
  extra: Record<string, unknown> = {}
) => ({
  toolName: 'Write',
  filePath,
  payload: { tool_input: { file_path: filePath, content }, ...extra },
})

const blocking = (filePath: string, content: string, extra = {}) =>
  detectCrossings(write(filePath, content, extra)).filter(
    c => c.category === 'HARDCODED_SECRET' && c.advisory !== true
  )

const secrets = (filePath: string, content: string, extra = {}) =>
  detectCrossings(write(filePath, content, extra)).filter(
    c => c.category === 'HARDCODED_SECRET'
  )

// LUM-899: a local env file is advisory because the hook's git probe says it
// is ignored — the file name alone no longer downgrades a vendor-prefixed key.
const IGNORED = { [WRITTEN_PATH_IGNORED_FIELD]: true }

const TASK_TABLE: Array<[string, string, Record<string, unknown>?]> = [
  [
    'docker-compose.yml',
    '    environment:\n      - POSTGRES_PASSWORD=postgres',
  ],
  ['scripts/dev-db.sh', 'PGPASSWORD=postgres psql -h localhost -U postgres'],
  ['Dockerfile', 'FROM node:20\nENV PWD=/app/server\nWORKDIR /app/server'],
  [
    '.github/workflows/ci.yml',
    '      - run: echo "TOKEN=undefined" >> $GITHUB_ENV',
  ],
  [
    'cli/src/commands/login.ts',
    "  .option('--token string', 'API token')\n//   --token string   API token",
  ],
  [
    'lib/auth/header.ts',
    '// Sends Bearer authenticationHeaderValue on every call',
  ],
  ['lib/config.ts', 'API_KEY=process.env.OTHER'],
  [
    '.env.local',
    `CLERK_SECRET_KEY=${clerkTest}\nOPENAI_API_KEY=${openaiKey}`,
    IGNORED,
  ],
  [
    '.env.test',
    `CLERK_SECRET_KEY=${clerkTest}\nOPENAI_API_KEY=${openaiKey}`,
    IGNORED,
  ],
  ['.env.development.local', `OPENAI_API_KEY=${openaiKey}`, IGNORED],
  ['apps/web/.env.local', `OPENAI_API_KEY=${openaiKey}`, IGNORED],
]

describe('LUM-893 boundary detector false positives', () => {
  it('LUM-893 task table rows never block DONE', () => {
    for (const [path, content, extra] of TASK_TABLE) {
      expect({ path, blocking: blocking(path, content, extra) }).toEqual({
        path,
        blocking: [],
      })
    }
    // Obvious non-secrets are not even recorded.
    for (const [path, content] of TASK_TABLE.slice(2, 7)) {
      expect({ path, n: secrets(path, content).length }).toEqual({ path, n: 0 })
    }
    // Broad shapes and test keys in source are recorded, advisory.
    const shape = secrets('scripts/dev-db.sh', TASK_TABLE[1]![1])
    expect(shape).toHaveLength(1)
    expect(shape[0]!.advisory).toBe(true)
    expect(shape[0]!.detail).toContain('advisory')
    const testKey = secrets('lib/billing.ts', `const k = "${clerkTest}"`)
    expect(testKey).toHaveLength(1)
    expect(testKey[0]!.advisory).toBe(true)
    // A broad-shape hit in a local env file is recorded, advisory, and says
    // why (LUM-899: only a shape rule is downgraded by the file name).
    const local = secrets('.env.local', dbPassword)
    expect(local).toHaveLength(1)
    expect(local[0]!.advisory).toBe(true)
    expect(local[0]!.detail).toContain('local env file')
  })

  it('LUM-893 real hardcoded secrets still block DONE', () => {
    const cases: Array<[string, string]> = [
      ['lib/billing.ts', `const stripe = new Stripe("${stripeLive}")`],
      ['lib/config.ts', `export const GH = '${githubToken}'`],
      ['lib/aws.ts', `const id = "${awsKeyId}"`],
      [
        'scripts/push.sh',
        `git remote set-url origin https://oauth2:${gitlabPat}@gitlab.com/x.git`,
      ],
      ['lib/hf.ts', `const t = "${hfToken}"`],
      // A plain .env / .env.production may be committed: still blocking.
      ['.env', `OPENAI_API_KEY=${openaiKey}`],
      ['.env.production', `OPENAI_API_KEY=${openaiKey}`],
      // A non-ignored write (probe answered false) is judged as before.
      ['config/keys.env', `OPENAI_API_KEY=${openaiKey}`],
    ]
    for (const [path, content] of cases) {
      expect({ path, n: blocking(path, content).length }).toEqual({
        path,
        n: 1,
      })
    }
    expect(
      blocking('config/keys.env', `OPENAI_API_KEY=${openaiKey}`, {
        [WRITTEN_PATH_IGNORED_FIELD]: false,
      })
    ).toHaveLength(1)
    // An advisory broad-shape line never masks a real key in the same write.
    expect(
      blocking(
        'lib/config.ts',
        `PGPASSWORD=Qm7Tz4Lw9Kp2 psql\nconst k = "${stripeLive}"`
      )
    ).toHaveLength(1)
  })

  it('LUM-893 gitignored write is advisory and missing probe fails closed', () => {
    const content = `OPENAI_API_KEY=${openaiKey}`
    const ignored = secrets('.env', content, {
      [WRITTEN_PATH_IGNORED_FIELD]: true,
    })
    expect(ignored).toHaveLength(1)
    expect(ignored[0]!.advisory).toBe(true)
    expect(ignored[0]!.detail).toContain('gitignored file')
    // No field, or a malformed one: judged as before (blocking).
    expect(blocking('.env', content)).toHaveLength(1)
    for (const bad of ['true', 1, null, {}]) {
      expect(
        blocking('.env', content, { [WRITTEN_PATH_IGNORED_FIELD]: bad })
      ).toHaveLength(1)
    }
  })

  it('LUM-903 worktree ignored claim from old CLI is not trusted', () => {
    const ignored = { [WRITTEN_PATH_IGNORED_FIELD]: true }
    // The 1.80.0 probe answered from the main checkout: every tracked file in
    // a worktree came back "ignored". Those claims must not downgrade.
    for (const path of [
      '/Users/dev/repo/.worktrees/LUM-1-x/lib/billing.ts',
      '.worktrees/LUM-1-x/.env',
      'C:\\repo\\.worktrees\\LUM-1-x\\lib\\aws.ts',
    ]) {
      expect({
        path,
        n: blocking(path, `const k = "${stripeLive}"`, ignored).length,
      }).toEqual({ path, n: 1 })
    }
    // An untrusted claim counts as no answer, and without an answer a vendor
    // key is never downgraded by the env filename (LUM-899) — it blocks.
    expect(
      blocking(
        '/Users/dev/repo/.worktrees/LUM-1-x/.env.local',
        `OPENAI_API_KEY=${openaiKey}`,
        ignored
      )
    ).toHaveLength(1)
    // Outside .worktrees/ the probe's true is still trusted (advisory).
    const outside = secrets('/Users/dev/repo/.env', `K=${openaiKey}`, ignored)
    expect(outside).toHaveLength(1)
    expect(outside[0]!.advisory).toBe(true)
    // A lookalike segment is not a worktrees dir.
    expect(
      blocking('/Users/dev/repo/my.worktrees/.env', `K=${openaiKey}`, ignored)
    ).toHaveLength(0)
  })
})
