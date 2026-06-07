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

describe('sumTranscriptUsage', () => {
  it('sums message.usage across assistant entries (cumulative)', () => {
    const path = fixture([
      { type: 'user', message: {} },
      {
        type: 'assistant',
        message: {
          usage: {
            input_tokens: 100,
            output_tokens: 10,
            cache_read_input_tokens: 5,
            cache_creation_input_tokens: 2,
          },
        },
      },
      {
        type: 'assistant',
        message: {
          usage: {
            input_tokens: 200,
            output_tokens: 20,
            cache_read_input_tokens: 7,
            cache_creation_input_tokens: 3,
          },
        },
      },
    ])
    expect(sumTranscriptUsage(path)).toEqual({
      inputTokens: 300,
      outputTokens: 30,
      cacheReadTokens: 12,
      cacheCreationTokens: 5,
    })
  })

  it('ignores non-assistant lines and missing usage', () => {
    const path = fixture([
      { type: 'system' },
      { type: 'assistant', message: {} },
      {
        type: 'assistant',
        message: { usage: { input_tokens: 1, output_tokens: 1 } },
      },
    ])
    expect(sumTranscriptUsage(path)).toEqual({
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    })
  })

  it('returns null when the file is missing or unreadable', () => {
    expect(sumTranscriptUsage('/no/such/transcript.jsonl')).toBeNull()
  })

  it('returns null when there are no assistant usage entries', () => {
    const path = fixture([{ type: 'user', message: {} }])
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
          message: { usage: { input_tokens: 9, output_tokens: 0 } },
        })
    )
    expect(sumTranscriptUsage(path)).toEqual({
      inputTokens: 9,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    })
  })
})
