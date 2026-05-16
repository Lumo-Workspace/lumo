/**
 * @jest-environment node
 */

import { formatSessionStartOutput } from '@/cli/src/lib/hook-runner'

describe('formatSessionStartOutput', () => {
  it('returns bound message when taskBinding.bound is true', () => {
    const body = {
      sessionId: 'sess_abc',
      taskBinding: {
        bound: true,
        taskIdentifier: 'LUM-12',
        taskTitle: 'Add OAuth',
      },
    }
    expect(formatSessionStartOutput(body)).toBe(
      '[Lumo] session_id=sess_abc | 当前任务: LUM-12 - Add OAuth'
    )
  })

  it('returns unbound message when taskBinding.bound is false', () => {
    const body = {
      sessionId: 'sess_abc',
      taskBinding: { bound: false },
    }
    expect(formatSessionStartOutput(body)).toBe(
      '[Lumo] session_id=sess_abc | 当前未绑定任务。请告诉我你要处理的任务编号（如 LUM-42），或说"跳过"。'
    )
  })

  it('returns null when body has no taskBinding', () => {
    expect(formatSessionStartOutput({ ok: true })).toBeNull()
  })

  it('returns null when body has no sessionId', () => {
    const body = { taskBinding: { bound: false } }
    expect(formatSessionStartOutput(body)).toBeNull()
  })

  it('returns null for null/undefined body', () => {
    expect(formatSessionStartOutput(null)).toBeNull()
    expect(formatSessionStartOutput(undefined)).toBeNull()
  })
})
