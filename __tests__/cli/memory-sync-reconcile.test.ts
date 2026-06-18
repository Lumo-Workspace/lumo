/**
 * @jest-environment node
 */
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { diffSync } from '@/cli/src/lib/memory-reconcile'
import { applySync, type SyncBundle } from '@/cli/src/lib/apply-sync'
import { toSyncEntry } from '@/lib/services/memory/sync-file-shape'
import type { MemoryCategory, MemoryScope } from '@prisma/client'

const owned = (id: string, hash: string) => ({
  id,
  contentHash: hash,
  diskHash: hash,
})
const ref = (id: string, hash: string) => ({ id, contentHash: hash })

describe('diffSync', () => {
  it('classifies add/update/remove and is idempotent on identical state', () => {
    const plan = diffSync(
      [owned('keep', 'h1'), owned('gone', 'hX')],
      [ref('keep', 'h1'), ref('new', 'h2')]
    )
    expect(plan.add.map(e => e.id)).toEqual(['new'])
    expect(plan.remove).toEqual(['gone'])
    expect(plan.update).toEqual([])
  })

  it('UPDATE when bundle hash differs from local frontmatter hash', () => {
    const plan = diffSync([owned('x', 'old')], [ref('x', 'newhash')])
    expect(plan.update.map(e => e.id)).toEqual(['x'])
  })

  it('SKIP-drift when on-disk hash diverged from frontmatter hash (locally edited)', () => {
    const plan = diffSync(
      [{ id: 'x', contentHash: 'frontmatter', diskHash: 'edited' }],
      [ref('x', 'newhash')]
    )
    expect(plan.update).toEqual([])
    expect(plan.skipDrift).toEqual(['x'])
  })
})

// --- applySync against a real temp dir ---

const entryFor = (id: string, rule: string) => {
  const e = toSyncEntry(
    {
      id,
      scope: 'PROJECT' as MemoryScope,
      category: 'CONVENTION' as MemoryCategory,
      content: { rule, scope: 'x' },
    },
    'T'
  )
  return {
    id: e.id,
    relPath: e.relPath,
    frontmatter: e.frontmatter,
    body: e.body,
    contentHash: e.contentHash,
    indexLine: e.indexLine,
  }
}
const bundle = (entries: ReturnType<typeof entryFor>[]): SyncBundle => ({
  projectId: 'p',
  entries,
})

describe('applySync', () => {
  it('is idempotent: a second run with the same bundle is a no-op', () => {
    const root = mkdtempSync(join(tmpdir(), 'lum537-recon-'))
    const b = bundle([entryFor('m1', 'a'), entryFor('m2', 'b')])
    const first = applySync(root, b)
    expect(first.added.sort()).toEqual(['m1', 'm2'])

    const second = applySync(root, b)
    expect(second.noop).toBe(true)
    expect(second.added).toEqual([])
    expect(second.updated).toEqual([])
    expect(second.removed).toEqual([])
  })

  it('--clean removes all owned files and the managed block', () => {
    const root = mkdtempSync(join(tmpdir(), 'lum537-clean-'))
    const b = bundle([entryFor('m1', 'a')])
    applySync(root, b)
    expect(existsSync(join(root, 'team', 'm1.md'))).toBe(true)

    const cleaned = applySync(root, b, { clean: true })
    expect(cleaned.removed).toContain('m1')
    expect(existsSync(join(root, 'team', 'm1.md'))).toBe(false)
    expect(readFileSync(join(root, 'MEMORY.md'), 'utf8')).not.toContain(
      'lumo:team-memory:start'
    )
  })

  it('--dry-run writes nothing', () => {
    const root = mkdtempSync(join(tmpdir(), 'lum537-dry-'))
    const b = bundle([entryFor('m1', 'a')])
    const plan = applySync(root, b, { dryRun: true })
    expect(plan.added).toEqual(['m1'])
    expect(existsSync(join(root, 'team', 'm1.md'))).toBe(false)
    expect(existsSync(join(root, 'MEMORY.md'))).toBe(false)
  })
})
