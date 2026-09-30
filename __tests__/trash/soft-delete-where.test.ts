/**
 * @jest-environment node
 *
 * LUM-918 — the where-clause rule of the soft-delete extension.
 */
import { withoutTrashed } from '@/lib/db/soft-delete'

describe('withoutTrashed', () => {
  it('adds deletedAt: null to a query that did not choose', () => {
    expect(withoutTrashed(undefined)).toEqual({ deletedAt: null })
    expect(withoutTrashed({ id: 't1' })).toEqual({ id: 't1', deletedAt: null })
  })

  it('leaves a query that names deletedAt untouched (the trash opts out)', () => {
    const trashed = { deletedAt: { not: null }, trashRootId: null }
    expect(withoutTrashed(trashed)).toBe(trashed)
  })
})
