/**
 * @jest-environment node
 */
import { toSyncEntry } from '@/lib/services/memory/sync-file-shape'

describe('toSyncEntry', () => {
  it('produces team/<id>.md path, frontmatter with metadata.lumo marker, and a one-line index entry', () => {
    const entry = toSyncEntry(
      {
        id: 'mem_abc',
        scope: 'PROJECT',
        category: 'TRAP',
        content: {
          trigger: 'X happens',
          outcome: 'Y breaks',
          workaround: 'do Z',
        },
      },
      '2026-06-18T00:00:00.000Z'
    )

    expect(entry.relPath).toBe('team/mem_abc.md')
    expect(entry.frontmatter).toContain('source: team')
    expect(entry.frontmatter).toContain('id: mem_abc')
    expect(entry.frontmatter).toContain('category: TRAP')
    expect(entry.frontmatter).toContain(`contentHash: ${entry.contentHash}`)
    expect(entry.frontmatter).toContain('syncedAt: 2026-06-18T00:00:00.000Z')
    expect(entry.body).toContain('X happens')
    expect(entry.indexLine).toMatch(/^- \[.+\]\(team\/mem_abc\.md\) — /)
    expect(entry.description).toBe('X happens')
  })

  it('hash is stable for identical content and changes when the body changes', () => {
    const a = toSyncEntry(
      {
        id: 'm1',
        scope: 'PROJECT',
        category: 'CONVENTION',
        content: { rule: 'r', scope: 's' },
      },
      'T'
    )
    const aAgain = toSyncEntry(
      {
        id: 'm1',
        scope: 'PROJECT',
        category: 'CONVENTION',
        content: { rule: 'r', scope: 's' },
      },
      'DIFFERENT-TIMESTAMP'
    )
    const b = toSyncEntry(
      {
        id: 'm1',
        scope: 'PROJECT',
        category: 'CONVENTION',
        content: { rule: 'changed', scope: 's' },
      },
      'T'
    )
    // contentHash depends only on the body, not the syncedAt stamp
    expect(a.contentHash).toBe(aAgain.contentHash)
    expect(a.contentHash).not.toBe(b.contentHash)
  })
})
