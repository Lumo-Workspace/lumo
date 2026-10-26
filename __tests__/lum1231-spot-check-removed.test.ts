/**
 * @jest-environment node
 *
 * LUM-1231 — the spot-check pool (LUM-819 / LUM-1191) was removed (user ruling
 * 2026-10-17, option A): the Run reviews page, `lumo spot-check`, the
 * `/api/test-case-reviews` routes and the review service / repository / pure
 * lib. The `TestCaseRunReview` table stays until a two-step migration drops it.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (f: string) => readFileSync(join(root, f), 'utf8')

describe('spot-check removed (LUM-1231)', () => {
  it('has no /api/test-case-reviews routes and no api catch-all that could serve them, so Next answers 404', () => {
    expect(existsSync(join(root, 'app/api/test-case-reviews'))).toBe(false)
    const apiSegments = readdirSync(join(root, 'app/api'), {
      withFileTypes: true,
    })
      .filter(d => d.isDirectory())
      .map(d => d.name)
    expect(apiSegments.filter(n => n.startsWith('['))).toEqual([])
  })

  it('has no /workspace/<slug>/run-reviews page', () => {
    expect(
      existsSync(join(root, 'app/workspace/[workspaceUrl]/run-reviews'))
    ).toBe(false)
  })

  it('deleted the review service, repository and pure lib', () => {
    for (const f of [
      'lib/services/test-case-review.service.ts',
      'lib/repositories/test-case-run-review.repository.ts',
      'lib/test-cases/review.ts',
      'lib/api-client/run-reviews.ts',
      'cli/src/commands/spot-check.ts',
    ]) {
      expect(existsSync(join(root, f))).toBe(false)
    }
  })

  it('`lumo spot-check` is not registered, allow-listed, in the grammar or documented', () => {
    expect(read('cli/src/index.ts')).not.toMatch(/spot-check|spotCheck/)
    expect(read('cli/src/lib/codex-rules.ts')).not.toContain("'spot-check'")
    expect(read('scripts/cli-grammar/grammar.json')).not.toContain('spot-check')
    for (const f of [
      'cli/skill/SKILL.md',
      'cli/skill/references/test-cases.md',
    ]) {
      expect(read(f)).not.toMatch(/spot-check|run-reviews/)
    }
  })

  it('keeps the TestCaseRunReview table (dropped later by a two-step migration)', () => {
    expect(read('prisma/schema.prisma')).toContain('model TestCaseRunReview {')
  })

  it('no locale keeps a runReviews.* or testCases.review.* key', () => {
    const dir = join(root, 'lib/i18n')
    for (const f of readdirSync(dir).filter(n => n.endsWith('.json'))) {
      const keys = Object.keys(
        JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, string>
      )
      expect(
        keys.filter(
          k => k.startsWith('runReviews.') || k.startsWith('testCases.review.')
        )
      ).toEqual([])
    }
  })
})
