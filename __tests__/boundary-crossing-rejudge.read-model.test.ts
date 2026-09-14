/**
 * @jest-environment node
 *
 * LUM-780: the read model folds the BOUNDARY_CROSSING_REJUDGED trail to the
 * LATEST re-judge per crossing; malformed rows are skipped rather than
 * rendered as a fabricated reason.
 */
import { latestRejudgeByCrossing } from '@/lib/services/boundary-crossing.service'

describe('latestRejudgeByCrossing', () => {
  it('keeps the latest trail per crossing and skips malformed rows', () => {
    const map = latestRejudgeByCrossing([
      {
        payload: {
          boundaryCrossingId: 'c1',
          reason: 'RULE_TEXT_PRESENT',
          evidence: 'first',
          criterionVersion: 'lum770-text-presence',
        },
        createdAt: new Date('2026-09-14T01:00:00Z'),
      },
      {
        payload: {
          boundaryCrossingId: 'c1',
          reason: 'RULE_TEXT_PRESENT',
          evidence: 'second',
          criterionVersion: 'lum770-text-presence',
        },
        createdAt: new Date('2026-09-14T02:00:00Z'),
      },
      { payload: { boundaryCrossingId: 'c2' }, createdAt: new Date() }, // no reason
      { payload: null, createdAt: new Date() },
      {
        payload: { boundaryCrossingId: 'c3', reason: 'NO_TEST_FILE_REMOVED' },
        createdAt: new Date('2026-09-14T03:00:00Z'),
      },
    ])
    expect(map.get('c1')).toEqual({
      reason: 'RULE_TEXT_PRESENT',
      evidence: 'second',
      criterionVersion: 'lum770-text-presence',
      at: '2026-09-14T02:00:00.000Z',
    })
    expect(map.has('c2')).toBe(false)
    expect(map.get('c3')).toEqual({
      reason: 'NO_TEST_FILE_REMOVED',
      evidence: '',
      criterionVersion: null,
      at: '2026-09-14T03:00:00.000Z',
    })
  })
})
