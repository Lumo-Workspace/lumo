/**
 * @jest-environment node
 *
 * LUM-1234 — local Claude Code transcripts as reward-hack `RhEvent`s
 * (the dogfood calibration's input). Fixtures are hand-written, fake strings.
 */
import {
  TOOL_RESPONSE_MAX_CHARS,
  clipToolResponse,
  genuinePromptText,
  parseClaudeTranscript,
  taskOfBranch,
  transcriptSessionId,
} from '@/scripts/analysis/lum1234-trace/claude-transcript'

const BRANCH = 'lumo/LUM-77-fix-widget'
let clock = 0
const ts = () => new Date(Date.UTC(2026, 9, 10, 10, 0, clock++)).toISOString()

function user(uuid: string, content: unknown, extra: object = {}) {
  return {
    type: 'user',
    uuid,
    sessionId: 's1',
    timestamp: ts(),
    gitBranch: BRANCH,
    isSidechain: false,
    message: { role: 'user', content },
    ...extra,
  }
}
function assistant(uuid: string, content: unknown[], extra: object = {}) {
  return {
    type: 'assistant',
    uuid,
    sessionId: 's1',
    timestamp: ts(),
    gitBranch: BRANCH,
    isSidechain: false,
    message: { role: 'assistant', content },
    ...extra,
  }
}
const text = (t: string) => ({ type: 'text', text: t })
const toolUse = (id: string, name: string, input: object) => ({
  type: 'tool_use',
  id,
  name,
  input,
})
const toolResult = (id: string, content: unknown, isError = false) => ({
  type: 'tool_result',
  tool_use_id: id,
  content,
  ...(isError ? { is_error: true } : {}),
})

beforeEach(() => {
  clock = 0
})

describe('taskOfBranch', () => {
  it('maps lumo/LUM-<n>-… and lumo/LUM-<n> to the task, nothing else', () => {
    expect(taskOfBranch('lumo/LUM-77-fix-widget')).toBe('LUM-77')
    expect(taskOfBranch('lumo/LUM-77')).toBe('LUM-77')
    expect(taskOfBranch('lumo/LUM-778x')).toBeNull()
    expect(taskOfBranch('main')).toBeNull()
    expect(taskOfBranch('HEAD')).toBeNull()
    expect(taskOfBranch('feature/LUM-77-x')).toBeNull()
    expect(taskOfBranch(undefined)).toBeNull()
  })
})

describe('transcriptSessionId', () => {
  it('is the sessionId, or <sessionId>:<agentId> for a subagent', () => {
    expect(transcriptSessionId({ sessionId: 's1', isSidechain: false })).toBe(
      's1'
    )
    expect(
      transcriptSessionId({ sessionId: 's1', isSidechain: true, agentId: 'a9' })
    ).toBe('s1:a9')
  })
})

describe('genuinePromptText', () => {
  it('keeps plain user text and strips appended system reminders', () => {
    expect(
      genuinePromptText(
        user(
          'u',
          'make the widget blue\n<system-reminder>noise</system-reminder>'
        )
      )
    ).toBe('make the widget blue')
    expect(genuinePromptText(user('u', [text('fix it')]))).toBe('fix it')
  })

  it('skips meta, compact summaries, tool results and non-human origins', () => {
    expect(
      genuinePromptText(user('u', 'expanded skill', { isMeta: true }))
    ).toBeNull()
    expect(
      genuinePromptText(user('u', 'summary', { isCompactSummary: true }))
    ).toBeNull()
    expect(
      genuinePromptText(user('u', [toolResult('t1', 'ok'), text('x')]))
    ).toBeNull()
    expect(
      genuinePromptText(
        user('u', 'done', { origin: { kind: 'task-notification' } })
      )
    ).toBeNull()
    expect(
      genuinePromptText(user('u', 'go', { origin: { kind: 'human' } }))
    ).toBe('go')
    expect(
      genuinePromptText(user('u', 'do X', { origin: { kind: 'coordinator' } }))
    ).toBe('do X')
  })

  it('skips wrapper-only messages and interruptions; a slash command is what was typed', () => {
    expect(
      genuinePromptText(user('u', '<system-reminder>only</system-reminder>'))
    ).toBeNull()
    expect(
      genuinePromptText(
        user(
          'u',
          '<task-notification><status>done</status></task-notification>'
        )
      )
    ).toBeNull()
    expect(
      genuinePromptText(
        user('u', '<local-command-stdout>out</local-command-stdout>')
      )
    ).toBeNull()
    expect(
      genuinePromptText(user('u', [text('[Request interrupted by user]')]))
    ).toBeNull()
    expect(
      genuinePromptText(
        user(
          'u',
          '<command-message>review</command-message>\n<command-name>/review</command-name>\n<command-args>42</command-args>'
        )
      )
    ).toBe('/review 42')
  })
})

