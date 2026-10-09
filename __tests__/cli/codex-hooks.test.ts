/**
 * @jest-environment node
 *
 * LUM-1051 — Codex hooks end to end on the CLI side. Payloads are the
 * sanitized real ones from the LUM-1050 probe (codex-cli 0.162.0).
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(),
  configDir: () => '/tmp/lumo-config',
}))
jest.mock('@/cli/src/lib/memory-auto', () => ({
  autoUpsyncOnDrain: jest.fn(),
}))

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readCredentials } from '@/cli/src/lib/config'
import { autoUpsyncOnDrain } from '@/cli/src/lib/memory-auto'
import { runHookWithBody, type HookPath } from '@/cli/src/lib/hook-runner'
import {
  CODEX_HOOK_EVENTS,
  LUMO_HOOK_EVENTS,
} from '@/cli/src/lib/hooks-template'
import { mergeHooksFile } from '@/cli/src/commands/init'
import {
  codexHooksPath,
  codexMemoryStoreError,
  codexSessionHasEvents,
} from '@/cli/src/lib/codex-hooks'
import {
  findSubagentRollout,
  sumCodexRolloutUsage,
} from '@/cli/src/lib/codex-rollout-usage'
import payloads from '../fixtures/codex-hooks/payloads.json'

type Fixture = { event: string; payload: Record<string, unknown> }
const FIXTURES = payloads as Fixture[]
const slugOf = (event: string) =>
  CODEX_HOOK_EVENTS.find(([e]) => e === event)?.[1]

let stdoutSpy: jest.SpyInstance
beforeEach(() => {
  jest.clearAllMocks()
  ;(readCredentials as jest.Mock).mockReturnValue({
    token: 'lum_test',
    apiUrl: 'https://api.example.com',
  })
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({}),
  }) as unknown as typeof fetch
  stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
})
afterEach(() => stdoutSpy.mockRestore())

describe('CODEX_HOOK_EVENTS', () => {
  it('covers the 12 Codex 0.162.0 events', () => {
    expect(CODEX_HOOK_EVENTS.map(([e]) => e).sort()).toEqual(
      [
        'Interrupt',
        'PermissionRequest',
        'PostCompact',
        'PostToolUse',
        'PreCompact',
        'PreToolUse',
        'SessionEnd',
        'SessionStart',
        'Stop',
        'SubagentStart',
        'SubagentStop',
        'UserPromptSubmit',
      ].sort()
    )
  })

  it('every probed event has a hook, and every hook a server route', () => {
    for (const { event } of FIXTURES) expect(slugOf(event)).toBeDefined()
    for (const [, slug] of CODEX_HOOK_EVENTS) {
      expect(existsSync(join('app/api/hooks', slug, 'route.ts'))).toBe(true)
    }
  })

  it('shared events keep the Claude Code slug', () => {
    const claude = new Map(LUMO_HOOK_EVENTS)
    for (const [event, slug] of CODEX_HOOK_EVENTS) {
      if (claude.has(event)) expect(claude.get(event)).toBe(slug)
    }
  })
})

describe('runHookWithBody forwards every probed Codex payload', () => {
  it.each(FIXTURES.map(f => [f.event, f.payload.tool_name ?? '', f] as const))(
    '%s %s',
    async (event, _tool, fixture) => {
      const slug = slugOf(event) as HookPath
      await runHookWithBody(slug, JSON.stringify(fixture.payload), 'codex')
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
      expect(url).toBe(`https://api.example.com/api/hooks/${slug}`)
      expect(init.headers['X-Lumo-Agent']).toBe('CODEX')
      const sent = JSON.parse(init.body)
      expect(sent.session_id).toBe(fixture.payload.session_id)
      expect(sent.hook_event_name).toBe(event)
      expect(sent.tool_input).toEqual(fixture.payload.tool_input)
      expect(sent.agent_id).toBe(fixture.payload.agent_id)
      // Stop / Interrupt / SessionEnd must print nothing: plain text is
      // invalid output for those Codex events.
      if (['Stop', 'Interrupt', 'SessionEnd', 'SubagentStop'].includes(event)) {
        expect(stdoutSpy).not.toHaveBeenCalled()
      }
    }
  )

  it('does not drain the Claude Code memory outbox on a Codex stop', async () => {
    await runHookWithBody('stop', '{}', 'codex')
    expect(autoUpsyncOnDrain).not.toHaveBeenCalled()
    await runHookWithBody('stop', '{}', 'claude-code')
    expect(autoUpsyncOnDrain).toHaveBeenCalledTimes(1)
  })
})

// ─── Codex rollout usage ────────────────────────────────────────────────────

const ROOT_ID = '01a11e00-83c8-7ce3-b89d-eb1a44e13f3d'
const SUB_ID = '01a11e00-aba8-7df2-9b0b-98c78d214c73'

function usageLine(
  responseId: string,
  input: number,
  cached: number,
  output: number
) {
  return {
    type: 'token_usage_record',
    payload: {
      response_id: responseId,
      usage: {
        input_tokens: input,
        cached_input_tokens: cached,
        cache_write_input_tokens: 0,
        output_tokens: output,
        reasoning_output_tokens: 0,
      },
    },
  }
}

function writeRollouts(subDay = '09'): { root: string; parent: string } {
  const root = mkdtempSync(join(tmpdir(), 'lumo-codex-rollout-'))
  const day = join(root, '2026', '10', '09')
  mkdirSync(day, { recursive: true })
  const parent = join(day, `rollout-2026-10-09T11-11-53-${ROOT_ID}.jsonl`)
  writeFileSync(
    parent,
    [
      {
        type: 'session_meta',
        payload: { id: ROOT_ID, originator: 'codex_exec' },
      },
      { type: 'turn_context', payload: { model: 'gpt-6.1-sol' } },
      usageLine('resp_1', 18912, 12000, 78),
      usageLine('resp_1', 18912, 12000, 78), // same response twice → once
      {
        type: 'event_msg',
        payload: {
          type: 'item_completed',
          item: {
            type: 'SubAgentActivity',
            kind: 'started',
            agent_thread_id: SUB_ID,
          },
        },
      },
      usageLine('resp_2', 19084, 18000, 85),
      'not json',
    ]
      .map(l => (typeof l === 'string' ? l : JSON.stringify(l)))
      .join('\n')
  )
  const subDir = join(root, '2026', '10', subDay)
  mkdirSync(subDir, { recursive: true })
  writeFileSync(
    join(subDir, `rollout-2026-10-${subDay}T11-12-02-${SUB_ID}.jsonl`),
    [
      { type: 'turn_context', payload: { model: 'gpt-6.1-sol' } },
      usageLine('resp_s1', 18731, 0, 33),
    ]
      .map(l => JSON.stringify(l))
      .join('\n')
  )
  return { root, parent }
}

describe('sumCodexRolloutUsage', () => {
  it('sums each response once, splits cached input out, adds subagents', () => {
    const { root, parent } = writeRollouts()
    try {
      const usage = sumCodexRolloutUsage(parent)!
      const main = {
        input: 18912 - 12000 + 19084 - 18000,
        output: 78 + 85,
        cacheRead: 12000 + 18000,
        cacheCreation: 0,
      }
      const sub = { input: 18731, output: 33, cacheRead: 0, cacheCreation: 0 }
      expect(usage.bySubagent[SUB_ID]).toEqual({
        total: {
          inputTokens: sub.input,
          outputTokens: sub.output,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        },
        byModel: { 'gpt-6.1-sol': sub },
      })
      expect(usage.total).toEqual({
        inputTokens: main.input + sub.input,
        outputTokens: main.output + sub.output,
        cacheReadTokens: main.cacheRead,
        cacheCreationTokens: 0,
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('finds a subagent rollout written on a later day', () => {
    const { root, parent } = writeRollouts('10')
    try {
      expect(findSubagentRollout(parent, SUB_ID)).toContain(
        join('2026', '10', '10')
      )
      expect(sumCodexRolloutUsage(parent)!.bySubagent[SUB_ID]).toBeDefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('skips usage records of another thread (never double counts a subagent)', () => {
    const root = mkdtempSync(join(tmpdir(), 'lumo-codex-rollout-'))
    try {
      const file = join(root, `rollout-x-${ROOT_ID}.jsonl`)
      const foreign = usageLine('resp_x', 500, 0, 5)
      ;(foreign.payload as Record<string, unknown>).thread_id = SUB_ID
      const own = usageLine('resp_o', 100, 0, 1)
      ;(own.payload as Record<string, unknown>).thread_id = ROOT_ID
      writeFileSync(
        file,
        [{ type: 'session_meta', payload: { id: ROOT_ID } }, own, foreign]
          .map(l => JSON.stringify(l))
          .join('\n')
      )
      expect(sumCodexRolloutUsage(file)!.total.inputTokens).toBe(100)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('returns null for a missing or usage-less rollout', () => {
    expect(sumCodexRolloutUsage('/nonexistent/rollout.jsonl')).toBeNull()
  })

  it('a Codex stop hook folds rollout usage into _lumo_usage', async () => {
    const { root, parent } = writeRollouts()
    try {
      await runHookWithBody(
        'stop',
        JSON.stringify({ session_id: ROOT_ID, transcript_path: parent }),
        'codex'
      )
      const sent = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
      expect(sent._lumo_usage.byModel['gpt-6.1-sol']).toBeDefined()
      expect(Object.keys(sent._lumo_usage.bySubagent)).toEqual([SUB_ID])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

// ─── setup --agent codex ────────────────────────────────────────────────────

describe('mergeHooksFile for Codex', () => {
  it('writes the 12 Codex events into .codex/hooks.json, idempotently, keeping user hooks', () => {
    const root = mkdtempSync(join(tmpdir(), 'lumo-codex-setup-'))
    try {
      const file = codexHooksPath(root)
      expect(file).toBe(join(root, '.codex', 'hooks.json'))
      mkdirSync(join(root, '.codex'))
      writeFileSync(
        file,
        JSON.stringify({
          hooks: {
            Stop: [{ hooks: [{ type: 'command', command: 'my-hook' }] }],
          },
        })
      )
      mergeHooksFile(file, 'codex', CODEX_HOOK_EVENTS)
      const first = readFileSync(file, 'utf8')
      const parsed = JSON.parse(first)
      expect(Object.keys(parsed.hooks).sort()).toEqual(
        CODEX_HOOK_EVENTS.map(([e]) => e).sort()
      )
      expect(parsed.hooks.Interrupt[0].hooks[0].command).toBe(
        'lumo hook interrupt --agent codex'
      )
      expect(parsed.hooks.Stop[0].hooks[0].command).toBe('my-hook')
      expect(parsed.hooks.PostToolBatch).toBeUndefined()
      mergeHooksFile(file, 'codex', CODEX_HOOK_EVENTS)
      // Byte-stable: re-running setup never invalidates Codex hook trust.
      expect(readFileSync(file, 'utf8')).toBe(first)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

// ─── self-check + memory store ─────────────────────────────────────────────

describe('codexSessionHasEvents', () => {
  const ask = () =>
    codexSessionHasEvents({
      base: 'https://api.example.com',
      token: 't',
      sessionId: ROOT_ID,
    })

  it('false when the server has no session or no events', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 404 }) as unknown as typeof fetch
    expect(await ask()).toBe(false)
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ eventCount: 0 }),
    }) as unknown as typeof fetch
    expect(await ask()).toBe(false)
  })

  it('true with events; null when it cannot tell', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ eventCount: 4 }),
    }) as unknown as typeof fetch
    expect(await ask()).toBe(true)
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('offline')) as unknown as typeof fetch
    expect(await ask()).toBeNull()
  })
})

describe('memory sync / push under Codex', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })

  it('refuse without --dir in a Codex shell', async () => {
    process.env.CODEX_THREAD_ID = ROOT_ID
    const err = jest.spyOn(console, 'error').mockImplementation(() => {})
    const { memorySync } = await import('@/cli/src/commands/memory-sync')
    const { memoryPush } = await import('@/cli/src/commands/memory-push')
    expect(await memorySync({})).toBe(1)
    expect(await memoryPush({})).toBe(1)
    expect(err).toHaveBeenCalledWith(codexMemoryStoreError('lumo memory sync'))
    err.mockRestore()
  })
})
