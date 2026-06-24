/** @jest-environment node */
import { mapTaskRowToInputs } from '@/lib/claim-faithfulness/task-inputs'

describe('mapTaskRowToInputs', () => {
  it('flattens claim, watermark, and criterion statements', () => {
    const out = mapTaskRowToInputs({
      team: 'LUM',
      number: 540,
      claimSnapshot: 'did not include code changes',
      claimSnapshotAt: new Date('2026-01-01'),
      acceptanceCriteria: [
        { statement: 'memory retire loop ships' },
        { statement: 'human review surface renders' },
      ],
    })
    expect(out.identifier).toBe('LUM-540')
    expect(out.claim).toBe('did not include code changes')
    expect(out.criteria).toEqual([
      'memory retire loop ships',
      'human review surface renders',
    ])
  })

  it('tolerates a null claim and empty criteria', () => {
    const out = mapTaskRowToInputs({
      team: 'LUM',
      number: 1,
      claimSnapshot: null,
      claimSnapshotAt: null,
      acceptanceCriteria: [],
    })
    expect(out.claim).toBeNull()
    expect(out.criteria).toEqual([])
  })
})
