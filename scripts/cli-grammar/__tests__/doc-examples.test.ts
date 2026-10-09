/**
 * LUM-415: skill-doc example guard. Every `lumo …` example in the skill docs
 * must (a) parse against the committed CLI grammar — documented examples are
 * the agent's few-shot set, and a stale one re-teaches the exact flag
 * hallucinations LUM-392 measured — and (b) cover every user-facing command
 * path, so no command ships without at least one complete invocation line.
 * grammar-drift.test.ts keeps grammar.json honest against cli/src, so this
 * suite transitively pins docs to the live CLI.
 */
import { join } from 'path'
import grammarJson from '../grammar.json'
import type { CliGrammar } from '../grammar'
import { validateSegment } from '../validate'
import {
  collectDocExamples,
  extractExampleLines,
  normalizePlaceholders,
  readSkillDescription,
  runnableGrammarPaths,
  stripInlineComment,
} from '../doc-examples'
import { extractLumoSegments } from '../parse'

const grammar = grammarJson as CliGrammar
const SKILL_ROOT = join(process.cwd(), '.claude/skills/lumo')

const examples = collectDocExamples(SKILL_ROOT)

describe('doc-example parsing helpers', () => {
  it('normalizePlaceholders neutralizes <…> tokens but spares redirections/heredocs', () => {
    expect(
      normalizePlaceholders('lumo doc update <docId> --file docs/<file>.md')
    ).toBe('lumo doc update PH --file docs/PH.md')
    expect(normalizePlaceholders('lumo task list -n 5 > out.txt 2>&1')).toBe(
      'lumo task list -n 5 > out.txt 2>&1'
    )
    expect(normalizePlaceholders("cat <<'EOF'")).toBe("cat <<'EOF'")
  })

  it('stripInlineComment cuts unquoted trailing comments only', () => {
    expect(stripInlineComment('lumo task list -n 5   # cap output')).toBe(
      'lumo task list -n 5'
    )
    expect(stripInlineComment('lumo task comment LUM-42 "fixed #123"')).toBe(
      'lumo task comment LUM-42 "fixed #123"'
    )
  })

  it('extractExampleLines takes fenced lumo lines, skips prose and output transcripts', () => {
    const md = [
      'Use `lumo task list` inline (not extracted).',
      '```bash',
      'lumo task list',
      '$ lumo whoami',
      'Next: lumo session attach LUM-42',
      '```',
      'lumo next outside any fence',
    ].join('\n')
    expect(extractExampleLines(md)).toEqual([
      { line: 3, raw: 'lumo task list' },
      { line: 4, raw: 'lumo whoami' },
    ])
  })

  it('runnableGrammarPaths returns callable nodes and exempts the internal hook surface', () => {
    const paths = runnableGrammarPaths(grammar)
    expect(paths).toContain('task list')
    expect(paths).not.toContain('task') // pure routing node
    expect(paths).toContain('priority') // parent with its own action (LUM-706)
    expect(paths).toContain('priority list')
    expect(paths.some(p => p === 'hook' || p.startsWith('hook '))).toBe(false)
  })
})

describe('skill doc examples', () => {
  it('extracts a non-trivial example set (extraction sanity)', () => {
    expect(examples.length).toBeGreaterThan(100)
  })

  it('every documented example parses against grammar — zero AST violations', () => {
    const violations: string[] = []
    for (const ex of examples) {
      for (const segment of extractLumoSegments(ex.normalized)) {
        const verdict = validateSegment(segment, grammar)
        if (verdict.kind !== 'valid') {
          violations.push(
            `${ex.file}:${ex.line} [${verdict.kind}] ${verdict.detail ?? ''}\n    ${ex.raw}`
          )
        }
      }
    }
    // Joined report so a failure prints every offending doc line verbatim.
    expect(violations.join('\n')).toBe('')
  })

  it('coverage — every user-facing command path has at least one documented example', () => {
    const covered = new Set<string>()
    for (const ex of examples) {
      for (const segment of extractLumoSegments(ex.normalized)) {
        const verdict = validateSegment(segment, grammar)
        if (verdict.kind === 'valid' && verdict.commandPath) {
          covered.add(verdict.commandPath)
        }
      }
    }
    const missing = runnableGrammarPaths(grammar).filter(p => !covered.has(p))
    expect(missing.join('\n')).toBe('')
  })

  it('SKILL.md frontmatter description cap — stays within the 1000-character hard limit', () => {
    const description = readSkillDescription(SKILL_ROOT)
    expect(description.length).toBeGreaterThan(0)
    expect(description.length).toBeLessThanOrEqual(1000)
  })
})
