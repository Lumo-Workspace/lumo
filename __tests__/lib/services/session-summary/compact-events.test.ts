import {
  compactEvents,
  extractSessionMetadata,
  type RawEvent,
} from '@/lib/services/session-summary/compact-events'

function pre(
  id: string,
  toolUseId: string,
  toolName: string,
  input: Record<string, unknown>,
  at: string
): RawEvent {
  return {
    id,
    type: 'PRE_TOOL_USE',
    toolName,
    payload: { tool_use_id: toolUseId, tool_name: toolName, tool_input: input },
    createdAt: new Date(at),
  }
}

function post(
  id: string,
  toolUseId: string,
  toolName: string,
  input: Record<string, unknown>,
  response: Record<string, unknown>,
  at: string
): RawEvent {
  return {
    id,
    type: 'POST_TOOL_USE',
    toolName,
    payload: {
      tool_use_id: toolUseId,
      tool_name: toolName,
      tool_input: input,
      tool_response: response,
    },
    createdAt: new Date(at),
  }
}

function stop(id: string, message: string | null, at: string): RawEvent {
  return {
    id,
    type: 'STOP',
    toolName: null,
    payload: message !== null ? { last_assistant_message: message } : {},
    createdAt: new Date(at),
  }
}

describe('compactEvents', () => {
  it('emits one line per merged tool call with time prefix', () => {
    const result = compactEvents([
      pre('p1', 'u1', 'Read', { file_path: '/a.ts' }, '2026-04-23T10:00:00Z'),
      post(
        'q1',
        'u1',
        'Read',
        { file_path: '/a.ts' },
        { file: { content: 'line1\nline2\nline3' }, type: 'text' },
        '2026-04-23T10:00:01Z'
      ),
    ])

    expect(result.toolCallLineCount).toBe(1)
    expect(result.truncatedCount).toBe(0)
    expect(result.text).toBe('[10:00:00] Read /a.ts (3 lines)')
  })

  it('flags Bash stderr with ERR status and keeps a stderr tail', () => {
    const result = compactEvents([
      pre('p1', 'u1', 'Bash', { command: 'npm test' }, '2026-04-23T10:00:00Z'),
      post(
        'q1',
        'u1',
        'Bash',
        { command: 'npm test' },
        { stdout: '', stderr: 'ENOENT: file missing', interrupted: false },
        '2026-04-23T10:00:01Z'
      ),
    ])

    expect(result.text).toContain('Bash "npm test" ERR')
    expect(result.text).toContain('stderr: ENOENT: file missing')
  })

  it('flags interrupted Bash as INTERRUPTED without stdout', () => {
    const result = compactEvents([
      pre('p1', 'u1', 'Bash', { command: 'sleep 100' }, '2026-04-23T10:00:00Z'),
      post(
        'q1',
        'u1',
        'Bash',
        { command: 'sleep 100' },
        { stdout: '', stderr: '', interrupted: true },
        '2026-04-23T10:00:05Z'
      ),
    ])

    expect(result.text).toContain('Bash "sleep 100" INTERRUPTED')
    expect(result.text).not.toContain('stdout:')
  })

  it('truncates long Bash stdout to the configured head size', () => {
    const bigOut = 'x'.repeat(2000)
    const result = compactEvents(
      [
        pre('p1', 'u1', 'Bash', { command: 'cat big' }, '2026-04-23T10:00:00Z'),
        post(
          'q1',
          'u1',
          'Bash',
          { command: 'cat big' },
          { stdout: bigOut, stderr: '' },
          '2026-04-23T10:00:01Z'
        ),
      ],
      { bashOutputHeadChars: 50 }
    )

    // 50 chars minus 1 for ellipsis + the ellipsis = 50 total visible chars.
    const line = result.text
    expect(line).toContain('…')
    const stdoutPart = line.split('stdout: ')[1] ?? ''
    expect(stdoutPart.length).toBeLessThanOrEqual(50)
  })

  it('counts Edit diff size from structuredPatch', () => {
    const patch = [
      {
        oldStart: 10,
        oldLines: 2,
        newStart: 10,
        newLines: 3,
        lines: [' ctx', '-old1', '+new1', '+new2'],
      },
    ]
    const result = compactEvents([
      pre(
        'p1',
        'u1',
        'Edit',
        { file_path: '/a.ts', old_string: 'x', new_string: 'y' },
        '2026-04-23T10:00:00Z'
      ),
      post(
        'q1',
        'u1',
        'Edit',
        { file_path: '/a.ts', old_string: 'x', new_string: 'y' },
        { filePath: '/a.ts', structuredPatch: patch, type: 'update' },
        '2026-04-23T10:00:01Z'
      ),
    ])

    expect(result.text).toBe('[10:00:00] Edit /a.ts +2 -1')
  })

  it('emits turn-end markers for STOP events', () => {
    const result = compactEvents([
      stop('s1', 'All done — tests passing.', '2026-04-23T10:00:10Z'),
    ])
    expect(result.text).toBe(
      '[10:00:10] [turn end] "All done — tests passing."'
    )
  })

  it('summarizes TodoWrite by status counts', () => {
    const result = compactEvents([
      pre(
        'p1',
        'u1',
        'TodoWrite',
        {
          todos: [
            { content: 'a', status: 'completed' },
            { content: 'b', status: 'completed' },
            { content: 'c', status: 'in_progress' },
            { content: 'd', status: 'pending' },
          ],
        },
        '2026-04-23T10:00:00Z'
      ),
      post(
        'q1',
        'u1',
        'TodoWrite',
        { todos: [] },
        { ok: true },
        '2026-04-23T10:00:01Z'
      ),
    ])
    expect(result.text).toContain(
      'TodoWrite (4 items: 2 completed, 1 in_progress, 1 pending)'
    )
  })

  it('notes orphan Pre (session ended mid-call) rather than silently dropping', () => {
    const result = compactEvents([
      pre('p1', 'u1', 'Bash', { command: 'long task' }, '2026-04-23T10:00:00Z'),
    ])
    expect(result.text).toContain('Bash command (no result — session ended')
  })

  it('truncates at maxToolCalls and reports dropped count', () => {
    const events: RawEvent[] = []
    for (let i = 0; i < 5; i++) {
      const at = new Date(2026, 3, 23, 10, 0, i).toISOString()
      events.push(pre(`p${i}`, `u${i}`, 'Read', { file_path: `/${i}.ts` }, at))
      events.push(
        post(
          `q${i}`,
          `u${i}`,
          'Read',
          { file_path: `/${i}.ts` },
          { file: { content: 'x' }, type: 'text' },
          at
        )
      )
    }
    const result = compactEvents(events, { maxToolCalls: 3 })
    expect(result.toolCallLineCount).toBe(3)
    expect(result.truncatedCount).toBe(2)
    expect(result.text.split('\n')).toHaveLength(3)
  })

  it('handles Grep in all three modes', () => {
    const result = compactEvents([
      pre(
        'p1',
        'u1',
        'Grep',
        { pattern: 'TODO', path: 'src' },
        '2026-04-23T10:00:00Z'
      ),
      post(
        'q1',
        'u1',
        'Grep',
        { pattern: 'TODO', path: 'src' },
        { mode: 'files_with_matches', numFiles: 4, filenames: [] },
        '2026-04-23T10:00:01Z'
      ),
      pre('p2', 'u2', 'Grep', { pattern: 'FIXME' }, '2026-04-23T10:00:02Z'),
      post(
        'q2',
        'u2',
        'Grep',
        { pattern: 'FIXME' },
        { mode: 'content', numLines: 7, content: 'x' },
        '2026-04-23T10:00:03Z'
      ),
      pre('p3', 'u3', 'Grep', { pattern: 'X' }, '2026-04-23T10:00:04Z'),
      post(
        'q3',
        'u3',
        'Grep',
        { pattern: 'X' },
        { mode: 'count', numMatches: 12 },
        '2026-04-23T10:00:05Z'
      ),
    ])

    const lines = result.text.split('\n')
    expect(lines[0]).toBe('[10:00:00] Grep "TODO" in src → 4 files')
    expect(lines[1]).toBe('[10:00:02] Grep "FIXME" → 7 lines')
    expect(lines[2]).toBe('[10:00:04] Grep "X" → 12 matches')
  })

  it('renders Task dispatches with subagent and prompt prefix', () => {
    const result = compactEvents([
      pre(
        'p1',
        'u1',
        'Task',
        {
          subagent_type: 'Explore',
          description: 'Find Session type',
          prompt:
            'Search the repo for the Session type definition and report path + line numbers.',
        },
        '2026-04-23T10:00:00Z'
      ),
      post(
        'q1',
        'u1',
        'Task',
        { description: 'Find Session type' },
        { type: 'text' },
        '2026-04-23T10:00:05Z'
      ),
    ])
    expect(result.text).toContain('Task[Explore] "Find Session type"')
    expect(result.text).toContain('Search the repo for the Session type')
  })
})

