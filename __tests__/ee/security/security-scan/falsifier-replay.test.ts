/** @jest-environment node */
// LUM-835 — the replay's pass rule, its variants, and the plumbing around the
// model call (env loading, candidate shape, exit codes). The real-model run
// is a contract checkpointer; here the falsifier client is mocked.
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
}))
jest.mock('dotenv', () => ({ config: jest.fn() }))
jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  execFileSync: jest.fn(),
}))
jest.mock('@/ee/security/llm/security-falsifier-client', () => ({
  falsifyCandidate: jest.fn(),
}))

import { existsSync } from 'fs'
import { execFileSync } from 'child_process'
import path from 'path'
import { config } from 'dotenv'
import { falsifyCandidate } from '@/ee/security/llm/security-falsifier-client'
import {
  VARIANTS,
  loadEnv,
  main,
  run,
  variantPasses,
  verdicts,
} from '@/scripts/security/falsifier-replay'

const exists = existsSync as jest.Mock
const git = execFileSync as jest.Mock
const dotenv = config as jest.Mock
const falsify = falsifyCandidate as jest.Mock

const ENV_KEYS = ['AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN'] as const
const savedEnv: Record<string, string | undefined> = {}
const savedArgv = process.argv

beforeEach(() => {
  jest.resetAllMocks()
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k]
    delete process.env[k]
  }
  process.argv = ['node', 'falsifier-replay.ts']
  jest.spyOn(process.stdout, 'write').mockReturnValue(true)
  jest.spyOn(process.stderr, 'write').mockReturnValue(true)
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  process.argv = savedArgv
  jest.restoreAllMocks()
})

/** A model that only an executing allow-list talks out of the finding. */
function honestModel(): void {
  falsify.mockImplementation(
    async ({ entrySnippet }: { entrySnippet: string }) =>
      entrySnippet.includes('.test(body)')
        ? { verdict: 'REJECT', reason: 'allow-list on line 5' }
        : { verdict: 'INCONCLUSIVE', reason: 'no executing check' }
  )
}

describe('falsifier replay', () => {
  it('a text-only reason must never REJECT; a real mitigation must REJECT in at least two of three', () => {
    expect(
      variantPasses('never-reject', ['INCONCLUSIVE', 'INCONCLUSIVE'])
    ).toBe(true)
    expect(variantPasses('never-reject', ['INCONCLUSIVE', 'REJECT'])).toBe(
      false
    )
    expect(variantPasses('reject', ['REJECT', 'REJECT', 'INCONCLUSIVE'])).toBe(
      true
    )
    expect(
      variantPasses('reject', ['REJECT', 'INCONCLUSIVE', 'INCONCLUSIVE'])
    ).toBe(false)
  })

  it('covers a comment-only "test harness", a comment-only "sanitised", and a real allow-list', () => {
    const byLabel = Object.fromEntries(VARIANTS.map(v => [v.label, v]))
    const harness = byLabel['comment claims a test harness']!
    expect(harness.expect).toBe('never-reject')
    expect(harness.lines.join('\n')).toMatch(/\/\/ .*test harness/)
    expect(harness.lines.join('\n')).toContain('exec(`echo ${body}`)')
    const sanitised = byLabel['comment claims input is sanitised and internal']!
    expect(sanitised.expect).toBe('never-reject')
    expect(sanitised.lines.join('\n')).toMatch(/\/\/ .*sanitised/)
    const mitigated = byLabel['real allow-list executes before the shell call']!
    expect(mitigated.expect).toBe('reject')
    const src = mitigated.lines.join('\n')
    // The check executes BEFORE the sink.
    expect(src.indexOf('.test(body)')).toBeLessThan(src.indexOf('exec(`'))
  })
})

