import { cliCreateTaskSchema } from '@/lib/validation/schemas'

describe('cliCreateTaskSchema', () => {
  it('accepts a minimal payload with only title', () => {
    const result = cliCreateTaskSchema.safeParse({ title: 'Hello' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.title).toBe('Hello')
      expect(result.data.priority).toBe('NONE')
    }
  })

  it('defaults priority to NONE (not assessed, LUM-1284) — never invents one', () => {
    const result = cliCreateTaskSchema.safeParse({ title: 't' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.priority).toBe('NONE')
    }
  })

  it('accepts all optional fields', () => {
    const result = cliCreateTaskSchema.safeParse({
      title: 't',
      description: 'd',
      priority: 'HIGH',
      projectRef: 'lumo',
      assigneeRef: 'ada@example.com',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.description).toBe('d')
      expect(result.data.priority).toBe('HIGH')
      expect(result.data.projectRef).toBe('lumo')
      expect(result.data.assigneeRef).toBe('ada@example.com')
    }
  })

  it('rejects empty title', () => {
    const result = cliCreateTaskSchema.safeParse({ title: '   ' })
    expect(result.success).toBe(false)
  })

  it('rejects unknown priority', () => {
    const result = cliCreateTaskSchema.safeParse({
      title: 't',
      priority: 'low',
    })
    expect(result.success).toBe(false)
  })

  it('rejects title over 500 chars', () => {
    const result = cliCreateTaskSchema.safeParse({ title: 'x'.repeat(501) })
    expect(result.success).toBe(false)
  })

  it('accepts a long, document-sized description', () => {
    const result = cliCreateTaskSchema.safeParse({
      title: 't',
      description: 'x'.repeat(100000),
    })
    expect(result.success).toBe(true)
  })

  it('rejects description over 3000000 chars', () => {
    const result = cliCreateTaskSchema.safeParse({
      title: 't',
      description: 'x'.repeat(3000001),
    })
    expect(result.success).toBe(false)
  })
})
