/**
 * LUM-433: MACHINE checkpointers for the context-file redundancy slim.
 *
 * Two acceptance criteria are wired to the test names below — keep them
 * BYTE-STABLE (renaming them makes jest-t.ts match zero tests and silently
 * fake-PASS; see scripts/jest-t.ts).
 *
 *  c1 — the resident CLAUDE.md actually shrank vs origin/main (measure-first:
 *       prove the slim happened on the real target, not only on references).
 *  c2 — the two safety red-line sections (Forbidden, Database Migrations) are
 *       byte-identical to origin/main; slimming must never touch them (mirrors
 *       the LUM-406 frozen-section discipline).
 *
 * The verify loop runs on the pre-merge branch, where origin/main is still the
 * un-slimmed version, so c1 holds naturally once CLAUDE.md is trimmed.
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
 * Character count using the same caliber as the CLAUDE.md soft-budget note
 * (`wc -m`): true Unicode code points, so CJK characters count as one each.
 */
function charCount(s: string): number {
  return [...s].length
}

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
  it('CLAUDE.md is strictly smaller than origin/main after slimming', () => {
    const current = charCount(currentClaudeMd())
    const base = charCount(originMainClaudeMd())
    // Sanity: the baseline is a real, non-trivial file (guards a git-show that
    // silently returned empty).
    expect(base).toBeGreaterThan(1000)
    expect(current).toBeLessThan(base)
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
