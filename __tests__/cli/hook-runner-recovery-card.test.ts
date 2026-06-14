/**
 * @jest-environment node
 */
import { formatHookStdoutLines } from '@/cli/src/lib/hook-runner'

// LUM-500: the CLI no longer renders its own "Resuming previous session"
// recovery card. The prior-session progress summary is now produced server-side
// as `progressSection` (Tier-1) and injected after the acceptance contract and
// before the memory index. `previousSession` is still sent by the server (it
// drives lineage + metrics) but is no longer rendered by the CLI.

function boundBody(extra: Record<string, unknown>) {
  return {
    ok: true,
    sessionId: 's-1',
    taskBinding: { bound: true, taskIdentifier: 'LUM-146', taskTitle: 'T' },
    ...extra,
  }
}

describe('hook-runner session-start progress wiring (LUM-500)', () => {
  it('injects the server-rendered progressSection between criteria and memory', () => {
    const body = boundBody({
      criteriaSection: '## Acceptance Criteria\n- [ ] do the thing',
      progressSection:
        '## Progress so far\nwired up the service\n\nUnresolved:\n- [ ] finish CLI render',
      memorySection: '## Relevant Memory (index)\n- x',
    })
    const lines = formatHookStdoutLines('session-start', body)
    const ctx = JSON.parse(lines[1]!).hookSpecificOutput
      .additionalContext as string

    expect(ctx).toContain('## Progress so far')
    expect(ctx).toContain('wired up the service')
    expect(ctx).toContain('- [ ] finish CLI render')
    // Tier order: criteria → progress → memory.
    expect(ctx.indexOf('Acceptance Criteria')).toBeLessThan(
      ctx.indexOf('Progress so far')
    )
    expect(ctx.indexOf('Progress so far')).toBeLessThan(
      ctx.indexOf('Relevant Memory')
    )
  })

  it('does NOT render a CLI recovery card from previousSession', () => {
    const body = boundBody({
      // The structured payload is still present, but it must not be rendered as
      // the old "Resuming previous session" card anymore.
      previousSession: {
        headline: 'wired up the service',
        unresolved: ['finish CLI render'],
        durationMs: 23 * 60_000,
        lastActivityAt: '2026-06-01T10:00:00Z',
      },
      memorySection: '## Relevant Memory (index)\n- x',
    })
    const lines = formatHookStdoutLines('session-start', body)
    const ctx = JSON.parse(lines[1]!).hookSpecificOutput
      .additionalContext as string

    expect(ctx).not.toContain('Resuming previous session')
    // Memory is still emitted.
    expect(ctx).toContain('Relevant Memory')
  })

  it('omits the progress block entirely when progressSection is empty', () => {
    const body = boundBody({
      progressSection: '',
      memorySection: '## Relevant Memory (index)\n- x',
    })
    const lines = formatHookStdoutLines('session-start', body)
    const ctx = JSON.parse(lines[1]!).hookSpecificOutput
      .additionalContext as string

    expect(ctx).not.toContain('Progress so far')
    expect(ctx).toContain('Relevant Memory')
  })
})
