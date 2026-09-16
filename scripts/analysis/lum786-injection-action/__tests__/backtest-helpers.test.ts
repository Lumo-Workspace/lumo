/**
 * LUM-786 — the pure helpers `backtest.ts` uses to turn production rows into
 * the shapes `correlate.ts` consumes, and to bucket the read-out.
 *
 * These decide what the backtest sees: `payloadText` picks which fields of a
 * hook payload count as "the action", `literalBucket` decides which fragments
 * the matched placebo may pair, and the bucketers shape the lag/turn
 * histograms the window decision rests on. Getting one of them silently wrong
 * would move the spec's numbers without failing anything else.
 *
 * Importing this file must NOT open a database connection — `backtest.ts`
 * guards its `main()` behind `require.main === module` for exactly that reason.
 */
import {
  bucketLag,
  bucketTurn,
  literalBucket,
  makeRand,
  mergeVocab,
  payloadText,
  repoVocabulary,
  signalCount,
} from '../backtest'
import { buildVocabulary } from '../correlate'

describe('payloadText', () => {
  it('reads the fields that carry what an action actually does', () => {
    const text = payloadText({
      tool_input: {
        command: 'npm install left-pad-evil',
        description: 'ignored — not an executed field',
      },
    })
    expect(text).toContain('npm install left-pad-evil')
    expect(text).not.toContain('ignored')
  })

  it('joins several input fields so an Edit carries both path and new text', () => {
    const text = payloadText({
      tool_input: { file_path: 'lib/a.ts', new_string: 'const x = 1' },
    })
    expect(text.split('\n')).toEqual(['lib/a.ts', 'const x = 1'])
  })

  it('returns empty string for payloads with no usable input', () => {
    expect(payloadText(null)).toBe('')
    expect(payloadText({})).toBe('')
    expect(payloadText({ tool_input: { replace_all: true } })).toBe('')
  })
})

describe('signalCount', () => {
  it('reads a LUM-783 contentSignals column', () => {
    expect(
      signalCount({
        counts: { IMPERATIVE: 2 },
        wrapperEscapes: 1,
        total: 3,
        scannedAt: '2026-09-16T00:00:00.000Z',
      })
    ).toBe(3)
  })

  it('treats null / unparseable columns as no signal, never as a crash', () => {
    expect(signalCount(null)).toBe(0)
    expect(signalCount({ nonsense: true })).toBe(0)
  })
})

describe('literalBucket', () => {
  it('puts comparable fragments in the same bucket and distant ones apart', () => {
    expect(literalBucket(1)).toBe(literalBucket(0))
    expect(literalBucket(4)).toBe(literalBucket(5))
    expect(literalBucket(2)).not.toBe(literalBucket(30))
    expect(literalBucket(100)).toBe('>10')
  })
})

describe('bucketLag / bucketTurn', () => {
  it('labels every lag, including the boundaries', () => {
    expect(bucketLag(0)).toBe('<1m')
    expect(bucketLag(59)).toBe('<1m')
    expect(bucketLag(60)).toBe('1-10m')
    expect(bucketLag(3600)).toBe('1-6h')
    expect(bucketLag(86400)).toBe('>24h')
  })

  it('reports an unknown turn distance as unknown rather than as zero', () => {
    expect(bucketTurn(null)).toBe('unknown')
    expect(bucketTurn(0)).toBe('same turn')
    expect(bucketTurn(11)).toBe('>10 turns')
  })
})

describe('mergeVocab', () => {
  it('unions the known literals of every input vocabulary', () => {
    const merged = mergeVocab(
      buildVocabulary([' lib/a.ts']),
      buildVocabulary([' lib/b.ts'])
    )
    expect(merged.known.has('lib/a.ts')).toBe(true)
    expect(merged.known.has('lib/b.ts')).toBe(true)
  })

  it('is empty for no inputs', () => {
    expect(mergeVocab().known.size).toBe(0)
  })
})

describe('makeRand', () => {
  it('is deterministic per seed, so the reservoir sample reproduces', () => {
    const a = makeRand(786)
    const b = makeRand(786)
    const first = [a(), a(), a()]
    expect([b(), b(), b()]).toEqual(first)
    expect(first.every(v => v >= 0 && v < 1)).toBe(true)
  })

  it('differs across seeds', () => {
    expect(makeRand(1)()).not.toBe(makeRand(2)())
  })
})

describe('repoVocabulary', () => {
  it('knows this repository’s own paths and dependencies, which is what makes a literal "not novel"', () => {
    const vocab = repoVocabulary()
    // A path that is tracked in this repo, and a dependency in package.json.
    expect(vocab.known.has('lib/memory/render.ts')).toBe(true)
    expect(vocab.known.has('@prisma/client')).toBe(true)
    // Something no repo file or dependency is named.
    expect(vocab.known.has('left-pad-evil')).toBe(false)
  })
})
