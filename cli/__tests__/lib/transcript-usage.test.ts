import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sumTranscriptUsage } from '../../src/lib/transcript-usage'

function fixture(lines: object[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'lumo-transcript-'))
  const path = join(dir, 't.jsonl')
  writeFileSync(path, lines.map(l => JSON.stringify(l)).join('\n'))
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
