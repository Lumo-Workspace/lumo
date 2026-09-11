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
  touchedPaths: ['lib/s.ts'],
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
  // The prompt assertions below read `gen.mock.calls[0]`, so the recorded
  // calls must not carry over from the previous test.
  beforeEach(() => {
    gen.mockClear()
  })

  /**
   * LUM-758 Task 10 review — `reasons` say WHICH rule fired, never WHERE.
   * `isGraphSourcePath` has no test-path exclusion, so a PR that only adds a
   * fixture containing `prisma.$queryRawUnsafe` emits `diff:sink:prisma-raw`
   * exactly like a production one. The touched paths are the only thing that
   * lets the planner tell them apart and answer `[]`, and answering `[]` is
   * worth one plan call plus up to 3 × HUNT_TASK_TOKEN_MAX.
   */
  it('renders the touched source paths into the prompt, and asks for a file-named task', async () => {
    gen.mockResolvedValueOnce({
      object: { tasks: [], reason: 'fixture only' },
      usage: { totalTokens: 120 },
    })

    await planHuntTasks({
      ...INPUT,
      touchedPaths: ['__tests__/fixtures/raw.test.ts', 'lib/s.ts'],
    })

    const { prompt, system } = gen.mock.calls[0]![0]
    expect(prompt).toContain('__tests__/fixtures/raw.test.ts')
    expect(prompt).toContain('lib/s.ts')
    expect(prompt).toContain('diff:sink:prisma-raw')
    // The bar rule 2 sets is checkable against that list — "tied to a signal
    // that fired" was satisfied by construction on every PR that gets here.
    expect(system).toContain('must name at least one file')
    expect(system).toMatch(/do not propose the task/)
    // …and the two sentences that produce the SKIPPED path and the entire
    // cost win are untouched.
    expect(system).toContain(
      'Most pull requests deserve an empty array. Returning nothing is not a failure.'
    )
    expect(system).toContain(
      'Never propose a task just because the trigger fired'
    )
  })

  it('caps how many paths reach the prompt and says how many were left out', async () => {
    gen.mockResolvedValueOnce({
      object: { tasks: [], reason: 'nothing' },
      usage: { totalTokens: 90 },
    })
    const many = Array.from({ length: 75 }, (_, i) => `lib/f${i}.ts`)

    await planHuntTasks({ ...INPUT, touchedPaths: many })

    const { prompt } = gen.mock.calls[0]![0]
    expect(prompt).toContain('lib/f59.ts')
    expect(prompt).not.toContain('lib/f60.ts')
    expect(prompt).toContain('…and 15 more')
  })

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
