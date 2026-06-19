import { classifyMemoryStaleness } from '../../shared/src/code-anchor'
import type { AnchorProbe } from '../../shared/src/code-anchor'

/** Probe driven by explicit present-sets; everything else is absent. */
function probeWith(files: string[], symbols: string[]): AnchorProbe {
  const f = new Set(files)
  const s = new Set(symbols)
  return {
    fileExists: p => f.has(p),
    symbolExists: n => s.has(n),
  }
}

describe('classifyMemoryStaleness — whole-memory verdict (命门)', () => {
  it('flags a memory whose every anchor is gone', () => {
    const text = 'Edit `archiveMemories` in lib/old/gone.ts when retiring.'
    const verdict = classifyMemoryStaleness(text, probeWith([], []))
    expect(verdict.stale).toBe(true)
    expect(verdict.deadAnchors).toEqual(
      expect.arrayContaining([
        { kind: 'file', value: 'lib/old/gone.ts' },
        { kind: 'symbol', value: 'archiveMemories' },
      ])
    )
    expect(verdict.anchorsFound).toBe(2)
  })

  it('does NOT flag a memory whose anchors all still exist', () => {
    const text =
      'Edit `archiveMemories` in lib/services/memory/retire.service.ts.'
    const verdict = classifyMemoryStaleness(
      text,
      probeWith(['lib/services/memory/retire.service.ts'], ['archiveMemories'])
    )
    expect(verdict.stale).toBe(false)
    expect(verdict.deadAnchors).toEqual([])
  })

  it('does NOT flag when only SOME anchors are dead (any survivor spares the memory)', () => {
    const text = '`archiveMemories` lives in lib/old/gone.ts (path renamed).'
    // symbol still exists, file is gone → mixed → NOT stale
    const verdict = classifyMemoryStaleness(
      text,
      probeWith([], ['archiveMemories'])
    )
    expect(verdict.stale).toBe(false)
    // evidence still reports the one dead anchor, but the memory is not a candidate
    expect(verdict.deadAnchors).toEqual([
      { kind: 'file', value: 'lib/old/gone.ts' },
    ])
  })

  it('does NOT treat an anchor-free memory as a candidate', () => {
    const text = 'Prefer async/await over .then() and keep handlers thin.'
    const verdict = classifyMemoryStaleness(text, probeWith([], []))
    expect(verdict.stale).toBe(false)
    expect(verdict.anchorsFound).toBe(0)
    expect(verdict.deadAnchors).toEqual([])
  })
})
