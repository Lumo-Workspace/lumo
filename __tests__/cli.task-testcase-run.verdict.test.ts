/**
 * LUM-808: `lumo task testcase run` 的判决层纯函数。
 *
 * 三件事在 CLI 侧完成，因此在 CLI 侧测：
 *   1. `--cause` 的取值与 FAIL 的绑定关系
 *   2. `--unproven` 的 1-based → 0-based 换算（同 `--failed-verify`）
 *   3. 回显把封顶摆在脸上 —— 自己报的 PASS 当场被降级，比事后在网页上发现有用
 */
import {
  resolveFailureCause,
  resolveUnprovenIndices,
  resolveRequiredEnvironment,
  formatRunOutcome,
} from '../cli/src/lib/test-case-verdict'

describe('resolveFailureCause', () => {
  it.each([
    ['defect', 'IMPLEMENTATION_DEFECT'],
    ['outdated', 'CASE_OUTDATED'],
    ['external', 'EXTERNAL_BLOCK'],
    ['unknown', 'UNKNOWN'],
  ])('maps --cause %s to %s', (raw, expected) => {
    expect(resolveFailureCause(raw, 'FAIL')).toEqual({
      ok: true,
      cause: expected,
    })
  })

  it('accepts the stored enum spelling too', () => {
    expect(resolveFailureCause('IMPLEMENTATION_DEFECT', 'FAIL')).toEqual({
      ok: true,
      cause: 'IMPLEMENTATION_DEFECT',
    })
  })

  it('rejects an unknown cause word', () => {
    const r = resolveFailureCause('whoops', 'FAIL')
    expect(r.ok).toBe(false)
  })

  it('requires a cause on FAIL', () => {
    const r = resolveFailureCause(undefined, 'FAIL')
    expect(r).toMatchObject({ ok: false })
    expect(r.ok === false && r.error).toMatch(/--cause/)
  })

  it.each(['PASS', 'BLOCKED'] as const)(
    'rejects a cause on a %s run',
    result => {
      expect(resolveFailureCause('defect', result)).toMatchObject({
        ok: false,
      })
    }
  )

  it.each(['PASS', 'BLOCKED'] as const)(
    'returns null for a %s run with no cause',
    result => {
      expect(resolveFailureCause(undefined, result)).toEqual({
        ok: true,
        cause: null,
      })
    }
  )
})

describe('resolveUnprovenIndices', () => {
  it('converts 1-based CLI numbers to 0-based storage indices', () => {
    expect(resolveUnprovenIndices(['1', '3'])).toEqual({
      ok: true,
      indices: [0, 2],
    })
  })

  it('returns an empty list when the flag was not given', () => {
    expect(resolveUnprovenIndices(undefined)).toEqual({ ok: true, indices: [] })
  })

  it('rejects a zero — step numbers are 1-based on the surface', () => {
    expect(resolveUnprovenIndices(['0'])).toMatchObject({ ok: false })
  })

  it('rejects a non-numeric index', () => {
    expect(resolveUnprovenIndices(['two'])).toMatchObject({ ok: false })
  })
})

describe('formatRunOutcome — the cap is on the face of the echo', () => {
  it('shows the downgrade, the reported result and the reason in one line', () => {
    const line = formatRunOutcome({
      handle: 'LUM-808/TC1',
      reported: 'PASS',
      environment: 'LOCAL',
      ceiling: {
        effective: 'UNPROVEN',
        reason: 'environment',
        requiredEnvironment: 'PRODUCTION',
        ranIn: 'LOCAL',
      },
    })
    expect(line).toContain('PASS')
    expect(line).toContain('UNPROVEN')
    expect(line).toContain('PRODUCTION')
  })

  it('names the unobserved verification items when that is what capped it', () => {
    const line = formatRunOutcome({
      handle: 'LUM-808/TC1',
      reported: 'PASS',
      environment: 'PRODUCTION',
      ceiling: {
        effective: 'UNPROVEN',
        reason: 'unobserved',
        unobserved: [{ index: 1, text: 'refresh: the page' }],
      },
    })
    expect(line).toContain('UNPROVEN')
    // 1-based 回到表面
    expect(line).toContain('2')
    expect(line).toContain('refresh: the page')
  })

  it('does not mention a cap when nothing capped the run', () => {
    const line = formatRunOutcome({
      handle: 'LUM-808/TC1',
      reported: 'PASS',
      environment: 'PRODUCTION',
      ceiling: { effective: 'PASS' },
    })
    expect(line).toBe('Recorded LUM-808/TC1: PASS on PRODUCTION')
    expect(line).not.toContain('UNPROVEN')
  })

  it('never caps a FAIL — the arrow is only for a downgraded pass', () => {
    const line = formatRunOutcome({
      handle: 'LUM-808/TC1',
      reported: 'FAIL',
      environment: 'LOCAL',
      ceiling: { effective: 'FAIL' },
    })
    expect(line).toBe('Recorded LUM-808/TC1: FAIL on LOCAL')
  })
})

describe('resolveRequiredEnvironment', () => {
  it('is undefined when the flag was not given — leaves the stored value alone', () => {
    expect(resolveRequiredEnvironment(undefined)).toEqual({
      ok: true,
      value: undefined,
    })
  })

  it.each([
    ['local', 'LOCAL'],
    ['PRODUCTION', 'PRODUCTION'],
  ])('maps %s to %s', (raw, expected) => {
    expect(resolveRequiredEnvironment(raw)).toEqual({
      ok: true,
      value: expected,
    })
  })

  it('clears the constraint on "none"', () => {
    expect(resolveRequiredEnvironment('none')).toEqual({
      ok: true,
      value: null,
    })
  })

  it('rejects an unknown environment', () => {
    expect(resolveRequiredEnvironment('staging')).toMatchObject({ ok: false })
  })
})
