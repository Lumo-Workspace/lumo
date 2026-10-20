/**
 * @jest-environment node
 *
 * LUM-1284: NONE ("not assessed") task priority, the default for new tasks.
 * Covers the create defaults on every path (web schema, CLI schema,
 * quick-dispatch rule parser + execute schema + LLM prompts, MCP), the sort
 * order URGENT > HIGH > MEDIUM > LOW > NONE wherever priority sorts, the
 * workflow catalog, and the migration shape (ADD VALUE apart from SET DEFAULT).
 */
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import {
  ASSESSED_PRIORITIES,
  PRIORITY_DISPLAY_ORDER,
  PRIORITY_SORT_WEIGHT,
  TASK_PRIORITIES,
  compareTaskPriority,
} from '@/lib/task/priority'
import {
  cliCreateTaskSchema,
  cliUpdateTaskSchema,
  createTaskSchema,
  executeQuickDispatchSchema,
  priorityOverrideSchema,
  updateTaskSchema,
  workspaceTaskFiltersSchema,
} from '@/lib/validation/schemas'
import { parseQuickDispatch } from '@/lib/quick-dispatch/rule-parser'
import {
  QUICK_DISPATCH_SYSTEM_PROMPT,
  QUICK_DISPATCH_V2_SYSTEM_PROMPT,
  QuickDispatchResponseSchema,
} from '@/lib/prompts/quick-dispatch'
import { PrioritySuggestionSchema } from '@/lib/prompts/priority'
import { MCP_TASK_PRIORITIES, priorityForCreate } from '@/mcp/task-priority'
import { sortTasks } from '@/app/workspace/[workspaceUrl]/utils/sortTasks'
import {
  cmpPriority,
  prioritySortValue,
} from '@/app/workspace/[workspaceUrl]/hooks/useTableSort'
import { rankTasks, type NextTask } from '@/cli/src/lib/rank-tasks'
import { priorityBreakdown } from '@/lib/services/sprint-breakdown'
import { computeMilestoneSegments } from '@/lib/summaries/milestone-segments'

import { taskWorkflowCatalog } from '@/lib/task/state-machine'

jest.mock('@/lib/db/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/events/dispatcher', () => ({ dispatchEvents: jest.fn() }))

const ORDER = ['URGENT', 'HIGH', 'MEDIUM', 'LOW', 'NONE']

describe('priority scale', () => {
  it('has NONE plus the four assessed levels', () => {
    expect([...TASK_PRIORITIES]).toEqual([
      'NONE',
      'LOW',
      'MEDIUM',
      'HIGH',
      'URGENT',
    ])
    expect([...ASSESSED_PRIORITIES]).not.toContain('NONE')
    expect([...PRIORITY_DISPLAY_ORDER]).toEqual(ORDER)
    expect(PRIORITY_SORT_WEIGHT.NONE).toBeGreaterThan(PRIORITY_SORT_WEIGHT.LOW)
  })

  it('compareTaskPriority sorts URGENT > HIGH > MEDIUM > LOW > NONE, unknown last', () => {
    const shuffled = ['NONE', 'LOW', 'bogus', 'URGENT', 'MEDIUM', 'HIGH']
    expect(shuffled.sort(compareTaskPriority)).toEqual([...ORDER, 'bogus'])
  })

  it('the workflow catalog (lumo task statuses) lists NONE', () => {
    expect(taskWorkflowCatalog().priorities).toEqual([
      'NONE',
      'LOW',
      'MEDIUM',
      'HIGH',
      'URGENT',
    ])
  })

  it('the MCP copy of the scale matches the app scale', () => {
    expect([...MCP_TASK_PRIORITIES]).toEqual([...TASK_PRIORITIES])
  })
})

