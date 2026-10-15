/**
 * LUM-1200 — one issue on one line gets one Lumo thread: the AI review and
 * the exploit-path hunt reporting the same vulnerability class on the same
 * line are grouped under one kept finding.
 */
import {
  groupSameIssue,
  issueClasses,
  type GroupableFinding,
} from '@/ee/security/security-scan/issue-groups'

function f(over: Partial<GroupableFinding> = {}): GroupableFinding {
  return {
    fingerprint: 'judge-fp',
    ruleId: 'vuln:command_injection',
    provenance: 'LLM_JUDGE',
    filePath: 'src/probe/run.ts',
    line: 5,
    severity: 'HIGH',
    ...over,
  }
}

const hunt = (over: Partial<GroupableFinding> = {}) =>
  f({ fingerprint: 'hunt-fp', ruleId: 'hunt:injection', ...over })

const none = { posted: new Set<string>(), isBlocking: () => false }

describe('issueClasses', () => {
  it('maps the hunt categories onto the AI review kinds they cover', () => {
    expect([...issueClasses('hunt:injection')]).toEqual(
      expect.arrayContaining(['command_injection', 'sql_injection', 'xss'])
    )
    expect([...issueClasses('hunt:ssrf')]).toEqual(['ssrf'])
    expect([...issueClasses('hunt:idor')]).toEqual(
      expect.arrayContaining(['authz_logic', 'auth_bypass'])
    )
    expect([...issueClasses('vuln:command_injection')]).toEqual([
      'command_injection',
    ])
  })

  it('gives bugs, secrets and external-tool rules no class (never grouped)', () => {
    expect(issueClasses('review:logic_error').size).toBe(0)
    expect(issueClasses('secret:aws-access-key').size).toBe(0)
    expect(issueClasses('ext:semgrep:foo').size).toBe(0)
  })
})

describe('groupSameIssue', () => {
  it('production probe: AI review + hunt injection on run.ts:5 → one kept, one merged', () => {
    const g = groupSameIssue([f(), hunt()], none)
    expect(g.mergedInto.get('hunt-fp')).toBe('judge-fp')
    expect(g.mergedOf.get('judge-fp')?.map(m => m.fingerprint)).toEqual([
      'hunt-fp',
    ])
    expect(g.mergedInto.has('judge-fp')).toBe(false)
  })

  it('keeps the finding whose thread is already on the PR', () => {
    const g = groupSameIssue([f(), hunt()], {
      ...none,
      posted: new Set(['hunt-fp']),
    })
    expect(g.mergedInto.get('judge-fp')).toBe('hunt-fp')
  })

  it('keeps the stricter standing: a blocking finding is the kept one, whatever its severity', () => {
    const g = groupSameIssue([f(), hunt({ severity: 'MEDIUM' })], {
      ...none,
      isBlocking: x => x.fingerprint === 'hunt-fp',
    })
    expect(g.mergedInto.get('judge-fp')).toBe('hunt-fp')
  })

  it('never hides a blocking finding under a non-blocking thread already on the PR', () => {
    const g = groupSameIssue([f(), hunt()], {
      posted: new Set(['judge-fp']),
      isBlocking: x => x.fingerprint === 'hunt-fp',
    })
    // The blocking row keeps a thread of its own.
    expect(g.mergedInto.has('hunt-fp')).toBe(false)
  })

  it('keeps the higher severity when neither is posted', () => {
    const g = groupSameIssue([f({ severity: 'MEDIUM' }), hunt()], none)
    expect(g.mergedInto.get('judge-fp')).toBe('hunt-fp')
  })

  it('never merges two findings that both already have a thread', () => {
    const g = groupSameIssue([f(), hunt()], {
      ...none,
      posted: new Set(['judge-fp', 'hunt-fp']),
    })
    expect(g.mergedInto.size).toBe(0)
  })

  it.each([
    ['another line', hunt({ line: 6 })],
    ['another file', hunt({ filePath: 'src/probe/store.ts' })],
    ['no line', hunt({ line: null })],
    ['a different class', hunt({ ruleId: 'hunt:ssrf' })],
    ['the same layer', f({ fingerprint: 'judge-2', ruleId: 'vuln:xss' })],
  ])('does not group across %s', (_label, other) => {
    expect(groupSameIssue([f(), other], none).mergedInto.size).toBe(0)
  })

  it('does not group two AI-review classes on one line through a broad hunt category', () => {
    const g = groupSameIssue(
      [
        f(),
        f({ fingerprint: 'judge-sql', ruleId: 'vuln:sql_injection' }),
        hunt(),
      ],
      none
    )
    // Exactly one of the judge rows absorbs the hunt row; the other stays alone.
    expect(g.mergedInto.size).toBe(1)
    expect(g.mergedInto.has('judge-fp')).toBe(false)
    expect(g.mergedInto.has('judge-sql')).toBe(false)
  })
})
