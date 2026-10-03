/** @jest-environment node */
import { mapTaskRowToInputs } from '@/lib/claim-faithfulness/task-inputs'

describe('mapTaskRowToInputs', () => {
  it('flattens claim and watermark', () => {
    const out = mapTaskRowToInputs({
      team: { identifier: 'LUM', workspaceId: 'ws1' },
      number: 540,
      claimSnapshot: 'did not include code changes',
      claimSnapshotAt: new Date('2026-01-01'),
      claimSnapshotSessionId: 'sess-1',
    })
    expect(out.identifier).toBe('LUM-540')
    expect(out.claim).toBe('did not include code changes')
    expect(out.claimSnapshotSessionId).toBe('sess-1')
    expect(out.workspaceId).toBe('ws1')
  })

  it('tolerates a null claim', () => {
    const out = mapTaskRowToInputs({
      team: { identifier: 'LUM', workspaceId: 'ws1' },
      number: 1,
      claimSnapshot: null,
      claimSnapshotAt: null,
      claimSnapshotSessionId: null,
    })
    expect(out.claim).toBeNull()
    expect(out.claimSnapshotSessionId).toBeNull()
  })
})
