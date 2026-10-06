/**
 * Reproducer for the Node 24 V8 GC crash that kills jest workers (LUM-940).
 *
 * Bug: V8 13.6 (all Node 24.x releases as of 2026-10-06) — a major GC that
 * hits a Sparkplug `BaselineOutOfLinePrologue` frame reads a junk stack slot
 * as a heap pointer and the process dies with SIGSEGV in
 * ClearStaleLeftTrimmedPointerVisitor. Upstream:
 * https://github.com/nodejs/node/issues/62393 (V8 fix 0b94a9fd23ba, 24.x
 * backport fb0d0ca28993). jest.config.js works around it with --no-sparkplug.
 *
 * This script generates 64 identical jest suites in a temp dir (each parses
 * one TypeScript statement with @typescript-eslint/parser, which reliably
 * triggers the crash; plain `typescript` does not) and runs jest on them
 * repeatedly. Each suite also records its process's execArgv, so the run shows
 * whether the flag actually reached the process running the tests.
 *
 * Usage:
 *   npx tsx scripts/jest-sparkplug-repro.ts [--runs N] [--mode inband|workers] [--no-guard]
 *
 *   default      loads the repo's jest.config.js (the workaround) → expect 0 crashes
 *   --no-guard   skips it → on an affected Node most runs crash (20/20 inband
 *                on 24.14.0). To decide whether the workaround can be removed,
 *                run with --no-guard on the new Node: 0 crashes over 20 runs
 *                in both modes means the fix is in.
 *
 * Exit code: 0 only when no run crashed or failed, every test process had the
 * flag (guarded runs), and worker-mode runs really used several processes.
 * Nothing is installed; it uses
 * the existing node_modules and fails clearly if the parser is missing.
 */
import { spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

export type RunOutcome = 'crash' | 'pass' | 'fail'

export type RunResult = {
  status: number | null
  signal: string | null
  output: string
}

/**
 * Pure core: a run crashed when jest died by SIGSEGV itself (exit 139 or
 * signal, the --runInBand shape) or reported a worker killed by SIGSEGV.
 */
export function classifyRun(run: RunResult): RunOutcome {
  if (
    run.signal === 'SIGSEGV' ||
    run.status === 139 ||
    run.output.includes('signal=SIGSEGV')
  ) {
    return 'crash'
  }
  return run.status === 0 ? 'pass' : 'fail'
}

/** Whether every recorded test process started/ran with --no-sparkplug. */
export function allProcessesFlagged(execArgvs: string[][]): boolean {
  return (
    execArgvs.length > 0 &&
    execArgvs.every((argv) => argv.includes('--no-sparkplug'))
  )
}

export type Tally = {
  crash: number
  pass: number
  fail: number
  /** Runs where some test process lacked --no-sparkplug. */
  unflagged: number
  /** Worker-mode runs where jest ran everything in one process anyway. */
  notParallel: number
}

/**
 * Pure core: exit 0 only when no run crashed or failed — and, with the guard
 * loaded, when the flag reached every test process; in worker mode, only when
 * jest really used several worker processes (otherwise the run proved nothing
 * about workers).
 */
export function exitCodeFor(tally: Tally, guard: boolean): number {
  if (tally.crash > 0 || tally.fail > 0) return 1
  if (guard && tally.unflagged > 0) return 1
  if (tally.notParallel > 0) return 1
  return 0
}

export type Options = { runs: number; mode: 'inband' | 'workers'; guard: boolean }

export function parseArgs(argv: string[]): Options {
  const opts: Options = { runs: 20, mode: 'inband', guard: true }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--no-guard') opts.guard = false
    else if (a === '--runs') opts.runs = Number(argv[++i])
    else if (a === '--mode') {
      const m = argv[++i]
      if (m !== 'inband' && m !== 'workers') {
        throw new Error(`--mode must be inband or workers, got ${m}`)
      }
      opts.mode = m
    } else throw new Error(`unknown argument ${a}`)
  }
  if (!Number.isInteger(opts.runs) || opts.runs < 1) {
    throw new Error('--runs must be a positive integer')
  }
  return opts
}

