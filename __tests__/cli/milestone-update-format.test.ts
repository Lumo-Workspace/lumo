/**
 * @jest-environment node
 *
 * LUM-714: `lumo milestone update` lost `--status`. Completion is derived from
 * task completion, so the command is metadata-only — these tests pin that the
 * payload builder can no longer produce a lifecycle field by any route.
 */
import {
  buildMilestoneUpdatePayload,
  formatMilestoneUpdateSummary,
} from '@/cli/src/commands/milestone-update'

describe('buildMilestoneUpdatePayload', () => {
  it('returns empty when nothing is set', () => {
    const { payload, flagsGiven } = buildMilestoneUpdatePayload({})
    expect(payload).toEqual({})
    expect(flagsGiven).toEqual([])
  })

  it('maps name, description, start, target', () => {
    const { payload, flagsGiven } = buildMilestoneUpdatePayload({
      name: 'Q3 v2',
      description: 'updated',
      start: '2026-06-01',
      target: '2026-08-31',
    })
    expect(payload).toEqual({
      name: 'Q3 v2',
      description: 'updated',
      startDate: '2026-06-01',
      targetDate: '2026-08-31',
    })
    expect(flagsGiven).toEqual([
      '--name',
      '--description',
      '--start',
      '--target',
    ])
  })

  it('never emits a status or completedAt field, even if one is passed in', () => {
    // A stale caller (older shell alias, script, or agent) may still pass
    // --status. It must be dropped on the floor, not forwarded to the API.
    const { payload, flagsGiven } = buildMilestoneUpdatePayload({
      name: 'Q3 v2',
      status: 'COMPLETED',
    } as Parameters<typeof buildMilestoneUpdatePayload>[0])
    expect(payload).not.toHaveProperty('status')
    expect(payload).not.toHaveProperty('completedAt')
    expect(flagsGiven).toEqual(['--name'])
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
      { name: 'Q3 Launch', targetDate: null },
      { name: 'Q3 Launch v2', targetDate: '2026-08-31' }
    )
    expect(line).toBe(
      'Updated milestone "Q3 Launch": name "Q3 Launch" → "Q3 Launch v2", target → 2026-08-31'
    )
  })
})
