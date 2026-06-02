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
