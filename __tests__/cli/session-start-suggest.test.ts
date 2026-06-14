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
      '[Lumo] session_id=sess_abc | Detected LUM-42 (from branch name). Run `lumo session attach LUM-42` to bind.'
    )
  })

  it('cites the recent-commit basis when matched from the log', () => {
    const line = formatSuggestLine(SID, {
      identifier: 'LUM-7',
      source: 'commit',
    })
    expect(line).toContain('from recent commits')
    expect(line).toContain('lumo session attach LUM-7')
  })

  it('never claims to have bound the task', () => {
    const line = formatSuggestLine(SID, {
      identifier: 'LUM-1',
      source: 'branch',
    })
    expect(line).not.toContain('auto-bound')
  })
})

describe('resolveSessionStartStdout — suggest, not auto-bind', () => {
  const unboundPrompt = 'No task bound'

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
      '[Lumo] session_id=sess_abc | Detected LUM-42 (from branch name). Run `lumo session attach LUM-42` to bind.',
    ])
  })

  it('falls back to the unbound prompt when git yields no match', () => {
    const lines = resolveSessionStartStdout(
      { sessionId: SID, taskBinding: { bound: false } },
      { extractTask: () => null }
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(unboundPrompt)
    expect(lines[0]).not.toContain('Detected')
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
    expect(lines[0]).toContain('Current task: LUM-9')
    const env = JSON.parse(lines[1]!)
    expect(env.hookSpecificOutput.additionalContext).toBe('mem\n\ntodos')
  })

  it('injects the Tier-1 progress section on the bound path (LUM-500)', () => {
    // The bound path delegates to formatHookStdoutLines, which injects the
    // server-rendered progressSection (replacing the old CLI recovery card)
    // before the memory index, and never runs extractTask.
    const lines = resolveSessionStartStdout(
      {
        sessionId: SID,
        taskBinding: { bound: true, taskIdentifier: 'LUM-146', taskTitle: 'T' },
        progressSection:
          '## Progress so far\ncross-branch carry-over\n\nUnresolved:\n- [ ] ship it',
        memorySection: '## Relevant Memory (index)\n- x',
      },
      {
        extractTask: () => {
          throw new Error('extractTask must not run on the bound path')
        },
      }
    )
    const ctx = JSON.parse(lines[1]!).hookSpecificOutput
      .additionalContext as string
    expect(ctx).toContain('## Progress so far')
    expect(ctx).toContain('cross-branch carry-over')
    expect(ctx).toContain('- [ ] ship it')
    expect(ctx).not.toContain('Resuming previous session')
    expect(ctx.indexOf('Progress so far')).toBeLessThan(
      ctx.indexOf('Relevant Memory')
    )
  })
})
