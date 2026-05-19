/**
 * @jest-environment node
 */
jest.mock('@/cli/src/lib/session-binding', () => ({
  readSessionBinding: jest.fn(),
}))

import { readSessionBinding } from '@/cli/src/lib/session-binding'
import { injectTaskId } from '@/cli/src/lib/hook-runner'

const mockRead = readSessionBinding as jest.Mock

const sample = {
  taskId: 'cmoc_abc',
  taskIdentifier: 'LUM-40',
  taskTitle: 'x',
  workspaceSlug: 'lumo',
  startedAt: '2026-05-19T12:00:00.000Z',
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('injectTaskId', () => {
  it('injects task_id when the per-session binding exists', () => {
    mockRead.mockReturnValue(sample)
    const out = injectTaskId(
      '{"session_id":"S1","cwd":"/r"}',
      'pre-tool-use',
      'S1'
    )
    expect(mockRead).toHaveBeenCalledWith('S1')
    expect(JSON.parse(out)).toEqual({
      session_id: 'S1',
      cwd: '/r',
      task_id: 'cmoc_abc',
    })
  })

  it('returns body unchanged when no per-session binding exists', () => {
    mockRead.mockReturnValue(null)
    const body = '{"session_id":"S1"}'
    expect(injectTaskId(body, 'pre-tool-use', 'S1')).toBe(body)
  })

  it('does not inject for session-start even if a binding exists', () => {
    mockRead.mockReturnValue(sample)
    const body = '{"session_id":"S1"}'
    expect(injectTaskId(body, 'session-start', 'S1')).toBe(body)
    expect(mockRead).not.toHaveBeenCalled()
  })

  it('does not inject when sessionId is null', () => {
    mockRead.mockReturnValue(sample)
    const body = '{"cwd":"/r"}'
    expect(injectTaskId(body, 'pre-tool-use', null)).toBe(body)
    expect(mockRead).not.toHaveBeenCalled()
  })

  it('falls back to "{}" when body is empty and sessionId is null', () => {
    mockRead.mockReturnValue(null)
    expect(injectTaskId('', 'pre-tool-use', null)).toBe('{}')
  })

  it('synthesizes a minimal body when stdin is empty but a binding exists', () => {
    mockRead.mockReturnValue(sample)
    expect(JSON.parse(injectTaskId('', 'pre-tool-use', 'S1'))).toEqual({
      task_id: 'cmoc_abc',
    })
  })

  it('passes through malformed JSON bodies without injecting', () => {
    mockRead.mockReturnValue(sample)
    const body = '{not json'
    expect(injectTaskId(body, 'pre-tool-use', 'S1')).toBe(body)
  })

  it('does not inject into non-object JSON (arrays, scalars)', () => {
    mockRead.mockReturnValue(sample)
    expect(injectTaskId('[1,2,3]', 'pre-tool-use', 'S1')).toBe('[1,2,3]')
    expect(injectTaskId('"hi"', 'pre-tool-use', 'S1')).toBe('"hi"')
  })

  it('overrides a stale task_id already present in the payload', () => {
    mockRead.mockReturnValue(sample)
    const out = injectTaskId('{"task_id":"stale"}', 'pre-tool-use', 'S1')
    expect(JSON.parse(out)).toEqual({ task_id: 'cmoc_abc' })
  })

  it('keeps per-sessionId lookups isolated', () => {
    mockRead.mockImplementation((sid: string) =>
      sid === 'S1'
        ? { ...sample, taskId: 'task_for_S1' }
        : sid === 'S2'
          ? { ...sample, taskId: 'task_for_S2' }
          : null
    )
    expect(
      JSON.parse(injectTaskId('{"session_id":"S1"}', 'pre-tool-use', 'S1'))
        .task_id
    ).toBe('task_for_S1')
    expect(
      JSON.parse(injectTaskId('{"session_id":"S2"}', 'pre-tool-use', 'S2'))
        .task_id
    ).toBe('task_for_S2')
  })
})
