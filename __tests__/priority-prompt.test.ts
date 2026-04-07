import {
  buildPriorityPrompt,
  PRIORITY_SYSTEM_PROMPT,
  PrioritySuggestionSchema,
} from '@/lib/prompts/priority'

describe('PRIORITY_SYSTEM_PROMPT', () => {
  it('includes all four priority levels', () => {
    expect(PRIORITY_SYSTEM_PROMPT).toContain('LOW')
    expect(PRIORITY_SYSTEM_PROMPT).toContain('MEDIUM')
    expect(PRIORITY_SYSTEM_PROMPT).toContain('HIGH')
    expect(PRIORITY_SYSTEM_PROMPT).toContain('URGENT')
  })
})

describe('buildPriorityPrompt', () => {
  it('includes task title and project name', () => {
    const result = buildPriorityPrompt({
      title: 'Fix login bug',
      projectName: 'Auth Service',
      historicalTasks: [],
      overrides: [],
    })
    expect(result).toContain('Fix login bug')
    expect(result).toContain('Auth Service')
  })

  it('shows "Not provided" when description is absent', () => {
    const result = buildPriorityPrompt({
      title: 'Fix login bug',
      projectName: 'Auth Service',
      historicalTasks: [],
      overrides: [],
    })
    expect(result).toContain('Not provided')
  })

  it('includes description when provided', () => {
    const result = buildPriorityPrompt({
      title: 'Fix login bug',
      description: 'Users cannot log in after password reset',
      projectName: 'Auth Service',
      historicalTasks: [],
      overrides: [],
    })
    expect(result).toContain('Users cannot log in after password reset')
    expect(result).not.toContain('Not provided')
  })

  it('serializes historical tasks with priority and number', () => {
    const result = buildPriorityPrompt({
      title: 'New task',
      projectName: 'My Project',
      historicalTasks: [
        { id: 'task1', number: 42, title: 'Fix timeout', priority: 'HIGH' },
        { id: 'task2', number: 38, title: 'Add caching', priority: 'MEDIUM' },
      ],
      overrides: [],
    })
    expect(result).toContain('[HIGH] #42 Fix timeout')
    expect(result).toContain('[MEDIUM] #38 Add caching')
  })

  it('serializes override records', () => {
    const result = buildPriorityPrompt({
      title: 'New task',
      projectName: 'My Project',
      historicalTasks: [],
      overrides: [
        { taskTitle: 'Old task', aiSuggested: 'HIGH', userChosen: 'MEDIUM' },
      ],
    })
    expect(result).toContain('"Old task"')
    expect(result).toContain('HIGH')
    expect(result).toContain('MEDIUM')
  })

  it('truncates historical tasks to 50', () => {
    const tasks = Array.from({ length: 60 }, (_, i) => ({
      id: `t${i}`,
      number: i + 1,
      title: `Task ${i}`,
      priority: 'MEDIUM' as const,
    }))
    const result = buildPriorityPrompt({
      title: 'New',
      projectName: 'P',
      historicalTasks: tasks,
      overrides: [],
    })
    expect(result).toContain('#50')
    expect(result).not.toContain('#51')
  })

  it('truncates overrides to 30', () => {
    const overrides = Array.from({ length: 35 }, (_, i) => ({
      taskTitle: `Override ${i}`,
      aiSuggested: 'HIGH' as const,
      userChosen: 'LOW' as const,
    }))
    const result = buildPriorityPrompt({
      title: 'New',
      projectName: 'P',
      historicalTasks: [],
      overrides,
    })
    expect(result).toContain('Override 29')
    expect(result).not.toContain('Override 30')
  })
})

describe('PrioritySuggestionSchema', () => {
  it('accepts a valid suggestion', () => {
    const valid = {
      priority: 'HIGH',
      reason: 'Affects core auth flow',
      stats: { total: 5, distribution: { HIGH: 3, MEDIUM: 1, URGENT: 1 } },
      similarTasks: [
        { id: 'abc', number: 42, title: 'Fix login', priority: 'HIGH' },
      ],
    }
    expect(PrioritySuggestionSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects invalid priority', () => {
    const invalid = {
      priority: 'CRITICAL',
      reason: 'test',
      stats: { total: 0, distribution: {} },
      similarTasks: [],
    }
    expect(PrioritySuggestionSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects more than 2 similar tasks', () => {
    const invalid = {
      priority: 'HIGH',
      reason: 'test',
      stats: { total: 0, distribution: {} },
      similarTasks: [
        { id: '1', number: 1, title: 'A', priority: 'HIGH' },
        { id: '2', number: 2, title: 'B', priority: 'HIGH' },
        { id: '3', number: 3, title: 'C', priority: 'HIGH' },
      ],
    }
    expect(PrioritySuggestionSchema.safeParse(invalid).success).toBe(false)
  })
})
