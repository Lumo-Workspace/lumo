import {
  taskDraftDataSchema,
  projectDraftDataSchema,
  upsertDraftSchema,
} from '@/lib/validation/schemas'

describe('taskDraftDataSchema', () => {
  it('accepts empty object (all fields optional)', () => {
    const result = taskDraftDataSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('accepts partial task data', () => {
    const result = taskDraftDataSchema.safeParse({
      title: 'Fix login bug',
      priority: 'HIGH',
    })
    expect(result.success).toBe(true)
  })

  it('accepts full task data', () => {
    const result = taskDraftDataSchema.safeParse({
      title: 'Fix login bug',
      description: '<p>Details here</p>',
      status: 'TODO',
      priority: 'HIGH',
      projectId: 'proj_123',
      assigneeId: 'actor_456',
      dueDate: '2026-04-10T00:00:00.000Z',
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid priority', () => {
    const result = taskDraftDataSchema.safeParse({ priority: 'SUPER_HIGH' })
    expect(result.success).toBe(false)
  })

  it('rejects title over 500 chars', () => {
    const result = taskDraftDataSchema.safeParse({ title: 'x'.repeat(501) })
    expect(result.success).toBe(false)
  })
})

describe('projectDraftDataSchema', () => {
  it('accepts empty object', () => {
    const result = projectDraftDataSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('accepts partial project data', () => {
    const result = projectDraftDataSchema.safeParse({ name: 'My Project' })
    expect(result.success).toBe(true)
  })

  it('rejects name over 200 chars', () => {
    const result = projectDraftDataSchema.safeParse({ name: 'x'.repeat(201) })
    expect(result.success).toBe(false)
  })
})

describe('upsertDraftSchema', () => {
  it('accepts valid create payload (no id)', () => {
    const result = upsertDraftSchema.safeParse({
      workspaceUrl: 'my-workspace',
      type: 'TASK',
      data: { title: 'Draft task' },
    })
    expect(result.success).toBe(true)
  })

  it('accepts valid update payload (with id)', () => {
    const result = upsertDraftSchema.safeParse({
      id: 'clxxxxxxxxxxxxxxxxxxxxxxxxx',
      workspaceUrl: 'my-workspace',
      type: 'PROJECT',
      data: { name: 'Draft project' },
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing workspaceUrl', () => {
    const result = upsertDraftSchema.safeParse({
      type: 'TASK',
      data: {},
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid type', () => {
    const result = upsertDraftSchema.safeParse({
      workspaceUrl: 'ws',
      type: 'DOCUMENT',
      data: {},
    })
    expect(result.success).toBe(false)
  })
})
