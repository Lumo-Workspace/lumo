import {
  planFallback,
  categoriesToTasks,
} from '@/ee/security/security-scan/hunt/plan-fallback'
import {
  HUNT_CATEGORIES,
  HUNT_MAX_PLANNED_TASKS,
} from '@/ee/security/services/security-hunt.config'

describe('planFallback', () => {
  it.each([
    ['diff:sink:prisma-raw', 'injection'],
    ['diff:sink:child-process', 'injection'],
    ['diff:sink:eval', 'injection'],
    ['diff:sink:new-function', 'injection'],
    ['diff:sink:fs-write', 'injection'],
    ['diff:sink:fetch', 'ssrf'],
    ['diff:sink:redirect', 'ssrf'],
    ['diff:sink:llm-call', 'prompt_injection'],
  ])('%s maps to %s', (reason, category) => {
    expect(planFallback([reason])).toEqual([category])
  })

  it('maps an entry with no auth/workspace control to idor', () => {
    expect(planFallback(['diff:entry:next-route-handler'])).toEqual(['idor'])
  })

  it('does not map to idor when the diff adds an auth control', () => {
    expect(
      planFallback(['diff:entry:next-route-handler', 'diff:control:auth'])
    ).toEqual([])
  })

  it('does not map to idor when the diff adds a workspace-scope control', () => {
    expect(
      planFallback([
        'diff:entry:next-route-handler',
        'diff:control:workspace-scope',
      ])
    ).toEqual([])
  })

  it('returns [] for intent-only reasons', () => {
    expect(planFallback(['stage-a:high', 'l4:open-crossing'])).toEqual([])
  })

  it('returns [] for unknown reasons', () => {
    expect(planFallback(['diff:sink:not-a-real-rule'])).toEqual([])
  })

  it('never returns race or logic', () => {
    const all = planFallback([
      'diff:sink:prisma-raw',
      'diff:sink:fetch',
      'diff:sink:llm-call',
      'diff:entry:next-route-handler',
      'stage-a:high',
    ])
    expect(all).not.toContain('race')
    expect(all).not.toContain('logic')
  })

  it('caps at HUNT_MAX_PLANNED_TASKS in priority order', () => {
    expect(
      planFallback([
        'diff:sink:fetch',
        'diff:sink:llm-call',
        'diff:sink:prisma-raw',
        'diff:entry:next-route-handler',
      ])
    ).toEqual(['injection', 'idor', 'ssrf'])
    expect(
      planFallback([
        'diff:sink:fetch',
        'diff:sink:llm-call',
        'diff:sink:prisma-raw',
        'diff:entry:next-route-handler',
      ])
    ).toHaveLength(HUNT_MAX_PLANNED_TASKS)
  })

  it('deduplicates categories reached by two reasons', () => {
    expect(
      planFallback(['diff:sink:prisma-raw', 'diff:sink:child-process'])
    ).toEqual(['injection'])
  })

  it('never widens to all six categories, even when every reason hits', () => {
    const all = planFallback([
      'diff:sink:prisma-raw',
      'diff:sink:fetch',
      'diff:sink:llm-call',
      'diff:entry:next-route-handler',
    ])
    expect(all.length).toBeLessThan(HUNT_CATEGORIES.length)
    expect(all.length).toBeLessThanOrEqual(HUNT_MAX_PLANNED_TASKS)
  })
})

describe('categoriesToTasks', () => {
  it('wraps each category in a degenerate task with no starting points', () => {
    const tasks = categoriesToTasks(['injection', 'idor'])
    expect(tasks).toEqual([
      {
        id: 'f1',
        objective: expect.any(String),
        category: 'injection',
        startingPoints: [],
      },
      {
        id: 'f2',
        objective: expect.any(String),
        category: 'idor',
        startingPoints: [],
      },
    ])
  })

  it('returns [] for an empty category list', () => {
    expect(categoriesToTasks([])).toEqual([])
  })

  it('has a non-empty fallback objective for every category', () => {
    for (const category of HUNT_CATEGORIES) {
      const [task] = categoriesToTasks([category])
      expect(task!.objective.length).toBeGreaterThan(0)
    }
  })

  it('composes with planFallback and still never widens to all six categories', () => {
    const tasks = categoriesToTasks(
      planFallback([
        'diff:sink:prisma-raw',
        'diff:sink:fetch',
        'diff:sink:llm-call',
        'diff:entry:next-route-handler',
      ])
    )
    expect(tasks.length).toBeLessThan(HUNT_CATEGORIES.length)
    expect(tasks.length).toBeLessThanOrEqual(HUNT_MAX_PLANNED_TASKS)
  })
})