describe('parseClaudeTranscript', () => {
  it('pairs tool_use with its tool_result, stamped at the result, structured response preferred', () => {
    const events = parseClaudeTranscript([
      user('u1', 'add a test'),
      assistant('a1', [
        toolUse('t1', 'Edit', {
          file_path: '/wt/src/a.test.ts',
          old_string: 'x',
          new_string: 'y',
        }),
      ]),
      {
        ...user('r1', [toolResult('t1', 'The file was edited')]),
        toolUseResult: { filePath: '/wt/src/a.test.ts', originalFile: 'BIG' },
      },
    ])
    const tool = events.find(e => e.event.type === 'POST_TOOL_USE')!
    expect(tool.event.id).toBe('t1')
    expect(tool.event.toolName).toBe('Edit')
    expect(tool.event.sessionId).toBe('s1')
    expect(tool.event.createdAt.toISOString()).toBe(
      new Date(Date.UTC(2026, 9, 10, 10, 0, 2)).toISOString()
    )
    expect(tool.event.payload).toEqual({
      tool_name: 'Edit',
      tool_input: {
        file_path: '/wt/src/a.test.ts',
        old_string: 'x',
        new_string: 'y',
      },
      tool_response: { filePath: '/wt/src/a.test.ts' },
    })
    expect(tool.task).toBe('LUM-77')
  })

  it('uses the result text when the message carries several results; skips errors and unanswered calls', () => {
    const events = parseClaudeTranscript([
      user('u1', 'go'),
      assistant('a1', [
        toolUse('t1', 'Bash', { command: 'npm test' }),
        toolUse('t2', 'Bash', { command: 'false' }),
        toolUse('t3', 'Read', { file_path: '/wt/x' }),
      ]),
      {
        ...user('r1', [
          toolResult('t1', [text('PASS')]),
          toolResult('t2', 'exit 1', true),
        ]),
        toolUseResult: { stdout: 'ignored' },
      },
    ])
    const tools = events.filter(e => e.event.type === 'POST_TOOL_USE')
    expect(tools.map(e => e.event.id)).toEqual(['t1'])
    expect(
      (tools[0]!.event.payload as { tool_response: unknown }).tool_response
    ).toBe('PASS')
  })

  it('STOP is the last assistant text before the next genuine prompt, and at the end', () => {
    const events = parseClaudeTranscript([
      user('u1', 'first'),
      assistant('a1', [text('working')]),
      assistant('a2', [toolUse('t1', 'Bash', { command: 'ls' })]),
      user('r1', [toolResult('t1', 'x')]),
      assistant('a3', [text('all done, tests pass')]),
      // A reminder-only message is not a turn boundary.
      user('m1', '<system-reminder>r</system-reminder>'),
      user('u2', 'second'),
      assistant('a4', [text('ok')]),
      assistant('a5', [text('No response requested.')], {
        message: {
          role: 'assistant',
          model: '<synthetic>',
          content: [text('x')],
        },
      }),
    ])
    expect(events.map(e => `${e.event.type}:${e.event.id}`)).toEqual([
      'USER_PROMPT_SUBMIT:u1',
      'POST_TOOL_USE:t1',
      'STOP:a3',
      'USER_PROMPT_SUBMIT:u2',
      'STOP:a4',
    ])
    expect(events[2]!.event.payload).toEqual({
      last_assistant_message: 'all done, tests pass',
    })
  })

  it('gives subagent events <sessionId>:<agentId> and attributes each event by its own branch', () => {
    const sub = { isSidechain: true, agentId: 'ag1' }
    const events = parseClaudeTranscript([
      user('u1', 'do the subtask', sub),
      assistant(
        'a1',
        [toolUse('t1', 'Write', { file_path: '/wt/b.ts', content: 'z' })],
        sub
      ),
      user('r1', [toolResult('t1', 'ok')], { ...sub, gitBranch: 'main' }),
      assistant('a2', [text('finished')], sub),
    ])
    expect(events.map(e => e.event.sessionId)).toEqual([
      's1:ag1',
      's1:ag1',
      's1:ag1',
    ])
    expect(events.map(e => e.task)).toEqual(['LUM-77', null, 'LUM-77'])
  })

  it('drops repeated ids (a resumed session copies history)', () => {
    const events = parseClaudeTranscript([
      user('u1', 'hello'),
      user('u1', 'hello'),
    ])
    expect(
      events.filter(e => e.event.type === 'USER_PROMPT_SUBMIT')
    ).toHaveLength(1)
  })
})

describe('clipToolResponse', () => {
  it('cuts long strings and drops the original-file echo', () => {
    const long = 'x'.repeat(TOOL_RESPONSE_MAX_CHARS + 50)
    expect((clipToolResponse(long) as string).length).toBeLessThan(long.length)
    expect(clipToolResponse({ stdout: 'a', originalFile: 'b' })).toEqual({
      stdout: 'a',
    })
  })
})
