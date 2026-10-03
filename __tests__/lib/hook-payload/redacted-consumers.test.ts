/**
 * LUM-855: readers of stored hook events render redacted content as sizes and
 * a not-retained notice — never an empty block or a zero line count.
 */
import { mergeEvents, type DetailBlock } from '@/app/sessions/[id]/merge-events'
import { compactEvents } from '@/lib/services/session-summary/compact-events'
import { stripCodeFromHookPayload } from '@/lib/hook-payload/redact'

const CODE = 'line one\nline two\nline three'

function pair(
  toolName: string,
  input: Record<string, unknown>,
  response: unknown
) {
  const base = { tool_use_id: `tu_${toolName}`, tool_name: toolName }
  return [
    {
      id: `pre_${toolName}`,
      type: 'PRE_TOOL_USE' as const,
      toolName,
      payload: stripCodeFromHookPayload('PRE_TOOL_USE', {
        ...base,
        tool_input: input,
      }),
      createdAt: new Date('2026-09-26T10:00:00Z'),
    },
    {
      id: `post_${toolName}`,
      type: 'POST_TOOL_USE' as const,
      toolName,
      payload: stripCodeFromHookPayload('POST_TOOL_USE', {
        ...base,
        tool_input: input,
        tool_response: response,
      }),
      createdAt: new Date('2026-09-26T10:00:01Z'),
    },
  ]
}

