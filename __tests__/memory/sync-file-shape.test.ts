/**
 * @jest-environment node
 *
 * LUM-556 follow-up — the team-memory sync index line is a resident hook in
 * MEMORY.md, so it must be clipped; the full content stays in the team/*.md
 * frontmatter + body (fetched on demand).
 */
import { truncateHeadline } from '@/lib/memory/render'
import { toSyncEntry } from '@/lib/services/memory/sync-file-shape'

describe('truncateHeadline', () => {
  it('clips a long headline to max + ellipsis and leaves a short one intact', () => {
    expect(truncateHeadline('short headline', 100)).toBe('short headline')
    const long = 'x'.repeat(250)
    const out = truncateHeadline(long, 100)
    expect(out).toBe('x'.repeat(100) + '…')
    expect(out.length).toBe(101) // 100 chars + the single ellipsis glyph
  })
})

describe('toSyncEntry index line (LUM-556 follow-up)', () => {
  it('clips the index line but keeps the full headline in the frontmatter', () => {
    const rule = `(1) ${'a'.repeat(400)} (2) ${'b'.repeat(400)}` // a folded mega-card headline
    const entry = toSyncEntry(
      {
        id: 'cmtest123',
        category: 'CONVENTION',
        scope: 'PROJECT',
        content: { rule, scope: 'everywhere' },
      } as never,
      '2026-06-19T00:00:00.000Z'
    )

    // The resident MEMORY.md line is one scannable hook, not the whole rule.
    expect(entry.indexLine.length).toBeLessThan(160)
    expect(entry.indexLine).toContain('](team/cmtest123.md) — CONVENTION')
    expect(entry.indexLine).toContain('…')

    // The full headline is preserved where it's read on demand (frontmatter).
    expect(entry.frontmatter).toContain('a'.repeat(400))
  })
})
