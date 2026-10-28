/**
 * @jest-environment node
 *
 * LUM-1328 — the migration that makes the developer's own agent review the
 * default, against a REAL Postgres: replay every migration up to it, seed a
 * workspace on the old defaults, apply it, and check that the old workspace
 * keeps AI review and hunt on, a new one starts with both off (matching
 * DEFAULT_WORKSPACE_SECURITY_SWITCHES), and scans get an empty
 * `agentReviewTools`.
 */
import { createPgliteHarness } from '../../../scripts/test-support/pglite-harness'
import { DEFAULT_WORKSPACE_SECURITY_SWITCHES } from '@/ee/security/security-scan/workspace-switches'

const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')

const MIGRATION = '20261206090000_lum1328_agent_review_default'
const harness = createPgliteHarness(PrismaClient, {
  stopBeforeMigration: MIGRATION,
})

jest.setTimeout(180_000)

type SwitchRow = {
  securityScanEnabled: boolean
  securityAiReviewEnabled: boolean
  securityHuntEnabled: boolean
}

async function switchesOf(id: string): Promise<SwitchRow> {
  const [row] = await harness.query<SwitchRow>(
    `select "securityScanEnabled", "securityAiReviewEnabled", "securityHuntEnabled"
     from workspaces where id = $1`,
    [id]
  )
  return row!
}

beforeAll(async () => {
  await harness.start()
  // Created before the migration: the column defaults of the time.
  await harness.query(
    `insert into workspaces (id, name, slug, "updatedAt") values ('ws_old', 'ws_old', 'ws-old', now())`
  )
  await harness.applyMigration(MIGRATION)
  await harness.query(
    `insert into workspaces (id, name, slug, "updatedAt") values ('ws_new', 'ws_new', 'ws-new', now())`
  )
})

afterAll(async () => {
  await harness.stop()
})

describe('LUM-1328 agent review default migration', () => {
  it('an existing workspace keeps AI review and hunt on', async () => {
    expect(await switchesOf('ws_old')).toEqual({
      securityScanEnabled: true,
      securityAiReviewEnabled: true,
      securityHuntEnabled: true,
    })
  })

  it('a new workspace starts with the defaults the code assumes', async () => {
    expect(await switchesOf('ws_new')).toEqual({
      securityScanEnabled:
        DEFAULT_WORKSPACE_SECURITY_SWITCHES.securityScanEnabled,
      securityAiReviewEnabled:
        DEFAULT_WORKSPACE_SECURITY_SWITCHES.securityAiReviewEnabled,
      securityHuntEnabled:
        DEFAULT_WORKSPACE_SECURITY_SWITCHES.securityHuntEnabled,
    })
    expect(await switchesOf('ws_new')).toMatchObject({
      securityAiReviewEnabled: false,
      securityHuntEnabled: false,
    })
  })

  it('scans get an agentReviewTools column defaulting to an empty list', async () => {
    const [col] = await harness.query<{ column_default: string | null }>(
      `select column_default from information_schema.columns
       where table_name = 'pr_security_scans' and column_name = 'agentReviewTools'`
    )
    expect(col?.column_default).toContain('ARRAY[]')
  })
})
