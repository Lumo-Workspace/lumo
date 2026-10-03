import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sumTranscriptUsage } from '../../src/lib/transcript-usage'

function fixture(lines: object[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'lumo-transcript-'))
  const path = join(dir, 't.jsonl')
  writeFileSync(path, lines.map(l => JSON.stringify(l)).join('\n'))
  return path
}

/**
 * Build the real on-disk layout: <dir>/<sessionId>.jsonl plus
 * <dir>/<sessionId>/subagents/<name> for each subagent entry.
 */
function fixtureWithSubagents(
  main: object[],
  subagents: Record<string, object[]>
): string {
  const dir = mkdtempSync(join(tmpdir(), 'lumo-transcript-'))
  const sessionId = 'sess-1234'
  const path = join(dir, `${sessionId}.jsonl`)
  writeFileSync(path, main.map(l => JSON.stringify(l)).join('\n'))
  const subDir = join(dir, sessionId, 'subagents')
  mkdirSync(subDir, { recursive: true })
  for (const [name, lines] of Object.entries(subagents)) {
    writeFileSync(
      join(subDir, name),
      lines.map(l => JSON.stringify(l)).join('\n')
    )
  }
  return path
}

const usage = (i: number, o: number, cr: number, cc: number) => ({
  input_tokens: i,
  output_tokens: o,
  cache_read_input_tokens: cr,
  cache_creation_input_tokens: cc,
})

