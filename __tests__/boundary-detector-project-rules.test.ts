import { detectProjectActionCrossings } from '@/lib/services/boundary-detector.service'
import type { PolicyRule } from '@/lib/policy/types'

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

// --- LUM-751: action rules are segment-scoped and prose-stripped ---------------
const mainRule: PolicyRule = {
  id: 'r-main',
  text: 'Never push or merge directly to main',
  kind: 'action',
  tier: 'deterministic',
  predicate: { type: 'cmd-substr', value: 'main' },
  severity: 'MEDIUM',
  blocking: true,
}
const deployRule: PolicyRule = {
  id: 'r-deploy',
  text: 'Production migrations are applied only by CI (prisma migrate deploy)',
  kind: 'action',
  tier: 'deterministic',
  predicate: { type: 'cmd-substr', value: 'prisma migrate deploy' },
  severity: 'HIGH',
  blocking: false,
}
const run = (command: string, rs: PolicyRule[] = [mainRule, deployRule]) =>
  detectProjectActionCrossings(
    { toolName: 'Bash', payload: { tool_input: { command } } },
    rs
  ).map(c => c.policyRuleRef)

describe('LUM-751: action rules are segment-scoped and prose-stripped', () => {
  it('read-only and target-branch references to main raise no PROJECT_RULE_VIOLATION', () => {
    expect(
      run('gh pr create --base main --title "feat: x" --body "..."')
    ).toEqual([])
    expect(run('git log origin/main..HEAD --oneline')).toEqual([])
    expect(run('git diff main...HEAD --stat')).toEqual([])
    expect(
      run('git merge-base origin/main HEAD && git push origin feature/x')
    ).toEqual([])
    expect(
      run('git fetch origin main && git checkout main && git pull')
    ).toEqual([])
    expect(run('lumo worktree add LUM-751 x --base main')).toEqual([])
  })

  it('prose quoting a rule keyword raises no PROJECT_RULE_VIOLATION', () => {
    expect(
      run('git commit -m "docs: CI runs prisma migrate deploy, never locally"')
    ).toEqual([])
    expect(
      run(
        'gh pr create --base feature/x --body "We do not run prisma migrate deploy by hand"'
      )
    ).toEqual([])
    expect(
      run(
        'lumo crossing explain abc --note "this was prisma migrate deploy prose only"'
      )
    ).toEqual([])
    expect(run('git commit -F - <<EOF\nfix: never push to main\nEOF')).toEqual(
      []
    )
  })

  it('the same keyword in an executing segment still raises the crossing', () => {
    expect(run('git push origin main')).toEqual(['r-main'])
    expect(run('git log main && git merge main')).toEqual(['r-main'])
    expect(run('npx prisma migrate deploy')).toEqual(['r-deploy'])
    expect(run('bash -c "npx prisma migrate deploy"')).toEqual(['r-deploy'])
    expect(run('node scripts/flush-prod.js', rules)).toEqual(['a1'])
  })
})
