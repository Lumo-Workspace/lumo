import { Prisma } from '@prisma/client'
import type { ContentSignals } from '@/shared/src/untrusted-content'

/**
 * LUM-783 — the `contentSignals` JSON column, written the same way on every
 * source-card table. Nullable Json columns cannot take a plain `null` through
 * Prisma's typed client (it must be `Prisma.DbNull`), and an `undefined` on
 * an update must leave the column untouched — so callers spread this into
 * `data` instead of writing the field by hand.
 *
 *   undefined → {}                        (not scanned / unchanged)
 *   null      → { contentSignals: DbNull } (scanned, clean)
 *   value     → { contentSignals: value }  (scanned, hit)
 */
export function contentSignalsData(v: ContentSignals | null | undefined): {
  contentSignals?: Prisma.InputJsonValue | typeof Prisma.DbNull
} {
  if (v === undefined) return {}
  return {
    contentSignals:
      v === null ? Prisma.DbNull : (v as unknown as Prisma.InputJsonValue),
  }
}
