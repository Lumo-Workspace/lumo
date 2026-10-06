/**
 * LUM-937: PostToolBatch events on the session detail page.
 *
 * Claude Code (2.1.186) fires PostToolBatch once per assistant message, after
 * every tool call in it has resolved, with
 * `tool_calls: [{ tool_name, tool_input, tool_use_id, tool_response }]` where
 * `tool_response` is the tool_result content sent back to the model (usually a
 * string). Each call has already fired its own PreToolUse / PostToolUse, so a
 * batch duplicates them — it is never a row of its own. Payloads below are the
 * real hook shapes run through the real ingest-side `stripCodeFromHookPayload`
 * (USED_UP) or stored as-is (RETAIN).
 */
import {
  countToolCalls,
  mergeEvents,
  type DetailBlock,
  type RawEvent,
  type TimelineItem,
} from '@/app/sessions/[id]/merge-events'
import { stripCodeFromHookPayload } from '@/lib/hook-payload/redact'
import {
  buildPrunedPayload,
  buildUserDeletedPayload,
} from '@/lib/hook-event/retention'

const CODE = 'export const a = 1\nexport const b = 2\nexport const c = 3'
const BASE = {
  session_id: 'sess-1',
  transcript_path: '/home/u/.claude/projects/p/sess-1.jsonl',
  cwd: '/repo',
  permission_mode: 'default',
}

type Mode = 'RETAIN' | 'USED_UP'

interface Call {
  id: string
  name: string
  input: Record<string, unknown>
  /** Structured PostToolUse tool_response. */
  response: Record<string, unknown>
  /** tool_result content the batch carries. */
  result: string
}

function stored(
  mode: Mode,
  type: 'PRE_TOOL_USE' | 'POST_TOOL_USE' | 'POST_TOOL_BATCH',
  payload: Record<string, unknown>
): Record<string, unknown> {
  return mode === 'USED_UP' ? stripCodeFromHookPayload(type, payload) : payload
}

function at(sec: number): Date {
  return new Date(Date.UTC(2026, 9, 6, 10, 0, sec))
}

function preEvent(mode: Mode, call: Call, sec: number): RawEvent {
  return {
    id: `pre_${call.id}`,
    type: 'PRE_TOOL_USE',
    toolName: call.name,
    payload: stored(mode, 'PRE_TOOL_USE', {
      ...BASE,
      hook_event_name: 'PreToolUse',
      tool_name: call.name,
      tool_input: call.input,
      tool_use_id: call.id,
    }),
    createdAt: at(sec),
  }
}

function postEvent(mode: Mode, call: Call, sec: number): RawEvent {
  return {
    id: `post_${call.id}`,
    type: 'POST_TOOL_USE',
    toolName: call.name,
    payload: stored(mode, 'POST_TOOL_USE', {
      ...BASE,
      hook_event_name: 'PostToolUse',
      tool_name: call.name,
      tool_input: call.input,
      tool_response: call.response,
      tool_use_id: call.id,
      duration_ms: 12,
    }),
    createdAt: at(sec),
  }
}

function batchEvent(mode: Mode, calls: Call[], sec: number): RawEvent {
  return {
    id: `batch_${sec}`,
    type: 'POST_TOOL_BATCH',
    // The route stores no tool_name for a batch (there is no top-level one).
    toolName: null,
    payload: stored(mode, 'POST_TOOL_BATCH', {
      ...BASE,
      hook_event_name: 'PostToolBatch',
      tool_calls: calls.map(c => ({
        tool_name: c.name,
        tool_input: c.input,
        tool_use_id: c.id,
        tool_response: c.result,
      })),
    }),
    createdAt: at(sec),
  }
}

const WRITE: Call = {
  id: 'toolu_01Write',
  name: 'Write',
  input: { file_path: '/repo/lib/a.ts', content: CODE },
  response: { type: 'create', filePath: '/repo/lib/a.ts', content: CODE },
  result: 'File created successfully at: /repo/lib/a.ts',
}
const BASH: Call = {
  id: 'toolu_02Bash',
  name: 'Bash',
  input: { command: 'npm test', description: 'Run tests' },
  response: { stdout: 'PASS 3 tests', stderr: '', interrupted: false },
  result: 'PASS 3 tests',
}
const READ: Call = {
  id: 'toolu_03Read',
  name: 'Read',
  input: { file_path: '/repo/lib/a.ts' },
  response: {
    type: 'text',
    file: { filePath: '/repo/lib/a.ts', content: CODE, numLines: 3 },
  },
  result: `     1\t${CODE.split('\n').join('\n     2\t')}`,
}

