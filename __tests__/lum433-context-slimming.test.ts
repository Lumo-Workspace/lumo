/**
 * LUM-433: regression guards for the context-file redundancy slim.
 *
 *  c1 — the resident CLAUDE.md stays within its soft budget (the `wc -m`
 *       ceiling from CLAUDE.md's "维护本文件" rule). This is a FIXED budget,
 *       not a vs-origin/main diff: the original "strictly smaller than
 *       origin/main" assertion was self-defeating once the slim merged to main
 *       (current == base on every branch cut from main → always failed). A
 *       fixed ceiling keeps guarding against runaway re-growth post-merge.
 *  c2 — the two safety red-line sections (Forbidden, Database Migrations) are
 *       byte-identical to origin/main; slimming must never touch them (mirrors
 *       the LUM-406 frozen-section discipline).
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '..')

/** Current working-tree CLAUDE.md. */
function currentClaudeMd(): string {
  return readFileSync(join(REPO_ROOT, 'CLAUDE.md'), 'utf8')
}

/** The committed origin/main CLAUDE.md (the un-slimmed baseline). */
function originMainClaudeMd(): string {
  return execFileSync('git', ['show', 'origin/main:CLAUDE.md'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  })
}

/**
 * Byte length — the same caliber as `wc -m CLAUDE.md` as the soft-budget rule
 * is measured in the repo's C locale (where `wc -m` == `wc -c` == UTF-8 bytes).
 * Computed via Buffer.byteLength so the result is locale-independent rather
 * than shelling out to `wc`.
 */
function byteCount(s: string): number {
  return Buffer.byteLength(s, 'utf8')
}

/**
 * Soft-budget ceiling for the resident CLAUDE.md, in `wc -m` chars — the
 * ~9500 figure documented in CLAUDE.md's "维护本文件" section. Enforced as a
 * hard regression ceiling here so the file can't silently re-grow past it.
 */
const CLAUDE_MD_BUDGET = 9500

/**
 * Extract a level-2 section: the `## <title>` heading line through (but not
 * including) the next `## ` heading or end-of-file. Throws if the heading is
 * absent so a renamed/removed red-line section fails loudly rather than passing
 * on an empty match.
 */
function extractSection(content: string, title: string): string {
  const lines = content.split('\n')
  const start = lines.findIndex(l => l.trim() === `## ${title}`)
  if (start === -1) throw new Error(`section "## ${title}" not found`)
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i]!.startsWith('## ')) {
      end = i
      break
    }
  }
  return lines.slice(start, end).join('\n')
}

describe('LUM-433 context slimming', () => {
  it('CLAUDE.md stays within the resident soft budget', () => {
    const size = byteCount(currentClaudeMd())
    // Sanity: the file is real and non-trivial (guards an empty read).
    expect(size).toBeGreaterThan(1000)
    expect(size).toBeLessThanOrEqual(CLAUDE_MD_BUDGET)
  })

  it('CLAUDE.md Forbidden and Database Migrations sections are unchanged vs origin/main', () => {
    const current = currentClaudeMd()
    const base = originMainClaudeMd()
    for (const title of ['Forbidden', 'Database Migrations']) {
      const currentSection = extractSection(current, title)
      const baseSection = extractSection(base, title)
      // Non-empty guard: both sides must actually contain the section body.
      expect(baseSection.length).toBeGreaterThan(0)
      expect(currentSection).toBe(baseSection)
    }
  })
})
