/**
 * @jest-environment node
 */

import {
  formatAutoBindLine,
  resolveSessionStartStdout,
} from '@/cli/src/lib/hook-runner'

const SID = 'sess_abc'

describe('formatAutoBindLine', () => {
  it('reports the branch basis and the bound title', () => {
    const line = formatAutoBindLine(
      SID,
      { identifier: 'LUM-42', source: 'branch' },
      { ok: true, taskIdentifier: 'LUM-42', taskTitle: 'Do the thing' }
    )
    expect(line).toContain('session_id=sess_abc')
    expect(line).toContain('已自动绑定 LUM-42 - Do the thing')
    expect(line).toContain('依据分支名')
    expect(line).toContain('回复"不是"')
  })

  it('reports the commit basis', () => {
    const line = formatAutoBindLine(
      SID,
      { identifier: 'LUM-7', source: 'commit' },
      { ok: true, taskIdentifier: 'LUM-7', taskTitle: '' }
    )
    expect(line).toContain('依据最近 commit')
  })

  it('strips control characters from the (untrusted) title', () => {
    const line = formatAutoBindLine(
      SID,
      { identifier: 'LUM-1', source: 'branch' },
      { ok: true, taskIdentifier: 'LUM-1', taskTitle: 'a\x1b[31mb' }
    )
    expect(line).not.toContain('\x1b')
  })
})

describe('resolveSessionStartStdout', () => {
  const unboundPrompt = '当前未绑定任务'

  it('passes through the existing bound formatting (memory + review todos)', async () => {
    const lines = await resolveSessionStartStdout(
      {
        sessionId: SID,
        taskBinding: { bound: true, taskIdentifier: 'LUM-9', taskTitle: 'T' },
        memorySection: 'mem',
        reviewTodosSection: 'todos',
      },
      {
        extractTask: () => {
          throw new Error('should not be called when already bound')
        },
        bindTask: async () => {
          throw new Error('should not bind when already bound')
        },
      }
    )
    expect(lines[0]).toContain('当前任务: LUM-9')
    const env = JSON.parse(lines[1]!)
    expect(env.hookSpecificOutput.additionalContext).toBe('mem\n\ntodos')
  })

  it('auto-binds when git yields a match and the bind succeeds', async () => {
    const bindTask = jest.fn(async () => ({
      ok: true,
      taskIdentifier: 'LUM-42',
      taskTitle: 'Bound',
      memorySection: 'task memory',
    }))
    const lines = await resolveSessionStartStdout(
      { sessionId: SID, taskBinding: { bound: false } },
      { extractTask: () => ({ identifier: 'LUM-42', source: 'branch' }), bindTask }
    )
    expect(bindTask).toHaveBeenCalledWith(SID, 'LUM-42')
    expect(lines[0]).toContain('已自动绑定 LUM-42 - Bound')
    const env = JSON.parse(lines[1]!)
    expect(env.hookSpecificOutput.additionalContext).toBe('task memory')
  })

  it('emits only the bind line when the bind returns no memory', async () => {
    const lines = await resolveSessionStartStdout(
      { sessionId: SID, taskBinding: { bound: false } },
      {
        extractTask: () => ({ identifier: 'LUM-7', source: 'commit' }),
        bindTask: async () => ({ ok: true, taskIdentifier: 'LUM-7', taskTitle: 'X' }),
      }
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('已自动绑定 LUM-7')
  })

  it('falls back to the unbound prompt when the bind fails (e.g. 404)', async () => {
    const lines = await resolveSessionStartStdout(
      { sessionId: SID, taskBinding: { bound: false } },
      {
        extractTask: () => ({ identifier: 'LUM-999', source: 'branch' }),
        bindTask: async () => ({ ok: false }),
      }
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(unboundPrompt)
  })

  it('falls back to the unbound prompt when git yields no match', async () => {
    const bindTask = jest.fn()
    const lines = await resolveSessionStartStdout(
      { sessionId: SID, taskBinding: { bound: false } },
      { extractTask: () => null, bindTask }
    )
    expect(bindTask).not.toHaveBeenCalled()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(unboundPrompt)
  })

  it('returns [] when there is no sessionId', async () => {
    const lines = await resolveSessionStartStdout(
      { taskBinding: { bound: false } },
      { extractTask: () => null, bindTask: async () => ({ ok: false }) }
    )
    expect(lines).toHaveLength(0)
  })

  it('injects the recovery card on the auto-bind path', async () => {
    const lines = await resolveSessionStartStdout(
      { ok: true, sessionId: 'sess_abc', taskBinding: { bound: false } },
      {
        extractTask: () => ({ identifier: 'LUM-146', source: 'branch' }),
        bindTask: async () => ({
          ok: true,
          taskIdentifier: 'LUM-146',
          taskTitle: 'T',
          memorySection: '## Relevant Memory\n- x',
          previousSession: {
            headline: 'cross-branch carry-over',
            unresolved: ['ship it'],
            durationMs: 60_000,
            lastActivityAt: '2026-06-01T10:00:00Z',
          },
        }),
      },
      new Date('2026-06-01T12:00:00Z')
    )

    // lines[0] = auto-bind status line; lines[1] = additionalContext envelope
    const ctx = JSON.parse(lines[1]!).hookSpecificOutput.additionalContext as string
    expect(ctx).toContain('## 续上次进度')
    expect(ctx).toContain('上次干到：cross-branch carry-over')
    expect(ctx).toContain('- ship it')
    expect(ctx.indexOf('续上次进度')).toBeLessThan(ctx.indexOf('Relevant Memory'))
  })
})
