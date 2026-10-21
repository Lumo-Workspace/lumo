/**
 * @jest-environment node
 *
 * LUM-1288 — the managed MEMORY.md block points at `team/INDEX.md` and keeps
 * only the top entries within a byte budget, so a large team corpus no longer
 * pushes MEMORY.md past Claude Code's ~24KB load limit.
 */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applySync, type SyncBundle } from '@/cli/src/lib/apply-sync'
import { readOwned } from '@/cli/src/lib/local-memory-store'
import {
  BLOCK_END,
  BLOCK_START,
  BLOCK_TOP_BUDGET_BYTES,
  blockLines,
  upsertBlock,
} from '@/cli/src/lib/managed-block'
import { toSyncEntry } from '@/lib/services/memory/sync-file-shape'
import type { MemoryCategory, MemoryScope } from '@prisma/client'

// A realistic, CJK-heavy rule so lines are near the 160-char index cap.
const RULE =
  '在本仓库开发时自己触发边界越界（写入疑似密钥、删测试文件、高危命令等）——本仓库自身的开发会话也会被 hook 记录入库，申辩措辞避开触发词。'

const entryFor = (i: number) => {
  const e = toSyncEntry(
    {
      id: `mem${String(i).padStart(4, '0')}`,
      scope: 'PROJECT' as MemoryScope,
      category: 'CONVENTION' as MemoryCategory,
      content: { rule: `${i} ${RULE}`, scope: 'x' },
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
const bundleOf = (n: number): SyncBundle => ({
  projectId: 'p',
  entries: Array.from({ length: n }, (_, i) => entryFor(i)),
})
const bytes = (s: string) => Buffer.byteLength(s, 'utf8')
const blockOf = (md: string) =>
  md.slice(md.indexOf(BLOCK_START), md.indexOf(BLOCK_END) + BLOCK_END.length)

const DEV = '# Memory index\n\n- [my note](mine.md) — my own hook\n'

describe('blockLines', () => {
  it('keeps a pointer, the leading lines within budget, and counts the rest', () => {
    const lines = bundleOf(320).entries.map(e => e.indexLine)
    const out = blockLines(lines)
    expect(out[0]).toContain('320 entries')
    expect(out[0]).toContain('(team/INDEX.md)')
    const kept = out.slice(1, -1)
    expect(kept).toEqual(lines.slice(0, kept.length)) // priority order kept
    expect(kept.length).toBeGreaterThan(0)
    expect(bytes(kept.join('\n'))).toBeLessThanOrEqual(BLOCK_TOP_BUDGET_BYTES)
    expect(out[out.length - 1]).toBe(
      `- …and ${320 - kept.length} more in [team/INDEX.md](team/INDEX.md)`
    )
  })

  it('lists everything with no "more" line when it all fits', () => {
    const lines = ['- [a](team/a.md) — TRAP', '- [b](team/b.md) — DECISION']
    expect(blockLines(lines)).toEqual([
      expect.stringContaining('2 entries'),
      ...lines,
    ])
  })

  it('is empty for an empty corpus', () => {
    expect(blockLines([])).toEqual([])
  })
})

describe('applySync with a large corpus', () => {
  it('keeps MEMORY.md small and writes every entry to team/INDEX.md', () => {
    const root = mkdtempSync(join(tmpdir(), 'lum1288-big-'))
    writeFileSync(join(root, 'MEMORY.md'), DEV)
    const b = bundleOf(320)
    applySync(root, b)

    const md = readFileSync(join(root, 'MEMORY.md'), 'utf8')
    expect(md.startsWith(DEV)).toBe(true) // dev content untouched
    expect(bytes(blockOf(md))).toBeLessThan(BLOCK_TOP_BUDGET_BYTES + 512)
    expect(bytes(md)).toBeLessThan(4 * 1024)

    const index = readFileSync(join(root, 'team', 'INDEX.md'), 'utf8')
    for (const e of b.entries) expect(index).toContain(e.indexLine)

    // INDEX.md is not mistaken for an owned memory file.
    expect(readOwned(root)).toHaveLength(320)
    // Idempotent: a second run changes nothing.
    const second = applySync(root, b)
    expect(second.noop).toBe(true)
    expect(readFileSync(join(root, 'MEMORY.md'), 'utf8')).toBe(md)
  })

  it('migrates an old full-list block in place', () => {
    const root = mkdtempSync(join(tmpdir(), 'lum1288-migrate-'))
    const b = bundleOf(320)
    const tail = '\n- [after](after.md) — dev line after the block\n'
    const old =
      upsertBlock(
        DEV,
        b.entries.map(e => e.indexLine)
      ) + tail
    writeFileSync(join(root, 'MEMORY.md'), old)
    expect(bytes(old)).toBeGreaterThan(24 * 1024) // the bug: over the load limit

    applySync(root, b)
    const md = readFileSync(join(root, 'MEMORY.md'), 'utf8')
    expect(md.startsWith(DEV)).toBe(true)
    expect(md.endsWith(tail)).toBe(true)
    expect(md.split(BLOCK_START)).toHaveLength(2) // still exactly one block
    expect(md).not.toContain(b.entries[319]!.indexLine)
    expect(bytes(md)).toBeLessThan(4 * 1024)
  })

  it('--clean removes team/INDEX.md and the block, keeping dev content', () => {
    const root = mkdtempSync(join(tmpdir(), 'lum1288-clean-'))
    writeFileSync(join(root, 'MEMORY.md'), DEV)
    const b = bundleOf(5)
    applySync(root, b)
    expect(existsSync(join(root, 'team', 'INDEX.md'))).toBe(true)

    applySync(root, b, { clean: true })
    expect(existsSync(join(root, 'team', 'INDEX.md'))).toBe(false)
    const md = readFileSync(join(root, 'MEMORY.md'), 'utf8')
    expect(md).not.toContain(BLOCK_START)
    expect(md).toContain('my own hook')
  })

  it('drops team/INDEX.md and the whole block when the corpus becomes empty', () => {
    const root = mkdtempSync(join(tmpdir(), 'lum1288-empty-'))
    writeFileSync(join(root, 'MEMORY.md'), DEV)
    applySync(root, bundleOf(3))
    applySync(root, { projectId: 'p', entries: [] })
    expect(existsSync(join(root, 'team', 'INDEX.md'))).toBe(false)
    const md = readFileSync(join(root, 'MEMORY.md'), 'utf8')
    expect(md).not.toContain(BLOCK_START)
    expect(md).not.toContain(BLOCK_END)
    expect(md).toContain('my own hook')
  })

  it('an empty corpus on a fresh dir writes no MEMORY.md at all', () => {
    const root = mkdtempSync(join(tmpdir(), 'lum1288-empty-fresh-'))
    const s = applySync(root, { projectId: 'p', entries: [] })
    expect(s.noop).toBe(true)
    expect(existsSync(join(root, 'MEMORY.md'))).toBe(false)
  })

  it('reports a block migration even when no memory file changes (and dry-run shows it)', () => {
    const root = mkdtempSync(join(tmpdir(), 'lum1288-migrate-noop-'))
    const b = bundleOf(320)
    applySync(root, b) // files + new-style block in place
    // Put an old full-list block back, as an older CLI would have left it.
    writeFileSync(
      join(root, 'MEMORY.md'),
      upsertBlock(
        DEV,
        b.entries.map(e => e.indexLine)
      )
    )

    const dry = applySync(root, b, { dryRun: true })
    expect(dry.added).toEqual([])
    expect(dry.updated).toEqual([])
    expect(dry.indexChanged).toBe(true)
    expect(dry.noop).toBe(false)
    expect(
      bytes(readFileSync(join(root, 'MEMORY.md'), 'utf8'))
    ).toBeGreaterThan(24 * 1024) // dry-run wrote nothing

    const real = applySync(root, b)
    expect(real.indexChanged).toBe(true)
    expect(real.noop).toBe(false)
    expect(bytes(readFileSync(join(root, 'MEMORY.md'), 'utf8'))).toBeLessThan(
      4 * 1024
    )

    const again = applySync(root, b)
    expect(again.indexChanged).toBe(false)
    expect(again.noop).toBe(true)
  })

  it('reports a recreated team/INDEX.md', () => {
    const root = mkdtempSync(join(tmpdir(), 'lum1288-index-gone-'))
    const b = bundleOf(3)
    applySync(root, b)
    rmSync(join(root, 'team', 'INDEX.md'))
    const s = applySync(root, b)
    expect(s.indexChanged).toBe(true)
    expect(s.noop).toBe(false)
    expect(existsSync(join(root, 'team', 'INDEX.md'))).toBe(true)
  })
})
