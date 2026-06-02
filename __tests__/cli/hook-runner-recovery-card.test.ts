/**
 * @jest-environment node
 */
import { formatHookStdoutLines } from '@/cli/src/lib/hook-runner'

const NOW = new Date('2026-06-01T12:00:00Z')

function boundBody(previousSession: unknown) {
  return {
    ok: true,
    sessionId: 's-1',
    taskBinding: { bound: true, taskIdentifier: 'LUM-146', taskTitle: 'T' },
    previousSession,
  }
}

describe('hook-runner recovery card (formatHookStdoutLines, session-start)', () => {
  it('renders the card first in additionalContext, before memorySection', () => {
    const body = {
      ...boundBody({
        headline: 'wired up the service',
        unresolved: ['finish CLI render', 'add tests'],
        durationMs: 23 * 60_000,
        lastActivityAt: '2026-06-01T10:00:00Z',
      }),
      memorySection: '## Relevant Memory\n- x',
    }
    const lines = formatHookStdoutLines('session-start', body, NOW)
    const ctx = JSON.parse(lines[1]!).hookSpecificOutput.additionalContext as string

    expect(ctx).toContain('## 续上次进度 (上一段 session · 2h ago · 23min)')
    expect(ctx).toContain('上次干到：wired up the service')
    expect(ctx).toContain('- finish CLI render')
    expect(ctx).toContain('- add tests')
    expect(ctx.indexOf('续上次进度')).toBeLessThan(ctx.indexOf('Relevant Memory'))
  })

  it('omits the "未完成" block when unresolved is empty', () => {
    const lines = formatHookStdoutLines(
      'session-start',
      boundBody({
        headline: 'just headline',
        unresolved: [],
        durationMs: 60_000,
        lastActivityAt: '2026-06-01T11:59:30Z',
      }),
      NOW
    )
    const ctx = JSON.parse(lines[1]!).hookSpecificOutput.additionalContext as string
    expect(ctx).toContain('## 续上次进度 (上一段 session · just now · 1min)')
    expect(ctx).not.toContain('未完成：')
  })

  it('caps unresolved at 5 and appends a "+M more" pointer', () => {
    const lines = formatHookStdoutLines(
      'session-start',
      boundBody({
        headline: 'h',
        unresolved: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
        durationMs: 60_000,
        lastActivityAt: '2026-06-01T11:00:00Z',
      }),
      NOW
    )
    const ctx = JSON.parse(lines[1]!).hookSpecificOutput.additionalContext as string
    expect(ctx).toContain('- e')
    expect(ctx).not.toContain('- f')
    expect(ctx).toContain('…(+2 more, 跑 lumo task context LUM-146 查看全部)')
  })

  it('sanitizes ANSI/control chars in headline and unresolved', () => {
    const lines = formatHookStdoutLines(
      'session-start',
      boundBody({
        headline: 'evil\x1b[31mred',
        unresolved: ['bad\x07bell'],
        durationMs: 60_000,
        lastActivityAt: '2026-06-01T11:00:00Z',
      }),
      NOW
    )
    const ctx = JSON.parse(lines[1]!).hookSpecificOutput.additionalContext as string
    expect(ctx).not.toContain('\x1b')
    expect(ctx).not.toContain('\x07')
  })

  it('injects no card when previousSession is null (memory still emitted)', () => {
    const body = { ...boundBody(null), memorySection: '## Relevant Memory\n- x' }
    const lines = formatHookStdoutLines('session-start', body, NOW)
    const ctx = JSON.parse(lines[1]!).hookSpecificOutput.additionalContext as string
    expect(ctx).not.toContain('续上次进度')
    expect(ctx).toContain('Relevant Memory')
  })
})
