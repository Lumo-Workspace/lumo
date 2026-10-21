/**
 * @jest-environment node
 *
 * LUM-1108 — end to end through `runHookWithBody('session-start')` in a real
 * temp git repo: a committed Lumo install behind the CLI appends one
 * reminder with the fix command (`lumo init`) to the status line, once per
 * session; a committed skill copy is never named; a failing probe leaves the
 * line as it was.
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

/** A skill copy as older CLIs installed it (no longer an install). */
function skill(root: string, agentDir: string, version: string): void {
  const dir = path.join(root, agentDir, 'skills', 'lumo')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `# lumo ${version}\n`)
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
  // LUM-1292: the skill pointer follows the status line (Claude Code) or leads
  // the folded context (Codex); the status line is the one that starts [Lumo].
  const text =
    agent === 'codex'
      ? (
          JSON.parse(out) as {
            hookSpecificOutput: { additionalContext: string }
          }
        ).hookSpecificOutput.additionalContext
      : out
  return text.split('\n').find(l => l.startsWith('[Lumo] session_id=')) ?? ''
}

const RULES_NOTE =
  'committed Lumo install behind lumo 1.70.0: .codex/rules/lumo.rules — run `lumo init --agent codex` (preview with `--dry-run`), then commit the changes in a PR (an outdated rules file may let newer lumo commands run outside the sandbox)'

describe('committed Lumo install behind the CLI', () => {
  it('Claude Code: one reminder with the fix command, once per session', async () => {
    skill(home, '.claude', '1.70.0')
    staleRules()
    commit()
    const reminded = `[Lumo] session_id=s1 | ${ID} | ${UNBOUND} | ${RULES_NOTE}`
    expect(await statusLine('claude-code', 's1')).toBe(reminded)
    // resume / clear / compact of the same session: not again
    expect(await statusLine('claude-code', 's1')).toBe(
      `[Lumo] session_id=s1 | ${ID} | ${UNBOUND}`
    )
    // a new session is reminded again
    expect(await statusLine('claude-code', 's2')).toBe(
      reminded.replace('s1', 's2')
    )
  })

  it('Codex: stale rules are reminded once per session; a committed skill copy never is', async () => {
    skill(repo, '.agents', '1.69.0')
    commit()
    expect(await statusLine('codex', 's0')).toBe(
      `[Lumo] session_id=s0 | ${ID} | ${UNBOUND}`
    )
    staleRules()
    commit()
    expect(await statusLine('codex', 's1')).toBe(
      `[Lumo] session_id=s1 | ${ID} | ${UNBOUND} | ${RULES_NOTE}`
    )
    // later SessionStarts of the session: not again
    expect(await statusLine('codex', 's1')).toBe(
      `[Lumo] session_id=s1 | ${ID} | ${UNBOUND}`
    )
  })

  it('an uncommitted (untracked) stale install: no reminder', async () => {
    staleRules()
    expect(await statusLine('claude-code', 's1')).toBe(
      `[Lumo] session_id=s1 | ${ID} | ${UNBOUND}`
    )
  })

  it('an uncommitted settings file with a retired WorktreeCreate hook: named once, without the PR step (LUM-1235)', async () => {
    const file = path.join(repo, '.claude', 'settings.json')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(
      file,
      JSON.stringify({
        hooks: {
          WorktreeCreate: [
            {
              hooks: [
                {
                  type: 'command',
                  command: 'lumo hook worktree-create --agent claude-code',
                },
              ],
            },
          ],
        },
      })
    )
    const note =
      'committed Lumo install behind lumo 1.70.0: .claude/settings.json — run `lumo init --agent claude-code` (preview with `--dry-run`), then commit the changes in a PR'
    expect(await statusLine('claude-code', 's1')).toBe(
      `[Lumo] session_id=s1 | ${ID} | ${UNBOUND} | ${note}`
    )
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
      `[Lumo] session_id=s1 | ${ID} | ${UNBOUND}`
    )
  })
})
