/** @jest-environment node */
// LUM-737: `lumo task status` renders undispositioned security findings as
// SECURITY_FINDING next actions and fails closed on a failed scan read / an
// unscanned open PR.
import {
  formatTaskStatus,
  type TaskStatusResponse,
} from '@/cli/src/commands/task-status'

const SECURITY_ACTION = {
  kind: 'SECURITY_FINDING' as const,
  findingId: 'f1',
  statement: 'secret:aws-access-key-id at lib/cfg.ts:12 — AWS access key id',
  severity: 'HIGH' as const,
  provenance: 'DETERMINISTIC' as const,
  blocking: true,
  prNumber: 12,
  ruleId: 'secret:aws-access-key-id',
  filePath: 'lib/cfg.ts',
  line: 12,
}

/** LUM-1091: a `Label:  value` row of the report, whatever the label padding. */
function row(label: string, value: string): RegExp {
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^ +${esc(label)}: +${esc(value)}$`, 'm')
}

function payload(over: Partial<TaskStatusResponse> = {}): TaskStatusResponse {
  return {
    version: 2,
    task: {
      id: 't-1',
      identifier: 'LUM-9',
      title: 'do the thing',
      status: 'IN_PROGRESS',
    },
    nextActions: [],
    securityFindings: { open: 0, blocking: 0, unconfirmedPrs: [] },
    ...over,
  }
}

describe('lumo task status — security findings (LUM-737)', () => {
  it('renders SECURITY_FINDING actions with their blocking state', () => {
    const out = formatTaskStatus(
      payload({
        nextActions: [
          SECURITY_ACTION,
          {
            ...SECURITY_ACTION,
            findingId: 'f2',
            provenance: 'LLM_JUDGE' as const,
            blocking: false,
            line: null,
            statement: 'vuln:sqli at lib/q.ts — raw query',
            ruleId: 'vuln:sqli',
            filePath: 'lib/q.ts',
          },
        ],
        securityFindings: { open: 2, blocking: 1, unconfirmedPrs: [] },
      })
    )
    expect(out).toContain('\nNext actions (2 security findings)\n')
    expect(out).toContain(
      [
        '  • [SECURITY] [HIGH] AWS access key id',
        '    Rule:   secret:aws-access-key-id (DETERMINISTIC)',
        '    Where:  lib/cfg.ts:12 · PR #12',
        '    Gate:   blocks DONE',
      ].join('\n')
    )
    expect(out).toContain(
      [
        '  • [SECURITY] [HIGH] raw query',
        '    Rule:   vuln:sqli (LLM_JUDGE)',
        '    Where:  lib/q.ts · PR #12',
        '    Gate:   advisory',
      ].join('\n')
    )
    expect(out).toContain('Fix the findings and push')
    expect(out).toContain('lumo finding disposition')
    expect(out).toContain('Never self-approve')
  })

  it('a single finding uses the singular label', () => {
    const out = formatTaskStatus(
      payload({
        nextActions: [SECURITY_ACTION],
        securityFindings: { open: 1, blocking: 1, unconfirmedPrs: [] },
      })
    )
    expect(out).toContain('\nNext actions (1 security finding)\n')
  })

  it('fails closed: null securityFindings prints could-not-confirm, unconfirmed PRs are listed', () => {
    const nul = formatTaskStatus(payload({ securityFindings: null }))
    expect(nul).toContain(
      '⚠ Security-scan check failed — could not confirm whether any findings are undispositioned.'
    )
    const unconfirmed = formatTaskStatus(
      payload({
        securityFindings: {
          open: 0,
          blocking: 0,
          unconfirmedPrs: [
            { number: 14, reason: 'FAILED' },
            { number: 15, reason: 'NONE' },
          ],
        },
      })
    )
    expect(unconfirmed).toContain(
      "⚠ PR #14: security scan didn't finish on our side — could not confirm it is clean."
    )
    expect(unconfirmed).toContain(
      '⚠ PR #15: no security scan has run — could not confirm it is clean.'
    )
  })

  it('an older server without securityFindings prints no security lines at all', () => {
    const { securityFindings: _s, ...older } = payload()
    const out = formatTaskStatus(older as TaskStatusResponse)
    expect(out).not.toContain('Security-scan check failed')
    expect(out).not.toContain('could not confirm')
  })
})

describe('lumo task status — security rendering details (LUM-737 review)', () => {
  function zeroCriteriaPayload(
    over: Partial<TaskStatusResponse> = {}
  ): TaskStatusResponse {
    return payload({
      nextActions: [],
      securityFindings: { open: 0, blocking: 0, unconfirmedPrs: [] },
      ...over,
    })
  }

  it('renders SECURITY_FINDING next actions with the human-only hint', () => {
    const out = formatTaskStatus(
      zeroCriteriaPayload({ nextActions: [SECURITY_ACTION] })
    )
    expect(out).toContain('  • [SECURITY] [HIGH] AWS access key id\n')
    expect(out).toMatch(row('Gate', 'blocks DONE'))
    expect(out).toContain('Fix the findings and push')
    expect(out).toContain('lumo finding disposition')
    expect(out).toContain('Never self-approve')
  })

  // LUM-758 follow-up: the scanner downgrades a recognised placeholder or a
  // test/fixture path to LOW but still reports it, by design. The line has to
  // carry the cause, or an advisory row reads as an unexplained credential and
  // the reader has no way to tell it from a real leak.
  it('states why a downgraded secret finding is LOW', () => {
    const out = formatTaskStatus(
      zeroCriteriaPayload({
        nextActions: [
          {
            ...SECURITY_ACTION,
            severity: 'LOW' as const,
            blocking: false,
            filePath: '__tests__/security-scan/hunt/compress.test.ts',
            line: 219,
            secretDowngrade: 'PLACEHOLDER_VALUE',
          },
        ],
      })
    )
    expect(out).toContain('  • [SECURITY] [LOW] AWS access key id\n')
    expect(out).toMatch(
      row('Where', '__tests__/security-scan/hunt/compress.test.ts:219 · PR #12')
    )
    expect(out).toMatch(row('Gate', 'advisory — placeholder value, downgraded'))
  })

  it('leaves the line unchanged when the server sent no downgrade cause', () => {
    // An older server omits the field entirely; the line must read exactly as
    // it always did rather than growing an empty dangling separator.
    const out = formatTaskStatus(
      zeroCriteriaPayload({ nextActions: [SECURITY_ACTION] })
    )
    expect(out).toMatch(row('Gate', 'blocks DONE'))
    expect(out).not.toMatch(/downgraded|— *$/m)
  })

  it('renders the fail-closed security-scan-failed line', () => {
    const out = formatTaskStatus(
      zeroCriteriaPayload({ securityFindings: null })
    )
    expect(out).toContain(
      '⚠ Security-scan check failed — could not confirm whether any findings are undispositioned.'
    )
  })
})

describe('LUM-738 supplyChain surface — task status per-PR line', () => {
  const scanRow = (over: object) => ({
    prNumber: 12,
    status: 'FINDINGS' as const,
    stages: {
      secrets: 'RAN',
      external: 'RAN',
      supplyChain: 'RAN',
      judge: 'RAN',
    },
    partial: false,
    error: null,
    externalFindings: 0,
    openFindings: 1,
    ...over,
  })

  it('LUM-763: task status per-PR line renders the same human labels as the PR summary', () => {
    const out = formatTaskStatus(
      payload({
        securityFindings: {
          open: 1,
          blocking: 0,
          unconfirmedPrs: [],
          scans: [
            scanRow({
              stages: {
                secrets: 'RAN',
                external: 'RAN',
                supplyChain: 'RAN',
                judge: 'RAN',
                hunt: 'PARTIAL',
              },
            }),
          ],
        },
      })
    )

    expect(out).toContain('  PR #12 · scan FINDINGS\n')
    for (const [label, value] of [
      ['Secrets', 'checked'],
      ['Code scan', 'checked'],
      ['Dependencies', 'checked'],
      ['AI review', 'checked'],
      ['Exploit paths', '\u26a0 partly checked'],
    ])
      expect(out).toMatch(row(label!, value!))
    for (const key of [
      'secrets RAN',
      'external RAN',
      'supplyChain RAN',
      'judge RAN',
      'hunt ',
    ]) {
      expect(out).not.toContain(key)
    }
  })

  it('LUM-775: a merged PR line says what left the queue and why; an open PR (or an older server) prints nothing extra', () => {
    const out = formatTaskStatus(
      payload({
        securityFindings: {
          open: 0,
          blocking: 0,
          unconfirmedPrs: [],
          scans: [
            scanRow({
              openFindings: 0,
              queueExits: { MERGED_UNREVIEWED: 2, RESOLVED_ON_MAIN: 3 },
            }),
            scanRow({ prNumber: 13, queueExits: {} }),
            scanRow({ prNumber: 14 }),
          ],
        },
      })
    )
    const block = (n: number) =>
      out.split(`  PR #${n} · scan FINDINGS\n`)[1]!.split('  PR #')[0]!
    expect(block(12)).toMatch(
      row('Queue', '5 left the queue (3 resolved on main, 2 merged unreviewed)')
    )
    expect(block(13)).toMatch(row('AI review', 'checked'))
    expect(block(13)).not.toContain('left the queue')
    expect(block(14)).not.toContain('left the queue')
  })

  it('prints the supplyChain segment in order with the dependency count and its already-on-main share', () => {
    const out = formatTaskStatus(
      payload({
        securityFindings: {
          open: 1,
          blocking: 0,
          unconfirmedPrs: [],
          scans: [scanRow({ dependencyFindings: 3, persistingFindings: 2 })],
        },
      })
    )
    expect(out).toMatch(
      row('Dependencies', 'checked (3 dependency findings, 2 already on main)')
    )
    // layer order: secrets, external, supplyChain, judge
    const order = ['Secrets:', 'Code scan:', 'Dependencies:', 'AI review:'].map(
      l => out.indexOf(l)
    )
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('singular, zero, skipped, and an older server without the counts', () => {
    expect(
      formatTaskStatus(
        payload({
          securityFindings: {
            open: 0,
            blocking: 0,
            unconfirmedPrs: [],
            scans: [scanRow({ dependencyFindings: 1, persistingFindings: 0 })],
          },
        })
      )
    ).toMatch(row('Dependencies', 'checked (1 dependency finding)'))
    expect(
      formatTaskStatus(
        payload({
          securityFindings: {
            open: 0,
            blocking: 0,
            unconfirmedPrs: [],
            scans: [
              scanRow({
                stages: { secrets: 'RAN', supplyChain: 'SKIPPED' },
                dependencyFindings: 0,
              }),
            ],
          },
        })
      )
    ).toMatch(/^ +Secrets: +checked\n +Dependencies: +skipped$/m)
    // Older server: no counts → the segment is still printed, bare.
    expect(
      formatTaskStatus(
        payload({
          securityFindings: {
            open: 0,
            blocking: 0,
            unconfirmedPrs: [],
            scans: [scanRow({})],
          },
        })
      )
    ).toMatch(
      /^ +Code scan: +checked\n +Dependencies: +checked\n +AI review: +checked$/m
    )
  })
})

