/**
 * @jest-environment node
 *
 * LUM-1256 — the CLI's copy of the DONE-gate predicate (it cannot import the
 * plugin) agrees with the server's `isBlockingUnderPolicy` on every input, so
 * a local scan's "would block DONE" is the server's answer.
 */
import { isBlockingUnderPolicy as cliPredicate } from '../../../cli/src/lib/scan-labels'
import { isBlockingUnderPolicy as serverPredicate } from '@/ee/security/security-scan/policy'

describe('isBlockingUnderPolicy parity with the server', () => {
  const provenances = ['DETERMINISTIC', 'LLM_JUDGE', 'EXTERNAL_TOOL'] as const
  const severities = ['LOW', 'MEDIUM', 'HIGH'] as const
  const dispositions = [null, 'FALSE_POSITIVE', 'ACCEPTED_RISK'] as const
  const policies = [
    { block: [] },
    {
      block: [
        { provenance: 'DETERMINISTIC' as const, severity: 'HIGH' as const },
      ],
    },
    {
      block: [
        { provenance: 'EXTERNAL_TOOL' as const, severity: 'LOW' as const },
        { provenance: 'DETERMINISTIC' as const, severity: 'MEDIUM' as const },
      ],
    },
    // LUM-1328: a workspace that opted in to blocking on agent reviews.
    {
      block: [
        { provenance: 'AGENT_REVIEW' as const, severity: 'HIGH' as const },
        { provenance: 'EXTERNAL_TOOL' as const, severity: 'HIGH' as const },
      ],
    },
  ]
  // LUM-1321: a CI scanner's row and an imported agent review's row.
  const ruleIds = ['ext:semgrep:js.sqli', 'ext:claude-code:sqli'] as const
  it('agrees on every rule × provenance × severity × disposition × persisting × policy', () => {
    let n = 0
    for (const ruleId of ruleIds)
      for (const provenance of provenances)
        for (const severity of severities)
          for (const disposition of dispositions)
            for (const persisting of [false, true, undefined])
              for (const policy of policies) {
                const f = {
                  ruleId,
                  provenance,
                  severity,
                  disposition,
                  ...(persisting === undefined ? {} : { persisting }),
                }
                expect(cliPredicate(f, policy)).toBe(serverPredicate(f, policy))
                n++
              }
    expect(n).toBe(648)
  })
})
