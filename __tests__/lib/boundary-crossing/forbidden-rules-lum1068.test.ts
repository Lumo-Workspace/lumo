/**
 * @jest-environment node
 *
 * LUM-1068 — the pure `## Forbidden` parser, diff and verdict of the core's
 * deterministic rule source. Every "edited" CLAUDE.md here is an in-memory
 * string: the repository's own CLAUDE.md is only READ (never written — this
 * repository's sessions are recorded by the crossing detector).
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  FORBIDDEN_RULE_REF_PREFIX,
  forbiddenRuleId,
  forbiddenRuleSourceText,
  forbiddenRuleWeakeningVerdict,
  parseForbiddenRuleSet,
  parseForbiddenRules,
  parseStoredForbiddenRules,
  removedForbiddenRules,
  sameForbiddenRuleSet,
  sameRuleText,
} from '@/lib/boundary-crossing/forbidden-rules'
import { ruleTextPresentIn } from '@/lib/boundary-crossing/rejudge-cause'

const texts = (md: string) =>
  parseForbiddenRules(md, 'CLAUDE.md').map(r => r.text)

const DOC = `# CLAUDE.md

## Project

- Not a rule: this list is in another section

## Forbidden

- Never delete files in prisma/migrations/
- Never install new npm packages without noting it in PR description
- Never hardcode API keys or secrets
- Never push to main or develop directly

## PR Checklist

- Not a rule either
`

describe('parseForbiddenRules — the supported format', () => {
  it('reads the top-level list items of the ## Forbidden section only', () => {
    expect(texts(DOC)).toEqual([
      'Never delete files in prisma/migrations/',
      'Never install new npm packages without noting it in PR description',
      'Never hardcode API keys or secrets',
      'Never push to main or develop directly',
    ])
  })

  it("parses this repository's own CLAUDE.md (read only) to its Forbidden list", () => {
    const md = readFileSync(join(__dirname, '../../../CLAUDE.md'), 'utf8')
    const rules = parseForbiddenRules(md, 'CLAUDE.md')
    expect(rules.length).toBeGreaterThanOrEqual(4)
    expect(rules.map(r => r.text)).toContain(
      'Never push to main or develop directly'
    )
    // Nothing from the other sections (the many other bullet lists).
    for (const r of rules) expect(r.text).toMatch(/^Never /)
  })

  it('accepts *, + and ordered markers, and a heading with more words', () => {
    expect(
      texts(
        `## Forbidden actions\n* Never a\n+ Never b\n1. Never c\n2) Never d\n`
      )
    ).toEqual(['Never a', 'Never b', 'Never c', 'Never d'])
    expect(texts(`## FORBIDDEN\n- Never a\n`)).toEqual(['Never a'])
    expect(texts(`## Forbidden ##\n- Never a\n`)).toEqual(['Never a'])
  })

  it('does not recognise other heading levels, setext headings or other titles', () => {
    expect(texts(`# Forbidden\n- Never a\n`)).toEqual([])
    expect(texts(`### Forbidden\n- Never a\n`)).toEqual([])
    expect(texts(`Forbidden\n---------\n- Never a\n`)).toEqual([])
    expect(texts(`## Not Forbidden\n- Never a\n`)).toEqual([])
    expect(texts(`## Forbiddenness\n- Never a\n`)).toEqual([])
    expect(texts(`## 禁止\n- Never a\n`)).toEqual([])
    expect(texts(`##Forbidden\n- Never a\n`)).toEqual([])
  })

  it('ends at the next # / ## heading or a thematic break, not at ###', () => {
    const md = `## Forbidden\n- Never a\n### Sub\n- Never b\n## Next\n- c\n`
    expect(texts(md)).toEqual(['Never a', 'Never b'])
    expect(texts(`## Forbidden\n- Never a\n# Top\n- b\n`)).toEqual(['Never a'])
    expect(texts(`## Forbidden\n- Never a\n\n---\n\n- b\n`)).toEqual([
      'Never a',
    ])
    expect(texts(`## Forbidden\n- Never a\n* * *\n- b\n`)).toEqual(['Never a'])
  })

  it('joins continuation lines into the item, a blank line ends it', () => {
    const md = [
      '## Forbidden',
      '- Never push to main',
      '  or develop directly',
      '- Never delete migrations',
      'lazy continuation line',
      '',
      '  An indented paragraph after a blank line is not a rule',
      '',
      'A paragraph is not a rule.',
      '- Never c',
    ].join('\n')
    expect(texts(md)).toEqual([
      'Never push to main or develop directly',
      'Never delete migrations lazy continuation line',
      'Never c',
    ])
  })

  it('nested items are not part of the rule: editing or dropping one removes nothing', () => {
    const base = [
      '## Forbidden',
      '- Never delete migrations',
      '  - except squashed dev-only ones',
      '    (ask first)',
      '  1. another nested note',
      '- Never c',
    ].join('\n')
    expect(texts(base)).toEqual(['Never delete migrations', 'Never c'])
    const prev = parseForbiddenRules(base, 'CLAUDE.md')
    for (const edited of [
      base.replace('  - except squashed dev-only ones\n', ''),
      base.replace('dev-only', 'any'),
    ])
      expect(
        removedForbiddenRules(prev, parseForbiddenRules(edited, 'CLAUDE.md'))
      ).toEqual([])
  })

  it('a fence closes only on the same character, at least as long', () => {
    const md = [
      '## Forbidden',
      '````',
      '```',
      '- Never inside (a shorter fence does not close)',
      '~~~~',
      '- Never inside (another character does not close)',
      '```` trailing text does not close',
      '````',
      '- Never real',
    ].join('\n')
    expect(texts(md)).toEqual(['Never real'])
  })

  it('ignores fenced code, HTML comments, struck-through items and tables', () => {
    const md = [
      '## Forbidden',
      '```md',
      '## Forbidden',
      '- Never inside a fence',
      '```',
      '~~~',
      '- Never inside a tilde fence',
      '~~~',
      '<!-- - Never commented out -->',
      '<!--',
      '- Never in a multi-line comment',
      '-->',
      '- ~~Never struck through~~',
      '| - | not a rule |',
      '- Never real',
    ].join('\n')
    expect(texts(md)).toEqual(['Never real'])
  })

  it('a heading inside a fence does not open or close the section', () => {
    expect(texts('```\n## Forbidden\n```\n- Never a\n')).toEqual([])
    expect(texts('## Forbidden\n```\n## Other\n```\n- Never a\n')).toEqual([
      'Never a',
    ])
  })

  it('handles CRLF, several sections and duplicate items', () => {
    const md =
      '## Forbidden\r\n- Never a\r\n## X\r\n## Forbidden\r\n- Never b\r\n- never  A\r\n'
    expect(texts(md)).toEqual(['Never a', 'Never b'])
  })

  it('identity ignores formatting (case, whitespace, backticks, *, trailing punctuation), not wording', () => {
    expect(forbiddenRuleId('Never delete files in prisma/migrations/')).toBe(
      forbiddenRuleId('never delete files in `prisma/migrations/`.')
    )
    expect(forbiddenRuleId('**Never** push to main')).toBe(
      forbiddenRuleId('Never push   to main')
    )
    expect(forbiddenRuleId('Never push to main')).not.toBe(
      forbiddenRuleId('Never push to main without review')
    )
  })

  it('returns nothing for an empty or Forbidden-less file', () => {
    expect(texts('')).toEqual([])
    expect(texts('# CLAUDE.md\n\n- a\n- b\n')).toEqual([])
    expect(texts('## Forbidden\n')).toEqual([])
  })
})

describe('rule sets across CLAUDE.md and AGENTS.md', () => {
  it('unions both files; a missing file adds nothing; a text in both counts once', () => {
    const set = parseForbiddenRuleSet([
      { path: 'CLAUDE.md', content: '## Forbidden\n- Never a\n- Never b\n' },
      { path: 'AGENTS.md', content: '## Forbidden\n- never b\n- Never c\n' },
    ])
    expect(set.map(r => [r.text, r.file])).toEqual([
      ['Never a', 'CLAUDE.md'],
      ['Never b', 'CLAUDE.md'],
      ['Never c', 'AGENTS.md'],
    ])
    expect(
      parseForbiddenRuleSet([
        { path: 'CLAUDE.md', content: null },
        { path: 'AGENTS.md', content: '## Forbidden\n- Never c\n' },
      ]).map(r => r.text)
    ).toEqual(['Never c'])
  })

  it('a rule moved from CLAUDE.md to AGENTS.md is not removed', () => {
    const prev = parseForbiddenRuleSet([
      { path: 'CLAUDE.md', content: '## Forbidden\n- Never a\n' },
      { path: 'AGENTS.md', content: null },
    ])
    const next = parseForbiddenRuleSet([
      { path: 'CLAUDE.md', content: '# nothing\n' },
      { path: 'AGENTS.md', content: '## Forbidden\n- Never a\n' },
    ])
    expect(removedForbiddenRules(prev, next)).toEqual([])
    expect(sameForbiddenRuleSet(prev, next)).toBe(true)
  })

  it('source text is the compiler concatenation (CLAUDE.md, blank line, AGENTS.md)', () => {
    expect(
      forbiddenRuleSourceText([
        { path: 'CLAUDE.md', content: 'x' },
        { path: 'AGENTS.md', content: null },
      ])
    ).toBe('x\n\n')
  })
})

describe('removed rules and their verdict (same line as the existing judge)', () => {
  const prev = parseForbiddenRules(DOC, 'CLAUDE.md')
  const migrations = prev[0]!

  it('deleting a line → HIGH, blocking, text stamped', () => {
    const edited = DOC.replace(
      '- Never delete files in prisma/migrations/\n',
      ''
    )
    const removed = removedForbiddenRules(
      prev,
      parseForbiddenRules(edited, 'CLAUDE.md')
    )
    expect(removed.map(r => r.text)).toEqual([migrations.text])
    const v = forbiddenRuleWeakeningVerdict(removed[0]!, edited)
    expect(v).toEqual({
      severity: 'HIGH',
      advisory: false,
      detail: `A Forbidden rule was removed from CLAUDE.md: "${migrations.text}"`,
      target: `weakening:forbidden:${migrations.id}`,
      policyRuleRef: `${FORBIDDEN_RULE_REF_PREFIX}${migrations.id}`,
      policyRuleText: migrations.text,
    })
    // The re-judge's own predicate agrees: the text is gone.
    expect(ruleTextPresentIn(edited, v.policyRuleText)).toBe(false)
  })

  it('rewording a line → the old wording is removed → HIGH', () => {
    const edited = DOC.replace(
      'Never push to main or develop directly',
      'Avoid pushing to main'
    )
    const removed = removedForbiddenRules(
      prev,
      parseForbiddenRules(edited, 'CLAUDE.md')
    )
    expect(removed.map(r => r.text)).toEqual([
      'Never push to main or develop directly',
    ])
    expect(forbiddenRuleWeakeningVerdict(removed[0]!, edited).severity).toBe(
      'HIGH'
    )
  })

  it('moving a line out of the section / striking / commenting it out → MEDIUM advisory', () => {
    const line = '- Never hardcode API keys or secrets\n'
    const variants = [
      DOC.replace(line, '').replace(
        '## PR Checklist\n',
        `## PR Checklist\n${line}`
      ),
      DOC.replace(line, '- ~~Never hardcode API keys or secrets~~\n'),
      DOC.replace(line, '<!-- - Never hardcode API keys or secrets -->\n'),
      DOC.replace('## Forbidden\n', '## Rules\n'),
    ]
    for (const edited of variants) {
      const removed = removedForbiddenRules(
        prev,
        parseForbiddenRules(edited, 'CLAUDE.md')
      )
      expect(removed.length).toBeGreaterThan(0)
      for (const r of removed) {
        const v = forbiddenRuleWeakeningVerdict(r, edited)
        expect({
          text: r.text,
          severity: v.severity,
          advisory: v.advisory,
        }).toEqual({
          text: r.text,
          severity: 'MEDIUM',
          advisory: true,
        })
        expect(v.detail).toContain('still in the file')
      }
    }
  })

  it('reformatting only (marker, backticks, wrapping, order, case) removes nothing', () => {
    const edited = `## Forbidden

* never delete files in \`prisma/migrations/\`
1. Never push to main or develop
   directly
- Never hardcode API keys or secrets.
- Never install new npm packages without noting it in PR description
`
    expect(
      removedForbiddenRules(prev, parseForbiddenRules(edited, 'CLAUDE.md'))
    ).toEqual([])
  })

  it('adding a rule removes nothing', () => {
    const edited = DOC.replace(
      '## PR Checklist',
      '- Never force-push\n\n## PR Checklist'
    )
    expect(
      removedForbiddenRules(prev, parseForbiddenRules(edited, 'CLAUDE.md'))
    ).toEqual([])
  })
})

describe('sameRuleText — matching a literal line with an LLM extraction', () => {
  it('matches equal-after-normalisation, a trailing gloss and containment', () => {
    expect(
      sameRuleText(
        'Never delete files in `prisma/migrations/`',
        'Never delete files in prisma/migrations/'
      )
    ).toBe(true)
    expect(
      sameRuleText(
        'Never push to main or develop directly',
        'Never push to main or develop directly [protected branches]'
      )
    ).toBe(true)
    expect(
      sameRuleText(
        'Never install new npm packages without noting it in PR description',
        'Never install new npm packages'
      )
    ).toBe(true)
  })

  it('does not match different rules or tiny fragments', () => {
    expect(
      sameRuleText('Never push to main', 'Never hardcode API keys or secrets')
    ).toBe(false)
    expect(sameRuleText('Never push to main or develop', 'push')).toBe(false)
    expect(sameRuleText('', 'Never push')).toBe(false)
  })
})

describe('stored snapshot parsing', () => {
  it('keeps well-formed rules and drops anything else', () => {
    expect(
      parseStoredForbiddenRules([
        { id: 'a', text: 'Never a', file: 'CLAUDE.md', extra: 1 },
        { id: 1, text: 'x', file: 'y' },
        null,
        'str',
      ])
    ).toEqual([{ id: 'a', text: 'Never a', file: 'CLAUDE.md' }])
    expect(parseStoredForbiddenRules({})).toEqual([])
  })
})