describe('create without a priority → NONE', () => {
  it('web create schema', () => {
    const r = createTaskSchema.parse({ title: 'Ship it' })
    expect(r.priority).toBe('NONE')
  })

  it('CLI create schema', () => {
    const r = cliCreateTaskSchema.parse({ title: 'Ship it' })
    expect(r.priority).toBe('NONE')
  })

  it('an explicit priority is kept', () => {
    expect(
      createTaskSchema.parse({ title: 't', priority: 'HIGH' }).priority
    ).toBe('HIGH')
    expect(
      cliCreateTaskSchema.parse({ title: 't', priority: 'LOW' }).priority
    ).toBe('LOW')
  })

  it('quick-dispatch execute schema defaults a create action to NONE', () => {
    const r = executeQuickDispatchSchema.parse({
      workspaceUrl: 'lumo',
      actions: [{ type: 'create', title: 'Do it', projectId: 'p1' }],
    })
    const action = r.actions[0]!
    expect(action.type).toBe('create')
    if (action.type === 'create') expect(action.priority).toBe('NONE')
  })

  it('quick-dispatch rule parser: no keyword → NONE, a keyword → that level', () => {
    const project = {
      type: 'project' as const,
      id: 'p1',
      name: 'Lumo',
      position: [0, 0] as [number, number],
    }
    const none = parseQuickDispatch('create Fix login Lumo', [project])
    const a = none.actions[0]!
    expect(a.type === 'create' && a.priority).toBe('NONE')
    const high = parseQuickDispatch('create Fix login high Lumo', [project])
    const b = high.actions[0]!
    expect(b.type === 'create' && b.priority).toBe('HIGH')
  })

  it('quick-dispatch LLM prompts map "no priority mentioned" to NONE, never MEDIUM', () => {
    for (const prompt of [
      QUICK_DISPATCH_SYSTEM_PROMPT,
      QUICK_DISPATCH_V2_SYSTEM_PROMPT,
    ]) {
      expect(prompt).not.toMatch(/no priority mentioned\)?\s*→\s*MEDIUM/)
      expect(prompt).toMatch(/no priority mentioned → NONE/)
    }
    expect(QUICK_DISPATCH_SYSTEM_PROMPT).toContain('NONE/TODO for defaults')
    expect(
      QuickDispatchResponseSchema.shape.priority.safeParse('NONE').success
    ).toBe(true)
  })

  it('MCP create_task: no priority → NONE, explicit kept', () => {
    expect(priorityForCreate()).toBe('NONE')
    expect(priorityForCreate(undefined)).toBe('NONE')
    expect(priorityForCreate('URGENT')).toBe('URGENT')
  })
})

describe('NONE is settable and filterable', () => {
  it('web and CLI update schemas accept NONE', () => {
    expect(updateTaskSchema.safeParse({ priority: 'NONE' }).success).toBe(true)
    expect(cliUpdateTaskSchema.safeParse({ priority: 'NONE' }).success).toBe(
      true
    )
  })

  it('the task list filter accepts NONE', () => {
    expect(
      workspaceTaskFiltersSchema.safeParse({ priorities: ['NONE', 'HIGH'] })
        .success
    ).toBe(true)
  })

  it('a user may choose NONE over an AI suggestion; the AI never suggests NONE', () => {
    const base = {
      taskId: 't',
      projectId: 'p',
      taskTitle: 'x',
    }
    expect(
      priorityOverrideSchema.safeParse({
        ...base,
        aiSuggested: 'HIGH',
        userChosen: 'NONE',
      }).success
    ).toBe(true)
    expect(
      priorityOverrideSchema.safeParse({
        ...base,
        aiSuggested: 'NONE',
        userChosen: 'HIGH',
      }).success
    ).toBe(false)
    expect(
      PrioritySuggestionSchema.shape.priority.safeParse('NONE').success
    ).toBe(false)
  })
})

