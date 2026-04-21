import {
  createSprintSchema,
  updateSprintSchema,
  closeSprintSchema,
  addTaskToSprintSchema,
  cadenceSchema,
} from '@/lib/validation/sprint.schema'

describe('createSprintSchema', () => {
  it('rejects when startDate or endDate is missing', () => {
    expect(createSprintSchema.safeParse({}).success).toBe(false)
    expect(
      createSprintSchema.safeParse({ startDate: '2026-04-20' }).success
    ).toBe(false)
    expect(
      createSprintSchema.safeParse({ endDate: '2026-04-27' }).success
    ).toBe(false)
  })

  it('accepts a name when both dates are present', () => {
    const r = createSprintSchema.safeParse({
      name: 'Sprint 1',
      startDate: '2026-04-20',
      endDate: '2026-04-27',
    })
    expect(r.success).toBe(true)
    expect(r.data?.name).toBe('Sprint 1')
  })

  it('trims whitespace from name', () => {
    const r = createSprintSchema.safeParse({
      name: '  Sprint 1  ',
      startDate: '2026-04-20',
      endDate: '2026-04-27',
    })
    expect(r.success).toBe(true)
    expect(r.data?.name).toBe('Sprint 1')
  })

  it('rejects empty name', () => {
    const r = createSprintSchema.safeParse({
      name: '',
      startDate: '2026-04-20',
      endDate: '2026-04-27',
    })
    expect(r.success).toBe(false)
  })

  it('rejects name > 120 chars', () => {
    const r = createSprintSchema.safeParse({
      name: 'a'.repeat(121),
      startDate: '2026-04-20',
      endDate: '2026-04-27',
    })
    expect(r.success).toBe(false)
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
})

describe('updateSprintSchema', () => {
  it('still allows partial updates (no required fields)', () => {
    expect(
      updateSprintSchema.safeParse({ name: 'Sprint Updated' }).success
    ).toBe(true)
    expect(
      updateSprintSchema.safeParse({
        startDate: '2026-05-01',
        endDate: '2026-05-08',
      }).success
    ).toBe(true)
    expect(
      updateSprintSchema.safeParse({
        startDate: '2026-05-01',
        endDate: '2026-05-01',
      }).success
    ).toBe(false)
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
  it('accepts enabled true/false', () => {
    expect(cadenceSchema.safeParse({ enabled: true }).success).toBe(true)
    expect(cadenceSchema.safeParse({ enabled: false }).success).toBe(true)
  })

  it('rejects non-boolean enabled', () => {
    expect(cadenceSchema.safeParse({ enabled: 'yes' }).success).toBe(false)
  })

  it('rejects empty body', () => {
    expect(cadenceSchema.safeParse({}).success).toBe(false)
  })

  it('accepts full cadence config', () => {
    const r = cadenceSchema.safeParse({
      enabled: true,
      durationDays: 14,
      cooldownDays: 7,
      startWeekday: 1,
      autoCreate: 2,
    })
    expect(r.success).toBe(true)
  })

  it('rejects durationDays outside the allowed set', () => {
    expect(
      cadenceSchema.safeParse({ enabled: true, durationDays: 10 }).success
    ).toBe(false)
    expect(
      cadenceSchema.safeParse({ enabled: true, durationDays: 0 }).success
    ).toBe(false)
  })

  it('rejects cooldownDays outside {0, 7}', () => {
    // Only 0 (back-to-back) and 7 (1-week gap) are valid — keeps startDate
    // aligned to `startWeekday`.
    expect(
      cadenceSchema.safeParse({ enabled: true, cooldownDays: 0 }).success
    ).toBe(true)
    expect(
      cadenceSchema.safeParse({ enabled: true, cooldownDays: 7 }).success
    ).toBe(true)
    for (const bad of [1, 2, 3, 4, -1, 14]) {
      expect(
        cadenceSchema.safeParse({ enabled: true, cooldownDays: bad }).success
      ).toBe(false)
    }
  })

  it('rejects startWeekday out of 0..6', () => {
    expect(
      cadenceSchema.safeParse({ enabled: true, startWeekday: 7 }).success
    ).toBe(false)
    expect(
      cadenceSchema.safeParse({ enabled: true, startWeekday: -1 }).success
    ).toBe(false)
  })

  it('rejects autoCreate out of 0..4', () => {
    expect(
      cadenceSchema.safeParse({ enabled: true, autoCreate: 5 }).success
    ).toBe(false)
    expect(
      cadenceSchema.safeParse({ enabled: true, autoCreate: -1 }).success
    ).toBe(false)
  })
})
