import { workspaceTaskFiltersSchema } from '@/lib/validation/schemas'

describe('workspaceTaskFiltersSchema', () => {
  it('accepts a fully-populated filter set', () => {
    const parsed = workspaceTaskFiltersSchema.safeParse({
      projectIds: ['p1'],
      milestoneIds: ['m1'],
      statuses: ['TODO', 'IN_PROGRESS'],
      priorities: ['HIGH'],
      assigneeActorIds: ['a1'],
      tagIds: ['t1'],
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts an empty object (all filters optional)', () => {
    expect(workspaceTaskFiltersSchema.safeParse({}).success).toBe(true)
  })

  it('rejects an unknown status value', () => {
    const parsed = workspaceTaskFiltersSchema.safeParse({ statuses: ['BOGUS'] })
    expect(parsed.success).toBe(false)
  })

  it('rejects an unknown priority value', () => {
    const parsed = workspaceTaskFiltersSchema.safeParse({ priorities: ['SUPER'] })
    expect(parsed.success).toBe(false)
  })
})