function redactedBlocks(items: TimelineItem[]): DetailBlock[] {
  return items.flatMap(i => i.details.filter(d => d.variant === 'redacted'))
}

function totalRedactedBytes(items: TimelineItem[]): number {
  return redactedBlocks(items).reduce((n, d) => n + (d.redacted?.bytes ?? 0), 0)
}

describe.each<Mode>(['RETAIN', 'USED_UP'])(
  'PostToolBatch duplicating its Pre/Post calls (%s)',
  mode => {
    const events = (): RawEvent[] => [
      preEvent(mode, WRITE, 1),
      preEvent(mode, BASH, 2),
      postEvent(mode, BASH, 3),
      postEvent(mode, WRITE, 4),
      batchEvent(mode, [WRITE, BASH], 5),
    ]

    it('adds no blank batch row', () => {
      const items = mergeEvents(events())
      expect(items.filter(i => i.toolName === null)).toEqual([])
      expect(items.map(i => [i.kind, i.toolName, i.status])).toEqual([
        ['tool', 'Write', 'ok'],
        ['tool', 'Bash', 'ok'],
      ])
    })

    it('counts each real tool call once', () => {
      expect(countToolCalls(mergeEvents(events()))).toBe(2)
    })

    it('does not add the batch copy of a size the row already shows', () => {
      const items = mergeEvents(events())
      const write = items.find(i => i.toolName === 'Write')!
      const sizes = write.details.filter(d => d.variant === 'redacted')
      if (mode === 'RETAIN') {
        expect(sizes).toEqual([])
      } else {
        // The Write body is reported once (from its own Pre/Post), not again
        // from tool_calls.0.tool_input.content / tool_calls.0.tool_response.
        expect(sizes).toEqual([
          expect.objectContaining({
            labelKey: 'content',
            redacted: { lines: 3, bytes: Buffer.byteLength(CODE) },
          }),
        ])
      }
    })

    it('keeps the batch out of the timeline even when it arrives first', () => {
      const [w1, b1, b2, w2, batch] = events()
      const items = mergeEvents([
        { ...batch!, createdAt: at(0) },
        w1!,
        b1!,
        b2!,
        w2!,
      ])
      expect(items.map(i => i.toolName)).toEqual(['Write', 'Bash'])
      expect(countToolCalls(items)).toBe(2)
    })
  }
)

