/**
 * LUM-940: pins the decision core of scripts/jest-sparkplug-repro.ts — what
 * counts as a Sparkplug/GC crash, and whether the --no-sparkplug workaround
 * reached every test process.
 */
import {
  allProcessesFlagged,
  classifyRun,
  exitCodeFor,
  parseArgs,
} from '../jest-sparkplug-repro'

describe('jest-sparkplug-repro', () => {
  it('classifies a --runInBand SIGSEGV (exit 139 or signal) as a crash', () => {
    expect(classifyRun({ status: 139, signal: null, output: '' })).toBe('crash')
    expect(classifyRun({ status: null, signal: 'SIGSEGV', output: '' })).toBe(
      'crash'
    )
  })

  it('classifies a jest worker killed by SIGSEGV as a crash, not a plain failure', () => {
    const output =
      'A jest worker process (pid=42852) was terminated by another process: signal=SIGSEGV, exitCode=null.'
    expect(classifyRun({ status: 1, signal: null, output })).toBe('crash')
  })

  it('separates clean passes from ordinary failures', () => {
    expect(classifyRun({ status: 0, signal: null, output: 'ok' })).toBe('pass')
    expect(classifyRun({ status: 1, signal: null, output: 'FAIL x' })).toBe(
      'fail'
    )
  })

  it('requires --no-sparkplug in every recorded test process', () => {
    expect(
      allProcessesFlagged([['--no-sparkplug'], ['--no-sparkplug', '--x']])
    ).toBe(true)
    expect(allProcessesFlagged([['--no-sparkplug'], []])).toBe(false)
    expect(allProcessesFlagged([])).toBe(false)
  })

  it('exits non-zero unless every run was clean and actually exercised the setup', () => {
    const clean = { crash: 0, pass: 20, fail: 0, unflagged: 0, notParallel: 0 }
    expect(exitCodeFor(clean, true)).toBe(0)
    expect(exitCodeFor({ ...clean, crash: 1 }, true)).toBe(1)
    expect(exitCodeFor({ ...clean, fail: 1 }, false)).toBe(1)
    // guarded run where the flag did not reach a test process proves nothing
    expect(exitCodeFor({ ...clean, unflagged: 1 }, true)).toBe(1)
    // unguarded runs never carry the flag; that alone is not a failure
    expect(exitCodeFor({ ...clean, unflagged: 20 }, false)).toBe(0)
    // worker mode that jest ran in one process did not test workers
    expect(exitCodeFor({ ...clean, notParallel: 1 }, true)).toBe(1)
  })

  it('parses options with safe defaults and rejects bad input', () => {
    expect(parseArgs([])).toEqual({ runs: 20, mode: 'inband', guard: true })
    expect(parseArgs(['--runs', '5', '--mode', 'workers', '--no-guard'])).toEqual(
      { runs: 5, mode: 'workers', guard: false }
    )
    expect(() => parseArgs(['--mode', 'x'])).toThrow('--mode')
    expect(() => parseArgs(['--runs', '0'])).toThrow('--runs')
    expect(() => parseArgs(['--bogus'])).toThrow('unknown argument')
  })
})
