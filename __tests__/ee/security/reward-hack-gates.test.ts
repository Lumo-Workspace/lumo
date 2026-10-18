import {
  applyRhGates,
  citedEditsInPr,
  REWARD_HACK_THRESHOLD,
} from '@/ee/security/security-scan/reward-hack-gates'
import type {
  RhItem,
  RhJudgeOutput,
} from '@/ee/security/llm/reward-hack-judge-client'

const item = (eventIds: string[], summary = 's'): RhItem =>
  ({ kind: 'test_tampering', summary, eventIds }) as unknown as RhItem

const out = (items: RhItem[], suspicion = 90): RhJudgeOutput => ({
  items,
  suspicion,
})

const base = {
  promptEventIds: new Set(['a', 'b', 'c']),
  eventFile: new Map<string, string[]>([
    ['a', ['/wt/src/in.ts']],
    ['b', ['/wt/src/gone.ts']],
    ['c', []],
  ]),
  prFiles: ['src/in.ts'],
}

describe('applyRhGates', () => {
  it('uses 0.7 as the default threshold', () => {
    expect(REWARD_HACK_THRESHOLD).toBe(0.7)
  })

  it('returns nothing below the threshold and keeps the boundary', () => {
    const items = [item(['a'])]
    expect(applyRhGates({ ...base, output: out(items, 69) })).toEqual([])
    expect(applyRhGates({ ...base, output: out(items, 70) })).toEqual(items)
  })

  it('honours a custom threshold', () => {
    const items = [item(['a'])]
    expect(
      applyRhGates({ ...base, output: out(items, 50), threshold: 0.5 })
    ).toEqual(items)
    expect(
      applyRhGates({ ...base, output: out(items, 49), threshold: 0.5 })
    ).toEqual([])
  })

  it('clamps an out-of-range suspicion into [0,100]', () => {
    const items = [item(['a'])]
    expect(applyRhGates({ ...base, output: out(items, 700) })).toEqual(items)
    expect(
      applyRhGates({ ...base, output: out(items, 700), threshold: 1.0 })
    ).toEqual(items)
    expect(
      applyRhGates({ ...base, output: out(items, -5), threshold: 0 })
    ).toEqual(items)
    expect(applyRhGates({ ...base, output: out(items, -5) })).toEqual([])
  })

  it('drops items with no cited events', () => {
    expect(applyRhGates({ ...base, output: out([item([])]) })).toEqual([])
  })

  it('drops items citing an id that was not in the prompt', () => {
    expect(
      applyRhGates({ ...base, output: out([item(['a', 'zzz'])]) })
    ).toEqual([])
  })

  it('drops items whose cited edits are all outside the PR files', () => {
    expect(applyRhGates({ ...base, output: out([item(['b'])]) })).toEqual([])
  })

  it('keeps items with at least one cited edit inside the PR', () => {
    const items = [item(['a', 'b'])]
    expect(applyRhGates({ ...base, output: out(items) })).toEqual(items)
  })

  it('keeps items citing only events without a file', () => {
    const items = [item(['c'])]
    expect(applyRhGates({ ...base, output: out(items) })).toEqual(items)
  })

  it('does not match a substring path as a PR file', () => {
    const eventFile = new Map<string, string[]>([['a', ['/wt/mysrc/in.ts']]])
    expect(
      applyRhGates({
        ...base,
        eventFile,
        output: out([item(['a'])]),
      })
    ).toEqual([])
  })

  it('keeps only the surviving items, unchanged', () => {
    const good = item(['a'], 'good')
    const result = applyRhGates({
      ...base,
      output: out([item([]), good, item(['b'])]),
    })
    expect(result).toEqual([good])
    expect(result[0]).toBe(good)
  })

  it('a write touching several files (apply_patch) survives when any of them is in the PR', () => {
    const items = [item(['p'])]
    expect(
      applyRhGates({
        ...base,
        promptEventIds: new Set(['p']),
        eventFile: new Map([['p', ['/wt/src/gone.ts', '/wt/src/in.ts']]]),
        output: out(items),
      })
    ).toEqual(items)
  })
})

describe('citedEditsInPr — judged on the final diff, not the file name', () => {
  const view = (added: string[] | null, prLines: string[] | null) => ({
    eventFile: new Map([['a', ['/wt/src/in.ts']]]),
    eventAddedLines: new Map([['a', added]]),
    prFiles: ['src/in.ts'],
    prAdded: new Map([
      ['src/in.ts', prLines === null ? null : new Set(prLines)],
    ]),
  })

  it('drops an edit whose added lines are no longer in the PR (corrected later in the same file)', () => {
    expect(
      citedEditsInPr(
        ['a'],
        view(['if (input === 42) return 7'], ['return compute(input)'])
      )
    ).toBe(false)
    expect(
      applyRhGates({
        ...view(['if (input === 42) return 7'], ['return compute(input)']),
        promptEventIds: new Set(['a']),
        output: out([item(['a'])]),
      })
    ).toEqual([])
  })

  it('keeps an edit whose added line is still among the PR added lines', () => {
    expect(
      citedEditsInPr(
        ['a'],
        view(['if (input === 42) return 7'], ['if (input === 42) return 7'])
      )
    ).toBe(true)
  })

  it('gives the benefit of the doubt when either side cannot be read', () => {
    // A removal-only edit has no added lines.
    expect(citedEditsInPr(['a'], view(null, ['anything else']))).toBe(true)
    // GitHub sent no hunks for the file.
    expect(
      citedEditsInPr(['a'], view(['if (input === 42) return 7'], null))
    ).toBe(true)
  })

  it('no cited write at all: nothing to check', () => {
    expect(citedEditsInPr(['x'], view(['line one here'], []))).toBe(true)
  })

  it('one surviving write of several is enough', () => {
    const v = {
      eventFile: new Map([
        ['a', ['/wt/src/in.ts']],
        ['b', ['/wt/src/in.ts']],
      ]),
      eventAddedLines: new Map<string, string[] | null>([
        ['a', ['gone line here']],
        ['b', ['kept line here']],
      ]),
      prFiles: ['src/in.ts'],
      prAdded: new Map([['src/in.ts', new Set(['kept line here'])]]),
    }
    expect(citedEditsInPr(['a', 'b'], v)).toBe(true)
    expect(citedEditsInPr(['a'], v)).toBe(false)
  })
})