describe('PostToolBatch as the only record of a call', () => {
  it('expands a call with no Pre/Post into its own tool row (USED_UP sizes once)', () => {
    // Read's Pre/Post never reached the server (hook delivery aborted); the
    // batch is the only record of it.
    const items = mergeEvents([
      preEvent('USED_UP', WRITE, 1),
      postEvent('USED_UP', WRITE, 2),
      batchEvent('USED_UP', [WRITE, READ], 3),
    ])
    expect(items.map(i => [i.kind, i.toolName, i.summary, i.status])).toEqual([
      ['tool', 'Write', '/repo/lib/a.ts', 'ok'],
      ['tool', 'Read', '/repo/lib/a.ts', 'ok'],
    ])
    expect(countToolCalls(items)).toBe(2)
    const read = items[1]!
    expect(read.key).toBe('tool:toolu_03Read')
    expect(read.endAt).toEqual(at(3))
    // tool_calls.1.tool_response — the Read result text — shown once.
    expect(read.details).toEqual([
      expect.objectContaining({
        labelKey: 'response',
        variant: 'redacted',
        redacted: {
          lines: READ.result.split('\n').length,
          bytes: Buffer.byteLength(READ.result),
        },
      }),
    ])
  })

  it('shows the recorded result text of an expanded call (RETAIN)', () => {
    const items = mergeEvents([batchEvent('RETAIN', [BASH], 1)])
    expect(items).toHaveLength(1)
    expect(items[0]!.toolName).toBe('Bash')
    expect(items[0]!.summary).toBe('npm test')
    expect(items[0]!.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ labelKey: 'command', text: 'npm test' }),
        expect.objectContaining({ labelKey: 'response', text: 'PASS 3 tests' }),
      ])
    )
    expect(redactedBlocks(items)).toEqual([])
  })

  it('expands a call only once when two batches repeat it', () => {
    const items = mergeEvents([
      batchEvent('RETAIN', [BASH], 1),
      { ...batchEvent('RETAIN', [BASH], 2) },
    ])
    expect(countToolCalls(items)).toBe(1)
  })

  it('reads sizes for tool_calls.1 without picking up tool_calls.10', () => {
    // 11 calls; only index 1 lacks its own Pre/Post.
    const calls: Call[] = Array.from({ length: 11 }, (_, i) => ({
      ...WRITE,
      id: `toolu_w${i}`,
      input: { file_path: `/repo/f${i}.ts`, content: 'x'.repeat(i + 1) },
      result: `ok ${i}`,
    }))
    const recorded = calls.filter((_, i) => i !== 1)
    const items = mergeEvents([
      ...recorded.flatMap(c => [
        preEvent('USED_UP', c, 1),
        postEvent('USED_UP', c, 2),
      ]),
      batchEvent('USED_UP', calls, 3),
    ])
    expect(countToolCalls(items)).toBe(11)
    const lone = items.find(i => i.summary === '/repo/f1.ts')!
    expect(lone.details).toEqual([
      expect.objectContaining({
        labelKey: 'content',
        redacted: { lines: 1, bytes: 2 },
      }),
      expect.objectContaining({
        labelKey: 'response',
        redacted: { lines: 1, bytes: Buffer.byteLength('ok 1') },
      }),
    ])
    // Every Write body reported exactly once across the whole timeline:
    // Σ(i+1) for the 11 bodies + the one expanded call's result text.
    const bodies = calls.reduce((n, _, i) => n + i + 1, 0)
    expect(totalRedactedBytes(items)).toBe(bodies + Buffer.byteLength('ok 1'))
  })
})

describe('PostToolBatch completing a call whose Post is missing', () => {
  it('adds the result to the pending row without a second row', () => {
    const items = mergeEvents([
      preEvent('USED_UP', READ, 1),
      batchEvent('USED_UP', [READ], 2),
    ])
    expect(items.map(i => [i.kind, i.toolName])).toEqual([['orphan', 'Read']])
    expect(countToolCalls(items)).toBe(1)
    expect(redactedBlocks(items)).toEqual([
      expect.objectContaining({
        labelKey: 'response',
        redacted: {
          lines: READ.result.split('\n').length,
          bytes: Buffer.byteLength(READ.result),
        },
      }),
    ])
  })

  it('shows the recorded result text on the pending row (RETAIN)', () => {
    const items = mergeEvents([
      preEvent('RETAIN', BASH, 1),
      batchEvent('RETAIN', [BASH], 2),
    ])
    expect(items).toHaveLength(1)
    expect(items[0]!.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ labelKey: 'response', text: 'PASS 3 tests' }),
      ])
    )
  })
})

describe('pruned or deleted PostToolBatch', () => {
  it.each([
    ['pruned', buildPrunedPayload(at(0), 90)],
    ['deleted', buildUserDeletedPayload(at(0), 'member_1')],
  ])('adds no stray row for a %s batch', (_label, payload) => {
    const items = mergeEvents([
      { ...preEvent('RETAIN', BASH, 1), payload },
      { ...postEvent('RETAIN', BASH, 2), payload },
      { ...batchEvent('RETAIN', [BASH], 3), payload },
    ])
    expect(items.map(i => [i.kind, i.toolName, i.pruned])).toEqual([
      ['tool', 'Bash', true],
    ])
    expect(countToolCalls(items)).toBe(1)
  })
})

describe('countToolCalls', () => {
  it('counts tool and pending rows, not prompts or stops', () => {
    const items = mergeEvents([
      {
        id: 'u1',
        type: 'USER_PROMPT_SUBMIT',
        toolName: null,
        payload: { prompt: 'go' },
        createdAt: at(0),
      },
      preEvent('RETAIN', READ, 1),
      preEvent('RETAIN', BASH, 2),
      postEvent('RETAIN', BASH, 3),
      {
        id: 's1',
        type: 'STOP',
        toolName: null,
        payload: { last_assistant_message: 'done' },
        createdAt: at(4),
      },
    ])
    expect(countToolCalls(items)).toBe(2)
  })
})
