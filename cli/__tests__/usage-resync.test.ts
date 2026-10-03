/**
 * @jest-environment node
 *
 * LUM-932: `lumo usage resync` scans local transcripts, posts numbers only.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

jest.mock('../src/lib/config', () => ({
  readCredentials: () => ({ token: 't', apiUrl: 'https://lumo.test' }),
}))

import { usageResync } from '../src/commands/usage-resync'
import { listTranscripts } from '../src/lib/transcript-scan'

const realFetch = global.fetch
const realEnv = process.env.CLAUDE_CONFIG_DIR
afterAll(() => {
  global.fetch = realFetch
  if (realEnv === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = realEnv
})

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function makeConfigDir(count: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'lumo-resync-'))
  const proj = join(dir, 'projects', '-some-project')
  mkdirSync(proj, { recursive: true })
  for (let i = 1; i <= count; i++) {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        id: `m${i}`,
        model: 'claude-x',
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    })
    writeFileSync(join(proj, `${uuid(i)}.jsonl`), line + '\n')
  }
  writeFileSync(join(proj, 'notes.jsonl'), 'x\n')
  writeFileSync(join(proj, 'readme.txt'), 'x\n')
  return dir
}

type Req = {
  url: string
  body: { dryRun: boolean; sessions: { sessionId: string }[] }
}

function mockFetch(
  status: number,
  respond?: (b: Req['body']) => unknown
): Req[] {
  const reqs: Req[] = []
  global.fetch = jest.fn(async (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body)
    reqs.push({ url, body })
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () =>
        respond ? respond(body) : { dryRun: body.dryRun, results: [] },
    }
  }) as unknown as typeof fetch
  return reqs
}

async function run(
  opts: { apply?: boolean; json?: boolean } = {}
): Promise<{ out: string; err: string; code: number | void }> {
  let out = ''
  let err = ''
  const o = jest.spyOn(process.stdout, 'write').mockImplementation(((
    s: string
  ) => {
    out += s
    return true
  }) as never)
  const e = jest.spyOn(console, 'error').mockImplementation(((s: string) => {
    err += s + '\n'
  }) as never)
  let code: number | void
  try {
    code = await usageResync(opts)
  } finally {
    o.mockRestore()
    e.mockRestore()
  }
  return { out, err, code }
}

const results = (b: Req['body']) => ({
  dryRun: b.dryRun,
  results: b.sessions.map((s, i) => ({
    sessionId: s.sessionId,
    status: b.dryRun ? 'would_resync' : 'resynced',
    before: 200,
    after: 100,
    ...(i < 0 ? { reason: 'x' } : {}),
  })),
})

describe('usage resync command and resynced runs', () => {
  it('default posts dryRun true and prints the dry-run header', async () => {
    process.env.CLAUDE_CONFIG_DIR = makeConfigDir(2)
    const reqs = mockFetch(200, results)
    const { out, code } = await run()
    expect(code).toBe(0)
    expect(reqs).toHaveLength(1)
    expect(reqs[0]!.url).toBe('https://lumo.test/api/sessions/usage-resync')
    expect(reqs[0]!.body.dryRun).toBe(true)
    expect(out).toContain('Dry run — nothing written.')
  })

  it('--apply posts dryRun false and omits the dry-run header', async () => {
    process.env.CLAUDE_CONFIG_DIR = makeConfigDir(1)
    const reqs = mockFetch(200, results)
    const { out } = await run({ apply: true })
    expect(reqs[0]!.body.dryRun).toBe(false)
    expect(out).not.toContain('Dry run')
  })

  it('batches 50 sessions per request', async () => {
    process.env.CLAUDE_CONFIG_DIR = makeConfigDir(120)
    const reqs = mockFetch(200, results)
    await run()
    expect(reqs.map(r => r.body.sessions.length)).toEqual([50, 50, 20])
  })

  it('prints counts per status and summed before and after totals', async () => {
    process.env.CLAUDE_CONFIG_DIR = makeConfigDir(3)
    mockFetch(200, b => ({
      dryRun: b.dryRun,
      results: [
        {
          sessionId: b.sessions[0]!.sessionId,
          status: 'would_resync',
          before: 200,
          after: 100,
        },
        {
          sessionId: b.sessions[1]!.sessionId,
          status: 'skipped',
          reason: 'not_found',
        },
        {
          sessionId: b.sessions[2]!.sessionId,
          status: 'skipped',
          reason: 'not_inflated',
        },
      ],
    }))
    const { out, code } = await run()
    expect(code).toBe(0)
    expect(out).toContain('1 would be resynced')
    expect(out).toContain('1 not on this account / unknown')
    expect(out).toContain('1 not inflated')
    expect(out).toContain('200')
    expect(out).toContain('100')
  })

  it('counts reason error as a failure and exits 1', async () => {
    process.env.CLAUDE_CONFIG_DIR = makeConfigDir(2)
    mockFetch(200, b => ({
      dryRun: b.dryRun,
      results: [
        {
          sessionId: b.sessions[0]!.sessionId,
          status: 'skipped',
          reason: 'error',
        },
        {
          sessionId: b.sessions[1]!.sessionId,
          status: 'skipped',
          reason: 'no_usage',
        },
      ],
    }))
    const { out, code } = await run()
    expect(code).toBe(1)
    expect(out).toContain('1 failed — re-run later')
  })

  it('--json prints the merged response', async () => {
    process.env.CLAUDE_CONFIG_DIR = makeConfigDir(60)
    mockFetch(200, results)
    const { out } = await run({ json: true })
    const parsed = JSON.parse(out)
    expect(parsed.dryRun).toBe(true)
    expect(parsed.results).toHaveLength(60)
  })

  it('401 tells the user to log in and exits 1', async () => {
    process.env.CLAUDE_CONFIG_DIR = makeConfigDir(1)
    mockFetch(401)
    const { err, code } = await run()
    expect(code).toBe(1)
    expect(err).toContain('lumo auth login')
  })

  it('network error exits 1', async () => {
    process.env.CLAUDE_CONFIG_DIR = makeConfigDir(1)
    global.fetch = jest.fn(async () => {
      throw new Error('boom')
    }) as unknown as typeof fetch
    const { err, code } = await run()
    expect(code).toBe(1)
    expect(err).toContain('could not reach')
  })

  it('no transcripts prints a message and exits 0 without posting', async () => {
    process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'lumo-empty-'))
    const reqs = mockFetch(200, results)
    const { out, code } = await run()
    expect(code).toBe(0)
    expect(reqs).toHaveLength(0)
    expect(out).toContain('No transcripts found')
  })

  it('scan honors CLAUDE_CONFIG_DIR and skips non-UUID names', () => {
    const dir = makeConfigDir(2)
    process.env.CLAUDE_CONFIG_DIR = dir
    const found = listTranscripts()
    expect(found.map(f => f.sessionId).sort()).toEqual([uuid(1), uuid(2)])
    expect(found[0]!.path.startsWith(dir)).toBe(true)
  })

  it('sends numbers only, never transcript content', async () => {
    process.env.CLAUDE_CONFIG_DIR = makeConfigDir(1)
    const reqs = mockFetch(200, results)
    await run()
    const s = JSON.stringify(reqs[0]!.body)
    expect(s).not.toContain('"type":"assistant"')
    expect(Object.keys(reqs[0]!.body.sessions[0]!).sort()).toEqual(
      ['byModel', 'sessionId', 'total']
        .concat(
          'bySubagent' in reqs[0]!.body.sessions[0]! ? ['bySubagent'] : []
        )
        .sort()
    )
  })
})