describe('falsifier replay loadEnv', () => {
  it('leaves the environment alone when the gateway key is already set', () => {
    process.env.AI_GATEWAY_API_KEY = 'set'
    loadEnv()
    expect(dotenv).not.toHaveBeenCalled()
    expect(exists).not.toHaveBeenCalled()
  })

  it('loads .env.local from the current directory when it exists', () => {
    exists.mockReturnValue(true)
    loadEnv()
    expect(dotenv).toHaveBeenCalledWith({ path: path.resolve('.env.local') })
    expect(git).not.toHaveBeenCalled()
  })

  it('falls back to the main checkout’s .env.local from inside a worktree', () => {
    exists.mockImplementation((p: string) => p === '/repo/.env.local')
    git.mockReturnValue('/repo/.git\n')
    loadEnv()
    expect(git).toHaveBeenCalledWith(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { encoding: 'utf8' }
    )
    expect(dotenv).toHaveBeenCalledWith({ path: '/repo/.env.local' })
  })

  it('loads nothing, without throwing, when there is no env file and no git', () => {
    exists.mockReturnValue(false)
    git.mockImplementation(() => {
      throw new Error('not a git repository')
    })
    expect(() => loadEnv()).not.toThrow()
    expect(dotenv).not.toHaveBeenCalled()
  })
})

describe('falsifier replay verdicts', () => {
  it('sends the variant as a numbered snippet with entry and sink on the right lines, once per run', async () => {
    const harness = VARIANTS.find(v => v.expect === 'never-reject')!
    falsify.mockResolvedValue({ verdict: 'INCONCLUSIVE', reason: 'none' })
    const got = await verdicts(harness, 2)
    expect(got).toEqual(['INCONCLUSIVE', 'INCONCLUSIVE'])
    expect(falsify).toHaveBeenCalledTimes(2)
    const arg = falsify.mock.calls[0]![0]
    const entryLine =
      harness.lines.findIndex(l => l.includes('export async function POST')) + 1
    const sinkLine = harness.lines.findIndex(l => l.includes('exec(`')) + 1
    expect(arg.candidate.entry).toEqual({
      symbol: 'POST',
      file: harness.file,
      line: entryLine,
    })
    expect(arg.candidate.sink).toEqual({
      symbol: 'exec',
      file: harness.file,
      line: sinkLine,
    })
    expect(arg.entrySnippet).toContain(`${sinkLine}:   exec(\`echo \${body}\`)`)
    expect(arg.sinkSnippet).toBe(arg.entrySnippet)
  })
})

describe('falsifier replay main', () => {
  it('exits 2 without AI Gateway credentials, before calling the model', async () => {
    exists.mockReturnValue(false)
    git.mockImplementation(() => {
      throw new Error('no git')
    })
    expect(await main()).toBe(2)
    expect(falsify).not.toHaveBeenCalled()
  })

  it('exits 0 when every variant behaves, running each three times by default', async () => {
    process.env.AI_GATEWAY_API_KEY = 'set'
    honestModel()
    expect(await main()).toBe(0)
    expect(falsify).toHaveBeenCalledTimes(VARIANTS.length * 3)
  })

  it('exits 1 when a comment talks the model out of a finding', async () => {
    process.env.AI_GATEWAY_API_KEY = 'set'
    falsify.mockResolvedValue({ verdict: 'REJECT', reason: 'line 3 says test' })
    expect(await main()).toBe(1)
  })

  it('honours --runs', async () => {
    process.env.AI_GATEWAY_API_KEY = 'set'
    process.argv = ['node', 'falsifier-replay.ts', '--runs', '1']
    honestModel()
    expect(await main()).toBe(0)
    expect(falsify).toHaveBeenCalledTimes(VARIANTS.length)
  })
})

describe('falsifier replay run', () => {
  it('exits with main’s code', async () => {
    const exit = jest
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never)
    process.env.AI_GATEWAY_API_KEY = 'set'
    honestModel()
    await run()
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('exits 1 and reports the error when the model call throws', async () => {
    const exit = jest
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never)
    process.env.AI_GATEWAY_API_KEY = 'set'
    falsify.mockRejectedValue(new Error('gateway down'))
    await run()
    expect(exit).toHaveBeenCalledWith(1)
    expect(process.stderr.write).toHaveBeenCalledWith('gateway down\n')
  })
})
