import {
  buildPriorityPrompt,
  PrioritySuggestionSchema,
} from '@/lib/prompts/priority'

describe('suggest-priority data assembly', () => {
  it('builds a valid prompt from tasks and overrides', () => {
    const prompt = buildPriorityPrompt({
      title: 'Fix authentication timeout',
      description: 'Users report being logged out after 5 minutes',
      projectName: 'Auth Service',
      historicalTasks: [
        { id: 't1', number: 12, title: 'Add OAuth login', priority: 'HIGH' },
        { id: 't2', number: 8, title: 'Fix session bug', priority: 'URGENT' },
      ],
      overrides: [
        {
          taskTitle: 'Token refresh',
          aiSuggested: 'MEDIUM',
          userChosen: 'HIGH',
        },
      ],
    })
    expect(prompt).toContain('Fix authentication timeout')
    expect(prompt).toContain('Users report being logged out after 5 minutes')
    expect(prompt).toContain('Auth Service')
    expect(prompt).toContain('[HIGH] #12 Add OAuth login')
    expect(prompt).toContain('[URGENT] #8 Fix session bug')
    expect(prompt).toContain('"Token refresh"')
  })

  it('handles cold start with no tasks and no overrides', () => {
    const prompt = buildPriorityPrompt({
      title: 'First task ever',
      projectName: 'New Project',
      historicalTasks: [],
      overrides: [],
    })
    expect(prompt).toContain('First task ever')
    expect(prompt).toContain('No historical tasks available')
    expect(prompt).toContain('No preference records available')
  })

  it('output schema validates a well-formed suggestion', () => {
    const suggestion = {
      priority: 'HIGH' as const,
      reason: 'Auth-related issues affect all users',
      stats: { total: 3, distribution: { HIGH: 2, URGENT: 1 } },
      similarTasks: [
        {
          id: 't1',
          number: 12,
          title: 'Add OAuth login',
          priority: 'HIGH' as const,
        },
      ],
    }
    const result = PrioritySuggestionSchema.safeParse(suggestion)
    expect(result.success).toBe(true)
  })
})
