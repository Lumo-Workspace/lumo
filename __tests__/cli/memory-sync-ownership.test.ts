/**
 * @jest-environment node
 */
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveMemoryDir } from '@/cli/src/lib/claude-memory-dir'
import { readOwned } from '@/cli/src/lib/local-memory-store'
import {
  upsertBlock,
  removeBlock,
  BLOCK_START,
} from '@/cli/src/lib/managed-block'
import { applySync, type SyncBundle } from '@/cli/src/lib/apply-sync'
import { toSyncEntry } from '@/lib/services/memory/sync-file-shape'
import type { MemoryCategory, MemoryScope } from '@prisma/client'

describe('resolveMemoryDir', () => {
  it('encodes cwd by replacing / with - under ~/.claude/projects', () => {
    expect(resolveMemoryDir('/Users/x/Desktop/lumo/lumo', '/home/x')).toBe(
      '/home/x/.claude/projects/-Users-x-Desktop-lumo-lumo/memory'
    )
  })
  it('honors an explicit --dir override', () => {
    expect(resolveMemoryDir('/any', '/home/x', '/tmp/custom')).toBe(
      '/tmp/custom'
    )
  })
})

describe('readOwned', () => {
  it('reads only files carrying the lumo team ownership marker', () => {
    const root = mkdtempSync(join(tmpdir(), 'lum537-owned-'))
    mkdirSync(join(root, 'team'))
    writeFileSync(
      join(root, 'team', 'm1.md'),
      `---\nname: a\nmetadata:\n  lumo: { id: m1, source: team, contentHash: abc }\n---\nbody\n`
    )
    writeFileSync(
      join(root, 'team', 'notmine.md'),
      `---\nname: dev\n---\nhand-written\n`
    )
    const owned = readOwned(root)
    expect(owned.map(o => o.id)).toEqual(['m1'])
    expect(owned[0]!.contentHash).toBe('abc')
  })
})

describe('managed block', () => {
  it('replaces only the managed block, leaving dev content byte-identical', () => {
    const original = `# Memory index\n\n- [my note](mine.md) — hook\n\n${BLOCK_START}\n- old\n<!-- lumo:team-memory:end -->\n\n- [tail](t.md) — x\n`
    const out = upsertBlock(original, ['- [a](team/a.md) — TRAP'])
    expect(out).toContain('- [my note](mine.md) — hook')
    expect(out).toContain('- [tail](t.md) — x')
    expect(out).toContain('- [a](team/a.md) — TRAP')
    expect(out).not.toContain('- old')
  })

  it('appends a fresh block at EOF when none exists, touching nothing above', () => {
    const original = `# Memory index\n\n- [my note](mine.md) — hook\n`
    const out = upsertBlock(original, ['- [a](team/a.md) — TRAP'])
    expect(out.startsWith(original)).toBe(true)
    expect(out).toContain(BLOCK_START)
  })

  it('removeBlock drops the block but keeps dev content', () => {
    const original = `dev line\n${BLOCK_START}\n- x\n<!-- lumo:team-memory:end -->\n`
    const out = removeBlock(original)
    expect(out).toContain('dev line')
    expect(out).not.toContain(BLOCK_START)
  })
})

// --- end-to-end ownership invariant (collateral-damage check) ---

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

describe('ownership invariant: sync never clobbers dev files', () => {
  it('leaves dev files, the locally-edited team file, and out-of-block index bytes untouched', () => {
    const root = mkdtempSync(join(tmpdir(), 'lum537-inv-'))
    const devNote = '---\nname: mine\n---\nhand-written, do not touch\n'
    const devIndex = '# Memory index\n\n- [my own note](dev-note.md) — mine\n'
    writeFileSync(join(root, 'MEMORY.md'), devIndex)
    mkdirSync(join(root, 'team'), { recursive: true })
    writeFileSync(join(root, 'dev-note.md'), devNote)

    // initial sync writes m1 + m2 cleanly
    applySync(root, bundle([entryFor('m1', 'one'), entryFor('m2', 'two')]))

    // dev edits m1 locally → drift
    const m1path = join(root, 'team', 'm1.md')
    writeFileSync(m1path, readFileSync(m1path, 'utf8') + '\nDEV EDIT\n')
    const m1AfterEdit = readFileSync(m1path, 'utf8')

    // new bundle: m1 changed (would update → must drift-skip), m2 dropped
    // (remove), m3 new (add)
    const summary = applySync(
      root,
      bundle([entryFor('m1', 'one-CHANGED'), entryFor('m3', 'three')])
    )

    expect(summary.skippedDrift).toContain('m1')
    expect(summary.removed).toContain('m2')
    expect(summary.added).toContain('m3')

    // invariants — nothing the sync doesn't own changed:
    expect(readFileSync(m1path, 'utf8')).toBe(m1AfterEdit) // drift file untouched
    expect(readFileSync(join(root, 'dev-note.md'), 'utf8')).toBe(devNote)
    expect(readFileSync(join(root, 'MEMORY.md'), 'utf8')).toContain(
      '- [my own note](dev-note.md) — mine'
    )
    // owned churn happened as expected:
    expect(existsSync(join(root, 'team', 'm2.md'))).toBe(false)
    expect(existsSync(join(root, 'team', 'm3.md'))).toBe(true)
  })
})
