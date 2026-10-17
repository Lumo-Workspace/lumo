import {
  formatDepsList,
  resolveEdgeSelector,
  type DepEdge,
} from '../src/commands/task-deps'

const edges: DepEdge[] = [
  {
    id: 'e1aaaaaaaaaaaa',
    direction: 'BLOCKED_BY',
    kind: 'BLOCKS',
    source: 'MANUAL',
    status: 'CONFIRMED',
    reason: null,
    detail: null,
    other: { identifier: 'LUM-9', title: 'auth', status: 'IN_PROGRESS' },
  },
  {
    id: 'e2bbbbbbbbbbbb',
    direction: 'BLOCKED_BY',
    kind: 'BLOCKS',
    source: 'DETECTED',
    status: 'SUGGESTED',
    reason: 'shared_files',
    detail: { count: 5, sample: ['lib/a.ts'] },
    other: { identifier: 'LUM-30', title: 'schema', status: 'TODO' },
  },
]

describe('formatDepsList', () => {
  it('groups confirmed vs suggested with evidence and confirm hint', () => {
    const out = formatDepsList('LUM-12', edges)
    expect(out).toContain('LUM-9')
    expect(out).toContain('SUGGESTED')
    expect(out).toContain('shared_files')
    expect(out).toContain('lumo task deps confirm LUM-12 e2bbbbbb')
  })
  it('renders empty state', () => {
    expect(formatDepsList('LUM-12', [])).toBe('No dependencies on LUM-12.')
  })
})

describe('resolveEdgeSelector', () => {
  it('matches by edge id prefix (>=6 chars)', () => {
    expect(resolveEdgeSelector(edges, 'e2bbbbbb')?.id).toBe('e2bbbbbbbbbbbb')
  })
  it('matches by other-task identifier case-insensitively', () => {
    expect(resolveEdgeSelector(edges, 'lum-9')?.id).toBe('e1aaaaaaaaaaaa')
  })
  it('returns null on ambiguity or no match', () => {
    expect(resolveEdgeSelector(edges, 'e')).toBeNull()
    expect(resolveEdgeSelector(edges, 'LUM-999')).toBeNull()
  })
})
