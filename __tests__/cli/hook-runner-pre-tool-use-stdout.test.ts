/**
 * @jest-environment node
 */

import { formatHookStdoutLines } from '@/cli/src/lib/hook-runner'

describe('formatHookStdoutLines (pre-tool-use collision warning)', () => {
  it('emits a PreToolUse additionalContext envelope when a collisionWarning is present', () => {
    const warning =
      '⚠️ Lumo parallel-edit warning: another session Codex (3 minutes ago) also recently edited `app/a.ts`.'
    const lines = formatHookStdoutLines('pre-tool-use', {
      collisionWarning: warning,
    })
    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0]!)
    expect(parsed).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: warning,
      },
    })
  })

  it('returns [] when there is no collisionWarning', () => {
    expect(formatHookStdoutLines('pre-tool-use', { ok: true })).toHaveLength(0)
  })

  it('returns [] when collisionWarning is an empty string', () => {
    expect(
      formatHookStdoutLines('pre-tool-use', { collisionWarning: '' })
    ).toHaveLength(0)
  })

  it('returns [] for null/undefined/non-object body', () => {
    expect(formatHookStdoutLines('pre-tool-use', null)).toHaveLength(0)
    expect(formatHookStdoutLines('pre-tool-use', undefined)).toHaveLength(0)
    expect(formatHookStdoutLines('pre-tool-use', 'nope')).toHaveLength(0)
  })

  it('strips control characters from the (untrusted) warning before emitting', () => {
    const lines = formatHookStdoutLines('pre-tool-use', {
      collisionWarning: 'edit \x1b[31mapp/a.ts\x1b[0m now',
    })
    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0]!)
    expect(parsed.hookSpecificOutput.additionalContext).not.toContain('\x1b')
  })
})
