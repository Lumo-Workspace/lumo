/**
 * @jest-environment node
 *
 * LUM-1054 — Codex accepts hook stdout as plain text OR one JSON object, and
 * marks a mixed run (status line + JSON line) as `hook: SessionStart Failed`,
 * dropping all of it. Under `--agent codex` the session-start hook must print
 * exactly one JSON object carrying every line; Claude Code keeps its
 * two-line shape byte for byte.
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(),
  configDir: () => '/tmp/lumo-config',
}))
jest.mock('@/cli/src/lib/memory-auto', () => ({
  autoUpsyncOnDrain: jest.fn(),
}))
jest.mock('@/cli/src/lib/git-task', () => ({
  extractTaskFromGit: jest.fn(),
}))
jest.mock('@/cli/src/lib/cli-version', () => ({
  readCliVersion: () => '1.102.0',
}))
import { readCredentials } from '@/cli/src/lib/config'
import { extractTaskFromGit } from '@/cli/src/lib/git-task'
import {
  codexHookStdout,
  runHookWithBody,
  type HookPath,
} from '@/cli/src/lib/hook-runner'
import { SKILL_POINTER_TEXT as P } from '@/cli/src/lib/skill-pointer'
import payloads from '../fixtures/codex-hooks/payloads.json'

type Fixture = { event: string; payload: Record<string, unknown> }
const SESSION_START = (payloads as Fixture[]).find(
  f => f.event === 'SessionStart'
) as Fixture
const PRE_TOOL_USE = (payloads as Fixture[]).find(
  f => f.event === 'PreToolUse'
) as Fixture

const SID = '01a1200e-dba8-7000-8000-000000000000'
const NOTICE =
  'Session records in this workspace: full transcripts, kept 30 days.'

let stdoutSpy: jest.SpyInstance
let respond: unknown
beforeEach(() => {
  jest.clearAllMocks()
  ;(readCredentials as jest.Mock).mockReturnValue({
    token: 'lum_test',
    // The hosted service: its status line carries no server label (LUM-1335).
    apiUrl: 'https://www.uselumo.ai',
    email: 'cli@uselumo.ai',
    workspaceSlug: 'lumo',
  })
  ;(extractTaskFromGit as jest.Mock).mockReturnValue(null)
  global.fetch = jest.fn().mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => respond,
  })) as unknown as typeof fetch
  stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
})
afterEach(() => stdoutSpy.mockRestore())

const written = () => stdoutSpy.mock.calls.map(c => String(c[0])).join('')

async function run(path: HookPath, agent: string, payload: Fixture) {
  await runHookWithBody(path, JSON.stringify(payload.payload), agent)
  return written()
}

/** The whole of stdout must be one JSON object (Codex's contract). */
function singleJson(out: string): {
  hookSpecificOutput: { hookEventName: string; additionalContext: string }
} {
  expect(out.endsWith('\n')).toBe(true)
  expect(out.trimEnd().split('\n')).toHaveLength(1)
  return JSON.parse(out)
}

