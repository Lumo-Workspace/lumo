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

const TASK_TABLE: Array<[string, string]> = [
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
  ['.env.local', `CLERK_SECRET_KEY=${clerkTest}\nOPENAI_API_KEY=${openaiKey}`],
  ['.env.test', `CLERK_SECRET_KEY=${clerkTest}\nOPENAI_API_KEY=${openaiKey}`],
  ['.env.development.local', `OPENAI_API_KEY=${openaiKey}`],
  ['apps/web/.env.local', `OPENAI_API_KEY=${openaiKey}`],
]

describe('LUM-893 boundary detector false positives', () => {
  it('LUM-893 task table rows never block DONE', () => {
    for (const [path, content] of TASK_TABLE) {
      expect({ path, blocking: blocking(path, content) }).toEqual({
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
    // A local env file hit is recorded, advisory, and says why.
    const local = secrets('.env.local', `OPENAI_API_KEY=${openaiKey}`)
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
})
