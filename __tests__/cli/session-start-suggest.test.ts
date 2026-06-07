/**
 * @jest-environment node
 */

import {
  formatSuggestLine,
  resolveSessionStartStdout,
} from '@/cli/src/lib/hook-runner'

const SID = 'sess_abc'

describe('formatSuggestLine', () => {
  it('points at `lumo session attach` and cites the branch basis', () => {
    const line = formatSuggestLine(SID, {
      identifier: 'LUM-42',
      source: 'branch',
    })
    expect(line).toBe(
      '[Lumo] session_id=sess_abc | 检测到 LUM-42（依据分支名）。运行 lumo session attach LUM-42 绑定。'
    )
  })

  it('cites the recent-commit basis when matched from the log', () => {
    const line = formatSuggestLine(SID, {
      identifier: 'LUM-7',
      source: 'commit',
    })
    expect(line).toContain('依据最近 commit')
    expect(line).toContain('lumo session attach LUM-7')
  })

  it('never claims to have bound the task', () => {
    const line = formatSuggestLine(SID, {
      identifier: 'LUM-1',
      source: 'branch',
    })
    expect(line).not.toContain('已自动绑定')
  })
})

describe('resolveSessionStartStdout — suggest, not auto-bind', () => {
  const unboundPrompt = '当前未绑定任务'

  it('suggests `session attach` (and does NOT bind) on a git match', () => {
    const extractTask = jest.fn(() => ({
      identifier: 'LUM-42' as const,
      source: 'branch' as const,
    }))
    const lines = resolveSessionStartStdout(
      { sessionId: SID, taskBinding: { bound: false } },
      { extractTask }
    )
    expect(extractTask).toHaveBeenCalledTimes(1)
    // Exactly one line — the suggestion. Nothing was fetched, so there is no
    // title and no injected-context envelope until the user actually attaches.
    expect(lines).toEqual([
      '[Lumo] session_id=sess_abc | 检测到 LUM-42（依据分支名）。运行 lumo session attach LUM-42 绑定。',
    ])
  })

  it('falls back to the unbound prompt when git yields no match', () => {
    const lines = resolveSessionStartStdout(
      { sessionId: SID, taskBinding: { bound: false } },
      { extractTask: () => null }
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(unboundPrompt)
    expect(lines[0]).not.toContain('检测到')
  })

  it('returns [] when there is no sessionId', () => {
    const lines = resolveSessionStartStdout(
      { taskBinding: { bound: false } },
      { extractTask: () => null }
    )
    expect(lines).toHaveLength(0)
  })

  it('passes through the bound formatting (status + memory + review todos) and never inspects git', () => {
    const lines = resolveSessionStartStdout(
      {
        sessionId: SID,
        taskBinding: { bound: true, taskIdentifier: 'LUM-9', taskTitle: 'T' },
        memorySection: 'mem',
        reviewTodosSection: 'todos',
      },
      {
        extractTask: () => {
          throw new Error('extractTask must not run on the bound path')
        },
      }
    )
    expect(lines[0]).toContain('当前任务: LUM-9')
    const env = JSON.parse(lines[1]!)
    expect(env.hookSpecificOutput.additionalContext).toBe('mem\n\ntodos')
  })

  it('still injects the recovery card on the bound path (LUM-146 survives)', () => {
    const lines = resolveSessionStartStdout(
      {
        sessionId: SID,
        taskBinding: { bound: true, taskIdentifier: 'LUM-146', taskTitle: 'T' },
        memorySection: '## Relevant Memory\n- x',
        previousSession: {
          headline: 'cross-branch carry-over',
          unresolved: ['ship it'],
          durationMs: 60_000,
          lastActivityAt: '2026-06-01T10:00:00Z',
        },
      },
      {
        extractTask: () => {
          throw new Error('extractTask must not run on the bound path')
        },
      },
      new Date('2026-06-01T12:00:00Z')
    )
    const ctx = JSON.parse(lines[1]!).hookSpecificOutput
      .additionalContext as string
    expect(ctx).toContain('## 续上次进度')
    expect(ctx).toContain('上次干到：cross-branch carry-over')
    expect(ctx).toContain('- ship it')
    expect(ctx.indexOf('续上次进度')).toBeLessThan(
      ctx.indexOf('Relevant Memory')
    )
  })
})
