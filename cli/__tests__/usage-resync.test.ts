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
  opts: { dryRun?: boolean; json?: boolean } = {}
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
  results: b.sessions.map(s => ({
    sessionId: s.sessionId,
    status: b.dryRun ? 'would_resync' : 'resynced',
    before: 200,
    after: 100,
  })),
})

describe('usage resync command and resynced runs', () => {
  it('--dry-run posts dryRun true and prints the dry-run header', async () => {
    process.env.CLAUDE_CONFIG_DIR = makeConfigDir(2)
    const reqs = mockFetch(200, results)
    const { out, code } = await run({ dryRun: true })
    expect(code).toBe(0)
    expect(reqs).toHaveLength(1)
    expect(reqs[0]!.url).toBe('https://lumo.test/api/sessions/usage-resync')
    expect(reqs[0]!.body.dryRun).toBe(true)
    expect(out).toContain('Dry run — nothing written.')
  })

  it('default (LUM-1233 3e: writes when run) posts dryRun false and omits the dry-run header', async () => {
    process.env.CLAUDE_CONFIG_DIR = makeConfigDir(1)
    const reqs = mockFetch(200, results)
    const { out } = await run()
    expect(reqs[0]!.body.dryRun).toBe(false)
    expect(out).not.toContain('Dry run')
  })

  it('batches 50 sessions per request with --dry-run', async () => {
    process.env.CLAUDE_CONFIG_DIR = makeConfigDir(120)
    const reqs = mockFetch(200, results)
    await run({ dryRun: true })
    expect(reqs.map(r => r.body.sessions.length)).toEqual([50, 50, 20])
  })

  it('batches 10 sessions per request when writing (default)', async () => {
    process.env.CLAUDE_CONFIG_DIR = makeConfigDir(25)
    const reqs = mockFetch(200, results)
    await run()
    expect(reqs.map(r => r.body.sessions.length)).toEqual([10, 10, 5])
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
    const { out, code } = await run({ dryRun: true })
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
    const { out, code } = await run({ dryRun: true })
    expect(code).toBe(1)
    expect(out).toContain('1 failed — re-run later')
  })

  it('--json prints the merged response', async () => {
    process.env.CLAUDE_CONFIG_DIR = makeConfigDir(60)
    mockFetch(200, results)
    const { out } = await run({ dryRun: true, json: true })
    const parsed = JSON.parse(out)
    expect(parsed.dryRun).toBe(true)
    expect(parsed.results).toHaveLength(60)
  })

  it('401 tells the user to log in and exits 1', async () => {
    process.env.CLAUDE_CONFIG_DIR = makeConfigDir(1)
    mockFetch(401)
    const { err, code } = await run({ dryRun: true })
    expect(code).toBe(1)
    expect(err).toContain('lumo auth login')
  })

  it('network error exits 1', async () => {
    process.env.CLAUDE_CONFIG_DIR = makeConfigDir(1)
    global.fetch = jest.fn(async () => {
      throw new Error('boom')
    }) as unknown as typeof fetch
    const { err, code } = await run({ dryRun: true })
    expect(code).toBe(1)
    expect(err).toContain('could not reach')
  })

  it('no transcripts prints a message and exits 0 without posting', async () => {
    process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'lumo-empty-'))
    const reqs = mockFetch(200, results)
    const { out, code } = await run({ dryRun: true })
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
    await run({ dryRun: true })
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

  it('a mid-run batch failure prints finished batches, unsent count, exit 1', async () => {
    process.env.CLAUDE_CONFIG_DIR = makeConfigDir(12)
    let call = 0
    global.fetch = jest.fn(async (_u: string, init: { body: string }) => {
      call++
      const body = JSON.parse(init.body)
      if (call === 2) throw new Error('boom')
      return { ok: true, status: 200, json: async () => results(body) }
    }) as unknown as typeof fetch
    const { out, err, code } = await run()
    expect(code).toBe(1)
    expect(out).toContain('Sent 10 of 12 session(s) with usage.')
    expect(out).toContain('10 resynced')
    expect(err).toContain('could not reach')
    expect(err).toContain('2 session(s) not sent — re-run')
  })

  it('a 401 on batch 2 keeps batch 1 results and exits 1', async () => {
    process.env.CLAUDE_CONFIG_DIR = makeConfigDir(12)
    let call = 0
    global.fetch = jest.fn(async (_u: string, init: { body: string }) => {
      call++
      const body = JSON.parse(init.body)
      if (call === 2) return { ok: false, status: 401, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => results(body) }
    }) as unknown as typeof fetch
    const { out, err, code } = await run()
    expect(code).toBe(1)
    expect(out).toContain('Sent 10 of 12 session(s) with usage.')
    expect(out).toContain('10 resynced')
    expect(err).toContain('lumo auth login')
    expect(err).toContain('2 session(s) not sent')
  })

  it('invalid JSON or missing results is a failed batch', async () => {
    process.env.CLAUDE_CONFIG_DIR = makeConfigDir(2)
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('bad json')
      },
    })) as unknown as typeof fetch
    let r = await run({ dryRun: true })
    expect(r.code).toBe(1)
    expect(r.err).toContain('2 session(s) not sent')
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ dryRun: true }),
    })) as unknown as typeof fetch
    r = await run({ dryRun: true })
    expect(r.code).toBe(1)
    expect(r.err).toContain('unexpected response')
  })

  it('dedupes a session id seen in two project dirs', () => {
    const dir = makeConfigDir(1)
    const other = join(dir, 'projects', '-other')
    mkdirSync(other, { recursive: true })
    writeFileSync(join(other, `${uuid(1)}.jsonl`), '\n')
    process.env.CLAUDE_CONFIG_DIR = dir
    expect(listTranscripts()).toHaveLength(1)
  })

  it('never lists a subagents file or a directory as a session', () => {
    const dir = makeConfigDir(1)
    const sub = join(dir, 'projects', '-some-project', uuid(1), 'subagents')
    mkdirSync(sub, { recursive: true })
    writeFileSync(join(sub, 'agent-abc.jsonl'), '\n')
    mkdirSync(join(dir, 'projects', '-some-project', `${uuid(9)}.jsonl`))
    process.env.CLAUDE_CONFIG_DIR = dir
    expect(listTranscripts().map(t => t.sessionId)).toEqual([uuid(1)])
  })

  it('sends bySubagent as numbers only and drops over-long model keys', async () => {
    const dir = makeConfigDir(1)
    const proj = join(dir, 'projects', '-some-project')
    // Distinct message ids: dedupe must not swallow the second line.
    const line = (model: string, id: string) =>
      JSON.stringify({
        type: 'assistant',
        message: {
          id,
          model,
          usage: { input_tokens: 3, output_tokens: 2 },
        },
      }) + '\n'
    const sub = join(proj, uuid(1), 'subagents')
    mkdirSync(sub, { recursive: true })
    writeFileSync(join(sub, 'agent-abc.jsonl'), line('claude-sub', 's1'))
    writeFileSync(
      join(proj, `${uuid(1)}.jsonl`),
      line('claude-x', 'x1') + line('m'.repeat(300), 'x2')
    )
    process.env.CLAUDE_CONFIG_DIR = dir
    const reqs = mockFetch(200, results)
    await run({ dryRun: true })
    const sent = reqs[0]!.body.sessions[0] as unknown as {
      byModel: Record<string, unknown>
      bySubagent: Record<string, { total: object; byModel: object }>
    }
    // The session total includes its subagent; only the 300-char key is dropped.
    expect(Object.keys(sent.byModel).sort()).toEqual(['claude-sub', 'claude-x'])
    expect(Object.keys(sent.bySubagent)).toEqual(['abc'])
    expect(JSON.stringify(sent.bySubagent)).not.toContain('"type"')
    expect(Object.keys(sent.bySubagent.abc!).sort()).toEqual([
      'byModel',
      'total',
    ])
  })
})
