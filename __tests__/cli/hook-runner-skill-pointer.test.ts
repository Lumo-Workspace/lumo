/**
 * @jest-environment node
 *
 * LUM-1292 — no Lumo skill is installed any more: every SessionStart tells
 * the agent to run `lumo skill read`, whether or not the server answered.
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(),
  configDir: () => '/tmp/lumo-config-pointer',
}))
jest.mock('@/cli/src/lib/memory-auto', () => ({
  autoUpsyncOnDrain: jest.fn(),
}))
jest.mock('@/cli/src/lib/git-task', () => ({
  extractTaskFromGit: () => null,
}))
jest.mock('@/cli/src/lib/cli-version', () => ({
  readCliVersion: () => '1.102.0',
}))
jest.mock('@/cli/src/lib/project-install-drift', () => ({
  projectDriftOnce: () => [],
  projectDriftNote: () => null,
  projectNotesPath: () => '/tmp/none',
}))

import { readCredentials } from '@/cli/src/lib/config'
import { runHookWithBody } from '@/cli/src/lib/hook-runner'
import { SKILL_POINTER_TEXT } from '@/cli/src/lib/skill-pointer'

const SID = 'sid-1'
const MEMORY = 'Team memory: prefer small PRs.'
let stdoutSpy: jest.SpyInstance
const out = () => stdoutSpy.mock.calls.map(c => String(c[0])).join('')

function ctxOf(agent: string): string {
  const lines = out().trimEnd().split('\n')
  const json = lines
    .map(l => {
      try {
        return JSON.parse(l) as {
          hookSpecificOutput?: { additionalContext?: string }
        }
      } catch {
        return null
      }
    })
    .filter(j => j?.hookSpecificOutput?.additionalContext !== undefined)
  expect(json).toHaveLength(1)
  if (agent === 'codex') expect(lines).toHaveLength(1)
  return json[0]?.hookSpecificOutput?.additionalContext as string
}

function server(body: unknown, ok = true) {
  global.fetch = jest
    .fn()
    .mockResolvedValue({ ok, status: ok ? 200 : 500, json: async () => body })
}

beforeEach(() => {
  ;(readCredentials as jest.Mock).mockReturnValue({
    token: 'lum_test',
    apiUrl: 'https://api.example.com',
    email: 'cli@uselumo.ai',
    workspaceSlug: 'lumo',
  })
  stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
})
afterEach(() => stdoutSpy.mockRestore())

const start = (agent: string) =>
  runHookWithBody(
    'session-start',
    JSON.stringify({ session_id: SID, cwd: '/tmp', source: 'startup' }),
    agent
  )

describe('SKILL_POINTER_TEXT', () => {
  it('is short and points at `lumo skill read`', () => {
    expect(SKILL_POINTER_TEXT.length).toBeLessThanOrEqual(600)
    expect(SKILL_POINTER_TEXT).toContain('`lumo skill read`')
    expect(SKILL_POINTER_TEXT).toMatch(/tasks and bugs/)
    expect(SKILL_POINTER_TEXT).toMatch(/create/)
    expect(SKILL_POINTER_TEXT).toMatch(/not in other trackers/)
    // does not assume the LUM- prefix
    expect(SKILL_POINTER_TEXT).toMatch(/team-specific/)
    expect(SKILL_POINTER_TEXT).toContain('SPEC-12')
  })
})

describe.each(['claude-code', 'codex'])('session-start (%s)', agent => {
  it('leads the injected context with the pointer', async () => {
    server({ sessionId: SID, taskBinding: { bound: false } })
    await start(agent)
    expect(ctxOf(agent).startsWith(SKILL_POINTER_TEXT)).toBe(true)
  })

  it('keeps the server memory section after the pointer', async () => {
    server({
      sessionId: SID,
      taskBinding: { bound: false },
      workspaceNoticeSection: MEMORY,
    })
    await start(agent)
    const ctx = ctxOf(agent)
    expect(ctx.startsWith(SKILL_POINTER_TEXT)).toBe(true)
    expect(ctx).toContain(MEMORY)
    expect(ctx.indexOf(MEMORY)).toBeGreaterThan(SKILL_POINTER_TEXT.length)
  })

  it('still prints the pointer when the server fails', async () => {
    server({}, false)
    await start(agent)
    expect(ctxOf(agent)).toBe(SKILL_POINTER_TEXT)
  })

  it('still prints the pointer when the request throws', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'))
    await start(agent)
    expect(ctxOf(agent)).toBe(SKILL_POINTER_TEXT)
  })

  it('still prints the pointer when not logged in', async () => {
    ;(readCredentials as jest.Mock).mockReturnValue(null)
    await start(agent)
    expect(ctxOf(agent)).toBe(SKILL_POINTER_TEXT)
  })

  it('does not send X-Lumo-Skill-Version', async () => {
    server({ sessionId: SID, taskBinding: { bound: false } })
    await start(agent)
    const init = (global.fetch as jest.Mock).mock.calls[0][1] as {
      headers: Record<string, string>
    }
    expect(init.headers).not.toHaveProperty('X-Lumo-Skill-Version')
  })
})

describe('other hooks', () => {
  it('stay silent: no pointer on stop', async () => {
    server({})
    await runHookWithBody('stop', '{}', 'claude-code')
    expect(out()).toBe('')
  })
})

describe('subagent-start (LUM-1292)', () => {
  it('Claude Code: the subagent gets the pointer as SubagentStart context', async () => {
    server({})
    await runHookWithBody('subagent-start', '{}', 'claude-code')
    expect(JSON.parse(out().trimEnd())).toEqual({
      hookSpecificOutput: {
        hookEventName: 'SubagentStart',
        additionalContext: SKILL_POINTER_TEXT,
      },
    })
  })

  it('prints the pointer even when not logged in', async () => {
    ;(readCredentials as jest.Mock).mockReturnValue(null)
    await runHookWithBody('subagent-start', '{}', 'claude-code')
    expect(out()).toContain(SKILL_POINTER_TEXT)
  })

  it('Codex: stays silent (its SubagentStart output shape is untested)', async () => {
    server({})
    await runHookWithBody('subagent-start', '{}', 'codex')
    expect(out()).toBe('')
  })
})
