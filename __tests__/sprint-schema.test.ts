import {
  createSprintSchema,
  updateSprintSchema,
  closeSprintSchema,
  addTaskToSprintSchema,
  cadenceSchema,
} from '@/lib/validation/sprint.schema'

describe('createSprintSchema', () => {
  it('allows no fields (defaults apply)', () => {
    expect(createSprintSchema.safeParse({}).success).toBe(true)
  })

  it('allows only name', () => {
    const r = createSprintSchema.safeParse({ name: 'Sprint 1' })
    expect(r.success).toBe(true)
    expect(r.data?.name).toBe('Sprint 1')
  })

  it('trims whitespace from name', () => {
    const r = createSprintSchema.safeParse({ name: '  Sprint 1  ' })
    expect(r.success).toBe(true)
    expect(r.data?.name).toBe('Sprint 1')
  })

  it('rejects empty name', () => {
    const r = createSprintSchema.safeParse({ name: '' })
    expect(r.success).toBe(false)
  })

  it('rejects name > 120 chars', () => {
    const r = createSprintSchema.safeParse({ name: 'a'.repeat(121) })
    expect(r.success).toBe(false)
  })

  it('allows valid dates', () => {
    const r = createSprintSchema.safeParse({
      startDate: '2026-04-20',
      endDate: '2026-04-27',
    })
    expect(r.success).toBe(true)
  })

  it('coerces string dates to Date objects', () => {
    const r = createSprintSchema.safeParse({
      startDate: '2026-04-20',
      endDate: '2026-04-27',
    })
    expect(r.success).toBe(true)
    expect(r.data?.startDate).toBeInstanceOf(Date)
    expect(r.data?.endDate).toBeInstanceOf(Date)
  })

  it('rejects endDate ≤ startDate (same day)', () => {
    const r = createSprintSchema.safeParse({
      startDate: '2026-04-20',
      endDate: '2026-04-20',
    })
    expect(r.success).toBe(false)
    expect(r.error?.issues[0]?.path).toContain('endDate')
  })

  it('rejects endDate < startDate (earlier date)', () => {
    const r = createSprintSchema.safeParse({
      startDate: '2026-04-27',
      endDate: '2026-04-20',
    })
    expect(r.success).toBe(false)
    expect(r.error?.issues[0]?.path).toContain('endDate')
  })

  it('allows only startDate without endDate', () => {
    const r = createSprintSchema.safeParse({ startDate: '2026-04-20' })
    expect(r.success).toBe(true)
  })

  it('allows only endDate without startDate', () => {
    const r = createSprintSchema.safeParse({ endDate: '2026-04-27' })
    expect(r.success).toBe(true)
  })
})

describe('updateSprintSchema', () => {
  it('has same validation as createSprintSchema', () => {
    const testCases = [
      { name: 'Sprint Updated' },
      { startDate: '2026-05-01', endDate: '2026-05-08' },
      { startDate: '2026-05-01', endDate: '2026-05-01' }, // should fail
    ]

    testCases.forEach((testCase, _i) => {
      const create = createSprintSchema.safeParse(testCase)
      const update = updateSprintSchema.safeParse(testCase)
      expect(create.success).toBe(update.success)
    })
  })
})

describe('closeSprintSchema', () => {
  it('accepts valid decisions', () => {
    const r = closeSprintSchema.safeParse({
      decisions: { t1: 'moveToNext', t2: 'backToBacklog' },
    })
    expect(r.success).toBe(true)
  })

  it('accepts empty decisions object', () => {
    const r = closeSprintSchema.safeParse({ decisions: {} })
    expect(r.success).toBe(true)
  })

  it('rejects unknown decision values', () => {
    const r = closeSprintSchema.safeParse({
      decisions: { t1: 'wat' },
    })
    expect(r.success).toBe(false)
  })

  it('rejects empty string task IDs', () => {
    const r = closeSprintSchema.safeParse({
      decisions: { '': 'moveToNext' },
    })
    expect(r.success).toBe(false)
  })

  it('requires decisions field', () => {
    const r = closeSprintSchema.safeParse({})
    expect(r.success).toBe(false)
  })

  it('accepts multiple decisions', () => {
    const r = closeSprintSchema.safeParse({
      decisions: {
        task1: 'moveToNext',
        task2: 'moveToNext',
        task3: 'backToBacklog',
      },
    })
    expect(r.success).toBe(true)
  })
})

describe('addTaskToSprintSchema', () => {
  it('accepts valid taskId', () => {
    const r = addTaskToSprintSchema.safeParse({ taskId: 'task-123' })
    expect(r.success).toBe(true)
  })

  it('rejects empty taskId', () => {
    const r = addTaskToSprintSchema.safeParse({ taskId: '' })
    expect(r.success).toBe(false)
  })

  it('requires taskId field', () => {
    const r = addTaskToSprintSchema.safeParse({})
    expect(r.success).toBe(false)
  })
})

describe('cadenceSchema', () => {
  it('accepts null cadenceDays', () => {
    expect(cadenceSchema.safeParse({ cadenceDays: null }).success).toBe(true)
  })

  it('accepts valid cadenceDays (1-90)', () => {
    expect(cadenceSchema.safeParse({ cadenceDays: 1 }).success).toBe(true)
    expect(cadenceSchema.safeParse({ cadenceDays: 14 }).success).toBe(true)
    expect(cadenceSchema.safeParse({ cadenceDays: 90 }).success).toBe(true)
  })

  it('rejects 0', () => {
    expect(cadenceSchema.safeParse({ cadenceDays: 0 }).success).toBe(false)
  })

  it('rejects > 90', () => {
    expect(cadenceSchema.safeParse({ cadenceDays: 91 }).success).toBe(false)
  })

  it('rejects negative numbers', () => {
    expect(cadenceSchema.safeParse({ cadenceDays: -1 }).success).toBe(false)
  })

  it('rejects non-integer numbers', () => {
    expect(cadenceSchema.safeParse({ cadenceDays: 14.5 }).success).toBe(false)
  })

  it('accepts autoPrepare boolean', () => {
    expect(
      cadenceSchema.safeParse({ cadenceDays: 14, autoPrepare: true }).success
    ).toBe(true)
    expect(
      cadenceSchema.safeParse({ cadenceDays: 14, autoPrepare: false }).success
    ).toBe(true)
  })

  it('rejects empty body (cadenceDays is required)', () => {
    expect(cadenceSchema.safeParse({}).success).toBe(false)
  })

  it('accepts cadenceDays with autoPrepare omitted', () => {
    expect(cadenceSchema.safeParse({ cadenceDays: 14 }).success).toBe(true)
  })
})
