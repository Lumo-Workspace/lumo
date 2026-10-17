/**
 * @jest-environment node
 */
import {
  buildCreateSprintPayload,
  formatCreatedSprintLine,
} from '@/cli/src/commands/sprint-create'

describe('buildCreateSprintPayload', () => {
  it('forwards required dates as-is', () => {
    expect(
      buildCreateSprintPayload({ start: '2026-06-01', end: '2026-06-14' })
    ).toEqual({ startDate: '2026-06-01', endDate: '2026-06-14' })
  })

  it('includes name when provided', () => {
    expect(
      buildCreateSprintPayload({
        start: '2026-06-01',
        end: '2026-06-14',
        name: 'Hotfix sprint',
      })
    ).toEqual({
      startDate: '2026-06-01',
      endDate: '2026-06-14',
      name: 'Hotfix sprint',
    })
  })

  it('omits name when blank', () => {
    expect(
      buildCreateSprintPayload({
        start: '2026-06-01',
        end: '2026-06-14',
        name: '',
      })
    ).toEqual({ startDate: '2026-06-01', endDate: '2026-06-14' })
  })
})

describe('formatCreatedSprintLine', () => {
  it('renders #number + name, no uuid (LUM-1230)', () => {
    expect(
      formatCreatedSprintLine({ id: 'sp-3', number: 3, name: 'Sprint 3' })
    ).toBe('Created sprint #3 "Sprint 3"')
  })
})
