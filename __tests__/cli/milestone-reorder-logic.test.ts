/**
 * @jest-environment node
 */
import {
  resolveOrderedIds,
  computeMoveOrder,
  type MilestoneRef,
} from '@/cli/src/lib/milestone-reorder'

const MS: MilestoneRef[] = [
  { id: 'm-a', name: 'Alpha', sortOrder: 0 },
  { id: 'm-b', name: 'Beta', sortOrder: 1 },
  { id: 'm-c', name: 'Gamma', sortOrder: 2 },
]

describe('resolveOrderedIds', () => {
  it('maps a full list of names (case-insensitive) to ids in order', () => {
    const r = resolveOrderedIds(['gamma', 'Alpha', 'BETA'], MS)
    expect(r).toEqual({ ok: true, orderedIds: ['m-c', 'm-a', 'm-b'] })
  })

  it('resolves by UUID too', () => {
    const r = resolveOrderedIds(['m-c', 'm-b', 'm-a'], MS)
    expect(r).toEqual({ ok: true, orderedIds: ['m-c', 'm-b', 'm-a'] })
  })

  it('errors on an unknown ref', () => {
    const r = resolveOrderedIds(['Alpha', 'Nope', 'Beta'], MS)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('Nope')
  })

  it('errors on a duplicate ref', () => {
    const r = resolveOrderedIds(['Alpha', 'Alpha', 'Beta'], MS)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('duplicate')
  })

  it('errors on an incomplete set, listing the missing names', () => {
    const r = resolveOrderedIds(['Alpha', 'Beta'], MS)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('Gamma')
  })
})

describe('computeMoveOrder', () => {
  it('moves a milestone before a target', () => {
    const r = computeMoveOrder('Gamma', 'Alpha', 'before', MS)
    expect(r).toEqual({ ok: true, orderedIds: ['m-c', 'm-a', 'm-b'] })
  })

  it('moves a milestone after a target', () => {
    const r = computeMoveOrder('Alpha', 'Gamma', 'after', MS)
    expect(r).toEqual({ ok: true, orderedIds: ['m-b', 'm-c', 'm-a'] })
  })

  it('errors when the milestone to move is not found', () => {
    const r = computeMoveOrder('Nope', 'Alpha', 'before', MS)
    expect(r.ok).toBe(false)
  })

  it('errors when the target is not found', () => {
    const r = computeMoveOrder('Alpha', 'Nope', 'before', MS)
    expect(r.ok).toBe(false)
  })

  it('errors when moving a milestone relative to itself', () => {
    const r = computeMoveOrder('Alpha', 'Alpha', 'before', MS)
    expect(r.ok).toBe(false)
  })
})

// Milestone names are NOT unique within a project (only slug is). A name that
// matches >1 milestone must error instead of silently picking the first.
const DUP: MilestoneRef[] = [
  { id: 'm-a', name: 'Beta', sortOrder: 0, slug: 'beta' },
  { id: 'm-b', name: 'Beta', sortOrder: 1, slug: 'beta-2' },
  { id: 'm-c', name: 'Gamma', sortOrder: 2, slug: 'gamma' },
]

describe('resolveOrderedIds — ambiguous name', () => {
  it('errors when a name matches >1 milestone, listing candidates by slug (LUM-1230)', () => {
    const r = resolveOrderedIds(['Beta', 'Beta', 'Gamma'], DUP)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toMatch(/ambiguous/i)
      expect(r.error).toContain('beta ("Beta")')
      expect(r.error).toContain('beta-2 ("Beta")')
      expect(r.error).not.toContain('m-a')
    }
  })

  it('LUM-1230: resolves the duplicate-named milestones by slug', () => {
    // The exact slug wins over the (duplicated) name; `Beta` stays a name.
    const r = resolveOrderedIds(['beta-2', 'beta', 'gamma'], DUP)
    expect(r).toEqual({ ok: true, orderedIds: ['m-b', 'm-a', 'm-c'] })
  })

  it('still resolves an ambiguously-named milestone when referenced by id', () => {
    const r = resolveOrderedIds(['m-a', 'm-b', 'm-c'], DUP)
    expect(r).toEqual({ ok: true, orderedIds: ['m-a', 'm-b', 'm-c'] })
  })
})

describe('computeMoveOrder — ambiguous name', () => {
  it('errors when the moved ref name is ambiguous', () => {
    const r = computeMoveOrder('Beta', 'Gamma', 'before', DUP)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/ambiguous/i)
  })

  it('errors when the target ref name is ambiguous', () => {
    const r = computeMoveOrder('Gamma', 'Beta', 'after', DUP)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/ambiguous/i)
  })

  it('resolves ambiguously-named milestones when referenced by id', () => {
    const r = computeMoveOrder('m-c', 'm-a', 'before', DUP)
    expect(r).toEqual({ ok: true, orderedIds: ['m-c', 'm-a', 'm-b'] })
  })
})
