/** @jest-environment node */
// LUM-758 — the plan client now produces per-PR tasks (open-vocabulary
// `objective` + closed `category`) instead of bare category labels.
// The dedupe review finding from PR 1 still applies: the zod schema
// (`z.array(TaskSchema).max(HUNT_MAX_PLANNED_TASKS)`) permits two tasks with
// identical `category` + `objective`. Undeduped, the orchestrator would run
// pass 1 on both, and the retry pass can double that again, spending the
// whole scan budget on what is really one task.
jest.mock('ai', () => ({ generateObject: jest.fn() }))
jest.mock('@ai-sdk/gateway', () => ({ gateway: (id: string) => ({ id }) }))

import { generateObject } from 'ai'
import { planHuntTasks } from '@/lib/llm/security-hunt-plan-client'

const gen = generateObject as jest.Mock

const INPUT = {
  reasons: ['diff:sink:prisma-raw'],
  findings: [],
  timeoutMs: 5_000,
}

const task = (over: Record<string, unknown> = {}) => ({
  objective:
    'Check that the new workspace id from the request is scoped before the Prisma call in a.ts',
  category: 'idor',
  startingPoints: ['a.ts'],
  ...over,
})

describe('LUM-758 hunt plan client', () => {
  it('assigns stable ids to the planned tasks', async () => {
    gen.mockResolvedValueOnce({
      object: {
        tasks: [
          task(),
          task({
            category: 'injection',
            objective: task().objective + ' extra',
          }),
        ],
        reason: 'two independent signals',
      },
      usage: { totalTokens: 300 },
    })

    const out = await planHuntTasks(INPUT)

    expect(out.tasks).toEqual([
      { ...task(), id: 't1' },
      {
        ...task({
          category: 'injection',
          objective: task().objective + ' extra',
        }),
        id: 't2',
      },
    ])
  })

  it('dedupes a model response that repeats the same category + objective', async () => {
    gen.mockResolvedValueOnce({
      object: {
        tasks: [task(), task()],
        reason: 'unchecked workspace id',
      },
      usage: { totalTokens: 300 },
    })

    const out = await planHuntTasks(INPUT)

    expect(out.tasks).toEqual([{ ...task(), id: 't1' }])
  })

  it('does not dedupe two tasks that share a category but differ in objective', async () => {
    gen.mockResolvedValueOnce({
      object: {
        tasks: [
          task({ objective: 'first objective, specific enough' }),
          task({ objective: 'second objective, specific enough' }),
        ],
        reason: 'two idor paths',
      },
      usage: { totalTokens: 300 },
    })

    const out = await planHuntTasks(INPUT)

    expect(out.tasks).toHaveLength(2)
    expect(out.tasks.map(t => t.id)).toEqual(['t1', 't2'])
  })

  it('dedupes before applying the max-tasks cap', async () => {
    gen.mockResolvedValueOnce({
      object: {
        tasks: [
          task(),
          task(),
          task({
            category: 'injection',
            objective: task().objective + ' extra',
          }),
        ],
        reason: 'multiple signals',
      },
      usage: { totalTokens: 300 },
    })

    const out = await planHuntTasks(INPUT)

    expect(out.tasks.map(t => t.category)).toEqual(['idor', 'injection'])
  })
})