describe('extractSessionMetadata', () => {
  it('returns zeroed metadata for an empty event list', () => {
    const m = extractSessionMetadata([])
    expect(m).toEqual({
      durationMs: 0,
      toolCallCount: 0,
      toolDistribution: {},
      firstAssistantMessage: null,
      keyStopMessages: [],
    })
  })

  it('counts tool-call distribution from PRE events only', () => {
    const m = extractSessionMetadata([
      pre('p1', 'u1', 'Read', { file_path: '/a' }, '2026-04-23T10:00:00Z'),
      post(
        'q1',
        'u1',
        'Read',
        { file_path: '/a' },
        { file: { content: '' }, type: 'text' },
        '2026-04-23T10:00:01Z'
      ),
      pre('p2', 'u2', 'Read', { file_path: '/b' }, '2026-04-23T10:00:02Z'),
      pre('p3', 'u3', 'Edit', { file_path: '/c' }, '2026-04-23T10:00:03Z'),
    ])
    // POST_TOOL_USE is not counted separately — only PREs contribute.
    expect(m.toolCallCount).toBe(3)
    expect(m.toolDistribution).toEqual({ Read: 2, Edit: 1 })
  })

  it('captures first assistant message and samples key stops', () => {
    const events: RawEvent[] = []
    for (let i = 0; i < 10; i++) {
      events.push(
        stop(
          `s${i}`,
          `turn ${i} summary`,
          `2026-04-23T10:00:0${i}Z`.replace('010', '10')
        )
      )
    }
    const m = extractSessionMetadata(events)
    expect(m.firstAssistantMessage).toBe('turn 0 summary')
    expect(m.keyStopMessages).toHaveLength(5)
    // First and last stops must be present.
    expect(m.keyStopMessages[0]!.message).toBe('turn 0 summary')
    expect(m.keyStopMessages[m.keyStopMessages.length - 1]!.message).toBe(
      'turn 9 summary'
    )
  })

  it('computes durationMs from first to last event', () => {
    const m = extractSessionMetadata([
      pre('p1', 'u1', 'Read', { file_path: '/a' }, '2026-04-23T10:00:00Z'),
      pre('p2', 'u2', 'Read', { file_path: '/b' }, '2026-04-23T10:05:00Z'),
    ])
    expect(m.durationMs).toBe(5 * 60 * 1000)
  })
})
