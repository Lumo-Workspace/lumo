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
  resolveCommitCoordinate,
  evidenceHint,
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

describe('resolveCommitCoordinate', () => {
  // LUM-801 走查时从截图里看出来的：一条 `--env production` 的 run 记着操作者
  // 本地 #1038 分支的 HEAD。本地检出跑的不是生产跑的东西 —— 那个 commit 从未
  // 上过生产。更糟的是，如果本地 HEAD 恰好等于 PR head，陈旧性会把它判成
  // `fresh`，等于伪造一条「生产已验证」。
  const cleanGit = () => ({ commitSha: 'a1b2c3d4', commitDirty: false })
  const noGit = () => ({ commitSha: null, commitDirty: null })

  it('auto-detects from local git for a LOCAL run', () => {
    expect(
      resolveCommitCoordinate({ env: 'LOCAL', readGit: cleanGit })
    ).toEqual({ commitSha: 'a1b2c3d4', commitDirty: false, hint: null })
  })

  it('never auto-detects for PRODUCTION — the local checkout is not what prod runs', () => {
    const r = resolveCommitCoordinate({ env: 'PRODUCTION', readGit: cleanGit })
    expect(r.commitSha).toBeNull()
    expect(r.commitDirty).toBeNull()
    expect(r.hint).toMatch(/not what production runs/i)
  })

  it('never auto-detects for PREVIEW either', () => {
    const r = resolveCommitCoordinate({ env: 'PREVIEW', readGit: cleanGit })
    expect(r.commitSha).toBeNull()
    expect(r.hint).toMatch(/not what preview runs/i)
  })

  it('does not even consult git for a non-local run', () => {
    const readGit = jest.fn(cleanGit)
    resolveCommitCoordinate({ env: 'PRODUCTION', readGit })
    expect(readGit).not.toHaveBeenCalled()
  })

  it('accepts an explicit --commit for any environment', () => {
    expect(
      resolveCommitCoordinate({
        env: 'PRODUCTION',
        commit: ' 80b62a3 ',
        readGit: cleanGit,
      })
    ).toEqual({ commitSha: '80b62a3', commitDirty: null, hint: null })
  })

  it('an explicit --commit stops claiming to know the worktree state', () => {
    const r = resolveCommitCoordinate({
      env: 'LOCAL',
      commit: 'deadbee',
      readGit: () => ({ commitSha: 'a1b2c3d4', commitDirty: true }),
    })
    expect(r.commitSha).toBe('deadbee')
    expect(r.commitDirty).toBeNull()
  })

  it('hints when a LOCAL run is outside a git checkout', () => {
    const r = resolveCommitCoordinate({ env: 'LOCAL', readGit: noGit })
    expect(r.commitSha).toBeNull()
    expect(r.hint).toMatch(/not a git checkout/i)
  })
})

/**
 * LUM-807 follow-up. The gap this closes was found by walking the flow: the
 * flags existed and were documented, but nothing ever asked for evidence at
 * the one moment the output is still on screen — so a run got recorded as a
 * bare "PASS on LOCAL" with the transcript already gone.
 */
describe('evidenceHint', () => {
  it('run without evidence prints a hint and a fail run says it louder', () => {
    const pass = evidenceHint({ evidenceCount: 0, result: 'PASS' })
    expect(pass).toContain('--evidence-file')
    expect(pass).toContain('nobody else can re-read')

    // A FAIL is the row where a missing transcript costs the most.
    const fail = evidenceHint({ evidenceCount: 0, result: 'FAIL' })
    expect(fail).toContain('--evidence-file')
    expect(fail).toContain('a verdict, not a finding')
    expect(fail).not.toEqual(pass)

    // BLOCKED is not a failure of the thing under test — ordinary wording.
    expect(evidenceHint({ evidenceCount: 0, result: 'BLOCKED' })).toEqual(pass)

    // Nothing to ask for once evidence rode along — the caller appends
    // unconditionally, so silence has to come from here.
    expect(evidenceHint({ evidenceCount: 1, result: 'PASS' })).toBeNull()
    expect(evidenceHint({ evidenceCount: 3, result: 'FAIL' })).toBeNull()
  })
})
