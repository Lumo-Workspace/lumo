import { parseStreamJsonUsage } from '@lumo/shared'

describe('parseStreamJsonUsage', () => {
  const resultLine = JSON.stringify({
    type: 'result',
    subtype: 'success',
    num_turns: 3,
    duration_ms: 1234,
    total_cost_usd: 0.0421,
    usage: {
      input_tokens: 19185,
      output_tokens: 471,
      cache_read_input_tokens: 17846,
      cache_creation_input_tokens: 17101,
    },
  })

  it('parses usage + num_turns from a stream-json result line', () => {
    expect(parseStreamJsonUsage(resultLine)).toEqual({
      inputTokens: 19185,
      outputTokens: 471,
      cacheReadTokens: 17846,
      cacheCreationTokens: 17101,
      loopCount: 3,
    })
  })

  it('finds the result line inside a multi-line stream-json log', () => {
    const log = [
      JSON.stringify({ type: 'system', subtype: 'init' }),
      JSON.stringify({ type: 'assistant', message: {} }),
      resultLine,
      '',
    ].join('\n')
    expect(parseStreamJsonUsage(log)?.loopCount).toBe(3)
  })

  it('returns null when there is no result line (crash/timeout)', () => {
    const log = JSON.stringify({ type: 'assistant', message: {} })
    expect(parseStreamJsonUsage(log)).toBeNull()
  })

  it('returns null on empty / non-JSON input', () => {
    expect(parseStreamJsonUsage('')).toBeNull()
    expect(parseStreamJsonUsage('not json\n{bad')).toBeNull()
  })

  it('defaults missing usage sub-fields to 0', () => {
    const line = JSON.stringify({
      type: 'result',
      num_turns: 1,
      usage: { input_tokens: 5, output_tokens: 2 },
    })
    expect(parseStreamJsonUsage(line)).toEqual({
      inputTokens: 5,
      outputTokens: 2,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      loopCount: 1,
    })
  })
})