describe('redacted hook events in the session timeline', () => {
  it('shows a not-retained block with sizes for Write, Read, Edit and Bash', () => {
    const items = mergeEvents([
      ...pair(
        'Write',
        { file_path: '/repo/a.ts', content: CODE },
        { type: 'create', filePath: '/repo/a.ts' }
      ),
      ...pair(
        'Read',
        { file_path: '/repo/a.ts' },
        { type: 'text', file: { filePath: '/repo/a.ts', content: CODE } }
      ),
      ...pair(
        'Edit',
        { file_path: '/repo/a.ts', old_string: 'x', new_string: 'y' },
        { filePath: '/repo/a.ts', structuredPatch: [{ lines: ['-x', '+y'] }] }
      ),
      ...pair(
        'Bash',
        { command: 'npm test' },
        { stdout: CODE, stderr: 'boom', interrupted: false }
      ),
    ])
    const byTool = Object.fromEntries(items.map(i => [i.toolName, i]))

    const write = byTool.Write!
    expect(write.badge).toEqual({
      kind: 'linesWithType',
      type: 'create',
      count: 3,
    })
    expect(write.details).toEqual([
      expect.objectContaining({
        labelKey: 'content',
        variant: 'redacted',
        redacted: { lines: 3, bytes: CODE.length },
      }),
    ])

    expect(byTool.Read!.badge).toEqual({ kind: 'lines', count: 3 })
    expect(byTool.Read!.details[0]).toMatchObject({ variant: 'redacted' })

    expect(byTool.Edit!.badge).toEqual({ kind: 'raw', text: '+1 -1' })
    expect(byTool.Edit!.details[0]).toMatchObject({
      labelKey: 'diff',
      variant: 'redacted',
    })

    const bash = byTool.Bash!
    expect(bash.status).toBe('error')
    expect(bash.badge).toEqual({ kind: 'stderr' })
    expect(
      bash.details.map((d: DetailBlock) => [d.labelKey, d.variant])
    ).toEqual([
      ['command', 'code'],
      ['stdout', 'redacted'],
      ['stderr', 'redacted'],
    ])
    expect(JSON.stringify(items)).not.toContain('line two')
  })

  it('MultiEdit redacted shows path and summed edit sizes as not retained', () => {
    const edits = [
      { old_string: 'aa', new_string: 'line one\nline two' },
      { old_string: 'b', new_string: 'line three', replace_all: true },
    ]
    const items = mergeEvents(
      pair(
        'MultiEdit',
        { file_path: '/repo/m.ts', edits },
        { filePath: '/repo/m.ts', edits, originalFileContents: CODE }
      )
    )
    const multi = items[0]!
    expect(multi.summary).toBe('/repo/m.ts')
    expect(multi.details).toEqual([
      expect.objectContaining({
        labelKey: 'diff',
        variant: 'redacted',
        // tool_input.edits.*: 'aa'(1 line, 2 B) + 2 lines/17 B + 'b'(1, 1) + 1 line/10 B
        redacted: { lines: 5, bytes: 30 },
      }),
    ])
    expect(JSON.stringify(items)).not.toContain('line two')
  })

  it('NotebookEdit redacted shows notebook path and source size as not retained', () => {
    const items = mergeEvents(
      pair(
        'NotebookEdit',
        {
          notebook_path: '/repo/n.ipynb',
          cell_id: 'c1',
          new_source: CODE,
          edit_mode: 'replace',
        },
        {
          notebook_path: '/repo/n.ipynb',
          new_source: CODE,
          original_file: '{"cells":[]}',
          updated_file: '{"cells":[1]}',
          edit_mode: 'replace',
        }
      )
    )
    const nb = items[0]!
    expect(nb.summary).toBe('/repo/n.ipynb')
    expect(nb.details).toEqual([
      expect.objectContaining({
        labelKey: 'content',
        variant: 'redacted',
        redacted: { lines: 3, bytes: CODE.length },
      }),
    ])
    expect(JSON.stringify(items)).not.toContain('line two')
  })

  it('NotebookEdit delete redacted shows the input and response size as not retained', () => {
    const items = mergeEvents(
      pair(
        'NotebookEdit',
        { notebook_path: '/repo/n.ipynb', cell_id: 'c1', edit_mode: 'delete' },
        {
          notebook_path: '/repo/n.ipynb',
          original_file: CODE,
          updated_file: 'x',
        }
      )
    )
    const nb = items[0]!
    expect(nb.summary).toBe('/repo/n.ipynb')
    expect(nb.details.map((d: DetailBlock) => [d.labelKey, d.variant])).toEqual(
      [
        ['input', 'json'],
        ['response', 'redacted'],
      ]
    )
    expect(nb.details[0]!.text).toContain('"edit_mode": "delete"')
    // original_file (3 lines / CODE bytes) + updated_file (1 line / 1 B) +
    // notebook_path, which redactResponse does not whitelist as metadata
    expect(nb.details[1]!.redacted).toEqual({
      lines: 5,
      bytes: CODE.length + 1 + '/repo/n.ipynb'.length,
    })
    expect(JSON.stringify(items)).not.toContain('line two')
  })

  it('NotebookEdit failure shows the error text', () => {
    const at = (s: number) => new Date(`2026-09-26T10:00:0${s}Z`)
    const input = {
      notebook_path: '/repo/n.ipynb',
      cell_id: 'c',
      new_source: 'print(1)',
      edit_mode: 'replace',
    }
    const items = mergeEvents([
      {
        id: 'pre_nb',
        type: 'PRE_TOOL_USE' as const,
        toolName: 'NotebookEdit',
        payload: { tool_use_id: 'tu_nb', tool_input: input },
        createdAt: at(0),
      },
      {
        id: 'post_nb',
        type: 'POST_TOOL_USE' as const,
        toolName: 'NotebookEdit',
        payload: {
          tool_use_id: 'tu_nb',
          tool_input: input,
          tool_response: { error: 'Cell c not found' },
        },
        createdAt: at(1),
      },
    ])
    const nb = items[0]!
    expect(nb.status).toBe('error')
    expect(nb.details[0]).toMatchObject({
      labelKey: 'response',
      variant: 'error',
      text: 'Cell c not found',
    })
  })

  it('fallback tools with nested redacted response show sizes as not retained', () => {
    const items = mergeEvents([
      ...pair(
        'WebFetch',
        { url: 'https://example.com/doc', prompt: 'summarize' },
        { url: 'https://example.com/doc', code: 200, result: CODE, bytes: 999 }
      ),
      ...pair(
        'Task',
        { description: 'Explore', prompt: 'find x', subagent_type: 'Explore' },
        { content: [{ type: 'text', text: CODE }], totalDurationMs: 5 }
      ),
      ...pair(
        'mcp__github__get_file',
        { path: 'src/a.ts' },
        { content: [{ type: 'text', text: CODE }] }
      ),
    ])
    const byTool = Object.fromEntries(items.map(i => [i.toolName, i]))

    for (const tool of ['WebFetch', 'Task', 'mcp__github__get_file']) {
      const redacted = byTool[tool]!.details.filter(
        (d: DetailBlock) => d.variant === 'redacted'
      )
      expect(redacted).toEqual([
        expect.objectContaining({
          labelKey: 'response',
          redacted: { lines: 3, bytes: CODE.length },
        }),
      ])
    }
    expect(byTool.WebFetch!.summary).toContain('https://example.com/doc')
    expect(byTool.mcp__github__get_file!.summary).toContain('src/a.ts')
    expect(JSON.stringify(items)).not.toContain('line two')
  })

  it('full content events render content and no not retained block', () => {
    const raw = (
      toolName: string,
      input: Record<string, unknown>,
      response: unknown
    ) => [
      {
        id: `pre_${toolName}`,
        type: 'PRE_TOOL_USE' as const,
        toolName,
        payload: { tool_use_id: `tu_${toolName}`, tool_input: input },
        createdAt: new Date('2026-09-26T10:00:00Z'),
      },
      {
        id: `post_${toolName}`,
        type: 'POST_TOOL_USE' as const,
        toolName,
        payload: {
          tool_use_id: `tu_${toolName}`,
          tool_input: input,
          tool_response: response,
        },
        createdAt: new Date('2026-09-26T10:00:01Z'),
      },
    ]
    const items = mergeEvents([
      ...raw(
        'MultiEdit',
        {
          file_path: '/repo/m.ts',
          edits: [{ old_string: 'old body', new_string: 'new body' }],
        },
        { filePath: '/repo/m.ts' }
      ),
      ...raw(
        'NotebookEdit',
        { notebook_path: '/repo/n.ipynb', new_source: 'print(1)' },
        { notebook_path: '/repo/n.ipynb' }
      ),
      ...raw(
        'WebFetch',
        { url: 'https://example.com/doc' },
        { url: 'https://example.com/doc', result: 'fetched text' }
      ),
    ])
    const byTool = Object.fromEntries(items.map(i => [i.toolName, i]))
    for (const item of items) {
      expect(
        item.details.some((d: DetailBlock) => d.variant === 'redacted')
      ).toBe(false)
    }
    const texts = (tool: string) =>
      byTool[tool]!.details.map((d: DetailBlock) => d.text).join('\n')
    expect(texts('MultiEdit')).toContain('old body')
    expect(texts('MultiEdit')).toContain('new body')
    expect(texts('NotebookEdit')).toContain('print(1)')
    expect(texts('WebFetch')).toContain('fetched text')
  })

  it('keeps line counts and error status in the session summary input', () => {
    const { text } = compactEvents([
      ...pair(
        'Write',
        { file_path: '/repo/a.ts', content: CODE },
        { type: 'create', filePath: '/repo/a.ts' }
      ),
      ...pair(
        'Read',
        { file_path: '/repo/a.ts' },
        { type: 'text', file: { filePath: '/repo/a.ts', content: CODE } }
      ),
      ...pair(
        'Edit',
        { file_path: '/repo/a.ts', old_string: 'x', new_string: 'y' },
        { filePath: '/repo/a.ts', structuredPatch: [{ lines: ['-x', '+y'] }] }
      ),
      ...pair('Bash', { command: 'npm test' }, { stderr: 'boom' }),
    ])
    expect(text).toContain('Write /repo/a.ts (create, 3 lines)')
    expect(text).toContain('Read /repo/a.ts (3 lines)')
    expect(text).toContain('Edit /repo/a.ts +1 -1')
    expect(text).toContain('Bash "npm test" ERR')
    expect(text).not.toContain('line two')
  })
})
