import { detectProjectActionCrossings } from '@/lib/services/boundary-detector.service'
import type { PolicyRule } from '@/lib/services/policy/types'

const rules: PolicyRule[] = [
  {
    id: 'a1',
    text: 'never run flush-prod',
    kind: 'action',
    tier: 'deterministic',
    predicate: { type: 'cmd-substr', value: 'flush-prod' },
    severity: 'HIGH',
    blocking: false,
  },
]

test('project cmd-substr action rule produces an advisory crossing in v1', () => {
  const out = detectProjectActionCrossings(
    {
      toolName: 'Bash',
      payload: { tool_input: { command: 'node scripts/flush-prod.js' } },
    },
    rules
  )
  expect(out).toEqual([
    expect.objectContaining({
      category: 'PROJECT_RULE_VIOLATION',
      advisory: true,
      policyRuleRef: 'a1',
    }),
  ])
  expect(out[0]?.detail).toContain('node scripts/flush-prod.js')
  // LUM-590: detail must be the raw command only, not the old "Action rule violated: …" wrapper.
  expect(out[0]?.detail).not.toContain('Action rule violated')
  expect(out[0]?.detail).not.toContain('never run flush-prod')
})

test('LUM-590: policyRuleText carries the frozen rule text', () => {
  const out = detectProjectActionCrossings(
    {
      toolName: 'Bash',
      payload: { tool_input: { command: 'node scripts/flush-prod.js' } },
    },
    rules
  )
  expect(out).toHaveLength(1)
  expect(out[0]?.policyRuleText).toBe('never run flush-prod')
})

test('a clean command produces no project crossing', () => {
  const out = detectProjectActionCrossings(
    { toolName: 'Bash', payload: { tool_input: { command: 'npm test' } } },
    rules
  )
  expect(out).toEqual([])
})
