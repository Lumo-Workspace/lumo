/**
 * @jest-environment node
 *
 * LUM-932 P3 I1: a POST_TOOL_USE event recorded without a task and later
 * backfilled by the attribution recompute never met the boundary detector
 * with a task. The replay runs the detector on the STORED payload, bounded
 * and fail-soft.
 */
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: { findForDetectorReplay: jest.fn() },
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: { hookEventIdsWithCrossing: jest.fn() },
}))
jest.mock('@/lib/services/boundary-detector.service', () => ({
  boundaryDetectorService: { detectAndRecord: jest.fn() },
}))
const loggerWarn = jest.fn()
const loggerError = jest.fn()
jest.mock('@/lib/logger', () => ({
  logger: {
    warn: (...a: unknown[]) => loggerWarn(...a),
    error: (...a: unknown[]) => loggerError(...a),
  },
}))

import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { boundaryDetectorService } from '@/lib/services/boundary-detector.service'
import {
  MAX_REPLAYED_EVENTS,
  replayBoundaryDetection,
} from '@/lib/services/boundary-detector-replay.service'

import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
const owned = boundaryCrossingRepository.hookEventIdsWithCrossing as jest.Mock
const find = hookEventRepository.findForDetectorReplay as jest.Mock
const detect = boundaryDetectorService.detectAndRecord as jest.Mock

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  taskId: 'task_12',
  type: 'POST_TOOL_USE',
  toolName: 'Bash',
  filePath: null,
  payload: { tool_input: { command: 'rm -rf /' } },
  payloadPrunedAt: null,
  createdAt: new Date('2026-10-13T00:00:00Z'),
  ...over,
})

beforeEach(() => {
  jest.clearAllMocks()
  detect.mockResolvedValue(undefined)
  owned.mockResolvedValue(new Set())
})

describe('replayBoundaryDetection', () => {
  it('runs the detector on the stored payload with the event current task', async () => {
    find.mockResolvedValue([row('e1')])
    await expect(replayBoundaryDetection('s1', ['e1'])).resolves.toEqual({
      replayed: 1,
      truncated: false,
    })
    expect(find).toHaveBeenCalledWith(['e1'])
    expect(detect).toHaveBeenCalledWith({
      taskId: 'task_12',
      hookEventId: 'e1',
      toolName: 'Bash',
      filePath: null,
      payload: { tool_input: { command: 'rm -rf /' } },
      // LUM-1114: the session and the event's time reach the detector.
      sessionId: 's1',
      occurredAt: new Date('2026-10-13T00:00:00Z'),
    })
  })

  it('skips events no longer on a task, not POST_TOOL_USE, or with a pruned payload', async () => {
    find.mockResolvedValue([
      row('gone', { taskId: null }),
      row('pre', { type: 'PRE_TOOL_USE' }),
      row('pruned', { payload: null, payloadPrunedAt: new Date(0) }),
      row('ok'),
    ])
    await expect(
      replayBoundaryDetection('s1', ['gone', 'pre', 'pruned', 'ok'])
    ).resolves.toEqual({ replayed: 1, truncated: false })
    expect(detect.mock.calls.map(c => c[0].hookEventId)).toEqual(['ok'])
  })

  it(`replays at most ${MAX_REPLAYED_EVENTS} events per recompute and logs the truncation`, async () => {
    const ids = Array.from(
      { length: MAX_REPLAYED_EVENTS + 5 },
      (_, i) => `e${i}`
    )
    find.mockImplementation(async (wanted: string[]) =>
      wanted.map(id => row(id))
    )
    const res = await replayBoundaryDetection('s1', ids)
    expect(res).toEqual({ replayed: MAX_REPLAYED_EVENTS, truncated: true })
    expect(find.mock.calls[0]![0]).toHaveLength(MAX_REPLAYED_EVENTS)
    expect(loggerWarn).toHaveBeenCalledWith(
      'boundary detector replay truncated',
      expect.objectContaining({ sessionId: 's1', skipped: 5 })
    )
  })

  it('is fail-soft: a failing event or load never throws', async () => {
    find.mockResolvedValue([row('a'), row('b')])
    detect.mockRejectedValueOnce(new Error('boom'))
    await expect(replayBoundaryDetection('s1', ['a', 'b'])).resolves.toEqual({
      replayed: 1,
      truncated: false,
    })
    find.mockRejectedValue(new Error('db down'))
    await expect(replayBoundaryDetection('s1', ['a'])).resolves.toEqual({
      replayed: 0,
      truncated: false,
    })
    expect(loggerError).toHaveBeenCalled()
  })

  it('does nothing for no ids', async () => {
    await expect(replayBoundaryDetection('s1', [])).resolves.toEqual({
      replayed: 0,
      truncated: false,
    })
    expect(find).not.toHaveBeenCalled()
  })

  it('skips events that already own a crossing (A -> null -> B, crossing moved to B)', async () => {
    find.mockResolvedValue([row('e1'), row('e2')])
    owned.mockResolvedValue(new Set(['e1']))
    await expect(replayBoundaryDetection('s1', ['e1', 'e2'])).resolves.toEqual({
      replayed: 1,
      truncated: false,
    })
    expect(owned).toHaveBeenCalledTimes(1)
    expect(owned).toHaveBeenCalledWith(['e1', 'e2'])
    expect(detect).toHaveBeenCalledTimes(1)
    expect(detect).toHaveBeenCalledWith(
      expect.objectContaining({ hookEventId: 'e2' })
    )
  })
})
