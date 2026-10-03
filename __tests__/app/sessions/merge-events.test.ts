import { mergeEvents, type RawEvent } from '@/app/sessions/[id]/merge-events'

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

describe('mergeEvents', () => {
  it('merges Pre + Post with matching tool_use_id into one item', () => {
    const result = mergeEvents([
      pre('p1', 'u1', 'Read', { file_path: '/a.ts' }, '2026-04-23T09:00:00Z'),
      post(
        'q1',
        'u1',
        'Read',
        { file_path: '/a.ts' },
        { file: { content: 'line1\nline2\nline3' }, type: 'text' },
        '2026-04-23T09:00:01Z'
      ),
    ])

    expect(result).toHaveLength(1)
    expect(result[0]!.kind).toBe('tool')
    expect(result[0]!.toolName).toBe('Read')
    expect(result[0]!.summary).toBe('/a.ts')
    expect(result[0]!.status).toBe('ok')
    expect(result[0]!.badge).toEqual({ kind: 'lines', count: 3 })
    expect(result[0]!.endAt?.toISOString()).toBe('2026-04-23T09:00:01.000Z')

    const content = result[0]!.details.find(d => d.labelKey === 'content')
    expect(content?.text).toContain('line1')
  })

  it('renders STOP event with message preview', () => {
    const result = mergeEvents([
      stop('s1', 'done with the task', '2026-04-23T09:00:00Z'),
    ])
    expect(result).toHaveLength(1)
    expect(result[0]!.kind).toBe('stop')
    expect(result[0]!.summary).toBe('done with the task')
    expect(result[0]!.details[0]!.text).toBe('done with the task')
  })

  it('flags Bash with non-empty stderr as error', () => {
    const result = mergeEvents([
      pre('p1', 'u1', 'Bash', { command: 'npm test' }, '2026-04-23T09:00:00Z'),
      post(
        'q1',
        'u1',
        'Bash',
        { command: 'npm test' },
        { stdout: '', stderr: 'ENOENT', interrupted: false },
        '2026-04-23T09:00:01Z'
      ),
    ])

    expect(result[0]!.status).toBe('error')
    expect(result[0]!.badge).toEqual({ kind: 'stderr' })
    const stderrBlock = result[0]!.details.find(d => d.labelKey === 'stderr')
    expect(stderrBlock?.variant).toBe('error')
    expect(stderrBlock?.text).toContain('ENOENT')
  })

  it('marks orphan Pre (no Post) as pending', () => {
    const result = mergeEvents([
      pre('p1', 'u1', 'Bash', { command: 'sleep 1' }, '2026-04-23T09:00:00Z'),
    ])
    expect(result).toHaveLength(1)
    expect(result[0]!.kind).toBe('orphan')
    expect(result[0]!.status).toBe('pending')
    expect(result[0]!.endAt).toBeNull()
  })

  it('counts diff lines from structuredPatch for Edit badge', () => {
    const patch = [
      {
        oldStart: 10,
        oldLines: 3,
        newStart: 10,
        newLines: 4,
        lines: [
          ' context',
          '-old line 1',
          '-old line 2',
          '+new line 1',
          '+new line 2',
          '+new line 3',
        ],
      },
    ]
    const result = mergeEvents([
      pre(
        'p1',
        'u1',
        'Edit',
        { file_path: '/a.ts', old_string: 'x', new_string: 'y' },
        '2026-04-23T09:00:00Z'
      ),
      post(
        'q1',
        'u1',
        'Edit',
        { file_path: '/a.ts', old_string: 'x', new_string: 'y' },
        { filePath: '/a.ts', structuredPatch: patch, type: 'update' },
        '2026-04-23T09:00:01Z'
      ),
    ])

    expect(result[0]!.badge).toEqual({ kind: 'raw', text: '+3 -2' })
    const diffBlock = result[0]!.details.find(d => d.labelKey === 'diff')
    expect(diffBlock?.variant).toBe('diff')
    expect(diffBlock?.text).toContain('@@ -10,3 +10,4 @@')
    expect(diffBlock?.text).toContain('+new line 1')
  })

  it('truncates long content blocks and records total line count', () => {
    const bigContent = Array.from({ length: 80 }, (_, i) => `line ${i}`).join(
      '\n'
    )
    const result = mergeEvents([
      pre('p1', 'u1', 'Read', { file_path: '/big.ts' }, '2026-04-23T09:00:00Z'),
      post(
        'q1',
        'u1',
        'Read',
        { file_path: '/big.ts' },
        { file: { content: bigContent }, type: 'text' },
        '2026-04-23T09:00:01Z'
      ),
    ])

    const contentBlock = result[0]!.details.find(d => d.labelKey === 'content')
    expect(contentBlock?.truncated).toEqual({ shownLines: 30, totalLines: 80 })
    expect(contentBlock?.text.split('\n')).toHaveLength(30)
  })

  it('sorts merged items by startAt regardless of input order', () => {
    // Stream events out of order to simulate interleaved writes.
    const events: RawEvent[] = [
      pre('p2', 'u2', 'Read', { file_path: '/b.ts' }, '2026-04-23T09:00:05Z'),
      pre('p1', 'u1', 'Read', { file_path: '/a.ts' }, '2026-04-23T09:00:00Z'),
      post(
        'q2',
        'u2',
        'Read',
        { file_path: '/b.ts' },
        { file: { content: 'B' }, type: 'text' },
        '2026-04-23T09:00:06Z'
      ),
      post(
        'q1',
        'u1',
        'Read',
        { file_path: '/a.ts' },
        { file: { content: 'A' }, type: 'text' },
        '2026-04-23T09:00:01Z'
      ),
    ]
    const result = mergeEvents(events)
    expect(result.map(r => r.summary)).toEqual(['/a.ts', '/b.ts'])
  })

  it('formats Grep files_with_matches mode with file list and count', () => {
    const result = mergeEvents([
      pre(
        'p1',
        'u1',
        'Grep',
        { pattern: 'TODO', path: 'src' },
        '2026-04-23T09:00:00Z'
      ),
      post(
        'q1',
        'u1',
        'Grep',
        { pattern: 'TODO', path: 'src' },
        {
          mode: 'files_with_matches',
          numFiles: 2,
          filenames: ['src/a.ts', 'src/b.ts'],
        },
        '2026-04-23T09:00:01Z'
      ),
    ])

    expect(result[0]!.summaryMsg).toEqual({
      kind: 'grepIn',
      pattern: 'TODO',
      path: 'src',
    })
    expect(result[0]!.badge).toEqual({ kind: 'files', count: 2 })
    const matches = result[0]!.details.find(d => d.labelKey === 'matches')
    expect(matches?.text).toBe('src/a.ts\nsrc/b.ts')
  })

  it('formats Grep content mode with matched lines and line count', () => {
    const result = mergeEvents([
      pre(
        'p1',
        'u1',
        'Grep',
        { pattern: 'ANTHROPIC', path: 'lib' },
        '2026-04-23T09:00:00Z'
      ),
      post(
        'q1',
        'u1',
        'Grep',
        { pattern: 'ANTHROPIC', path: 'lib' },
        {
          mode: 'content',
          numFiles: 0,
          numLines: 3,
          filenames: [],
          content:
            'lib/a.ts:1:ANTHROPIC_KEY\nlib/a.ts:2:ANTHROPIC_URL\nlib/b.ts:5:ANTHROPIC',
        },
        '2026-04-23T09:00:01Z'
      ),
    ])

    expect(result[0]!.badge).toEqual({ kind: 'lines', count: 3 })
    const matches = result[0]!.details.find(d => d.labelKey === 'matches')
    expect(matches?.variant).toBe('code')
    expect(matches?.text).toContain('ANTHROPIC_KEY')
  })

  it('marks empty Grep result as "no match" with no details', () => {
    const result = mergeEvents([
      pre(
        'p1',
        'u1',
        'Grep',
        { pattern: 'NONEXISTENT' },
        '2026-04-23T09:00:00Z'
      ),
      post(
        'q1',
        'u1',
        'Grep',
        { pattern: 'NONEXISTENT' },
        {
          mode: 'content',
          content: '',
          numFiles: 0,
          numLines: 0,
          filenames: [],
        },
        '2026-04-23T09:00:01Z'
      ),
    ])

    expect(result[0]!.badge).toEqual({ kind: 'noMatch' })
    expect(result[0]!.details).toHaveLength(0)
  })

  it('falls back gracefully when tool is unknown', () => {
    const result = mergeEvents([
      pre('p1', 'u1', 'SomeNewTool', { foo: 'bar' }, '2026-04-23T09:00:00Z'),
      post(
        'q1',
        'u1',
        'SomeNewTool',
        { foo: 'bar' },
        { ok: true },
        '2026-04-23T09:00:01Z'
      ),
    ])
    expect(result).toHaveLength(1)
    expect(result[0]!.toolName).toBe('SomeNewTool')
    expect(result[0]!.status).toBe('ok')
    const inputBlock = result[0]!.details.find(d => d.labelKey === 'input')
    expect(inputBlock?.variant).toBe('json')
    expect(inputBlock?.text).toContain('"foo"')
  })

  it('extracts user-visible text from UserPromptSubmit prompt', () => {
    const result = mergeEvents([
      {
        id: 'u1',
        type: 'USER_PROMPT_SUBMIT',
        toolName: null,
        payload: {
          prompt:
            'add oauth login\n<system-reminder>ignore me</system-reminder>',
        },
        createdAt: new Date('2026-04-23T09:00:00Z'),
      },
    ])
    expect(result).toHaveLength(1)
    expect(result[0]!.kind).toBe('user-prompt')
    expect(result[0]!.summary).toBe('add oauth login')
    const promptBlock = result[0]!.details.find(d => d.labelKey === 'prompt')
    expect(promptBlock?.text).toBe('add oauth login')
    const raw = result[0]!.details.find(d => d.labelKey === 'rawWithContext')
    expect(raw?.text).toContain('<system-reminder>')
  })

  it('returns "(empty prompt)" when payload.prompt is missing', () => {
    const result = mergeEvents([
      {
        id: 'u2',
        type: 'USER_PROMPT_SUBMIT',
        toolName: null,
        payload: {},
        createdAt: new Date('2026-04-23T09:00:00Z'),
      },
    ])
    expect(result[0]!.summaryMsg).toEqual({ kind: 'emptyPrompt' })
    expect(result[0]!.details).toHaveLength(0)
  })

  it('omits raw detail block when nothing was stripped', () => {
    const result = mergeEvents([
      {
        id: 'u3',
        type: 'USER_PROMPT_SUBMIT',
        toolName: null,
        payload: { prompt: 'plain text, no tags' },
        createdAt: new Date('2026-04-23T09:00:00Z'),
      },
    ])
    expect(result[0]!.details).toHaveLength(1)
    expect(result[0]!.details[0]!.labelKey).toBe('prompt')
  })

  it('strips command-name / command-message / command-args tags', () => {
    const result = mergeEvents([
      {
        id: 'u4',
        type: 'USER_PROMPT_SUBMIT',
        toolName: null,
        payload: {
          prompt:
            '<command-message>slash cmd</command-message><command-name>/foo</command-name><command-args>a\nb</command-args>run this',
        },
        createdAt: new Date('2026-04-23T09:00:00Z'),
      },
    ])
    expect(result[0]!.summary).toBe('run this')
  })

  it('clips summary to 100 chars but keeps full text in detail', () => {
    const longPrompt = 'x'.repeat(200)
    const result = mergeEvents([
      {
        id: 'u5',
        type: 'USER_PROMPT_SUBMIT',
        toolName: null,
        payload: { prompt: longPrompt },
        createdAt: new Date('2026-04-23T09:00:00Z'),
      },
    ])
    expect(result[0]!.summary.length).toBeLessThanOrEqual(100)
    expect(result[0]!.details[0]!.text.length).toBe(200)
  })

  it('sorts UserPromptSubmit into the timeline by createdAt', () => {
    const result = mergeEvents([
      {
        id: 'u6',
        type: 'USER_PROMPT_SUBMIT',
        toolName: null,
        payload: { prompt: 'hi' },
        createdAt: new Date('2026-04-23T09:00:00Z'),
      },
      stop('s1', 'done', '2026-04-23T09:00:02Z'),
      pre('p1', 'u1', 'Read', { file_path: '/a' }, '2026-04-23T09:00:01Z'),
      post(
        'q1',
        'u1',
        'Read',
        { file_path: '/a' },
        { file: { content: 'x' } },
        '2026-04-23T09:00:01.500Z'
      ),
    ])
    expect(result.map(r => r.kind)).toEqual(['user-prompt', 'tool', 'stop'])
  })

  it('strips interleaved injected tags around user text', () => {
    const result = mergeEvents([
      {
        id: 'u7',
        type: 'USER_PROMPT_SUBMIT',
        toolName: null,
        payload: {
          prompt:
            '<command-name>/foo</command-name>real text<system-reminder>skip</system-reminder>more real',
        },
        createdAt: new Date('2026-04-23T09:00:00Z'),
      },
    ])
    expect(result[0]!.summary).toBe('real textmore real')
  })
})

