// __tests__/lib/context/budget.test.ts
/** @jest-environment node */
import {
  estimateTokens,
  makeBudgetSection,
  allocateBudget,
} from '@/lib/context/budget'

describe('estimateTokens', () => {
  it('approximates length / 4, rounded up', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcde')).toBe(2)
  })
})

describe('makeBudgetSection', () => {
  const cards = ['a', 'bb', 'ccc']
  const section = makeBudgetSection(
    '## H',
    cards,
    c => `FULL:${c}`,
    c => `- M:${c}`
  )

  it('computes per-card token cost from the full rendering', () => {
    expect(section.cardTokens).toEqual([
      estimateTokens('FULL:a'),
      estimateTokens('FULL:bb'),
      estimateTokens('FULL:ccc'),
    ])
  })

  it('render(all) emits heading + every full card, no manifest block', () => {
    const out = section.render(3)
    expect(out).toBe('## H\n\nFULL:a\n\nFULL:bb\n\nFULL:ccc')
  })

  it('render(partial) emits fulls then a manifest block for the rest', () => {
    const out = section.render(1)
    expect(out).toBe(
      '## H\n\nFULL:a\n\nRemaining 2 (manifest only):\n- M:bb\n- M:ccc'
    )
  })

  it('render(0) emits heading + manifest block only', () => {
    const out = section.render(0)
    expect(out).toBe(
      '## H\n\nRemaining 3 (manifest only):\n- M:a\n- M:bb\n- M:ccc'
    )
  })

  it('render of an empty section returns ""', () => {
    const empty = makeBudgetSection(
      '## H',
      [],
      c => c,
      c => c
    )
    expect(empty.render(0)).toBe('')
  })

  it('preserves blank lines inside a multi-line full card (no \\n collapse)', () => {
    const multi = makeBudgetSection(
      '## H',
      ['x'],
      () => 'line1\n\nline3', // intentional blank line inside the card
      () => '- m'
    )
    expect(multi.render(1)).toBe('## H\n\nline1\n\nline3')
  })

  it('render(fullCount > card count) renders all cards as full, no overflow', () => {
    const sec = makeBudgetSection(
      '## H',
      ['a', 'b'],
      c => `F:${c}`,
      c => `- ${c}`
    )
    expect(sec.render(99)).toBe('## H\n\nF:a\n\nF:b')
  })

  it('honors a custom card separator between full cards', () => {
    const sec = makeBudgetSection(
      '## H',
      ['a', 'b'],
      c => `F:${c}`,
      c => `- ${c}`,
      '\n'
    )
    expect(sec.render(2)).toBe('## H\n\nF:a\nF:b')
  })
})

describe('allocateBudget', () => {
  const sec = (heading: string, costs: number[]) => ({
    cardTokens: costs,
    render: (fullCount: number) => `${heading}:${fullCount}`,
  })

  it('keeps full cards greedily until the budget is exhausted, aligned to input', () => {
    const out = allocateBudget([sec('A', [100, 100]), sec('B', [100])], 250)
    expect(out).toEqual(['A:2', 'B:0'])
  })

  it('once a card overflows, all later sections are full=0', () => {
    const out = allocateBudget(
      [sec('A', [200]), sec('B', [10]), sec('C', [10])],
      150
    )
    expect(out).toEqual(['A:0', 'B:0', 'C:0'])
  })

  it('drops empty render results to "" but keeps array alignment', () => {
    const empty = { cardTokens: [], render: () => '' }
    const out = allocateBudget([empty, sec('B', [10])], 1000)
    expect(out).toEqual(['', 'B:1'])
  })
})
