/** @jest-environment node */
const handleHookRequest = jest.fn()
jest.mock('@/app/api/hooks/_handler', () => ({
  handleHookRequest: (...a: unknown[]) => handleHookRequest(...a),
}))
jest.mock('@vercel/functions', () => ({
  waitUntil: (p: Promise<unknown>) => p,
}))
jest.mock('@/lib/attribution/trigger', () => ({
  recomputeAttributionSafely: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/services/memory/layer1.service', () => ({
  layer1Service: { triggerLayer1Extraction: jest.fn() },
}))
jest.mock('@/lib/services/turn-summary/turn-summary.service', () => ({
  turnSummaryService: { generateAndStore: jest.fn() },
}))
jest.mock('@/lib/services/auto-block.service', () => ({
  autoBlockService: { onProgressRecorded: jest.fn() },
}))

import { recomputeAttributionSafely } from '@/lib/attribution/trigger'
import { POST as stopPost } from '@/app/api/hooks/stop/route'
import { POST as subagentStopPost } from '@/app/api/hooks/subagent-stop/route'

type AfterRecord = (ctx: Record<string, unknown>) => void
const afterRecordOf = (): AfterRecord =>
  (handleHookRequest.mock.calls[0][2] as { afterRecord: AfterRecord })
    .afterRecord

beforeEach(() => {
  jest.clearAllMocks()
  handleHookRequest.mockResolvedValue(new Response(null))
})

describe('hook routes trigger attribution recompute (LUM-932)', () => {
  it('STOP recomputes for the session', async () => {
    await stopPost(new Request('http://x'))
    expect(handleHookRequest.mock.calls[0][1]).toBe('STOP')
    afterRecordOf()({ sessionId: 's-1', taskId: null, eventId: 'e1' })
    expect(recomputeAttributionSafely).toHaveBeenCalledWith('s-1')
  })

  it('STOP skips recompute without a session id', async () => {
    await stopPost(new Request('http://x'))
    afterRecordOf()({ sessionId: null, taskId: null, eventId: 'e1' })
    expect(recomputeAttributionSafely).not.toHaveBeenCalled()
  })

  it('SUBAGENT_STOP recomputes for the child session id', async () => {
    await subagentStopPost(new Request('http://x'))
    expect(handleHookRequest.mock.calls[0][1]).toBe('SUBAGENT_STOP')
    afterRecordOf()({ sessionId: 'child-1' })
    expect(recomputeAttributionSafely).toHaveBeenCalledWith('child-1')
  })
})
