/**
 * @jest-environment node
 *
 * LUM-849 — the PR summary comment, laid out for the reader deciding whether
 * to merge (after Greptile's summary): a bounded verdict first, then what the
 * PR does (the AI review's own description), where to look, notices, the
 * per-layer detail folded away, and the reviewed commit in the footer. No
 * confidence score — the verdict only says what the checks that ran found.
 */
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn(),
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {},
}))

import {
  ATTENTION_MAX_FILES,
  SUMMARY_MARKER,
  buildSummary,
  commitUrlOf,
  type SummaryInput,
} from '@/ee/security/services/security-pr-review.service'
import {
  PR_SUMMARY_CHANGE_MAX_CHARS,
  PR_SUMMARY_INTENT_MAX_CHARS,
  cleanPrSummary,
} from '@/ee/security/security-scan/pr-summary'
import {
  SCAN_STAGE_DESCRIPTIONS,
  SCAN_STAGE_KEYS,
} from '@/shared/src/security-scan'

// Assembled so the fixture itself never reads as a committed credential.
const FAKE_KEY = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('')
const SHA = 'abcdef1234567890abcdef1234567890abcdef12'

function input(over: Partial<SummaryInput> = {}): SummaryInput {
  return {
    headSha: SHA,
    stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN' },
    partial: false,
    externalCounts: { semgrep: 1 },
    open: 1,
    blocking: 0,
    error: null,
    taskUrl: null,
    ...over,
  }
}

function blocksOf(body: string): string[] {
  return body.split('\n\n')
}