describe('sumTranscriptUsage', () => {
  it('sums usage and groups it by model', () => {
    const path = fixture([
      { type: 'user', message: {} },
      {
        type: 'assistant',
        message: { model: 'claude-opus-4-8', usage: usage(100, 10, 5, 2) },
      },
      {
        type: 'assistant',
        message: { model: 'claude-opus-4-8', usage: usage(200, 20, 7, 3) },
      },
      {
        type: 'assistant',
        message: { model: 'claude-sonnet-4-6', usage: usage(50, 5, 1, 1) },
      },
    ])
    expect(sumTranscriptUsage(path)).toEqual({
      bySubagent: {},
      total: {
        inputTokens: 350,
        outputTokens: 35,
        cacheReadTokens: 13,
        cacheCreationTokens: 6,
      },
      byModel: {
        'claude-opus-4-8': {
          input: 300,
          output: 30,
          cacheRead: 12,
          cacheCreation: 5,
        },
        'claude-sonnet-4-6': {
          input: 50,
          output: 5,
          cacheRead: 1,
          cacheCreation: 1,
        },
      },
    })
  })

  it('skips <synthetic> model entries (no real API cost)', () => {
    const path = fixture([
      {
        type: 'assistant',
        message: { model: '<synthetic>', usage: usage(999, 999, 999, 999) },
      },
      {
        type: 'assistant',
        message: { model: 'claude-opus-4-8', usage: usage(10, 1, 0, 0) },
      },
    ])
    expect(sumTranscriptUsage(path)).toEqual({
      bySubagent: {},
      total: {
        inputTokens: 10,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
      byModel: {
        'claude-opus-4-8': {
          input: 10,
          output: 1,
          cacheRead: 0,
          cacheCreation: 0,
        },
      },
    })
  })

  it('buckets entries with no model string under "unknown"', () => {
    const path = fixture([
      { type: 'assistant', message: { usage: usage(7, 1, 0, 0) } },
    ])
    expect(sumTranscriptUsage(path)).toEqual({
      bySubagent: {},
      total: {
        inputTokens: 7,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
      byModel: {
        unknown: { input: 7, output: 1, cacheRead: 0, cacheCreation: 0 },
      },
    })
  })

  it('returns null when the file is missing or unreadable', () => {
    expect(sumTranscriptUsage('/no/such/transcript.jsonl')).toBeNull()
  })

  it('returns null when there are no assistant usage entries', () => {
    const path = fixture([{ type: 'user', message: {} }])
    expect(sumTranscriptUsage(path)).toBeNull()
  })

  it('returns null when the only usage is <synthetic>', () => {
    const path = fixture([
      {
        type: 'assistant',
        message: { model: '<synthetic>', usage: usage(1, 1, 1, 1) },
      },
    ])
    expect(sumTranscriptUsage(path)).toBeNull()
  })

  it('folds subagent transcripts under <sessionId>/subagents/ into the sum', () => {
    const path = fixtureWithSubagents(
      [
        {
          type: 'assistant',
          message: { model: 'claude-opus-4-8', usage: usage(100, 10, 5, 2) },
        },
      ],
      {
        'agent-a1.jsonl': [
          {
            type: 'assistant',
            message: { model: 'claude-sonnet-4-6', usage: usage(50, 5, 1, 1) },
          },
          {
            type: 'assistant',
            message: { model: 'claude-sonnet-4-6', usage: usage(30, 3, 2, 0) },
          },
        ],
        'agent-b2.jsonl': [
          {
            type: 'assistant',
            message: { model: '<synthetic>', usage: usage(999, 999, 999, 999) },
          },
          {
            type: 'assistant',
            message: { model: 'claude-opus-4-8', usage: usage(20, 2, 0, 1) },
          },
        ],
      }
    )
    expect(sumTranscriptUsage(path)).toEqual({
      bySubagent: {
        a1: {
          total: {
            inputTokens: 80,
            outputTokens: 8,
            cacheReadTokens: 3,
            cacheCreationTokens: 1,
          },
          byModel: {
            'claude-sonnet-4-6': {
              input: 80,
              output: 8,
              cacheRead: 3,
              cacheCreation: 1,
            },
          },
        },
        b2: {
          total: {
            inputTokens: 20,
            outputTokens: 2,
            cacheReadTokens: 0,
            cacheCreationTokens: 1,
          },
          byModel: {
            'claude-opus-4-8': {
              input: 20,
              output: 2,
              cacheRead: 0,
              cacheCreation: 1,
            },
          },
        },
      },
      total: {
        inputTokens: 200,
        outputTokens: 20,
        cacheReadTokens: 8,
        cacheCreationTokens: 4,
      },
      byModel: {
        'claude-opus-4-8': {
          input: 120,
          output: 12,
          cacheRead: 5,
          cacheCreation: 3,
        },
        'claude-sonnet-4-6': {
          input: 80,
          output: 8,
          cacheRead: 3,
          cacheCreation: 1,
        },
      },
    })
  })

  it('returns subagent usage even when the main transcript has none', () => {
    const path = fixtureWithSubagents([{ type: 'user', message: {} }], {
      'agent-a1.jsonl': [
        {
          type: 'assistant',
          message: { model: 'claude-sonnet-4-6', usage: usage(10, 1, 0, 0) },
        },
      ],
    })
    expect(sumTranscriptUsage(path)).toEqual({
      bySubagent: {
        a1: {
          total: {
            inputTokens: 10,
            outputTokens: 1,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
          },
          byModel: {
            'claude-sonnet-4-6': {
              input: 10,
              output: 1,
              cacheRead: 0,
              cacheCreation: 0,
            },
          },
        },
      },
      total: {
        inputTokens: 10,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
      byModel: {
        'claude-sonnet-4-6': {
          input: 10,
          output: 1,
          cacheRead: 0,
          cacheCreation: 0,
        },
      },
    })
  })

  it('only reads agent-*.jsonl in the subagents dir, ignoring other files', () => {
    const path = fixtureWithSubagents(
      [
        {
          type: 'assistant',
          message: { model: 'claude-opus-4-8', usage: usage(10, 1, 0, 0) },
        },
      ],
      {
        'agent-a1.meta.json': [
          {
            type: 'assistant',
            message: { model: 'sneaky', usage: usage(777, 777, 777, 777) },
          },
        ],
        'notes.jsonl': [
          {
            type: 'assistant',
            message: { model: 'sneaky', usage: usage(888, 888, 888, 888) },
          },
        ],
      }
    )
    expect(sumTranscriptUsage(path)).toEqual({
      bySubagent: {},
      total: {
        inputTokens: 10,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
      byModel: {
        'claude-opus-4-8': {
          input: 10,
          output: 1,
          cacheRead: 0,
          cacheCreation: 0,
        },
      },
    })
  })

  it('skips malformed JSON lines without throwing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumo-transcript-'))
    const path = join(dir, 't.jsonl')
    writeFileSync(
      path,
      'not json\n' +
        JSON.stringify({
          type: 'assistant',
          message: { model: 'm', usage: usage(9, 0, 0, 0) },
        })
    )
    expect(sumTranscriptUsage(path)).toEqual({
      bySubagent: {},
      total: {
        inputTokens: 9,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
      byModel: { m: { input: 9, output: 0, cacheRead: 0, cacheCreation: 0 } },
    })
  })
})

describe('dedupes multi-line assistant messages by message id', () => {
  // Claude Code writes ONE assistant message as several JSONL lines (one per
  // content block), each repeating the identical usage under the same id.
  const block = (id: string | undefined, model: string, u: object) => ({
    type: 'assistant',
    message: { ...(id ? { id } : {}), model, usage: u },
  })

  it('counts a message split across lines once', () => {
    const path = fixture([
      block('msg_1', 'claude-opus-4-8', usage(100, 10, 5, 2)),
      block('msg_1', 'claude-opus-4-8', usage(100, 10, 5, 2)),
      block('msg_1', 'claude-opus-4-8', usage(100, 10, 5, 2)),
      { type: 'user', message: {} },
      block('msg_2', 'claude-opus-4-8', usage(200, 20, 7, 3)),
      block('msg_2', 'claude-opus-4-8', usage(200, 20, 7, 3)),
    ])
    expect(sumTranscriptUsage(path)).toEqual({
      bySubagent: {},
      total: {
        inputTokens: 300,
        outputTokens: 30,
        cacheReadTokens: 12,
        cacheCreationTokens: 5,
      },
      byModel: {
        'claude-opus-4-8': {
          input: 300,
          output: 30,
          cacheRead: 12,
          cacheCreation: 5,
        },
      },
    })
  })

  it('still counts every line that has no message id', () => {
    const path = fixture([
      block(undefined, 'm', usage(10, 1, 0, 0)),
      block(undefined, 'm', usage(10, 1, 0, 0)),
      block('msg_1', 'm', usage(5, 1, 0, 0)),
      block('msg_1', 'm', usage(5, 1, 0, 0)),
    ])
    expect(sumTranscriptUsage(path)?.total).toEqual({
      inputTokens: 25,
      outputTokens: 3,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    })
  })

  it('keeps skipping <synthetic> messages that repeat across lines', () => {
    const path = fixture([
      block('msg_s', '<synthetic>', usage(999, 999, 999, 999)),
      block('msg_s', '<synthetic>', usage(999, 999, 999, 999)),
      block('msg_1', 'm', usage(4, 1, 0, 0)),
      block('msg_1', 'm', usage(4, 1, 0, 0)),
    ])
    expect(sumTranscriptUsage(path)?.byModel).toEqual({
      m: { input: 4, output: 1, cacheRead: 0, cacheCreation: 0 },
    })
  })

  it('dedupes inside subagent files for total, byModel and bySubagent', () => {
    const path = fixtureWithSubagents(
      [
        block('msg_main', 'claude-opus-4-8', usage(100, 10, 0, 0)),
        block('msg_main', 'claude-opus-4-8', usage(100, 10, 0, 0)),
      ],
      {
        'agent-a1.jsonl': [
          block('msg_sub', 'claude-sonnet-4-6', usage(50, 5, 1, 1)),
          block('msg_sub', 'claude-sonnet-4-6', usage(50, 5, 1, 1)),
          block('msg_sub', 'claude-sonnet-4-6', usage(50, 5, 1, 1)),
        ],
      }
    )
    const r = sumTranscriptUsage(path)
    expect(r?.bySubagent.a1?.total).toEqual({
      inputTokens: 50,
      outputTokens: 5,
      cacheReadTokens: 1,
      cacheCreationTokens: 1,
    })
    expect(r?.total).toEqual({
      inputTokens: 150,
      outputTokens: 15,
      cacheReadTokens: 1,
      cacheCreationTokens: 1,
    })
    expect(r?.byModel['claude-sonnet-4-6']).toEqual({
      input: 50,
      output: 5,
      cacheRead: 1,
      cacheCreation: 1,
    })
  })
})
