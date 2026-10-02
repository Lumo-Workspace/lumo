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
    expect(write.badge).toBe('create · 3 lines')
    expect(write.details).toEqual([
      expect.objectContaining({
        labelKey: 'content',
        variant: 'redacted',
        redacted: { lines: 3, bytes: CODE.length },
      }),
    ])

    expect(byTool.Read!.badge).toBe('3 lines')
    expect(byTool.Read!.details[0]).toMatchObject({ variant: 'redacted' })

    expect(byTool.Edit!.badge).toBe('+1 -1')
    expect(byTool.Edit!.details[0]).toMatchObject({
      labelKey: 'diff',
      variant: 'redacted',
    })

    const bash = byTool.Bash!
    expect(bash.status).toBe('error')
    expect(bash.badge).toBe('stderr')
    expect(
      bash.details.map((d: DetailBlock) => [d.labelKey, d.variant])
    ).toEqual([
      ['command', 'code'],
      ['stdout', 'redacted'],
      ['stderr', 'redacted'],
    ])
    expect(JSON.stringify(items)).not.toContain('line two')
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
