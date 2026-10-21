/**
 * LUM-427: tests for the context actionable-density audit. The three
 * checkpointer names below are wired into the task's MACHINE acceptance
 * criteria — keep them byte-stable.
 */
import { readdirSync } from 'node:fs'
import * as fs from 'node:fs'
import { join, relative } from 'node:path'
import {
  REPO_ROOT,
  DEFAULT_CONFIG,
  classify,
  auditContent,
  auditAll,
  discoverContextFiles,
  type Category,
} from '../audit'

const ALL_CATEGORIES: Category[] = [
  'commandSpec',
  'flagsTable',
  'codeExample',
  'whenToSuggest',
  'freeProse',
  'heading',
  'structural',
]

describe('context-budget audit', () => {
  it('context-budget audit covers all resident/loaded context files', () => {
    // Independently re-derive the target set (SKILL.md + every references/*.md +
    // CLAUDE.md) and assert the audit covers it with NO omission.
    const skillRoot = join(REPO_ROOT, 'cli', 'skill')
    const refDir = join(skillRoot, 'references')
    const expected = [
      join(skillRoot, 'SKILL.md'),
      ...readdirSync(refDir)
        .filter(f => f.endsWith('.md'))
        .map(f => join(refDir, f)),
      join(REPO_ROOT, 'CLAUDE.md'),
    ]
      .map(p => relative(REPO_ROOT, p).split('\\').join('/'))
      .sort()

    // The references dir must actually contain files (guards a glob that
    // silently matched nothing).
    expect(expected.length).toBeGreaterThan(2)
    expect(discoverContextFiles(REPO_ROOT)).toEqual(expected)

    const audits = auditAll()
    expect(audits.map(a => a.path).sort()).toEqual(expected)

    // Every covered file carries a token count and a full structural breakdown.
    for (const a of audits) {
      expect(a.tokens).toBeGreaterThan(0)
      for (const cat of ALL_CATEGORIES) {
        expect(typeof a.breakdown[cat]).toBe('number')
      }
      // Breakdown sums to the reported total — no tokens fall through the
      // classifier uncounted.
      const sum = ALL_CATEGORIES.reduce((s, c) => s + a.breakdown[c], 0)
      expect(sum).toBe(a.tokens)
    }

    // SKILL.md specifically splits out the frontmatter routing description (the
    // LUM-415 caliber) — that sub-metric must be present for it and absent for
    // the body-only files.
    const skill = audits.find(a => a.path.endsWith('SKILL.md'))!
    expect(skill.descriptionChars).toBeGreaterThan(0)
    expect(
      audits.find(a => a.path.endsWith('CLAUDE.md'))!.descriptionChars
    ).toBeUndefined()
  })

  it('context-budget audit flags only files over the prose/token budget', () => {
    // A lean, command-dense file: all actionable, small. Must NOT flag.
    const lean = [
      '# Commands',
      '',
      '- `lumo task create <title>` — create a task',
      '- `lumo task list` — list your tasks',
      '- `lumo verify` — run the acceptance loop',
      '',
      '```bash',
      'lumo task show LUM-1',
      '```',
    ].join('\n')

    // A prose-heavy file: nothing but free-prose paragraphs. Must flag prose,
    // not tokens.
    const prosey = Array.from(
      { length: 8 },
      (_, i) =>
        `This is an explanatory paragraph number ${i} that carries narrative ` +
        `guidance and reasoning but contains no command, no flag table, and no ` +
        `runnable example whatsoever, so it is pure non-actionable prose.`
    ).join('\n\n')

    // A token-heavy but actionable file: stays under the prose ratio yet blows
    // the token budget. Must flag tokens, not prose. One command bullet per line
    // keeps the content fully actionable.
    const tokenBudget = DEFAULT_CONFIG.perFileTokenBudget
    const bulk = ['# Bulk']
    while (bulk.join('\n').length / 4 <= tokenBudget * 1.1) {
      bulk.push('- `lumo task update LUM-1 --status in_progress` — bump status')
    }
    const huge = bulk.join('\n')

    const leanAudit = auditContent('lean.md', lean)
    const proseAudit = auditContent('prosey.md', prosey)
    const hugeAudit = auditContent('huge.md', huge)

    // Discriminative both ways: the lean file trips nothing…
    expect(leanAudit.flags).toEqual([])
    expect(leanAudit.proseRatio).toBeLessThanOrEqual(
      DEFAULT_CONFIG.maxProseRatio
    )
    expect(leanAudit.tokens).toBeLessThanOrEqual(tokenBudget)

    // …the prose file trips ONLY the prose flag…
    expect(proseAudit.flags).toContain('OVER_PROSE_RATIO')
    expect(proseAudit.flags).not.toContain('OVER_TOKEN_BUDGET')
    expect(proseAudit.proseRatio).toBeGreaterThan(DEFAULT_CONFIG.maxProseRatio)

    // …and the bulk file trips ONLY the token flag (it is actionable, not prose).
    expect(hugeAudit.flags).toContain('OVER_TOKEN_BUDGET')
    expect(hugeAudit.flags).not.toContain('OVER_PROSE_RATIO')
    expect(hugeAudit.tokens).toBeGreaterThan(tokenBudget)
  })

  it('classify credits commands/flags/examples/triggers and isolates free prose', () => {
    const { breakdown } = classify(
      [
        '---',
        'name: demo',
        'description: trigger when the user mentions X',
        '---',
        '## Heading',
        'A plain prose sentence.',
        '- `lumo do thing` — a command bullet',
        '| col | col |',
        '| --- | --- |',
        '```bash',
        'lumo run',
        '```',
        '## When to suggest',
        'Suggest this whenever the user asks.',
      ].join('\n')
    )
    expect(breakdown.commandSpec).toBeGreaterThan(0)
    expect(breakdown.flagsTable).toBeGreaterThan(0)
    expect(breakdown.codeExample).toBeGreaterThan(0)
    expect(breakdown.whenToSuggest).toBeGreaterThan(0) // description + section
    expect(breakdown.heading).toBeGreaterThan(0)
    expect(breakdown.freeProse).toBeGreaterThan(0) // the lone prose sentence
  })

  it('context-budget audit performs no filesystem writes to any .md', () => {
    // Spy on every filesystem mutator the audit could conceivably reach and
    // assert it touches none of them — the audit is read-only by contract
    // (criterion 3: v1 never auto-rewrites a context file).
    const mutators = [
      'writeFileSync',
      'appendFileSync',
      'writeSync',
      'truncateSync',
      'ftruncateSync',
      'rmSync',
      'unlinkSync',
      'createWriteStream',
      'openSync',
    ] as const
    const spies = mutators.map(name =>
      // Recording no-op: if the audit ever called one of these the spy captures
      // it and the assertion below fails. (A no-op is safer than a throw, which
      // could false-fail if an unrelated internal path touched a spied method.)
      jest.spyOn(fs, name as keyof typeof fs).mockImplementation((() => {
        return undefined
      }) as never)
    )

    try {
      const audits = auditAll()
      expect(audits.length).toBeGreaterThan(2)
      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled()
      }
    } finally {
      spies.forEach(s => s.mockRestore())
    }
  })
})
