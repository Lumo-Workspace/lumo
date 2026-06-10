/**
 * @jest-environment node
 */

import { formatHookStdoutLines } from '@/cli/src/lib/hook-runner'

describe('hook-runner SessionStart stdout — additionalContext emission', () => {
  it('emits the plain-text bind line plus hookSpecificOutput JSON when memorySection present', () => {
    const responseBody = {
      ok: true,
      sessionId: 's-1',
      taskBinding: {
        bound: true,
        taskIdentifier: 'LUM-42',
        taskTitle: 'Test task',
      },
      memorySection: '## Relevant Memory\n\n### Traps\n- [task] **X** → Y\n',
    }

    const lines = formatHookStdoutLines('session-start', responseBody)

    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('LUM-42')
    expect(lines[0]).toContain('Test task')

    const parsed = JSON.parse(lines[1]!)
    expect(parsed).toEqual({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext:
          '## Relevant Memory\n\n### Traps\n- [task] **X** → Y\n',
      },
    })
  })

  it('emits only the plain-text bind line when memorySection missing', () => {
    const responseBody = {
      ok: true,
      sessionId: 's-1',
      taskBinding: {
        bound: true,
        taskIdentifier: 'LUM-42',
        taskTitle: 'Test task',
      },
    }

    const lines = formatHookStdoutLines('session-start', responseBody)

    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('LUM-42')
  })

  it('emits only the plain-text unbound line when neither binding nor memory', () => {
    const responseBody = {
      ok: true,
      sessionId: 's-1',
      taskBinding: { bound: false },
    }

    const lines = formatHookStdoutLines('session-start', responseBody)

    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('No task bound')
  })

  it('omits hookSpecificOutput when memorySection is empty string', () => {
    const responseBody = {
      ok: true,
      sessionId: 's-1',
      taskBinding: {
        bound: true,
        taskIdentifier: 'LUM-42',
        taskTitle: 'Test task',
      },
      memorySection: '',
    }

    const lines = formatHookStdoutLines('session-start', responseBody)

    expect(lines).toHaveLength(1)
  })

  it('combines memorySection and reviewTodosSection into one additionalContext block', () => {
    const responseBody = {
      ok: true,
      sessionId: 's-1',
      taskBinding: {
        bound: true,
        taskIdentifier: 'LUM-42',
        taskTitle: 'Test task',
      },
      memorySection: '## Relevant Memory\n\n- [task] **X** → Y',
      reviewTodosSection: '## PR review todos\n\n- [ ] `a.ts:1` — fix it',
    }

    const lines = formatHookStdoutLines('session-start', responseBody)

    expect(lines).toHaveLength(2)
    const parsed = JSON.parse(lines[1]!)
    expect(parsed.hookSpecificOutput.additionalContext).toBe(
      '## Relevant Memory\n\n- [task] **X** → Y\n\n## PR review todos\n\n- [ ] `a.ts:1` — fix it'
    )
  })

  it('includes blockerWarningSection in additionalContext, BEFORE the memory section (LUM-172)', () => {
    const responseBody = {
      ok: true,
      sessionId: 's-1',
      taskBinding: {
        bound: true,
        taskIdentifier: 'LUM-42',
        taskTitle: 'Test task',
      },
      blockerWarningSection:
        '## ⚠ Dependency alerts\n- This task is blocked by LUM-7 "Blocker" (status IN_PROGRESS).',
      memorySection: '## Relevant Memory\n\n- [task] **X** → Y',
    }

    const lines = formatHookStdoutLines('session-start', responseBody)

    expect(lines).toHaveLength(2)
    const parsed = JSON.parse(lines[1]!)
    const ctx = parsed.hookSpecificOutput.additionalContext as string
    expect(ctx).toContain(
      '## ⚠ Dependency alerts\n- This task is blocked by LUM-7 "Blocker" (status IN_PROGRESS).'
    )
    expect(ctx).toContain('## Relevant Memory')
    // The warning must come before the memory section so it stays prominent.
    expect(ctx.indexOf('Dependency alerts')).toBeLessThan(ctx.indexOf('Relevant Memory'))
  })

  it('omits an empty blockerWarningSection from additionalContext', () => {
    const responseBody = {
      ok: true,
      sessionId: 's-1',
      taskBinding: {
        bound: true,
        taskIdentifier: 'LUM-42',
        taskTitle: 'Test task',
      },
      blockerWarningSection: '',
      memorySection: '## Relevant Memory\n\n- [task] **X** → Y',
    }

    const lines = formatHookStdoutLines('session-start', responseBody)

    expect(lines).toHaveLength(2)
    const parsed = JSON.parse(lines[1]!)
    expect(parsed.hookSpecificOutput.additionalContext).toBe(
      '## Relevant Memory\n\n- [task] **X** → Y'
    )
  })

  it('emits reviewTodosSection alone as additionalContext when memorySection is empty', () => {
    const responseBody = {
      ok: true,
      sessionId: 's-1',
      taskBinding: {
        bound: true,
        taskIdentifier: 'LUM-42',
        taskTitle: 'Test task',
      },
      memorySection: '',
      reviewTodosSection: '## PR review todos\n\n- [ ] `a.ts:1` — fix it',
    }

    const lines = formatHookStdoutLines('session-start', responseBody)

    expect(lines).toHaveLength(2)
    const parsed = JSON.parse(lines[1]!)
    expect(parsed.hookSpecificOutput.additionalContext).toBe(
      '## PR review todos\n\n- [ ] `a.ts:1` — fix it'
    )
  })
})