const SUITES = 64

function writeFixture(dir: string, repoRoot: string, guard: boolean): void {
  let parserPath: string
  try {
    parserPath = require.resolve('@typescript-eslint/parser', {
      paths: [repoRoot],
    })
  } catch {
    throw new Error(
      '@typescript-eslint/parser is not in node_modules; this reproducer needs it (it is not installed by this script).'
    )
  }
  for (let i = 0; i < SUITES; i++) {
    const name = `parser-${String(i).padStart(2, '0')}.test.js`
    fs.writeFileSync(
      path.join(dir, name),
      `const fs = require('fs');
const parser = require(${JSON.stringify(parserPath)});
fs.writeFileSync(${JSON.stringify(dir)} + '/argv-' + process.pid + '.json', JSON.stringify(process.execArgv));
test('parses TypeScript', () => {
  const ast = parser.parse('export const result: number = 1;', { sourceType: 'module' });
  expect(ast.type).toBe('Program');
});
`
    )
  }
  const guardLine = guard
    ? `require(${JSON.stringify(path.join(repoRoot, 'jest.config.js'))})\n`
    : ''
  fs.writeFileSync(
    path.join(dir, 'jest.config.js'),
    `${guardLine}module.exports = { rootDir: ${JSON.stringify(dir)}, testEnvironment: 'node', transform: {} }\n`
  )
}

function readExecArgvs(dir: string): string[][] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('argv-'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as string[])
}

export function main(argv: string[]): number {
  let opts: Options
  try {
    opts = parseArgs(argv)
  } catch (e) {
    process.stderr.write(`jest-sparkplug-repro: ${(e as Error).message}\n`)
    return 1
  }
  const repoRoot = path.resolve(__dirname, '..')
  const jestBin = require.resolve('jest/bin/jest', { paths: [repoRoot] })
  // Don't hand tsx's loader (or any other NODE_OPTIONS) to the jest under test.
  const env = { ...process.env }
  delete env.NODE_OPTIONS

  const tally: Tally = { crash: 0, pass: 0, fail: 0, unflagged: 0, notParallel: 0 }
  for (let i = 1; i <= opts.runs; i++) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jest-sparkplug-repro-'))
    try {
      writeFixture(dir, repoRoot, opts.guard)
      const args = [jestBin, '--config', path.join(dir, 'jest.config.js')]
      if (opts.mode === 'inband') args.push('--runInBand')
      const r = spawnSync(process.execPath, args, {
        cwd: dir,
        env,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      })
      const outcome = classifyRun({
        status: r.status,
        signal: r.signal,
        output: `${r.stdout ?? ''}${r.stderr ?? ''}`,
      })
      tally[outcome]++
      const argvs = readExecArgvs(dir)
      const flagged = allProcessesFlagged(argvs)
      if (!flagged) tally.unflagged++
      // jest may decide to run in band by itself; a worker-mode run only
      // counts when several processes actually ran the suites.
      if (opts.mode === 'workers' && outcome === 'pass' && argvs.length < 2) {
        tally.notParallel++
      }
      process.stdout.write(
        `run ${i}/${opts.runs}: ${outcome} (exit ${r.status ?? r.signal}) — ` +
          `${argvs.length} test process record(s), --no-sparkplug in all: ${flagged}\n`
      )
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
  process.stdout.write(
    `\n${process.version} mode=${opts.mode} guard=${opts.guard}: ` +
      `${tally.crash} crashed, ${tally.pass} passed, ${tally.fail} failed (other) ` +
      `of ${opts.runs}; runs where a test process lacked --no-sparkplug: ${tally.unflagged}` +
      (opts.mode === 'workers'
        ? `; passing runs that used <2 processes: ${tally.notParallel}`
        : '') +
      '\n'
  )
  return exitCodeFor(tally, opts.guard)
}

// Run only when invoked as a script (not when imported by tests).
if (process.argv[1] && process.argv[1].endsWith('jest-sparkplug-repro.ts')) {
  process.exit(main(process.argv.slice(2)))
}
