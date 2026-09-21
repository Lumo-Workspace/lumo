/**
 * LUM-801: test case CLI 的两处换算。
 *
 * 一处是复合句柄 `LUM-12/TC3` 的切分（服务端不认带斜杠的句柄）；
 * 另一处是 CLI 表面 1-based ↔ 存储 0-based 的步骤编号。第二处只要错一次，
 * 所有失败定位都会指向相邻的那一步，而且测试全绿也看不出来。
 */
import {
  splitCaseHandle,
  toZeroBased,
  resolveRunLocator,
  readGitCoordinate,
} from '@/cli/src/lib/test-case-handle'

describe('splitCaseHandle', () => {
  it('splits LUM-12/TC3 into task and case ref', () => {
    expect(splitCaseHandle('LUM-12/TC3')).toEqual({
      task: 'LUM-12',
      caseRef: 'TC3',
    })
  })

  it('accepts a bare number after the slash', () => {
    expect(splitCaseHandle('LUM-12/3')).toEqual({
      task: 'LUM-12',
      caseRef: '3',
    })
  })

  it('rejects a handle with no slash', () => {
    expect(splitCaseHandle('LUM-12')).toBeNull()
  })

  it('rejects a handle with more than one slash', () => {
    expect(splitCaseHandle('LUM-12/TC3/x')).toBeNull()
  })

  it('rejects an empty side', () => {
    expect(splitCaseHandle('/TC3')).toBeNull()
    expect(splitCaseHandle('LUM-12/')).toBeNull()
  })
})

describe('toZeroBased', () => {
  it('converts a 1-based CLI index to 0-based storage', () => {
    expect(toZeroBased('1')).toBe(0)
    expect(toZeroBased('3')).toBe(2)
  })

  it('rejects 0 — the CLI surface is 1-based', () => {
    expect(toZeroBased('0')).toBeNull()
  })

  it('rejects a negative or non-numeric index', () => {
    expect(toZeroBased('-1')).toBeNull()
    expect(toZeroBased('two')).toBeNull()
  })
})

describe('resolveRunLocator', () => {
  it('maps --failed-step 2 to STEPS index 1', () => {
    expect(resolveRunLocator({ failedStep: '2' })).toEqual({
      ok: true,
      failedPhase: 'STEPS',
      failedIndex: 1,
    })
  })

  it('maps --failed-verify 1 to VERIFICATION index 0', () => {
    expect(resolveRunLocator({ failedVerify: '1' })).toEqual({
      ok: true,
      failedPhase: 'VERIFICATION',
      failedIndex: 0,
    })
  })

  it('returns no locator when neither flag is given', () => {
    expect(resolveRunLocator({})).toEqual({
      ok: true,
      failedPhase: null,
      failedIndex: null,
    })
  })

  it('rejects both flags at once', () => {
    const r = resolveRunLocator({ failedStep: '1', failedVerify: '1' })
    expect(r.ok).toBe(false)
  })

  it('rejects a 0 index with a 1-based hint', () => {
    const r = resolveRunLocator({ failedStep: '0' })
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.error).toMatch(/1-based/)
  })
})

describe('readGitCoordinate', () => {
  const ok = (stdout: string) => ({ status: 0, stdout })
  const boom = () => ({ status: 128, stdout: '' })

  it('reads HEAD and a clean worktree', () => {
    const run = (_c: string, args: string[]) =>
      args[1] === 'HEAD' ? ok('a1b2c3d4e5f6\n') : ok('')
    expect(readGitCoordinate(run)).toEqual({
      commitSha: 'a1b2c3d4e5f6',
      commitDirty: false,
    })
  })

  it('flags a dirty worktree', () => {
    const run = (_c: string, args: string[]) =>
      args[1] === 'HEAD' ? ok('a1b2c3d4e5f6\n') : ok(' M lib/x.ts\n')
    expect(readGitCoordinate(run).commitDirty).toBe(true)
  })

  it('returns nulls outside a git repo — never invents a sha', () => {
    expect(readGitCoordinate(boom)).toEqual({
      commitSha: null,
      commitDirty: null,
    })
  })

  it('returns nulls when rev-parse prints something that is not a sha', () => {
    const run = (_c: string, args: string[]) =>
      args[1] === 'HEAD' ? ok('HEAD\n') : ok('')
    expect(readGitCoordinate(run).commitSha).toBeNull()
  })

  it('leaves dirty unknown when git status itself fails', () => {
    const run = (_c: string, args: string[]) =>
      args[1] === 'HEAD' ? ok('a1b2c3d4e5f6\n') : boom()
    expect(readGitCoordinate(run).commitDirty).toBeNull()
  })
})
