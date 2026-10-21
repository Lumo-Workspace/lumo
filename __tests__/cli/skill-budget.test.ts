/**
 * @jest-environment node
 *
 * LUM-1292: the skill is served only by `lumo skill read [path]`, one file per
 * call. Codex cuts a single tool output at ~10k tokens (middle truncation) and
 * Claude Code's Bash moves output over ~30KB to a file, so every file must fit
 * one read: ≤ 24KB each, SKILL.md (read first, every time) ≤ 10KB.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, resolve, sep } from 'path'
import { skillRoot } from '@/cli/src/lib/skill-content'

const FILE_BUDGET = 24576
const SKILL_MD_BUDGET = 10240

const root = skillRoot()

function markdownFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...markdownFiles(full))
    else if (name.endsWith('.md')) out.push(full)
  }
  return out.sort()
}

const bytes = (file: string) => Buffer.byteLength(readFileSync(file, 'utf8'))
const rel = (file: string) => relative(root, file).split(sep).join('/')

describe('skill size budget (one `lumo skill read` per file)', () => {
  const files = markdownFiles(root)

  it('finds the skill files', () => {
    expect(files.map(rel)).toContain('SKILL.md')
    expect(files.length).toBeGreaterThan(5)
  })

  it(`every file is ≤ ${FILE_BUDGET} bytes`, () => {
    const over = files
      .filter(f => bytes(f) > FILE_BUDGET)
      .map(f => `${rel(f)}: ${bytes(f)} bytes`)
    expect(over).toEqual([])
  })

  it(`SKILL.md is ≤ ${SKILL_MD_BUDGET} bytes`, () => {
    expect(bytes(join(root, 'SKILL.md'))).toBeLessThanOrEqual(SKILL_MD_BUDGET)
  })

  it('every references/*.md link in SKILL.md exists', () => {
    const skill = readFileSync(join(root, 'SKILL.md'), 'utf8')
    const links = [...skill.matchAll(/\]\((references\/[^)#\s]+\.md)/g)].map(
      m => m[1]!
    )
    expect(links.length).toBeGreaterThan(5)
    expect(links.filter(l => !existsSync(join(root, l)))).toEqual([])
  })

  it('every reference file is listed in SKILL.md', () => {
    const skill = readFileSync(join(root, 'SKILL.md'), 'utf8')
    const unlisted = readdirSync(join(root, 'references'))
      .filter(f => f.endsWith('.md'))
      .filter(f => !skill.includes(`references/${f}`))
    expect(unlisted).toEqual([])
  })

  it('relative links between skill files resolve', () => {
    const broken: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(/\]\(([^)#\s]+\.md)(?:#[^)]*)?\)/g)) {
        const target = m[1]!
        if (/^[a-z]+:/i.test(target)) continue
        if (!existsSync(resolve(file, '..', target)))
          broken.push(`${rel(file)} → ${target}`)
      }
    }
    expect(broken).toEqual([])
  })

  it('SKILL.md frontmatter carries no trigger description', () => {
    const skill = readFileSync(join(root, 'SKILL.md'), 'utf8')
    const fm = skill.match(/^---\n([\s\S]*?)\n---/)
    expect(fm?.[1] ?? '').not.toMatch(/^description:/m)
  })
})
