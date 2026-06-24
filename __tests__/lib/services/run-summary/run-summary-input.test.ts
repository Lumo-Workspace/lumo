import { buildRunSummaryInput } from '@/lib/services/run-summary/run-summary-input'
import type { RawEvent } from '@/lib/services/session-summary/compact-events'

let clock = 0
function at(): Date {
  clock += 1000
  return new Date(1_700_000_000_000 + clock)
}

let idSeq = 0
function nextId(): string {
  idSeq += 1
  return `evt-${idSeq}`
}

/** A PRE+POST tool-call pair, the shape compactEvents merges into one line. */
function toolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  toolResponse: Record<string, unknown> = {}
): RawEvent[] {
  const tuid = `tool-${nextId()}`
  return [
    {
      id: nextId(),
      type: 'PRE_TOOL_USE',
      toolName,
      payload: { tool_use_id: tuid, tool_input: toolInput },
      createdAt: at(),
    },
    {
      id: nextId(),
      type: 'POST_TOOL_USE',
      toolName,
      payload: { tool_use_id: tuid, tool_response: toolResponse },
      createdAt: at(),
    },
  ]
}

function stop(message: string): RawEvent {
  return {
    id: nextId(),
    type: 'STOP',
    toolName: null,
    payload: { last_assistant_message: message },
    createdAt: at(),
  }
}

beforeEach(() => {
  clock = 0
  idSeq = 0
})

describe('buildRunSummaryInput', () => {
  it('builds run-summary input from the full event stream including edit and write tool calls', () => {
    // A delivery session: early reads, then real mutations late in the run —
    // exactly the turns the old turnSummary path never captured.
    const events: RawEvent[] = [
      ...toolCall('Read', { file_path: '/lib/run-summary.service.ts' }),
      ...toolCall(
        'Grep',
        { pattern: 'runSummary' },
        { mode: 'content', numLines: 12 }
      ),
      stop(
        'Explored the run-summary service to understand the generation path.'
      ),
      ...toolCall(
        'Edit',
        { file_path: '/lib/run-summary.service.ts' },
        { structuredPatch: [{ lines: ['+a', '-b'] }] }
      ),
      ...toolCall('Write', {
        file_path: '/lib/run-summary/run-summary-input.ts',
        content: 'export function x() {}\n',
      }),
      stop(
        'Implemented the event-stream input builder and wired it into the service.'
      ),
    ]

    const input = buildRunSummaryInput(events)

    expect(input).not.toBeNull()
    expect(input).toContain('Edit /lib/run-summary.service.ts')
    expect(input).toContain('Write /lib/run-summary/run-summary-input.ts')
    // The late delivery narration is carried by the turn-end STOP line.
    expect(input).toContain('Implemented the event-stream input builder')
  })

  it('exploration-only event stream produces an input with no mutation tool calls', () => {
    const events: RawEvent[] = [
      ...toolCall('Read', { file_path: '/app/page.tsx' }),
      ...toolCall(
        'Grep',
        { pattern: 'TODO' },
        { mode: 'files_with_matches', numFiles: 3 }
      ),
      ...toolCall('Glob', { pattern: '**/*.ts' }, { numFiles: 42 }),
      stop('Investigated the codebase structure; no changes made yet.'),
    ]

    const input = buildRunSummaryInput(events)

    expect(input).not.toBeNull()
    // The reads it actually ran are present...
    expect(input).toContain('Read /app/page.tsx')
    // ...but no mutation operations are fabricated into the input.
    expect(input).not.toMatch(/\b(Edit|MultiEdit|Write) \//)
  })

  it('returns null for an event stream with nothing to summarize', () => {
    expect(buildRunSummaryInput([])).toBeNull()
    // Only structural turn-end markers, no narration and no tool calls.
    expect(
      buildRunSummaryInput([
        {
          id: nextId(),
          type: 'STOP',
          toolName: null,
          payload: {},
          createdAt: at(),
        },
      ])
    ).toBeNull()
  })
})
