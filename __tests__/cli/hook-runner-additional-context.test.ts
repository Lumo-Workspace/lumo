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
    expect(lines[0]).toContain('未绑定任务')
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
})
