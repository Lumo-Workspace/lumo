import { priorityOverrideSchema } from '@/lib/validation/schemas'

describe('priorityOverrideSchema', () => {
  it('accepts valid override data', () => {
    const valid = {
      taskId: 'clxyz123',
      projectId: 'clxyz456',
      aiSuggested: 'HIGH',
      userChosen: 'MEDIUM',
      taskTitle: 'Fix login bug',
      taskDescription: 'Users cannot log in',
    }
    expect(priorityOverrideSchema.safeParse(valid).success).toBe(true)
  })

  it('accepts override without description', () => {
    const valid = {
      taskId: 'clxyz123',
      projectId: 'clxyz456',
      aiSuggested: 'HIGH',
      userChosen: 'MEDIUM',
      taskTitle: 'Fix login bug',
    }
    expect(priorityOverrideSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects missing taskId', () => {
    const invalid = {
      projectId: 'clxyz456',
      aiSuggested: 'HIGH',
      userChosen: 'MEDIUM',
      taskTitle: 'Fix login bug',
    }
    expect(priorityOverrideSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects invalid priority value', () => {
    const invalid = {
      taskId: 'clxyz123',
      projectId: 'clxyz456',
      aiSuggested: 'CRITICAL',
      userChosen: 'MEDIUM',
      taskTitle: 'Fix login bug',
    }
    expect(priorityOverrideSchema.safeParse(invalid).success).toBe(false)
  })
})