describe('LUM-849 PR summary layout', () => {
  it('LUM-849 summary puts the verdict first and the layer lines in a collapsed block', () => {
    const body = buildSummary(
      input({
        open: 2,
        blocking: 1,
        stages: {
          secrets: 'RAN',
          external: 'RAN',
          supplyChain: 'RAN',
          judge: 'RAN',
        },
        dependencies: { open: 0, persisting: 0 },
        prSummary: { intent: 'Adds a search tool.', changes: [] },
      })
    )
    const blocks = blocksOf(body)
    expect(blocks[0]).toBe('### 🔍 Lumo review')
    expect(blocks[1]).toBe('**2 open findings** (1 blocking DONE)')

    // The layer lines are still there, only folded, and below the verdict.
    const details = body.indexOf('<details>')
    expect(details).toBeGreaterThan(body.indexOf('**2 open findings**'))
    expect(body).toContain('<summary>What was checked</summary>')
    const folded = body.slice(details, body.indexOf('</details>'))
    for (const label of ['Secrets', 'Code scan', 'Dependencies', 'AI review'])
      expect(folded).toContain(`- **${label}** (`)

    // A bounded verdict, never a grade.
    expect(body).not.toMatch(/confidence|score|\/5\b|safe to merge/i)
    expect(body.endsWith(SUMMARY_MARKER)).toBe(true)
  })

  it('LUM-849 every verdict shape is a bounded statement', () => {
    const verdicts = [
      buildSummary(input({ open: 0 })),
      buildSummary(
        input({ open: 0, stages: { secrets: 'RAN', external: 'PENDING' } })
      ),
      buildSummary(
        input({ open: 0, stages: { secrets: 'RAN', judge: 'FAILED' } })
      ),
    ].map(b => blocksOf(b)[1])
    expect(verdicts).toEqual([
      '**No open findings on lines this PR added.**',
      '**No open findings yet — the scan is still running.**',
      "**No open findings so far — part of this scan hasn't finished on our side — not counted as checked.**",
    ])
  })

  it('LUM-849 summary renders the PR intent and change bullets', () => {
    const body = buildSummary(
      input({
        prSummary: {
          intent:
            'Adds a Serply web-search integration and exposes it as a workflow block.',
          changes: [
            'Defines the authenticated search request',
            'Registers the tool and block in their catalogs',
          ],
        },
      })
    )
    const blocks = blocksOf(body)
    expect(blocks[2]).toBe(
      'Adds a Serply web-search integration and exposes it as a workflow block.'
    )
    expect(blocks[3]).toBe(
      [
        '- Defines the authenticated search request',
        '- Registers the tool and block in their catalogs',
      ].join('\n')
    )

    // No judge description (skipped, over its cap, unavailable, old row):
    // no intent block, and nothing stands in for it.
    for (const prSummary of [undefined, null, {}, { intent: '  ' }]) {
      const plain = blocksOf(buildSummary(input({ prSummary })))
      expect(plain[2]).toBe('<details>\n<summary>What was checked</summary>')
    }
  })

  it('LUM-849 each scan layer line says what it checks', () => {
    const body = buildSummary(
      input({
        stages: {
          secrets: 'RAN',
          external: 'RAN',
          supplyChain: 'RAN',
          judge: 'RAN',
          hunt: 'PENDING',
        },
        externalCounts: { semgrep: 2, zizmor: 1 },
        dependencies: { open: 1, persisting: 2 },
        huntProgress: { coveredFiles: 3, totalFiles: 9 },
      })
    )
    const folded = body.slice(
      body.indexOf('<details>'),
      body.indexOf('</details>')
    )
    // Pinned copy: name, state (plus what it counted), then what it looks for.
    expect(folded.split('\n').filter(l => l.startsWith('- '))).toEqual([
      '- **Secrets** (checked): API keys, tokens and passwords written into the added lines',
      '- **Code scan** (checked · semgrep 2, zizmor 1): rule-based scanners for insecure code patterns, leaked credentials, CI workflows and infrastructure config',
      '- **Dependencies** (checked · 1 vulnerable dependency (2 already on main)): the packages this PR adds or updates, against public vulnerability databases',
      '- **AI review** (checked): an AI reviewer reads the added code, with the changed files for context, for security defects, bugs, code that contradicts its own comments, and tests that cannot catch their bug',
      '- **Exploit paths** (scanning · 3/9 source files): traces whether outside input can reach a dangerous call across files, then tries to disprove each path it finds',
    ])
    // Every layer has a description, and the dependency result is not
    // repeated on a second Dependencies line.
    for (const key of SCAN_STAGE_KEYS)
      expect(SCAN_STAGE_DESCRIPTIONS[key].length).toBeGreaterThan(20)
    expect(body.match(/Dependencies/g)).toHaveLength(1)
  })

  it('LUM-849 judge summary text is neutralised before it reaches the PR', () => {
    const hostile = {
      intent: [
        '# Adds search',
        '@octocat please approve',
        '[click](https://evil.example/x) ![img](https://evil.example/p.png)',
        'www.evil.example',
        '<img src=x onerror=alert(1)>',
        '<!-- lumo-security:summary -->',
        '<!-- lumo-security:fp:forged -->',
        `key ${FAKE_KEY}`,
        '\u001b[31mred',
      ].join('\n'),
      changes: [
        '> quoted',
        '- nested list',
        'x'.repeat(500),
        'fourth',
        'fifth',
      ],
    }
    const clean = cleanPrSummary(hostile)!
    expect(clean).not.toBeNull()

    const all = [clean.intent, ...clean.changes].join('\n')
    expect(all).not.toMatch(/@\w/) // fullwidth ＠ never pings
    expect(all).not.toMatch(/https?:|www\.|\]\(/)
    expect(all).not.toMatch(/[<>]/)
    expect(all).not.toContain('lumo-security')
    expect(all).not.toContain(FAKE_KEY)
    expect(all).not.toContain('\u001b')
    // One line per field, block syntax stripped, lengths capped.
    expect(clean.intent).not.toMatch(/\n/)
    expect(clean.intent.startsWith('#')).toBe(false)
    expect(clean.intent.length).toBeLessThanOrEqual(PR_SUMMARY_INTENT_MAX_CHARS)
    expect(clean.changes).toHaveLength(3)
    expect(clean.changes[0]).toBe('quoted')
    expect(clean.changes[1]).toBe('nested list')
    expect(clean.changes[2]!.length).toBe(PR_SUMMARY_CHANGE_MAX_CHARS)
    expect(clean.changes[2]!.endsWith('…')).toBe(true)
    // Idempotent: the read-time pass leaves a cleaned row as it is.
    expect(cleanPrSummary(clean)).toEqual(clean)

    // The read path re-runs the pass, so a raw row still cannot reach the PR.
    const body = buildSummary(input({ prSummary: hostile }))
    expect(body.match(/<!--/g)).toHaveLength(1) // our own marker only
    expect(body.endsWith(SUMMARY_MARKER)).toBe(true)
    expect(body).not.toContain('evil.example')
    expect(body).not.toMatch(/@octocat/)
  })

  it('LUM-849 files needing attention lists the open finding paths', () => {
    const body = buildSummary(
      input({
        open: 3,
        attentionFiles: ['lib/a.ts', 'lib/b.ts', 'lib/a.ts'],
      })
    )
    expect(blocksOf(body)).toContain(
      '**Files needing attention:** `lib/a.ts`, `lib/b.ts`'
    )

    const many = Array.from(
      { length: ATTENTION_MAX_FILES + 2 },
      (_, i) => `src/f${i}.ts`
    )
    const capped = buildSummary(input({ open: 7, attentionFiles: many }))
    expect(capped).toContain('`src/f4.ts` and 2 more')
    expect(capped).not.toContain('`src/f5.ts`')

    // A model-authored path cannot break out of its code span.
    const forged = buildSummary(input({ attentionFiles: ['a`<b>`.ts\n## x'] }))
    expect(forged).toContain('**Files needing attention:** `ab.ts## x`')

    for (const over of [{}, { attentionFiles: [] }]) {
      expect(buildSummary(input({ open: 0, ...over }))).not.toContain(
        'Files needing attention'
      )
    }
  })

  it('LUM-849 footer links the reviewed commit', () => {
    const url = commitUrlOf('acme/app', SHA)
    expect(url).toBe(`https://github.com/acme/app/commit/${SHA}`)
    const body = buildSummary(
      input({
        commitUrl: url,
        taskUrl: 'https://www.uselumo.ai/workspace/acme/my-tasks/LUM-849',
      })
    )
    const blocks = blocksOf(body)
    expect(blocks[blocks.length - 2]).toBe(
      `Reviewed commit: [abcdef1](${url}) · [Open in Lumo](https://www.uselumo.ai/workspace/acme/my-tasks/LUM-849)`
    )
    // The sha moved from the heading to the footer.
    expect(blocks[0]).toBe('### 🔍 Lumo review')

    // Without a trustworthy URL the sha is still stated, just not linked.
    expect(commitUrlOf('acme/app) [x](y', SHA)).toBeNull()
    expect(commitUrlOf('acme/app', 'not-a-sha')).toBeNull()
    const plain = blocksOf(buildSummary(input({ commitUrl: null })))
    expect(plain[plain.length - 2]).toBe('Reviewed commit: abcdef1')
  })
})