describe('mergeEvents — locale-free placeholder messages', () => {
  const at = new Date('2026-04-23T09:00:00Z')
  const post = (
    toolName: string,
    tool_input: unknown,
    tool_response: unknown
  ) =>
    mergeEvents([
      {
        id: 'p',
        type: 'POST_TOOL_USE',
        toolName,
        payload: { tool_use_id: 't', tool_input, tool_response },
        createdAt: at,
      },
    ])[0]!

  it('emits modelStopped for a STOP without a message', () => {
    const [item] = mergeEvents([
      { id: 's', type: 'STOP', toolName: null, payload: {}, createdAt: at },
    ])
    expect(item!.summaryMsg).toEqual({ kind: 'modelStopped' })
    expect(item!.summary).toBe('')
  })

  it('emits noPath when a file tool has no path', () => {
    expect(post('Read', {}, {}).summaryMsg).toEqual({ kind: 'noPath' })
  })

  it('emits a todos count', () => {
    expect(post('TodoWrite', { todos: [{}, {}] }, {}).summaryMsg).toEqual({
      kind: 'todos',
      count: 2,
    })
  })

  it('emits noInput for an unknown tool without input', () => {
    expect(post('Mystery', null, {}).summaryMsg).toEqual({ kind: 'noInput' })
  })

  it('marks an interrupted Bash call with a badge and a status textKey', () => {
    const item = post('Bash', { command: 'sleep 9' }, { interrupted: true })
    expect(item.badge).toEqual({ kind: 'interrupted' })
    expect(item.details.find(d => d.labelKey === 'status')?.textKey).toBe(
      'interrupted'
    )
  })
})
