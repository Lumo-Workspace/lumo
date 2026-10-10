/** @jest-environment node */
import { reachability } from '@/lib/security-scan/graph/query'
import type { Subgraph, GraphSymbol } from '@/lib/security-scan/graph/types'

const S = (
  id: string,
  kind: GraphSymbol['kind'],
  controls: string[] = []
): GraphSymbol => ({
  id,
  kind,
  file: 'f.ts',
  line: 1,
  name: id,
  rule: null,
  controls,
})
const graph = (
  symbols: GraphSymbol[],
  edges: Array<[string, string]>
): Subgraph => ({
  symbols,
  edges: edges.map(([from, to]) => ({ from, to })),
  files: [{ path: 'f.ts', lineCount: 10, touched: true }],
})

describe('LUM-739 graph query', () => {
  it('EXTERNAL when an entry reaches the sink with no control on the path', () => {
    const g = graph(
      [S('e', 'entry'), S('f', 'function'), S('s', 'sink')],
      [
        ['e', 'f'],
        ['f', 's'],
      ]
    )
    expect(reachability(g, 's')).toBe('EXTERNAL')
  })

  it('INTERNAL when every path from an entry crosses a control', () => {
    const g = graph(
      [S('e', 'entry', ['auth']), S('f', 'function'), S('s', 'sink')],
      [
        ['e', 'f'],
        ['f', 's'],
      ]
    )
    expect(reachability(g, 's')).toBe('INTERNAL')
    const g2 = graph(
      [S('e', 'entry'), S('f', 'function', ['zod-parse']), S('s', 'sink')],
      [
        ['e', 'f'],
        ['f', 's'],
      ]
    )
    expect(reachability(g2, 's')).toBe('INTERNAL')
  })

  it('EXTERNAL when one uncontrolled path exists next to a controlled one', () => {
    const g = graph(
      [
        S('e', 'entry'),
        S('guarded', 'function', ['auth']),
        S('plain', 'function'),
        S('s', 'sink'),
      ],
      [
        ['e', 'guarded'],
        ['guarded', 's'],
        ['e', 'plain'],
        ['plain', 's'],
      ]
    )
    expect(reachability(g, 's')).toBe('EXTERNAL')
  })

  it('UNKNOWN when no entry reaches the sink, and for unknown ids', () => {
    const g = graph([S('f', 'function'), S('s', 'sink')], [['f', 's']])
    expect(reachability(g, 's')).toBe('UNKNOWN')
    expect(reachability(g, 'nope')).toBe('UNKNOWN')
  })

  it('survives cycles', () => {
    const g = graph(
      [S('e', 'entry'), S('a', 'function'), S('b', 'function'), S('s', 'sink')],
      [
        ['e', 'a'],
        ['a', 'b'],
        ['b', 'a'],
        ['b', 's'],
      ]
    )
    expect(reachability(g, 's')).toBe('EXTERNAL')
  })
})
