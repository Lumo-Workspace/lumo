/**
 * @jest-environment node
 */
import {
  buildSprintUpdatePayload,
  formatSprintUpdateSummary,
} from '@/cli/src/commands/sprint-update'

describe('buildSprintUpdatePayload', () => {
  it('returns empty payload and no flags when nothing is set', () => {
    const { payload, flagsGiven } = buildSprintUpdatePayload({})
    expect(payload).toEqual({})
    expect(flagsGiven).toEqual([])
  })

  it('maps name, start, end to payload fields', () => {
    const { payload, flagsGiven } = buildSprintUpdatePayload({
      name: 'Sprint 5',
      start: '2026-06-01',
      end: '2026-06-14',
    })
    expect(payload).toEqual({
      name: 'Sprint 5',
      startDate: '2026-06-01',
      endDate: '2026-06-14',
    })
    expect(flagsGiven).toEqual(['--name', '--start', '--end'])
  })

  it('includes name when only name is set', () => {
    const { payload, flagsGiven } = buildSprintUpdatePayload({ name: 'Alpha' })
    expect(payload).toEqual({ name: 'Alpha' })
    expect(flagsGiven).toEqual(['--name'])
  })

  it('includes startDate when only start is set', () => {
    const { payload, flagsGiven } = buildSprintUpdatePayload({
      start: '2026-07-01',
    })
    expect(payload).toEqual({ startDate: '2026-07-01' })
    expect(flagsGiven).toEqual(['--start'])
  })

  it('includes endDate when only end is set', () => {
    const { payload, flagsGiven } = buildSprintUpdatePayload({
      end: '2026-07-31',
    })
    expect(payload).toEqual({ endDate: '2026-07-31' })
    expect(flagsGiven).toEqual(['--end'])
  })
})

describe('formatSprintUpdateSummary', () => {
  it('shows name change when name differs', () => {
    const line = formatSprintUpdateSummary(
      { number: 3, name: 'Sprint 3' },
      { name: 'Sprint 3 — Extended' }
    )
    expect(line).toBe(
      'Updated sprint #3 "Sprint 3": name "Sprint 3" → "Sprint 3 — Extended"'
    )
  })

  it('shows date updates', () => {
    const line = formatSprintUpdateSummary(
      { number: 3, name: 'Sprint 3', startDate: '2026-06-01', endDate: '2026-06-14' },
      { startDate: '2026-06-08', endDate: '2026-06-21' }
    )
    expect(line).toBe(
      'Updated sprint #3 "Sprint 3": start → 2026-06-08, end → 2026-06-21'
    )
  })

  it('shows only changed fields', () => {
    const line = formatSprintUpdateSummary(
      { number: 5, name: 'Sprint 5' },
      { endDate: '2026-08-31' }
    )
    expect(line).toBe('Updated sprint #5 "Sprint 5": end → 2026-08-31')
  })

  it('suppresses name line when name is unchanged', () => {
    const line = formatSprintUpdateSummary(
      { number: 2, name: 'Sprint 2' },
      { name: 'Sprint 2', startDate: '2026-05-01' }
    )
    expect(line).toBe('Updated sprint #2 "Sprint 2": start → 2026-05-01')
  })
})
