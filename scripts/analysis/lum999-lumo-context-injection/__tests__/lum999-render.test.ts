/**
 * @jest-environment node
 *
 * LUM-999 — fixtures through the REAL renderers.
 *
 * 1. In-process, through this checkout's service + CLI renderer: every
 *    payload reaches the agent exactly once, in the section of its path.
 *    These invariants hold for every arm.
 * 2. Cross-tree, through the arm worktrees (set LUM999_TREE_BEFORE /
 *    LUM999_TREE_AFTER / LUM999_TREE_AFTERB): the arm-specific shape
 *    the benchmark depends on — bare description before, fenced after, and
 *    the inline marker on flagged session/PR-todo lines only after.
 */
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { CANARY_MARKER, buildVariants, type ContextPath } from '../fixtures'
import { renderVariant } from '../render-harness'
import { renderArm } from '../render-arms'

const variants = buildVariants()

/** The heading / block that owns a position in the rendered markdown. */
function owningSection(md: string, at: number): string {
  const before = md.slice(0, at)
  const marks: Array<[number, string]> = []
  for (const m of before.matchAll(
    /^(## [^\n]+|<untrusted-[a-z-]+>|\*\*Description\*\*:)/gm
  )) {
    marks.push([m.index, m[1] ?? ''])
  }
  return marks.length > 0 ? (marks[marks.length - 1]?.[1] ?? '') : ''
}

const EXPECTED_SECTION: Record<ContextPath, RegExp> = {
  description: /^(\*\*Description\*\*:|<untrusted-task-description>)$/,
  slack: /^## Slack Context$/,
  web: /^## Web Links$/,
  comments: /^## Comments$/,
  memory: /^## Relevant Memory/,
  session_summary: /^## Previous Sessions/,
  pr_review_todo: /^## PR review todos$/,
}

describe('in-process render (this checkout)', () => {
  it('the clean baseline carries the work order and no marker', async () => {
    const clean = variants[0]
    if (!clean) throw new Error('no clean variant')
    const { markdown } = await renderVariant(clean)
    expect(markdown).toContain('# Task: DEMO-7')
    expect(markdown).toContain('subtract(a, b)')
    expect(markdown).not.toContain(CANARY_MARKER)
  })

  it.each(variants.slice(1).map(v => [v.id, v] as const))(
    '%s: the payload reaches the agent once, in its own section',
    async (_id, v) => {
      const { markdown } = await renderVariant(v)
      const at = markdown.indexOf(CANARY_MARKER)
      expect(at).toBeGreaterThan(0)
      expect(markdown.indexOf(CANARY_MARKER, at + 1)).toBe(-1)
      if (!v.path) throw new Error('injected variant without a path')
      expect(owningSection(markdown, at)).toMatch(EXPECTED_SECTION[v.path])
    }
  )

  it('is deterministic', async () => {
    const v = variants[1]
    if (!v) throw new Error('no variant')
    expect((await renderVariant(v)).markdown).toBe(
      (await renderVariant(v)).markdown
    )
  })
})

const trees = {
  before: process.env.LUM999_TREE_BEFORE,
  after: process.env.LUM999_TREE_AFTER,
  afterB: process.env.LUM999_TREE_AFTERB,
}
const crossTree =
  trees.before && trees.after && trees.afterB ? describe : describe.skip

crossTree('cross-tree render (arm worktrees)', () => {
  const work = mkdtempSync(join(tmpdir(), 'lum999-render-'))
  const render = (tree: string | undefined, name: string) =>
    new Map(
      renderArm(tree ?? '', variants, join(work, name)).map(r => [
        r.id,
        r.markdown,
      ])
    )
  let before: Map<string, string>
  let after: Map<string, string>
  let afterB: Map<string, string>
  beforeAll(() => {
    before = render(trees.before, 'before')
    after = render(trees.after, 'after')
    afterB = render(trees.afterB, 'afterB')
  }, 600_000)

  it('renders every variant in every arm', () => {
    for (const m of [before, after, afterB])
      expect(m.size).toBe(variants.length)
  })

  it('before prints the description bare; after / after+B fence it', () => {
    const id = 'description__canary_file__plain'
    expect(before.get(id)).toMatch(/^\*\*Description\*\*: /m)
    expect(before.get(id)).not.toContain('<untrusted-task-description>')
    for (const m of [after, afterB]) {
      const md = m.get(id) ?? ''
      expect(md).toContain('<untrusted-task-description>')
      expect(owningSection(md, md.indexOf(CANARY_MARKER))).toBe(
        '<untrusted-task-description>'
      )
    }
  })

  it.each(['session_summary', 'pr_review_todo'])(
    '%s: a flagged line gets the inline ⚠ marker after, not before',
    path => {
      const id = `${path}__canary_file__flagged`
      const line = (md: string | undefined) =>
        (md ?? '').split('\n').find(l => l.includes(CANARY_MARKER)) ?? ''
      expect(line(before.get(id))).not.toContain('⚠')
      expect(line(after.get(id))).toContain('⚠')
      expect(line(afterB.get(id))).toContain('⚠')
    }
  )

  it('the plain wording draws no guard notice or marker in any arm', () => {
    for (const v of variants.filter(x => x.wording === 'plain')) {
      for (const m of [before, after, afterB])
        expect(m.get(v.id)).not.toContain('⚠')
    }
  })
})
