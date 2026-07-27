/**
 * @jest-environment node
 */

import { formatHookStdoutLines } from '@/cli/src/lib/hook-runner'

const BOUND_BODY = {
  sessionId: 'sess_abc',
  taskBinding: {
    bound: true,
    taskIdentifier: 'LUM-12',
    taskTitle: 'Add OAuth',
  },
}

function envelopeContext(lines: string[]): string {
  const envelope = lines.find(l => l.startsWith('{'))
  expect(envelope).toBeDefined()
  const parsed = JSON.parse(envelope!) as {
    hookSpecificOutput: { additionalContext: string }
  }
  return parsed.hookSpecificOutput.additionalContext
}

describe('formatHookStdoutLines (session-start criteriaSection, LUM-342)', () => {
  it('injects the contract ahead of memory in the additionalContext envelope', () => {
    const lines = formatHookStdoutLines('session-start', {
      ...BOUND_BODY,
      criteriaSection:
        '## Acceptance criteria (contract)\n\n- [MACHINE] tests pass',
      memorySection: '## Relevant Memory\n\n- m',
    })
    const ctx = envelopeContext(lines)
    expect(ctx).toContain('- [MACHINE] tests pass')
    expect(ctx.indexOf('Acceptance criteria')).toBeLessThan(
      ctx.indexOf('Relevant Memory')
    )
  })

  it('emits no envelope when all sections are empty', () => {
    const lines = formatHookStdoutLines('session-start', {
      ...BOUND_BODY,
      criteriaSection: '',
      memorySection: '',
    })
    expect(lines.find(l => l.startsWith('{'))).toBeUndefined()
  })
})
