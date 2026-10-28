/**
 * @jest-environment node
 *
 * LUM-1333 — `lumo review import --kind bug`: an agent's code review lands as
 * `ext:<agent>:bug:<kind>` CORRECTNESS rows — one of the AI review's bug
 * kinds, tagged [BUG], never blocking DONE (even under an AGENT_REVIEW
 * policy entry) and grouped with Lumo's own `review:<kind>` threads.
 */
import {
  agentReviewSarif,
  bugKindOf,
} from '@/ee/security/security-scan/agent-review-sarif'
import {
  findingCountPhrase,
  isAgentBugRuleId,
  isCodeReviewFinding,
} from '@/shared/src/security-scan'
import { isBlockingUnderPolicy } from '@/ee/security/security-scan/policy'
import { isBlockingUnderPolicy as cliPredicate } from '../../../cli/src/lib/scan-labels'
import { normalizeSarif, parseSarif } from '@/ee/security/security-scan/sarif'
import { issueClasses } from '@/ee/security/security-scan/issue-classes'

const report = (ruleId: string, message = 'q reaches a raw query') => ({
  version: '2.1.0',
  runs: [
    {
      tool: { driver: { name: 'claude-code', rules: [{ id: ruleId }] } },
      results: [
        {
          ruleId,
          level: 'warning',
          message: { text: message },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: 'app/x.ts' },
                region: { startLine: 3 },
              },
            },
          ],
        },
      ],
    },
  ],
})

type Run = {
  tool: { driver: { rules: { id: string }[] } }
  results: {
    ruleId: string
    locations: {
      physicalLocation: { region: { snippet?: { text: string } } }
    }[]
  }[]
}
const firstRun = (doc: Record<string, unknown>) => (doc['runs'] as Run[])[0]!

describe('bugKindOf', () => {
  it('reads a bug kind in any spelling, else logic_error', () => {
    expect(bugKindOf('error-handling')).toBe('error_handling')
    expect(bugKindOf('Null Or Undefined')).toBe('null_or_undefined')
    expect(bugKindOf('bug:concurrency')).toBe('concurrency')
    expect(bugKindOf('off-by-one')).toBe('logic_error')
  })
})

describe('agentReviewSarif', () => {
  it('a code review: rules become bug:<kind>, and the message keys the fingerprint', () => {
    const run = firstRun(agentReviewSarif(report('error-handling'), 'bug'))
    expect(run.tool.driver.rules).toEqual([{ id: 'bug:error_handling' }])
    expect(run.results[0]!.ruleId).toBe('bug:error_handling')
    expect(
      run.results[0]!.locations[0]!.physicalLocation.region.snippet
    ).toEqual({ text: 'q reaches a raw query' })
  })
  it('a security review keeps its rules but never the reserved bug: segment', () => {
    expect(
      firstRun(agentReviewSarif(report('sqli'), 'security')).results[0]!.ruleId
    ).toBe('sqli')
    expect(
      firstRun(agentReviewSarif(report('bug:sqli'), 'security')).results[0]!
        .ruleId
    ).toBe('bug-sqli')
  })
  it('two bugs of one kind in one file stay two rows after the ingest', () => {
    const doc = report('logic-error', 'first')
    const run = (doc.runs[0]!.results as unknown[]).concat({
      ...doc.runs[0]!.results[0]!,
      message: { text: 'second' },
    })
    doc.runs[0]!.results = run as (typeof doc.runs)[0]['results']
    const n = normalizeSarif(parseSarif(agentReviewSarif(doc, 'bug')), {
      toolHint: 'claude-code',
      changedLines: null,
    })
    expect(n.findings).toHaveLength(2)
    expect(n.dropped.duplicate).toBe(0)
  })
})

describe('an imported bug row', () => {
  const ruleId = 'ext:claude-code:bug:logic_error'

  it('is CORRECTNESS after the ingest', () => {
    const n = normalizeSarif(
      parseSarif(agentReviewSarif(report('logic-error'), 'bug')),
      { toolHint: 'claude-code', changedLines: null }
    )
    expect(n.findings[0]).toMatchObject({ ruleId, kind: 'CORRECTNESS' })
  })

  it('is a code-review finding and counts as a bug', () => {
    expect(isAgentBugRuleId(ruleId)).toBe(true)
    expect(isCodeReviewFinding(ruleId)).toBe(true)
    expect(isAgentBugRuleId('ext:claude-code:sqli')).toBe(false)
    expect(isAgentBugRuleId('ext:semgrep:bug:x')).toBe(false)
    expect(isAgentBugRuleId('ext:codex:bug:')).toBe(false)
    expect(findingCountPhrase([ruleId, 'ext:codex:sqli'])).toBe(
      '1 security finding · 1 bug'
    )
  })

  it('never blocks DONE, even when the policy lists AGENT_REVIEW — server and CLI agree', () => {
    const policy = {
      block: [
        { provenance: 'AGENT_REVIEW' as const, severity: 'HIGH' as const },
      ],
    }
    const f = {
      ruleId,
      provenance: 'EXTERNAL_TOOL' as const,
      severity: 'HIGH' as const,
      disposition: null,
    }
    expect(isBlockingUnderPolicy(f, policy)).toBe(false)
    expect(cliPredicate(f, policy)).toBe(false)
    // The same agent's security finding still blocks under that entry.
    const sec = { ...f, ruleId: 'ext:claude-code:sqli' }
    expect(isBlockingUnderPolicy(sec, policy)).toBe(true)
    expect(cliPredicate(sec, policy)).toBe(true)
  })

  it("groups with Lumo's own review of the same bug kind", () => {
    expect([...issueClasses(ruleId)]).toEqual(['logic_error'])
    expect([...issueClasses('review:logic_error')]).toEqual(['logic_error'])
  })
})
