/**
 * @jest-environment node
 *
 * LUM-1111 — end to end through `runHookWithBody('session-start')`, with the
 * real local skill probe against a temp HOME: Claude Code and Codex both get
 * the skill version field and the same hints; a failed probe leaves the
 * status line exactly as it was before LUM-1111.
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

let mockConfigDir = ''
let mockHome = ''
jest.mock('os', () => ({
  ...jest.requireActual<typeof import('os')>('os'),
  homedir: () => mockHome,
}))
let mockCliVersion = '1.70.0'
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
  readCliVersion: () => mockCliVersion,
}))

import { readCredentials } from '@/cli/src/lib/config'
import { runHookWithBody } from '@/cli/src/lib/hook-runner'
import { writeMarker } from '@/cli/src/lib/install-registry'
import { hashSkillDir } from '@/cli/src/lib/skill-hash'

const SID = 'sess-1111'
const UNBOUND =
  'No task bound. Tell me the task you want to work on (e.g. LUM-42), or say "skip".'
const BEFORE = `[Lumo] session_id=${SID} | lumo 1.70.0 · cli@uselumo.ai (lumo) | ${UNBOUND}`

let tmp: string
let home: string
let work: string
let stdoutSpy: jest.SpyInstance

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lum1111-e2e-')))
  home = path.join(tmp, 'home')
  work = path.join(tmp, 'work')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(work, { recursive: true })
  mockConfigDir = path.join(tmp, 'lumo')
  mockCliVersion = '1.70.0'
  mockHome = home
  ;(readCredentials as jest.Mock).mockReturnValue({
    token: 'lum_test',
    apiUrl: 'https://api.example.com',
    email: 'cli@uselumo.ai',
    workspaceSlug: 'lumo',
  })
  global.fetch = jest.fn().mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ sessionId: SID, taskBinding: { bound: false } }),
  })) as unknown as typeof fetch
  stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
})
afterEach(() => {
  stdoutSpy.mockRestore()
  fs.rmSync(tmp, { recursive: true, force: true })
})

function installSkill(agentDir: string, version: string): void {
  const dir = path.join(home, agentDir, 'skills', 'lumo')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `# lumo ${version}\n`)
  writeMarker(dir, {
    version,
    hash: hashSkillDir(dir),
    agent: agentDir === '.agents' ? 'codex' : 'claude-code',
    installedAt: '2026-10-13T00:00:00.000Z',
  })
}

async function statusLine(agent: string): Promise<string> {
  stdoutSpy.mockClear()
  await runHookWithBody(
    'session-start',
    JSON.stringify({ session_id: SID, cwd: work, source: 'startup' }),
    agent
  )
  const out = stdoutSpy.mock.calls.map(c => String(c[0])).join('')
  if (agent === 'codex')
    return (
      JSON.parse(out) as { hookSpecificOutput: { additionalContext: string } }
    ).hookSpecificOutput.additionalContext
  return out.trimEnd()
}

const BEHIND_NOTE =
  'skill 1.69.0 is older than lumo 1.70.0 — run `lumo skill update`, then restart the session'

describe.each([
  ['claude-code', '.claude'],
  ['codex', '.agents'],
])('%s session-start status line', (agent, agentDir) => {
  it('matching versions: one extra skill field, nothing else', async () => {
    installSkill(agentDir, '1.70.0')
    expect(await statusLine(agent)).toBe(
      `[Lumo] session_id=${SID} | lumo 1.70.0 · cli@uselumo.ai (lumo) · skill 1.70.0 | ${UNBOUND}`
    )
  })

  it('skill behind the CLI: field plus an update hint', async () => {
    installSkill(agentDir, '1.69.0')
    expect(await statusLine(agent)).toBe(
      `[Lumo] session_id=${SID} | lumo 1.70.0 · cli@uselumo.ai (lumo) · skill 1.69.0 | ${UNBOUND} | ${BEHIND_NOTE}`
    )
  })

  it('probe failure: the line is exactly what it was before', async () => {
    const skills = path.join(home, agentDir, 'skills')
    fs.mkdirSync(skills, { recursive: true })
    fs.writeFileSync(path.join(skills, 'lumo'), 'not a directory')
    expect(await statusLine(agent)).toBe(BEFORE)
  })

  it('no skill installed: the line is exactly what it was before', async () => {
    expect(await statusLine(agent)).toBe(BEFORE)
  })

  it('CLI upgraded since this session started: restart hint', async () => {
    installSkill(agentDir, '1.70.0')
    await statusLine(agent)
    mockCliVersion = '1.71.0'
    installSkill(agentDir, '1.71.0')
    expect(await statusLine(agent)).toBe(
      `[Lumo] session_id=${SID} | lumo 1.71.0 · cli@uselumo.ai (lumo) · skill 1.71.0 | ${UNBOUND} | lumo upgraded 1.70.0 → 1.71.0 since this session started — restart the session to load the new skill`
    )
  })
})
