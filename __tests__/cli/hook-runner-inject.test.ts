/**
 * @jest-environment node
 */
jest.mock('@/cli/src/lib/current-task', () => ({
  readCurrentTask: jest.fn(),
}))

import { readCurrentTask } from '@/cli/src/lib/current-task'
import { injectCurrentTaskId } from '@/cli/src/lib/hook-runner'

const mockRead = readCurrentTask as jest.Mock

const sample = {
  taskId: 'cmoc_abc',
  taskIdentifier: 'LUM-30',
  taskTitle: 'x',
  workspaceSlug: 'lumo',
  startedAt: '2026-04-24T12:00:00.000Z',
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('injectCurrentTaskId', () => {
  it('merges task_id into a valid JSON body when current-task is set', () => {
    mockRead.mockReturnValue(sample)
    const out = injectCurrentTaskId('{"session_id":"s","cwd":"/r"}')
    expect(JSON.parse(out)).toEqual({
      session_id: 's',
      cwd: '/r',
      task_id: 'cmoc_abc',
    })
  })

  it('returns body unchanged when no current-task is set', () => {
    mockRead.mockReturnValue(null)
    const body = '{"session_id":"s"}'
    expect(injectCurrentTaskId(body)).toBe(body)
  })

  it('synthesizes a minimal body when stdin was empty but a current-task exists', () => {
    mockRead.mockReturnValue(sample)
    expect(JSON.parse(injectCurrentTaskId(''))).toEqual({ task_id: 'cmoc_abc' })
  })

  it('falls back to "{}" when stdin is empty and no current-task is set', () => {
    mockRead.mockReturnValue(null)
    expect(injectCurrentTaskId('')).toBe('{}')
  })

  it('passes through malformed JSON bodies without attempting to inject', () => {
    mockRead.mockReturnValue(sample)
    const body = '{not json'
    expect(injectCurrentTaskId(body)).toBe(body)
  })

  it('does not inject into non-object JSON (arrays, scalars)', () => {
    mockRead.mockReturnValue(sample)
    expect(injectCurrentTaskId('[1,2,3]')).toBe('[1,2,3]')
    expect(injectCurrentTaskId('"hi"')).toBe('"hi"')
  })

  it('overrides a stale task_id already present in the payload', () => {
    mockRead.mockReturnValue(sample)
    const out = injectCurrentTaskId('{"task_id":"stale"}')
    expect(JSON.parse(out)).toEqual({ task_id: 'cmoc_abc' })
  })
})
