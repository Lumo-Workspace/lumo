/**
 * @jest-environment node
 *
 * LUM-1108 — end to end through `runHookWithBody('session-start')` in a real
 * temp git repo: a committed Lumo install behind the CLI appends one
 * reminder with the fix command to the status line, once per session; it
 * replaces the plain skill hint when it names the session's own copy; a
 * failing probe leaves the line as it was.
 */
import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

let mockConfigDir = ''
let mockHome = ''
let mockThrow = false
jest.mock('os', () => ({
  ...jest.requireActual<typeof import('os')>('os'),
  homedir: () => mockHome,
}))
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(),
  configDir: () => mockConfigDir,
}))
jest.mock('@/cli/src/lib/memory-auto', () => ({
  autoUpsyncOnDrain: jest.fn(),
}))
jest.mock('@/cli/src/lib/git-task', () => ({
  extractTaskFromGit: () => null,
}))
jest.mock('@/cli/src/lib/cli-version', () => ({
  readCliVersion: () => '1.70.0',
}))
jest.mock('@/cli/src/lib/project-install-drift', () => {
  const actual = jest.requireActual<
    typeof import('@/cli/src/lib/project-install-drift')
  >('@/cli/src/lib/project-install-drift')
  return {
    ...actual,
    projectDriftOnce: (...args: Parameters<typeof actual.projectDriftOnce>) => {
      if (mockThrow) throw new Error('probe exploded')
      return actual.projectDriftOnce(...args)
    },
  }
})

import { CODEX_RULES_MARKER } from '@/cli/src/lib/codex-rules'
import { readCredentials } from '@/cli/src/lib/config'
import { runHookWithBody } from '@/cli/src/lib/hook-runner'
import { writeMarker } from '@/cli/src/lib/install-registry'
import { hashSkillDir } from '@/cli/src/lib/skill-hash'

const UNBOUND =
  'No task bound. Tell me the task you want to work on (e.g. LUM-42), or say "skip".'
const ID = 'lumo 1.70.0 · cli@uselumo.ai (lumo)'

let tmp: string
let home: string
let repo: string
let stdoutSpy: jest.SpyInstance

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lum1108-e2e-')))
  home = path.join(tmp, 'home')
  repo = path.join(tmp, 'repo')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(repo, { recursive: true })
  expect(spawnSync('git', ['init', '-q'], { cwd: repo }).status).toBe(0)
  mockConfigDir = path.join(tmp, 'lumo')
  mockHome = home
  mockThrow = false
  ;(readCredentials as jest.Mock).mockReturnValue({
    token: 'lum_test',
    apiUrl: 'https://api.example.com',
    email: 'cli@uselumo.ai',
    workspaceSlug: 'lumo',
  })
  stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
})
afterEach(() => {
  stdoutSpy.mockRestore()
  fs.rmSync(tmp, { recursive: true, force: true })
})

function skill(root: string, agentDir: string, version: string): void {
  const dir = path.join(root, agentDir, 'skills', 'lumo')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `# lumo ${version}\n`)
  writeMarker(dir, {
    version,
    hash: hashSkillDir(dir),
    agent: agentDir === '.agents' ? 'codex' : 'claude-code',
    installedAt: '2026-10-13T00:00:00.000Z',
  })
}

function staleRules(): void {
  const file = path.join(repo, '.codex', 'rules', 'lumo.rules')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${CODEX_RULES_MARKER}\n# old rules\n`)
}

const commit = () =>
  expect(spawnSync('git', ['add', '-A'], { cwd: repo }).status).toBe(0)

async function statusLine(agent: string, sid: string): Promise<string> {
  global.fetch = jest.fn().mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ sessionId: sid, taskBinding: { bound: false } }),
  })) as unknown as typeof fetch
  stdoutSpy.mockClear()
  await runHookWithBody(
    'session-start',
    JSON.stringify({ session_id: sid, cwd: repo, source: 'startup' }),
    agent
  )
  const out = stdoutSpy.mock.calls.map(c => String(c[0])).join('')
  if (agent === 'codex')
    return (
      JSON.parse(out) as { hookSpecificOutput: { additionalContext: string } }
    ).hookSpecificOutput.additionalContext
  return out.trimEnd()
}

const RULES_NOTE =
  'committed Lumo install behind lumo 1.70.0: .codex/rules/lumo.rules — run `lumo init --project --agent codex` (preview with `--dry-run`), then commit the changes in a PR'

describe('committed Lumo install behind the CLI', () => {
  it('Claude Code: one reminder with the fix command, once per session', async () => {
    skill(home, '.claude', '1.70.0')
    staleRules()
    commit()
    const reminded = `[Lumo] session_id=s1 | ${ID} · skill 1.70.0 | ${UNBOUND} | ${RULES_NOTE}`
    expect(await statusLine('claude-code', 's1')).toBe(reminded)
    // resume / clear / compact of the same session: not again
    expect(await statusLine('claude-code', 's1')).toBe(
      `[Lumo] session_id=s1 | ${ID} · skill 1.70.0 | ${UNBOUND}`
    )
    // a new session is reminded again
    expect(await statusLine('claude-code', 's2')).toBe(
      reminded.replace('s1', 's2')
    )
  })

  it("Codex: the session's own committed copy — one combined hint, not two", async () => {
    skill(repo, '.agents', '1.69.0')
    commit()
    expect(await statusLine('codex', 's1')).toBe(
      `[Lumo] session_id=s1 | ${ID} · skill 1.69.0 | ${UNBOUND} | committed Lumo install behind lumo 1.70.0: .agents/skills/lumo 1.69.0 — run \`lumo skill update --project\`, then commit the changes in a PR, then restart the session`
    )
    // later SessionStarts of the session fall back to the plain skill hint
    expect(await statusLine('codex', 's1')).toBe(
      `[Lumo] session_id=s1 | ${ID} · skill 1.69.0 | ${UNBOUND} | skill 1.69.0 is older than lumo 1.70.0 — run \`lumo skill update\`, then restart the session`
    )
  })

  it('an uncommitted (untracked) stale install: no reminder', async () => {
    staleRules()
    expect(await statusLine('claude-code', 's1')).toBe(
      `[Lumo] session_id=s1 | ${ID} | ${UNBOUND}`
    )
  })

  it('a probe that throws leaves the status line as it was', async () => {
    skill(home, '.claude', '1.70.0')
    staleRules()
    commit()
    mockThrow = true
    expect(await statusLine('claude-code', 's1')).toBe(
      `[Lumo] session_id=s1 | ${ID} · skill 1.70.0 | ${UNBOUND}`
    )
  })
})
