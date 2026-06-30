import {
  buildPerPrGateAudit,
  type GateHookEventRow,
  type GateSignalRow,
  type PrRef,
  type DeliveryGateAudit,
  type GateRecord,
} from '@/lib/services/gate-audit'

/** A self-reported Bash gate run, optionally tagged with the session it ran in. */
function bash(
  command: string,
  createdAt: string,
  sessionId: string | null,
  type = 'POST_TOOL_USE'
): GateHookEventRow {
  return {
    type,
    payload: { tool_name: 'Bash', tool_input: { command } },
    createdAt: new Date(createdAt),
    sessionId,
  }
}

/** An independent CI signal, carrying its resolved PR number (write-time linkage). */
function ci(
  gateKey: string,
  outcome: 'success' | 'failure',
  createdAt: string,
  prNumber: number | null
): GateSignalRow {
  return {
    gateKey,
    outcome,
    checkName: gateKey === 'build' ? 'Vercel' : gateKey,
    detailsUrl: null,
    source: 'github_status',
    createdAt: new Date(createdAt),
    prNumber,
  }
}

const PR_753: PrRef = {
  number: 753,
  title: 'gate audit panel',
  state: 'merged',
  headBranch: 'lumo/LUM-614-gates-audit',
}
const PR_754: PrRef = {
  number: 754,
  title: 'strip quotes',
  state: 'merged',
  headBranch: 'lumo/LUM-614-fix-quotes',
}

function gateOf(audit: DeliveryGateAudit, key: string): GateRecord {
  const g = audit.gates.find(x => x.key === key)
  if (!g) throw new Error(`gate ${key} missing from audit`)
  return g
}

describe('buildPerPrGateAudit', () => {
  it('groups gate signals by pull request', () => {
    const result = buildPerPrGateAudit({
      // PR 753 carries an independent CI build pass (linked by stored prNumber).
      gateSignals: [ci('build', 'success', '2026-06-28T10:00:00.000Z', 753)],
      // PR 754 carries a self-reported typecheck pass, attributed via the
      // session's worktree branch matching PR 754's headBranch.
      hookRows: [bash('tsc --noEmit', '2026-06-28T11:00:00.000Z', 's754')],
      pullRequests: [PR_753, PR_754],
      sessionBranchById: { s754: 'lumo/LUM-614-fix-quotes' },
    })

    const byNumber = new Map(result.prs.map(p => [p.pr.number, p]))
    // PR 753: only the CI build signal lands here.
    expect(gateOf(byNumber.get(753)!.audit, 'build').status).toBe('passed')
    expect(gateOf(byNumber.get(753)!.audit, 'typecheck').status).toBe('not_run')
    // PR 754: only the self-reported typecheck signal lands here.
    expect(gateOf(byNumber.get(754)!.audit, 'typecheck').status).toBe('passed')
    expect(gateOf(byNumber.get(754)!.audit, 'build').status).toBe('not_run')
    expect(result.unlinked).toBeNull()
  })

  it('puts unresolved signals in the unlinked bucket', () => {
    // With MULTIPLE PRs an unresolved signal is genuinely ambiguous — there's no
    // single candidate to attribute it to, so it stays unlinked rather than guessed.
    const result = buildPerPrGateAudit({
      // A CI signal whose stored prNumber matches no known PR.
      gateSignals: [ci('build', 'success', '2026-06-28T10:00:00.000Z', 999)],
      // A self-reported run whose session branch matches no PR headBranch.
      hookRows: [bash('npm test', '2026-06-28T11:00:00.000Z', 'sOrphan')],
      pullRequests: [PR_753, PR_754],
      sessionBranchById: { sOrphan: 'lumo/some-other-branch' },
    })

    // Nothing leaks onto either PR — their gates are all signal-free.
    for (const n of [753, 754]) {
      const pr = result.prs.find(p => p.pr.number === n)!
      expect(gateOf(pr.audit, 'build').status).toBe('not_run')
      expect(gateOf(pr.audit, 'test').status).toBe('not_run')
    }
    // Both orphan signals land in the explicit unlinked bucket.
    expect(result.unlinked).not.toBeNull()
    expect(gateOf(result.unlinked!, 'build').status).toBe('passed')
    expect(gateOf(result.unlinked!, 'test').status).toBe('passed')
  })

  it('attributes an unresolved signal to the sole pr when the task has one', () => {
    // A self-reported run with no resolvable branch — but the task has exactly
    // one PR, so it is the only candidate. Attribute to it (not a guess between
    // many), so a single-PR delivery never reads as a phantom unlinked bucket.
    const result = buildPerPrGateAudit({
      gateSignals: [],
      hookRows: [bash('npm test', '2026-06-28T11:00:00.000Z', 'sNoBranch')],
      pullRequests: [PR_753],
      sessionBranchById: {}, // branch unknown → unresolved
    })

    const pr753 = result.prs.find(p => p.pr.number === 753)!
    expect(gateOf(pr753.audit, 'test').status).toBe('passed')
    expect(result.unlinked).toBeNull()
  })

  it('keeps a signal naming an unknown pr unlinked even with a sole pr', () => {
    // The signal explicitly names PR 999 (not on the task) — it has a PR identity
    // we just cannot place, so it must NOT be reassigned to the sole PR 753.
    const result = buildPerPrGateAudit({
      gateSignals: [ci('build', 'success', '2026-06-28T10:00:00.000Z', 999)],
      hookRows: [],
      pullRequests: [PR_753],
      sessionBranchById: {},
    })

    const pr753 = result.prs.find(p => p.pr.number === 753)!
    expect(gateOf(pr753.audit, 'build').status).toBe('not_run')
    expect(result.unlinked).not.toBeNull()
    expect(gateOf(result.unlinked!, 'build').status).toBe('passed')
  })

  it('preserves four state and independent preference within a pull request', () => {
    const result = buildPerPrGateAudit({
      // Same gate (typecheck) on PR 753: an independent CI FAILURE (earlier) and
      // a self-reported PASS (later). Independence must win despite being older.
      gateSignals: [
        ci('typecheck', 'failure', '2026-06-28T10:00:00.000Z', 753),
      ],
      hookRows: [bash('tsc --noEmit', '2026-06-28T12:00:00.000Z', 's753')],
      pullRequests: [PR_753],
      sessionBranchById: { s753: 'lumo/LUM-614-gates-audit' },
    })

    const pr753 = result.prs.find(p => p.pr.number === 753)!.audit
    // Independent CI failure overrides the newer self-report.
    expect(gateOf(pr753, 'typecheck').status).toBe('failed')
    expect(gateOf(pr753, 'typecheck').provenance).toBe('independent_harness')
    // A gate with no signal at all stays not_run — never a fabricated pass.
    expect(gateOf(pr753, 'build').status).toBe('not_run')
  })
})
