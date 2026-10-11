/**
 * @jest-environment node
 *
 * LUM-1083 — the migration that removes Initiatives, against a REAL Postgres:
 * replay every migration up to it, seed an initiative with a progress update
 * and a task + milestone rolled up to it, apply it, and check that only the
 * initiative data goes.
 */
import { createPgliteHarness } from '../../scripts/test-support/pglite-harness'

const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')

const MIGRATION = '20261030090000_lum1083_remove_initiatives'
const harness = createPgliteHarness(PrismaClient, {
  stopBeforeMigration: MIGRATION,
})

jest.setTimeout(180_000)

const WS = 'ws_rm_initiatives'

async function tableExists(name: string): Promise<boolean> {
  const rows = await harness.query<{ n: bigint }>(
    `select count(*) as n from information_schema.tables
     where table_schema = 'public' and table_name = $1`,
    [name]
  )
  return Number(rows[0]!.n) > 0
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await harness.query<{ n: bigint }>(
    `select count(*) as n from information_schema.columns
     where table_schema = 'public' and table_name = $1 and column_name = $2`,
    [table, column]
  )
  return Number(rows[0]!.n) > 0
}

beforeAll(async () => {
  await harness.start()
  // The replay really stopped before the migration under test.
  expect(await tableExists('initiatives')).toBe(true)

  await harness.insert('workspaces', { id: WS, name: WS, slug: WS })
  await harness.insert('workspace_members', {
    id: 'm1',
    workspaceId: WS,
    clerkId: 'c1',
  })
  await harness.insert('teams', {
    id: 't1',
    workspaceId: WS,
    name: 'Eng',
    identifier: 'RI',
  })
  await harness.insert('projects', {
    id: 'p1',
    workspaceId: WS,
    teamId: 't1',
    createdByMemberId: 'm1',
    name: 'Project',
  })
  await harness.insert('initiatives', {
    id: 'init1',
    teamId: 't1',
    workspaceId: WS,
    number: 1,
    name: 'An initiative',
  })
  await harness.insert('initiative_updates', {
    id: 'upd1',
    initiativeId: 'init1',
    authorMemberId: 'm1',
    body: 'On track',
    health: 'ON_TRACK',
  })
  await harness.insert('milestones', {
    id: 'ms1',
    projectId: 'p1',
    name: 'Milestone',
    slug: 'milestone',
    initiativeId: 'init1',
  })
  await harness.insert('tasks', {
    id: 'task1',
    projectId: 'p1',
    workspaceId: WS,
    teamId: 't1',
    number: 1,
    title: 'Rolled-up task',
    milestoneId: 'ms1',
    initiativeId: 'init1',
  })

  await harness.applyMigration(MIGRATION)
})

afterAll(async () => {
  await harness.stop()
})

describe('LUM-1083 remove initiatives migration', () => {
  it('drops both initiative tables', async () => {
    expect(await tableExists('initiatives')).toBe(false)
    expect(await tableExists('initiative_updates')).toBe(false)
  })

  it('drops the roll-up columns but keeps the task and milestone rows', async () => {
    expect(await columnExists('tasks', 'initiativeId')).toBe(false)
    expect(await columnExists('milestones', 'initiativeId')).toBe(false)

    const tasks = await harness.query<{ id: string; milestoneId: string }>(
      `select id, "milestoneId" from tasks where id = 'task1'`
    )
    expect(tasks).toEqual([{ id: 'task1', milestoneId: 'ms1' }])
    const milestones = await harness.query<{ id: string }>(
      `select id from milestones where id = 'ms1'`
    )
    expect(milestones).toHaveLength(1)
  })

  it('drops the initiative enums', async () => {
    const types = await harness.query<{ typname: string }>(
      `select typname from pg_type
       where typname in ('InitiativeStatus', 'InitiativeHealth')`
    )
    expect(types).toEqual([])
  })
})
