/**
 * @jest-environment node
 *
 * LUM-1040 — the migration that removes Ideas and plan runs, against a REAL
 * Postgres: replay every migration up to it, seed ideas / idea comments /
 * plan runs next to the task and initiative rows they link to, apply it, and
 * check that only the idea and plan-run data goes.
 */
import { createPgliteHarness } from '../../scripts/test-support/pglite-harness'

const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')

const MIGRATION = '20261021090000_lum1040_remove_ideas_plan_runs'
const harness = createPgliteHarness(PrismaClient, {
  stopBeforeMigration: MIGRATION,
})

jest.setTimeout(180_000)

const WS = 'ws_rm_ideas'

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
  expect(await tableExists('ideas')).toBe(true)

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
    identifier: 'RM',
  })
  await harness.insert('projects', {
    id: 'p1',
    workspaceId: WS,
    teamId: 't1',
    createdByMemberId: 'm1',
    name: 'Project',
  })
  await harness.insert('plan_runs', {
    id: 'run1',
    teamId: 't1',
    workspaceId: WS,
    startedByMemberId: 'm1',
    stage: 'MATERIALIZED',
  })
  await harness.insert('plan_run_stage_records', {
    id: 'stage1',
    planRunId: 'run1',
    kind: 'GENERATE',
  })
  await harness.insert('initiatives', {
    id: 'init1',
    teamId: 't1',
    workspaceId: WS,
    number: 1,
    name: 'Materialised initiative',
    planRunId: 'run1',
  })
  await harness.insert('ideas', {
    id: 'idea1',
    teamId: 't1',
    workspaceId: WS,
    number: 1,
    statement: 'An idea',
    proposedByMemberId: 'm1',
    planRunId: 'run1',
    initiativeId: 'init1',
  })
  await harness.insert('idea_activities', {
    id: 'act1',
    ideaId: 'idea1',
    type: 'IDEA_CAPTURED',
  })
  await harness.insert('tasks', {
    id: 'task1',
    projectId: 'p1',
    teamId: 't1',
    number: 1,
    title: 'Materialised task',
    initiativeId: 'init1',
    ideaId: 'idea1',
  })
  await harness.insert('comments', {
    id: 'c_task',
    taskId: 'task1',
    ideaId: null,
    body: '<p>task comment</p>',
  })
  await harness.insert('comments', {
    id: 'c_idea',
    taskId: null,
    ideaId: 'idea1',
    body: '<p>idea comment</p>',
  })

  await harness.applyMigration(MIGRATION)
})

afterAll(async () => {
  await harness.stop()
})

describe('LUM-1040 remove ideas + plan runs migration', () => {
  it('drops every idea and plan-run table', async () => {
    for (const table of [
      'ideas',
      'idea_activities',
      'idea_slack_contexts',
      'idea_web_links',
      'idea_figma_links',
      'idea_pull_requests',
      'plan_runs',
      'plan_run_stage_records',
    ]) {
      expect([table, await tableExists(table)]).toEqual([table, false])
    }
  })

  it('drops the link columns but keeps the task and initiative rows', async () => {
    expect(await columnExists('tasks', 'ideaId')).toBe(false)
    expect(await columnExists('initiatives', 'planRunId')).toBe(false)
    expect(await columnExists('comments', 'ideaId')).toBe(false)

    const tasks = await harness.query<{ id: string; initiativeId: string }>(
      `select id, "initiativeId" from tasks where id = 'task1'`
    )
    expect(tasks).toEqual([{ id: 'task1', initiativeId: 'init1' }])
    const initiatives = await harness.query<{ id: string }>(
      `select id from initiatives where id = 'init1'`
    )
    expect(initiatives).toHaveLength(1)
  })

  it('deletes idea comments, keeps task comments, and makes taskId required', async () => {
    const comments = await harness.query<{ id: string }>(
      `select id from comments order by id`
    )
    expect(comments).toEqual([{ id: 'c_task' }])

    const nullable = await harness.query<{ is_nullable: string }>(
      `select is_nullable from information_schema.columns
       where table_name = 'comments' and column_name = 'taskId'`
    )
    expect(nullable[0]!.is_nullable).toBe('NO')
  })

  it('drops the idea and plan-run enums', async () => {
    const types = await harness.query<{ typname: string }>(
      `select typname from pg_type
       where typname in ('IdeaStatus', 'IdeaActivityType', 'PlanRunStage', 'PlanStageKind')`
    )
    expect(types).toEqual([])
  })
})
