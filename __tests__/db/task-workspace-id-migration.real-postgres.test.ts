/**
 * @jest-environment node
 *
 * LUM-992 — the `tasks.workspaceId` migration against a REAL Postgres: replay
 * every migration up to it, seed tasks in the pre-migration shape (no
 * workspaceId column), apply it, and check the backfill plus the guard
 * trigger that keeps a task's workspace equal to its project's.
 */
import { createPgliteHarness } from '../../scripts/test-support/pglite-harness'

const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')

const MIGRATION = '20261016090000_task_workspace_id'
const harness = createPgliteHarness(PrismaClient, {
  stopBeforeMigration: MIGRATION,
})

jest.setTimeout(180_000)

const A = 'ws_mig_a'
const B = 'ws_mig_b'

async function seedWorkspace(ws: string, tasks: number) {
  await harness.insert('workspaces', { id: ws, name: ws, slug: ws })
  await harness.insert('workspace_members', {
    id: `m_${ws}`,
    workspaceId: ws,
    clerkId: `c_${ws}`,
  })
  await harness.insert('teams', {
    id: `t_${ws}`,
    workspaceId: ws,
    name: 'Eng',
    identifier: 'MG',
  })
  for (const p of ['1', '2']) {
    await harness.insert('projects', {
      id: `p${p}_${ws}`,
      workspaceId: ws,
      teamId: `t_${ws}`,
      createdByMemberId: `m_${ws}`,
      name: `Project ${p}`,
    })
  }
  for (let i = 1; i <= tasks; i++) {
    await harness.insert('tasks', {
      id: `task${i}_${ws}`,
      projectId: `p${(i % 2) + 1}_${ws}`,
      teamId: `t_${ws}`,
      number: i,
      title: `Task ${i}`,
    })
  }
}

beforeAll(async () => {
  await harness.start()
  const before = await harness.query<{ n: bigint }>(
    `select count(*) as n from information_schema.columns
     where table_name = 'tasks' and column_name = 'workspaceId'`
  )
  // The replay really stopped before the migration under test.
  expect(Number(before[0]!.n)).toBe(0)
  await seedWorkspace(A, 5)
  await seedWorkspace(B, 3)
  await harness.applyMigration(MIGRATION)
})

afterAll(async () => {
  await harness.stop()
})

describe('tasks.workspaceId migration', () => {
  it('backfills every task with its project workspace', async () => {
    const rows = await harness.query<{
      id: string
      workspaceId: string | null
      projectWorkspaceId: string
    }>(
      `select t.id, t."workspaceId", p."workspaceId" as "projectWorkspaceId"
       from tasks t join projects p on p.id = t."projectId" order by t.id`
    )
    expect(rows).toHaveLength(8)
    for (const r of rows) expect(r.workspaceId).toBe(r.projectWorkspaceId)
    const mismatched = await harness.query<{ n: bigint }>(
      `select count(*) as n from tasks t join projects p on p.id = t."projectId"
       where t."workspaceId" is distinct from p."workspaceId"`
    )
    expect(Number(mismatched[0]!.n)).toBe(0)
  })

  it('makes the column NOT NULL with an FK to workspaces and an index', async () => {
    const col = await harness.query<{ is_nullable: string }>(
      `select is_nullable from information_schema.columns
       where table_name = 'tasks' and column_name = 'workspaceId'`
    )
    expect(col[0]!.is_nullable).toBe('NO')
    const fk = await harness.query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint
       where conname = 'tasks_workspaceId_fkey'`
    )
    expect(fk[0]!.def).toMatch(
      /FOREIGN KEY \("workspaceId"\) REFERENCES workspaces\(id\) ON UPDATE CASCADE ON DELETE CASCADE/
    )
    const idx = await harness.query<{ indexname: string }>(
      `select indexname from pg_indexes where tablename = 'tasks'
       and indexname = 'tasks_workspaceId_status_idx'`
    )
    expect(idx).toHaveLength(1)
  })

  it('fills workspaceId from the project when an insert omits it (old code during deploy)', async () => {
    await harness.insert('tasks', {
      id: 'late_insert',
      projectId: `p1_${B}`,
      teamId: `t_${B}`,
      number: 100,
      title: 'written by the previous deployment',
    })
    const [row] = await harness.query<{ workspaceId: string }>(
      `select "workspaceId" from tasks where id = 'late_insert'`
    )
    expect(row!.workspaceId).toBe(B)
  })

  it('rejects a task whose workspaceId differs from its project', async () => {
    await expect(
      harness.insert('tasks', {
        id: 'forged',
        projectId: `p1_${B}`,
        workspaceId: A,
        teamId: `t_${B}`,
        number: 101,
        title: 'forged workspace',
      })
    ).rejects.toThrow(/does not match its project/)
  })

  it('rejects moving a task to another workspace project, even unscoped', async () => {
    await expect(
      harness.query(`update tasks set "projectId" = $1 where id = $2`, [
        `p1_${B}`,
        `task1_${A}`,
      ])
    ).rejects.toThrow(/does not match its project/)
    // A same-workspace move is fine and keeps the workspace.
    await harness.query(`update tasks set "projectId" = $1 where id = $2`, [
      `p1_${A}`,
      `task1_${A}`,
    ])
    const [row] = await harness.query<{
      projectId: string
      workspaceId: string
    }>(`select "projectId", "workspaceId" from tasks where id = $1`, [
      `task1_${A}`,
    ])
    expect(row).toEqual({ projectId: `p1_${A}`, workspaceId: A })
  })

  it("moves a project's tasks with it if the project's workspace changes", async () => {
    await harness.insert('workspaces', { id: 'ws_mig_c', name: 'c', slug: 'c' })
    await harness.query(
      `update projects set "workspaceId" = 'ws_mig_c' where id = $1`,
      [`p2_${B}`]
    )
    const rows = await harness.query<{ workspaceId: string }>(
      `select distinct "workspaceId" from tasks where "projectId" = $1`,
      [`p2_${B}`]
    )
    expect(rows).toEqual([{ workspaceId: 'ws_mig_c' }])
  })
})
