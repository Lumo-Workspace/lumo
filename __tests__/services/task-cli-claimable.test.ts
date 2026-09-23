/**
 * @jest-environment node
 *
 * LUM-646: the agent-claimable marker end-to-end wire contract —
 *   - the field is fail-closed (`Boolean @default(false)`) in the schema,
 *   - both task-update Zod schemas accept a `claimable` boolean,
 *   - the CLI collapses --claimable / --not-claimable into the wire payload.
 */
// LUM-825: DONE also cleans up the task's local git worktrees; these suites
// test the API flow, so never let it touch the real checkout's worktrees.
jest.mock('@/cli/src/lib/worktree-cleanup', () => ({
  ...jest.requireActual('@/cli/src/lib/worktree-cleanup'),
  planTaskWorktreeCleanup: jest.fn(() => null),
}))
import { readFileSync } from 'fs'
import path from 'path'
import { cliUpdateTaskSchema, updateTaskSchema } from '@/lib/validation/schemas'
import { buildUpdatePayload } from '@/cli/src/commands/task-update'

describe('LUM-646 claimable field', () => {
  it('is declared on Task as Boolean with a fail-closed default false', () => {
    const schema = readFileSync(
      path.resolve(__dirname, '../../prisma/schema.prisma'),
      'utf8'
    )
    expect(schema).toMatch(/claimable\s+Boolean\s+@default\(false\)/)
  })

  it('the migration adds the column with a fail-closed default', () => {
    const sql = readFileSync(
      path.resolve(
        __dirname,
        '../../prisma/migrations/20260703000000_lum646_task_claimable/migration.sql'
      ),
      'utf8'
    )
    expect(sql).toMatch(
      /ADD COLUMN "claimable" BOOLEAN NOT NULL DEFAULT false/i
    )
  })

  it('cliUpdateTaskSchema accepts a claimable boolean', () => {
    expect(cliUpdateTaskSchema.safeParse({ claimable: true }).success).toBe(
      true
    )
    expect(cliUpdateTaskSchema.safeParse({ claimable: false }).success).toBe(
      true
    )
    expect(cliUpdateTaskSchema.safeParse({ claimable: 'yes' }).success).toBe(
      false
    )
  })

  it('updateTaskSchema (web) also accepts a claimable boolean', () => {
    expect(updateTaskSchema.safeParse({ claimable: true }).success).toBe(true)
  })

  it('buildUpdatePayload emits claimable true and the --claimable flag', () => {
    const { payload, flagsGiven } = buildUpdatePayload({ claimable: true })
    expect(payload).toEqual({ claimable: true })
    expect(flagsGiven).toContain('--claimable')
  })

  it('buildUpdatePayload emits claimable false and the --not-claimable flag', () => {
    const { payload, flagsGiven } = buildUpdatePayload({ claimable: false })
    expect(payload).toEqual({ claimable: false })
    expect(flagsGiven).toContain('--not-claimable')
  })

  it('buildUpdatePayload omits claimable when unset (tri-state)', () => {
    const { payload, flagsGiven } = buildUpdatePayload({ title: 'x' })
    expect('claimable' in payload).toBe(false)
    expect(flagsGiven).not.toContain('--claimable')
  })
})
