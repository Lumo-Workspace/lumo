/**
 * @jest-environment node
 */
import {
  buildCreatePayload,
  formatCreatedMilestoneLine,
} from '@/cli/src/commands/milestone-create'

describe('buildCreatePayload', () => {
  it('keeps only provided optional fields', () => {
    expect(buildCreatePayload('Q3 Launch', {})).toEqual({ name: 'Q3 Launch' })
  })

  it('forwards description and dates as ISO date strings', () => {
    expect(
      buildCreatePayload('Q3 Launch', {
        description: 'rollout',
        start: '2026-06-01',
        target: '2026-08-31',
      })
    ).toEqual({
      name: 'Q3 Launch',
      description: 'rollout',
      startDate: '2026-06-01',
      targetDate: '2026-08-31',
    })
  })
})

describe('formatCreatedMilestoneLine', () => {
  it('renders id + name', () => {
    expect(formatCreatedMilestoneLine({ id: 'm-1', name: 'Q3 Launch' })).toBe(
      'Created milestone "Q3 Launch"  m-1'
    )
  })
})