describe('LUM-988 code-review findings in lumo task status', () => {
  it('tags review:<kind> rows [BUG] and splits the heading count', () => {
    const out = formatTaskStatus(
      payload({
        nextActions: [
          SECURITY_ACTION,
          {
            ...SECURITY_ACTION,
            findingId: 'f2',
            provenance: 'LLM_JUDGE' as const,
            severity: 'MEDIUM' as const,
            blocking: false,
            ruleId: 'review:logic_error',
            statement: 'review:logic_error at lib/q.ts:3 — Inverted guard',
            filePath: 'lib/q.ts',
            line: 3,
          },
        ],
      })
    )
    expect(out).toContain('\nNext actions (1 security finding · 1 bug)\n')
    expect(out).toContain('  • [SECURITY] [HIGH] AWS access key id\n')
    expect(out).toContain(
      [
        '  • [BUG] [MEDIUM] Inverted guard',
        '    Rule:   review:logic_error (LLM_JUDGE)',
        '    Where:  lib/q.ts:3 · PR #12',
        '    Gate:   advisory',
      ].join('\n')
    )
  })

  it('keeps the old heading when there is no bug', () => {
    const out = formatTaskStatus(payload({ nextActions: [SECURITY_ACTION] }))
    expect(out).toContain('\nNext actions (1 security finding)\n')
  })
})
