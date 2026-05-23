/**
 * @jest-environment node
 */

import { formatHookStdoutLines } from '@/cli/src/lib/hook-runner'

describe('formatHookStdoutLines (session-start stdout)', () => {
  it('returns bound message when taskBinding.bound is true', () => {
    const body = {
      sessionId: 'sess_abc',
      taskBinding: {
        bound: true,
        taskIdentifier: 'LUM-12',
        taskTitle: 'Add OAuth',
      },
    }
    const lines = formatHookStdoutLines('session-start', body)
    expect(lines.length).toBeGreaterThanOrEqual(1)
    expect(lines[0]).toBe(
      '[Lumo] session_id=sess_abc | 当前任务: LUM-12 - Add OAuth'
    )
  })

  it('returns unbound message when taskBinding.bound is false', () => {
    const body = {
      sessionId: 'sess_abc',
      taskBinding: { bound: false },
    }
    const lines = formatHookStdoutLines('session-start', body)
    expect(lines.length).toBeGreaterThanOrEqual(1)
    expect(lines[0]).toBe(
      '[Lumo] session_id=sess_abc | 当前未绑定任务。请告诉我你要处理的任务编号（如 LUM-42），或说"跳过"。'
    )
  })

  it('returns [] when body has no taskBinding', () => {
    expect(formatHookStdoutLines('session-start', { ok: true })).toHaveLength(0)
  })

  it('returns [] when body has no sessionId', () => {
    const body = { taskBinding: { bound: false } }
    expect(formatHookStdoutLines('session-start', body)).toHaveLength(0)
  })

  it('returns [] for null/undefined body', () => {
    expect(formatHookStdoutLines('session-start', null)).toHaveLength(0)
    expect(formatHookStdoutLines('session-start', undefined)).toHaveLength(0)
  })
})
