/**
 * @jest-environment node
 *
 * LUM-1136 — the SessionStart hook reports the session's skill copy in
 * `X-Lumo-Skill-Version` so the members page can show it.
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { writeMarker } from '@/cli/src/lib/install-registry'
import { skillVersionHeaderValue } from '@/cli/src/lib/session-start-skill'
import { hashSkillDir } from '@/cli/src/lib/skill-hash'

let tmp: string
let home: string
let cwd: string

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lum1136-')))
  home = path.join(tmp, 'home')
  cwd = path.join(tmp, 'work')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(cwd, { recursive: true })
})
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

function installSkill(version: string, agentDir = '.claude'): string {
  const dir = path.join(home, agentDir, 'skills', 'lumo')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `# lumo ${version}\n`)
  writeMarker(dir, {
    version,
    hash: hashSkillDir(dir),
    agent: agentDir === '.agents' ? 'codex' : 'claude-code',
    installedAt: '2026-10-14T00:00:00.000Z',
  })
  return dir
}

const value = (
  agentEnum: string | null,
  cliVersion: string | null = '1.121.0'
) => skillVersionHeaderValue({ agentEnum, cliVersion, cwd, homeDir: home })

describe('skillVersionHeaderValue', () => {
  it('a managed copy reports its version', () => {
    installSkill('1.120.0')
    expect(value(null)).toBe('1.120.0')
    expect(value('CLAUDE_CODE')).toBe('1.120.0')
  })

  it('a locally modified copy is marked', () => {
    const dir = installSkill('1.120.0')
    fs.appendFileSync(path.join(dir, 'SKILL.md'), 'edited\n')
    expect(value(null)).toBe('1.120.0 modified')
  })

  it('Codex reports the ~/.agents copy', () => {
    installSkill('1.121.0')
    installSkill('1.119.0', '.agents')
    expect(value('CODEX')).toBe('1.119.0')
  })

  it('no copy installed → none', () => {
    expect(value(null)).toBe('none')
  })

  it('cannot tell (unknown agent / no CLI version) → null', () => {
    installSkill('1.120.0')
    expect(value('CURSOR')).toBeNull()
    expect(value(null, null)).toBeNull()
  })
})
