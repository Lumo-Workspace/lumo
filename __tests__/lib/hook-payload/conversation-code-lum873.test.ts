/**
 * LUM-873 option C (user ruling 2026-10-03) — in a used-up workspace the
 * conversation fields keep their prose and lose their code: the top-level
 * `prompt` / `last_assistant_message`, a Task / Agent / WebFetch
 * `tool_input.prompt` and TodoWrite item text. The removed code is counted in
 * `_lumo_redacted` under the field's own path.
 */
import { createHash } from 'crypto'
import {
  readRedactedStats,
  stripCodeFromHookPayload,
  sumRedactedStats,
} from '@/lib/hook-payload/redact'
import { CODE_OMITTED_MARKER } from '@/lib/ai-derived/strip-code'
import {
  compactEvents,
  extractSessionMetadata,
  type RawEvent,
} from '@/lib/services/session-summary/compact-events'
import { buildRunSummaryInput } from '@/lib/services/run-summary/run-summary-input'
import { classifyTurnSource } from '@/lib/services/memory/layer1-prompt'
import { mergeEvents } from '@/app/sessions/[id]/merge-events'

const FENCE = '```'
const CODE_LINES = [
  'export function charge(amount: number) {',
  '  return amount * 2',
  '}',
]
const FENCED = [`${FENCE}ts`, ...CODE_LINES, FENCE].join('\n')
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const statsFor = (s: string) => ({
  bytes: Buffer.byteLength(s),
  lines: s.split('\n').length,
  sha256: sha(s),
})

const PROMPT = [
  'Please fix the billing bug in LUM-13.',
  FENCED,
  'It doubles every charge.',
].join('\n')
const LAST = [
  'Fixed the doubling in lib/billing.ts.',
  'const total = charge(amount);',
  'All tests pass now.',
].join('\n')

describe('LUM-873 conversation fields keep prose, lose code', () => {
  it('prompt and last_assistant_message keep only text with correct stats', () => {
    const prompt = stripCodeFromHookPayload('USER_PROMPT_SUBMIT', {
      session_id: 's1',
      prompt: PROMPT,
    })
    expect(prompt.prompt).toBe(
      [
        'Please fix the billing bug in LUM-13.',
        CODE_OMITTED_MARKER,
        'It doubles every charge.',
      ].join('\n')
    )
    expect(readRedactedStats(prompt, 'prompt')).toEqual(statsFor(FENCED))
    expect(JSON.stringify(prompt)).not.toContain('amount * 2')

    const stop = stripCodeFromHookPayload('STOP', {
      last_assistant_message: LAST,
    })
    expect(stop.last_assistant_message).toBe(
      [
        'Fixed the doubling in lib/billing.ts.',
        CODE_OMITTED_MARKER,
        'All tests pass now.',
      ].join('\n')
    )
    expect(readRedactedStats(stop, 'last_assistant_message')).toEqual(
      statsFor('const total = charge(amount);')
    )
  })

  it('Task and WebFetch prompts and todo text lose code, stats under tool_input', () => {
    const task = stripCodeFromHookPayload('POST_TOOL_USE', {
      tool_name: 'Task',
      tool_input: {
        description: 'Fix billing',
        subagent_type: 'general',
        prompt: PROMPT,
      },
      tool_response: { status: 'completed', agentId: 'abeaba01ea909a7ee' },
    })
    const input = task.tool_input as Record<string, unknown>
    expect(input.prompt).toContain('Please fix the billing bug in LUM-13.')
    expect(input.prompt).not.toContain('amount * 2')
    expect(sumRedactedStats(task, 'tool_input')).toEqual({
      bytes: Buffer.byteLength(FENCED),
      lines: 5,
    })

    const fetched = stripCodeFromHookPayload('PRE_TOOL_USE', {
      tool_name: 'WebFetch',
      tool_input: { url: 'https://x.dev', prompt: `Check this:\n${FENCED}` },
    })
    expect((fetched.tool_input as Record<string, unknown>).prompt).toBe(
      `Check this:\n${CODE_OMITTED_MARKER}`
    )

    const todos = stripCodeFromHookPayload('PRE_TOOL_USE', {
      tool_name: 'TodoWrite',
      tool_input: {
        todos: [
          {
            content: 'Replace const total = charge(amount);',
            status: 'pending',
          },
          { content: 'Run the tests', status: 'pending' },
        ],
      },
    })
    const items = (todos.tool_input as { todos: Record<string, unknown>[] })
      .todos
    expect(items[1]!.content).toBe('Run the tests')
    expect(readRedactedStats(todos, 'tool_input.todos.1.content')).toBeNull()
    expect(
      readRedactedStats(todos, 'tool_input.todos.0.content')
    ).not.toBeNull()
  })

  it('prose without code is stored unchanged with no stats', () => {
    const stop = stripCodeFromHookPayload('STOP', {
      last_assistant_message:
        'Done. Updated `lib/billing.ts` and ran npm test.',
    })
    expect(stop).toEqual({
      last_assistant_message:
        'Done. Updated `lib/billing.ts` and ran npm test.',
    })
  })

  it('turn, session and run summary inputs still carry the prose', () => {
    const at = (s: number) => new Date(`2026-10-03T10:00:0${s}Z`)
    const raw: Array<
      [RawEvent['type'], string | null, Record<string, unknown>]
    > = [
      ['USER_PROMPT_SUBMIT', null, { prompt: PROMPT }],
      [
        'PRE_TOOL_USE',
        'Task',
        {
          tool_use_id: 't1',
          tool_name: 'Task',
          tool_input: { description: 'Fix billing', prompt: PROMPT },
        },
      ],
      [
        'POST_TOOL_USE',
        'Task',
        {
          tool_use_id: 't1',
          tool_name: 'Task',
          tool_input: { description: 'Fix billing', prompt: PROMPT },
          tool_response: { status: 'completed' },
        },
      ],
      ['STOP', null, { last_assistant_message: LAST }],
    ]
    const events: RawEvent[] = raw.map(([type, toolName, payload], i) => ({
      id: `e${i}`,
      type,
      toolName,
      payload: stripCodeFromHookPayload(type, payload),
      createdAt: at(i),
    }))

    const turn = compactEvents(events, { maxToolCalls: 80 }).text
    expect(turn).toContain('Fixed the doubling in lib/billing.ts.')
    expect(turn).toContain('Please fix the billing bug in LUM-13.')
    expect(turn).not.toContain('amount * 2')
    expect(classifyTurnSource(events).trivial).toBe(false)

    const session = extractSessionMetadata(events)
    expect(session.firstAssistantMessage).toContain('Fixed the doubling')

    const run = buildRunSummaryInput(events)
    expect(run).not.toBeNull()
    expect(run).toContain('All tests pass now.')
    expect(run).not.toContain('charge(amount)')

    const items = mergeEvents(events as Parameters<typeof mergeEvents>[0])
    const stopItem = items.find(i => i.kind === 'stop')!
    expect(stopItem.details.map(d => [d.labelKey, d.variant])).toEqual([
      ['lastMessage', 'text'],
      ['lastMessage', 'redacted'],
    ])
    const promptItem = items.find(i => i.kind === 'user-prompt')!
    expect(
      promptItem.details.find(d => d.variant === 'redacted')?.redacted
    ).toEqual({
      lines: 5,
      bytes: Buffer.byteLength(FENCED),
    })
  })
})