describe('sorting: URGENT > HIGH > MEDIUM > LOW > NONE', () => {
  const tasks = ['NONE', 'LOW', 'URGENT', 'MEDIUM', 'HIGH'].map((p, i) => ({
    title: `t${i}`,
    priority: p,
    updatedAt: '2026-10-01T00:00:00.000Z',
  }))

  it('board/list sortTasks (default direction)', () => {
    expect(sortTasks(tasks, 'priority').map(t => t.priority)).toEqual(ORDER)
  })

  it('board/list sortTasks keeps NONE last when the direction flips', () => {
    expect(sortTasks(tasks, 'priority', 'desc').map(t => t.priority)).toEqual([
      'LOW',
      'MEDIUM',
      'HIGH',
      'URGENT',
      'NONE',
    ])
  })

  it('data-table cmpPriority', () => {
    expect(
      ['NONE', 'LOW', 'URGENT', 'MEDIUM', 'HIGH'].sort(cmpPriority)
    ).toEqual(ORDER)
  })

  it('data-table cmpPriority pins NONE last in both directions', () => {
    const input = ['NONE', 'LOW', 'URGENT', 'NONE', 'MEDIUM', 'HIGH']
    expect([...input].sort((a, b) => cmpPriority(a, b, 'asc'))).toEqual([
      'URGENT',
      'HIGH',
      'MEDIUM',
      'LOW',
      'NONE',
      'NONE',
    ])
    expect([...input].sort((a, b) => cmpPriority(a, b, 'desc'))).toEqual([
      'LOW',
      'MEDIUM',
      'HIGH',
      'URGENT',
      'NONE',
      'NONE',
    ])
  })

  it('data-table prioritySortValue reads NONE as unset', () => {
    expect(prioritySortValue('NONE')).toBeUndefined()
    expect(prioritySortValue('LOW')).toBe('LOW')
  })

  it('CLI status --next ranking puts NONE last and says "no priority"', () => {
    const base: Omit<NextTask, 'id' | 'number' | 'priority'> = {
      title: 'x',
      status: 'TODO',
      teamIdentifier: 'LUM',
      sprintId: null,
      dueDate: null,
      updatedAt: '2026-10-01T00:00:00.000Z',
    }
    const input: NextTask[] = ['NONE', 'LOW', 'URGENT', 'MEDIUM', 'HIGH'].map(
      (priority, i) => ({ ...base, id: `t${i}`, number: i + 1, priority })
    )
    const ranked = rankTasks(input, new Set(), new Date('2026-10-02'))
    expect(ranked.map(r => r.task.priority)).toEqual(ORDER)
    expect(ranked[4]!.reasons[0]).toBe('no priority')
    expect(ranked[0]!.reasons[0]).toBe('URGENT')
  })

  it('sprint priority breakdown keeps NONE tasks, listed last', () => {
    const buckets = priorityBreakdown(
      ['NONE', 'LOW', 'URGENT', 'MEDIUM', 'HIGH'].map(p => ({
        priority: p as (typeof TASK_PRIORITIES)[number],
        status: 'TODO' as const,
        assigneeActorId: null,
      }))
    )
    expect(buckets.map(b => b.priority)).toEqual(ORDER)
  })

  it('milestone priority segments list NONE last', () => {
    const segs = computeMilestoneSegments(
      ['NONE', 'LOW', 'URGENT', 'MEDIUM', 'HIGH'].map((p, i) => ({
        id: `t${i}`,
        ref: `LUM-${i}`,
        title: 'x',
        status: 'TODO' as const,
        priority: p as (typeof TASK_PRIORITIES)[number],
        sprintId: null,
        tags: [],
      })),
      []
    )
    expect(segs.priority.map(s => s.key)).toEqual(ORDER)
  })
})

describe('LUM-1284 migrations', () => {
  const dir = join(__dirname, '..', 'prisma', 'migrations')
  const ENUM = '20261201090000_lum1284_priority_none_enum'
  const DEFAULT = '20261201090100_lum1284_priority_default_none'
  const code = (name: string) =>
    readFileSync(join(dir, name, 'migration.sql'), 'utf8')
      .split('\n')
      .map(l => l.replace(/--.*$/, ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
  const stmts = (name: string) =>
    code(name)
      .split(';')
      .map(s => s.trim())
      .filter(Boolean)

  it('ADD VALUE ships alone, in an earlier migration than SET DEFAULT', () => {
    const names = readdirSync(dir).filter(n => n.includes('lum1284'))
    expect(names.sort()).toEqual([ENUM, DEFAULT])
    const latestOther = readdirSync(dir)
      .filter(n => /^\d{14}_/.test(n) && !n.includes('lum1284'))
      .sort()
      .pop()!
    expect(ENUM > latestOther).toBe(true)
    expect(stmts(ENUM)).toEqual([
      `ALTER TYPE "TaskPriority" ADD VALUE IF NOT EXISTS 'NONE' BEFORE 'LOW'`,
    ])
  })

  it('SET DEFAULT is the only statement of the later migration (no backfill)', () => {
    expect(stmts(DEFAULT)).toEqual([
      `ALTER TABLE "tasks" ALTER COLUMN "priority" SET DEFAULT 'NONE'`,
    ])
  })

  it('the Prisma schema matches: NONE first in the enum, default NONE', () => {
    const schema = readFileSync(
      join(__dirname, '..', 'prisma', 'schema.prisma'),
      'utf8'
    )
    const body = /enum TaskPriority \{([^}]*)\}/.exec(schema)![1]!
    const values = body
      .split('\n')
      .map(l => l.replace(/\/\/.*$/, '').trim())
      .filter(Boolean)
    expect(values).toEqual(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT'])
    expect(schema).toMatch(/priority\s+TaskPriority\s+@default\(NONE\)/)
  })
})
