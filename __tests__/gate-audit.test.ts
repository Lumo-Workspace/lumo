import {
  deriveGateAudit,
  type NormalizedGateEvent,
  type GateRecord,
} from '@/lib/services/gate-audit'
import { parseEvidencePointer } from '../shared/src/acceptance-evidence'
import type { GateKey } from '../shared/src/gate-map'

function byKey(gates: GateRecord[]): Record<string, GateRecord> {
  return Object.fromEntries(gates.map(g => [g.key, g]))
}

const EVENTS: NormalizedGateEvent[] = [
  {
    key: 'typecheck',
    outcome: 'success',
    command: 'tsc --noEmit',
    exitCode: 0,
    hookEvent: 'POST_TOOL_USE',
    at: '2026-06-27T10:00:00.000Z',
  },
  {
    key: 'test',
    outcome: 'failure',
    command: 'npm test',
    exitCode: 1,
    hookEvent: 'POST_TOOL_USE_FAILURE',
    at: '2026-06-27T10:05:00.000Z',
  },
  {
    key: 'diff-scope',
    outcome: 'success',
    command: 'lumo:diff-scope',
    exitCode: 0,
    hookEvent: 'PRE_TOOL_USE',
    at: '2026-06-27T10:01:00.000Z',
  },
]

// typecheck/test/build/diff-scope are wired; git-hygiene is not.
const CONFIGURED: GateKey[] = ['typecheck', 'test', 'build', 'diff-scope']

describe('gate-audit', () => {
  it('derive four states', () => {
    const { gates } = deriveGateAudit({
      configured: CONFIGURED,
      events: EVENTS,
    })
    const g = byKey(gates)

    // matched success → passed; matched failure variant → failed
    expect(g['typecheck']!.status).toBe('passed')
    expect(g['test']!.status).toBe('failed')
    expect(g['diff-scope']!.status).toBe('passed')

    // configured but no matching event → not_run (NOT passed)
    expect(g['build']!.status).toBe('not_run')

    // no definition wired for this delivery → not_configured (NOT passed)
    expect(g['git-hygiene']!.status).toBe('not_configured')

    // The silent-absence red line: a gate that did not run, or is not
    // configured, is NEVER derived as passed.
    expect(g['build']!.status).not.toBe('passed')
    expect(g['git-hygiene']!.status).not.toBe('passed')

    // provenance rides the class regardless of status
    expect(g['typecheck']!.provenance).toBe('agent_self_reported')
    expect(g['diff-scope']!.provenance).toBe('independent_harness')
  })

  it('grounding bound to status', () => {
    const { gates } = deriveGateAudit({
      configured: CONFIGURED,
      events: EVENTS,
    })
    const g = byKey(gates)

    // passed / failed carry a parseable cmd:<command>#exit=<code> pointer
    for (const key of ['typecheck', 'test', 'diff-scope']) {
      const grounding = g[key]!.grounding
      expect(grounding).not.toBeNull()
      const parsed = parseEvidencePointer(grounding!.pointer)
      expect(parsed?.kind).toBe('cmd')
    }
    expect(parseEvidencePointer(g['typecheck']!.grounding!.pointer)).toEqual({
      kind: 'cmd',
      command: 'tsc --noEmit',
      exitCode: 0,
    })
    expect(parseEvidencePointer(g['test']!.grounding!.pointer)).toEqual({
      kind: 'cmd',
      command: 'npm test',
      exitCode: 1,
    })

    // not_run / not_configured carry NO grounding
    expect(g['build']!.grounding).toBeNull()
    expect(g['git-hygiene']!.grounding).toBeNull()
  })

  it('latest event per gate wins', () => {
    const events: NormalizedGateEvent[] = [
      {
        key: 'typecheck',
        outcome: 'failure',
        command: 'tsc --noEmit',
        exitCode: 2,
        hookEvent: 'POST_TOOL_USE_FAILURE',
        at: '2026-06-27T09:00:00.000Z',
      },
      {
        key: 'typecheck',
        outcome: 'success',
        command: 'tsc --noEmit',
        exitCode: 0,
        hookEvent: 'POST_TOOL_USE',
        at: '2026-06-27T11:00:00.000Z',
      },
    ]
    const { gates } = deriveGateAudit({ configured: ['typecheck'], events })
    expect(byKey(gates)['typecheck']!.status).toBe('passed')
  })
})
