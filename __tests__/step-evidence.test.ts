/**
 * LUM-1185: 记录弹窗按步挂证据的纯逻辑——哪些步能挂、清掉不再上报的步的文件、
 * 与上传路由一致的限额、拼出 stepResults[].evidence 下标。
 */
import {
  assembleStepEvidence,
  checkEvidenceFiles,
  countStepFiles,
  pruneStepFiles,
  reportableStepKeys,
  stepRefOfKey,
} from '@/lib/test-cases/step-evidence'

const steps = ['a', 'b', 'c']
const verification = ['v']

describe('reportableStepKeys', () => {
  it('lists only marked steps', () => {
    const keys = reportableStepKeys(steps, verification, 'PASS', {
      'STEPS:0': { status: 'PASS', reason: '' },
      'VERIFICATION:0': { status: 'SKIP', reason: 'x' },
    })
    expect([...keys]).toEqual(['STEPS:0', 'VERIFICATION:0'])
  })

  it('reports nothing for a BLOCKED run', () => {
    expect(
      reportableStepKeys(steps, verification, 'BLOCKED', {
        'STEPS:0': { status: 'PASS', reason: '' },
      }).size
    ).toBe(0)
  })

  it('drops a failed step from a non-FAIL run', () => {
    const keys = reportableStepKeys(steps, verification, 'PASS', {
      'STEPS:0': { status: 'FAIL', reason: '' },
      'STEPS:1': { status: 'PASS', reason: '' },
    })
    expect([...keys]).toEqual(['STEPS:1'])
  })

  it('stops at the first failed step of a FAIL run', () => {
    const keys = reportableStepKeys(steps, verification, 'FAIL', {
      'STEPS:0': { status: 'PASS', reason: '' },
      'STEPS:1': { status: 'FAIL', reason: '' },
      'STEPS:2': { status: 'PASS', reason: '' },
    })
    expect([...keys]).toEqual(['STEPS:0', 'STEPS:1'])
  })
})

describe('pruneStepFiles / countStepFiles', () => {
  it('keeps the same object when nothing is stale', () => {
    const files = { 'STEPS:0': ['x'] }
    expect(pruneStepFiles(files, new Set(['STEPS:0']))).toBe(files)
  })

  it('drops files under steps that are no longer reported', () => {
    const next = pruneStepFiles(
      { 'STEPS:0': ['x'], 'STEPS:1': ['y', 'z'] },
      new Set(['STEPS:0'])
    )
    expect(next).toEqual({ 'STEPS:0': ['x'] })
    expect(countStepFiles(next)).toBe(1)
  })
})

describe('checkEvidenceFiles', () => {
  const png = (name: string, size = 10) => ({ name, size, type: 'image/png' })

  it('accepts up to five in total', () => {
    expect(checkEvidenceFiles([png('a'), png('b')], 3)).toEqual({ ok: true })
  })

  it('counts files already picked elsewhere toward the five', () => {
    expect(checkEvidenceFiles([png('a'), png('b')], 4)).toEqual({
      ok: false,
      reason: 'tooMany',
      count: 6,
      picked: 2,
      others: 4,
      max: 5,
    })
  })

  it('rejects a type the upload route refuses', () => {
    expect(
      checkEvidenceFiles(
        [{ name: 'a.pdf', size: 1, type: 'application/pdf' }],
        0
      )
    ).toEqual({ ok: false, reason: 'badType', filename: 'a.pdf' })
  })

  it('rejects a file over 10 MB with its size', () => {
    expect(checkEvidenceFiles([png('big', 11 * 1024 * 1024)], 0)).toEqual({
      ok: false,
      reason: 'tooLarge',
      filename: 'big',
      sizeMb: '11.0',
      maxMb: 10,
    })
  })
})

describe('assembleStepEvidence', () => {
  it('puts run files first, then step files in step order, with indices', () => {
    const out = assembleStepEvidence(
      ['run.txt'],
      { 'VERIFICATION:0': ['v.png'], 'STEPS:1': ['s2a.png', 's2b.png'] },
      [
        { phase: 'STEPS' as const, index: 0, status: 'PASS' as const },
        { phase: 'STEPS' as const, index: 1, status: 'PASS' as const },
        { phase: 'VERIFICATION' as const, index: 0, status: 'PASS' as const },
      ]
    )
    expect(out.files).toEqual(['run.txt', 's2a.png', 's2b.png', 'v.png'])
    expect(out.stepResults).toEqual([
      { phase: 'STEPS', index: 0, status: 'PASS' },
      { phase: 'STEPS', index: 1, status: 'PASS', evidence: [1, 2] },
      { phase: 'VERIFICATION', index: 0, status: 'PASS', evidence: [3] },
    ])
  })

  it('shifts indices past evidence already in the run', () => {
    const out = assembleStepEvidence(
      [],
      { 'STEPS:0': ['a'] },
      [{ phase: 'STEPS' as const, index: 0 }],
      2
    )
    expect(out.stepResults[0]!.evidence).toEqual([2])
  })
})

describe('stepRefOfKey', () => {
  it('uses the CLI numbering', () => {
    expect(stepRefOfKey('STEPS:1')).toBe('s2')
    expect(stepRefOfKey('VERIFICATION:0')).toBe('v1')
  })
})