describe('Codex session-start prints a single JSON object', () => {
  it('no task bound: banner + retention notice in one additionalContext', async () => {
    respond = {
      sessionId: SID,
      taskBinding: { bound: false },
      sessionRecordNotice: NOTICE,
    }
    const out = singleJson(await run('session-start', 'codex', SESSION_START))
    expect(out.hookSpecificOutput.hookEventName).toBe('SessionStart')
    expect(out.hookSpecificOutput.additionalContext).toBe(
      `${P}\n[Lumo] session_id=${SID} | lumo 1.102.0 · cli@uselumo.ai (lumo) | No task bound. Tell me the task you want to work on (e.g. LUM-42), or say "skip".\n${NOTICE}`
    )
  })

  it('detected task: suggest line + retention notice', async () => {
    ;(extractTaskFromGit as jest.Mock).mockReturnValue({
      identifier: 'LUM-9',
      source: 'branch',
    })
    respond = {
      sessionId: SID,
      taskBinding: { bound: false },
      sessionRecordNotice: NOTICE,
    }
    const ctx = singleJson(await run('session-start', 'codex', SESSION_START))
      .hookSpecificOutput.additionalContext
    expect(ctx).toContain(
      `[Lumo] session_id=${SID} | lumo 1.102.0 · cli@uselumo.ai (lumo) | Detected LUM-9 (from branch name). Run \`lumo session attach LUM-9\` to bind.`
    )
    expect(ctx.endsWith(NOTICE)).toBe(true)
  })

  it('bound task: banner + task context + memory + notice, sanitized', async () => {
    respond = {
      sessionId: SID,
      taskBinding: {
        bound: true,
        taskIdentifier: 'LUM-12',
        taskTitle: 'Add \u001b[31mOAuth',
      },
      memorySection: '## Team memory\n- a trap',
      progressSection: '## Progress\n- step one',
      sessionRecordNotice: NOTICE,
    }
    const ctx = singleJson(await run('session-start', 'codex', SESSION_START))
      .hookSpecificOutput.additionalContext
    const [pointer, banner, ...rest] = ctx.split('\n')
    expect(pointer).toBe(P)
    expect(banner).toBe(
      `[Lumo] session_id=${SID} | lumo 1.102.0 · cli@uselumo.ai (lumo) | Current task: LUM-12 - Add [31mOAuth`
    )
    expect(ctx).not.toContain('\u001b')
    expect(rest.join('\n')).toBe(
      `## Progress\n- step one\n\n## Team memory\n- a trap\n\n${NOTICE}`
    )
  })

  it('a server answer without a session still prints the pointer', async () => {
    respond = {}
    expect(
      singleJson(await run('session-start', 'codex', SESSION_START))
        .hookSpecificOutput.additionalContext
    ).toBe(P)
  })
})

describe('Claude Code session-start stdout is unchanged', () => {
  it('status line, then the context JSON line', async () => {
    respond = {
      sessionId: SID,
      taskBinding: { bound: false },
      sessionRecordNotice: NOTICE,
    }
    expect(await run('session-start', 'claude-code', SESSION_START)).toBe(
      `[Lumo] session_id=${SID} | lumo 1.102.0 · cli@uselumo.ai (lumo) | No task bound. Tell me the task you want to work on (e.g. LUM-42), or say "skip".\n` +
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: `${P}\n\n${NOTICE}`,
          },
        }) +
        '\n'
    )
  })

  it('no agent token behaves like Claude Code', async () => {
    respond = { sessionId: SID, taskBinding: { bound: false } }
    await runHookWithBody('session-start', '{}', undefined)
    expect(written()).toBe(
      `[Lumo] session_id=${SID} | lumo 1.102.0 · cli@uselumo.ai (lumo) | No task bound. Tell me the task you want to work on (e.g. LUM-42), or say "skip".\n` +
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: P,
          },
        }) +
        '\n'
    )
  })
})

describe('Codex pre-tool-use stays one PreToolUse JSON object', () => {
  it('same bytes as Claude Code (already a single, Codex-valid object)', async () => {
    respond = { collisionWarning: 'W', securityReminder: 'S' }
    const codex = await run('pre-tool-use', 'codex', PRE_TOOL_USE)
    stdoutSpy.mockClear()
    const claude = await run('pre-tool-use', 'claude-code', PRE_TOOL_USE)
    expect(codex).toBe(claude)
    expect(singleJson(codex).hookSpecificOutput).toEqual({
      hookEventName: 'PreToolUse',
      additionalContext: 'W\n\nS',
    })
  })
})

describe('codexHookStdout', () => {
  it('folds plain lines and envelope context into one object', () => {
    const env = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: 'B\n\nC',
      },
    })
    expect(codexHookStdout('SessionStart', ['A', env])).toEqual([
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: 'A\nB\n\nC',
        },
      }),
    ])
  })

  it('returns [] for nothing to say', () => {
    expect(codexHookStdout('SessionStart', [])).toEqual([])
  })

  it('keeps a line that only looks like JSON as text', () => {
    const out = codexHookStdout('SessionStart', ['{not json', '{"a":1}'])
    expect(
      JSON.parse(out[0] as string).hookSpecificOutput.additionalContext
    ).toBe('{not json\n{"a":1}')
  })
})
