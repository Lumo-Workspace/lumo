/**
 * @jest-environment node
 */
import {
  buildMilestoneUpdatePayload,
  formatMilestoneUpdateSummary,
  normalizeMilestoneStatus,
} from '@/cli/src/commands/milestone-update'

describe('normalizeMilestoneStatus', () => {
  it('uppercases canonical values', () => {
    expect(normalizeMilestoneStatus('planned')).toBe('PLANNED')
    expect(normalizeMilestoneStatus('active')).toBe('ACTIVE')
    expect(normalizeMilestoneStatus('COMPLETED')).toBe('COMPLETED')
    expect(normalizeMilestoneStatus('cancelled')).toBe('CANCELLED')
  })

  it('returns null for unknown values', () => {
    expect(normalizeMilestoneStatus('done')).toBeNull()
    expect(normalizeMilestoneStatus('')).toBeNull()
  })
})

describe('buildMilestoneUpdatePayload', () => {
  it('returns empty when nothing is set', () => {
    const { payload, flagsGiven } = buildMilestoneUpdatePayload({})
    expect(payload).toEqual({})
    expect(flagsGiven).toEqual([])
  })

  it('maps name, description, status, start, target', () => {
    const { payload, flagsGiven } = buildMilestoneUpdatePayload({
      name: 'Q3 v2',
      description: 'updated',
      status: 'ACTIVE',
      start: '2026-06-01',
      target: '2026-08-31',
    })
    expect(payload).toEqual({
      name: 'Q3 v2',
      description: 'updated',
      status: 'ACTIVE',
      startDate: '2026-06-01',
      targetDate: '2026-08-31',
    })
    expect(flagsGiven).toEqual([
      '--name',
      '--description',
      '--status',
      '--start',
      '--target',
    ])
  })

  it('treats empty string as clear for nullable fields', () => {
    const { payload } = buildMilestoneUpdatePayload({
      description: '',
      start: '',
      target: '',
    })
    expect(payload).toEqual({
      description: null,
      startDate: null,
      targetDate: null,
    })
  })
})

describe('formatMilestoneUpdateSummary', () => {
  it('lists changed fields in flag order', () => {
    const line = formatMilestoneUpdateSummary(
      { name: 'Q3 Launch', status: 'PLANNED', targetDate: null },
      { status: 'ACTIVE', targetDate: '2026-08-31' }
    )
    expect(line).toBe(
      'Updated milestone "Q3 Launch": status PLANNED → ACTIVE, target → 2026-08-31'
    )
  })
})
