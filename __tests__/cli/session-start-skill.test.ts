/**
 * @jest-environment node
 *
 * LUM-1111 — the SessionStart status line names the skill version the
 * session loads, hints `lumo skill update` when that copy is behind the CLI,
 * and hints a restart when the CLI changed under a running session.
 */
import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { withCliIdentity, withStatusNotes } from '@/cli/src/lib/hook-runner'
import { writeMarker } from '@/cli/src/lib/install-registry'
import {
  cliUpgradeNote,
  sessionSkillCopy,
  sessionStartSkillInfo,
  skillAgentFor,
  skillTag,
  skillVersionNote,
} from '@/cli/src/lib/session-start-skill'
import { hashSkillDir } from '@/cli/src/lib/skill-hash'

let tmp: string
let home: string
let cwd: string
let stateFile: string

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lum1111-')))
  home = path.join(tmp, 'home')
  cwd = path.join(tmp, 'work')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(cwd, { recursive: true })
  stateFile = path.join(tmp, 'lumo', 'session-cli-versions.json')
})
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

/** A managed skill copy (content + marker) at `<root>/<agentDir>/skills/lumo`. */
function installSkill(root: string, agentDir: string, version: string): string {
  const dir = path.join(root, agentDir, 'skills', 'lumo')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `# lumo ${version}\n`)
  writeMarker(dir, {
    version,
    hash: hashSkillDir(dir),
    agent: agentDir === '.agents' ? 'codex' : 'claude-code',
    installedAt: '2026-10-13T00:00:00.000Z',
  })
  return dir
}

function gitInit(dir: string): void {
  const r = spawnSync('git', ['init', '-q', dir])
  expect(r.status).toBe(0)
}

const info = (agentEnum: string | null, cliVersion: string | null = '1.70.0') =>
  sessionStartSkillInfo({
    agentEnum,
    cliVersion,
    sessionId: 's1',
    cwd,
    homeDir: home,
    sessionVersionsFile: stateFile,
  })

const STATUS = '[Lumo] session_id=s1 | Current task: LUM-1 - x'
const ID = { version: '1.70.0', email: 'cli@uselumo.ai', workspaceSlug: 'lumo' }

describe('status line decoration', () => {
  it('matching versions add exactly one skill field to the identity segment', () => {
    const before = withCliIdentity([STATUS], ID)[0] as string
    const after = withStatusNotes(
      withCliIdentity([STATUS], { ...ID, skill: 'skill 1.70.0' }),
      []
    )[0] as string
    expect(before).toBe(
      '[Lumo] session_id=s1 | lumo 1.70.0 · cli@uselumo.ai (lumo) | Current task: LUM-1 - x'
    )
    expect(after).toBe(
      '[Lumo] session_id=s1 | lumo 1.70.0 · cli@uselumo.ai (lumo) · skill 1.70.0 | Current task: LUM-1 - x'
    )
    expect(after.replace(' · skill 1.70.0', '')).toBe(before)
  })

  it('a null skill tag leaves the line byte-identical to before', () => {
    expect(withCliIdentity([STATUS], { ...ID, skill: null })).toEqual(
      withCliIdentity([STATUS], ID)
    )
  })

  it('withStatusNotes appends each note as a trailing segment', () => {
    const json = '{"hookSpecificOutput":{}}'
    expect(withStatusNotes([STATUS, json], ['A', '', 'B\u001b'])).toEqual([
      `${STATUS} | A | B`,
      json,
    ])
  })

  it('withStatusNotes leaves non-status output and empty notes alone', () => {
    const json = '{"hookSpecificOutput":{}}'
    expect(withStatusNotes([json], ['A'])).toEqual([json])
    expect(withStatusNotes([], ['A'])).toEqual([])
    expect(withStatusNotes([STATUS], [])).toEqual([STATUS])
  })
})

describe('sessionStartSkillInfo', () => {
  it('up-to-date user copy: version tag, no hint', () => {
    installSkill(home, '.claude', '1.70.0')
    expect(info(null)).toEqual({ tag: 'skill 1.70.0', notes: [] })
    expect(info('CLAUDE_CODE')).toEqual({ tag: 'skill 1.70.0', notes: [] })
  })

  it('behind: hints lumo skill update', () => {
    installSkill(home, '.claude', '1.69.0')
    expect(info(null)).toEqual({
      tag: 'skill 1.69.0',
      notes: [
        'skill 1.69.0 is older than lumo 1.70.0 — run `lumo skill update`, then restart the session',
      ],
    })
  })

  it('newer than the CLI: tag only, no hint', () => {
    installSkill(home, '.claude', '1.71.0')
    expect(info(null)).toEqual({ tag: 'skill 1.71.0', notes: [] })
  })

  it('locally modified copy: marked, no hint', () => {
    const dir = installSkill(home, '.claude', '1.69.0')
    fs.appendFileSync(path.join(dir, 'SKILL.md'), 'edited\n')
    expect(info(null)).toEqual({ tag: 'skill 1.69.0 modified', notes: [] })
  })

  it('Codex reads ~/.agents/skills/lumo, not the Claude copy', () => {
    installSkill(home, '.claude', '1.70.0')
    installSkill(home, '.agents', '1.68.0')
    const out = info('CODEX')
    expect(out.tag).toBe('skill 1.68.0')
    expect(out.notes[0]).toContain('`lumo skill update`')
  })

  it('Claude Code: the user copy wins over the project copy', () => {
    gitInit(cwd)
    installSkill(home, '.claude', '1.70.0')
    installSkill(cwd, '.claude', '1.60.0')
    expect(info(null).tag).toBe('skill 1.70.0')
  })

  it('Codex: the repo copy wins over the user copy', () => {
    gitInit(cwd)
    installSkill(home, '.agents', '1.70.0')
    installSkill(cwd, '.agents', '1.60.0')
    expect(info('CODEX').tag).toBe('skill 1.60.0')
  })

  it('the Lumo source repo copy is shown as source with no hint', () => {
    gitInit(cwd)
    fs.mkdirSync(path.join(cwd, 'cli'), { recursive: true })
    fs.writeFileSync(
      path.join(cwd, 'cli', 'package.json'),
      JSON.stringify({ name: '@lumoai/cli', version: '1.70.0' })
    )
    const src = path.join(cwd, '.claude', 'skills', 'lumo')
    fs.mkdirSync(src, { recursive: true })
    fs.writeFileSync(path.join(src, 'SKILL.md'), '# source\n')
    expect(info(null)).toEqual({ tag: 'skill source', notes: [] })
  })

  it('no skill installed: nothing to add', () => {
    expect(info(null)).toEqual({ tag: null, notes: [] })
  })

  it('unreadable copy: nothing to add (status line unchanged)', () => {
    const dir = path.join(home, '.claude', 'skills')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'lumo'), 'not a directory')
    expect(info(null)).toEqual({ tag: null, notes: [] })
  })

  it('agents without a skill dir and an unknown CLI version add nothing', () => {
    installSkill(home, '.claude', '1.69.0')
    expect(info('CURSOR')).toEqual({ tag: null, notes: [] })
    expect(info(null, null)).toEqual({ tag: null, notes: [] })
  })
})

describe('restart hint after a CLI upgrade', () => {
  it('silent on first sight and on the same version, hints on a change', () => {
    expect(cliUpgradeNote('s1', '1.70.0', stateFile)).toBeNull()
    expect(cliUpgradeNote('s1', '1.70.0', stateFile)).toBeNull()
    expect(cliUpgradeNote('s2', '1.71.0', stateFile)).toBeNull()
    expect(cliUpgradeNote('s1', '1.71.0', stateFile)).toBe(
      'lumo upgraded 1.70.0 → 1.71.0 since this session started — restart the session to load the new skill'
    )
    // said once: the session now runs on 1.71.0
    expect(cliUpgradeNote('s1', '1.71.0', stateFile)).toBeNull()
  })

  it('a corrupt state file is replaced without a hint or a throw', () => {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true })
    fs.writeFileSync(stateFile, '{nope')
    expect(cliUpgradeNote('s1', '1.70.0', stateFile)).toBeNull()
    expect(cliUpgradeNote('s1', '1.71.0', stateFile)).toContain('restart')
  })

  it('an unwritable state path fails silent', () => {
    fs.writeFileSync(path.join(tmp, 'blocker'), '')
    expect(
      cliUpgradeNote('s1', '1.70.0', path.join(tmp, 'blocker', 'x.json'))
    ).toBeNull()
  })

  it('keeps at most 200 sessions', () => {
    for (let i = 0; i < 205; i++) cliUpgradeNote(`s${i}`, '1.70.0', stateFile)
    const seen = new Map<string, string>(
      JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    )
    expect(seen.size).toBe(200)
    expect(seen.has('s0')).toBe(false)
    expect(seen.get('s204')).toBe('1.70.0')
    expect(fs.readdirSync(path.dirname(stateFile))).toEqual([
      'session-cli-versions.json',
    ])
  })

  it('treats prototype-named session ids as plain keys', () => {
    expect(cliUpgradeNote('__proto__', '1.70.0', stateFile)).toBeNull()
    expect(cliUpgradeNote('constructor', '1.70.0', stateFile)).toBeNull()
    expect(cliUpgradeNote('__proto__', '1.71.0', stateFile)).toBe(
      'lumo upgraded 1.70.0 → 1.71.0 since this session started — restart the session to load the new skill'
    )
    expect(JSON.parse(fs.readFileSync(stateFile, 'utf8'))).toEqual([
      ['constructor', '1.70.0'],
      ['__proto__', '1.71.0'],
    ])
  })

  it('no skill copy: no restart hint and nothing recorded', () => {
    expect(info(null, '1.69.0')).toEqual({ tag: null, notes: [] })
    expect(info(null, '1.70.0')).toEqual({ tag: null, notes: [] })
    expect(fs.existsSync(stateFile)).toBe(false)
  })

  it('rides along with the skill info as a trailing note', () => {
    installSkill(home, '.claude', '1.70.0')
    expect(info(null, '1.69.0').notes).toEqual([])
    expect(info(null, '1.70.0')).toEqual({
      tag: 'skill 1.70.0',
      notes: [
        'lumo upgraded 1.69.0 → 1.70.0 since this session started — restart the session to load the new skill',
      ],
    })
  })
})

describe('small helpers', () => {
  it('skillAgentFor maps hook agents to skill dirs', () => {
    expect(skillAgentFor(null)).toBe('claude-code')
    expect(skillAgentFor('CLAUDE_CODE')).toBe('claude-code')
    expect(skillAgentFor('CODEX')).toBe('codex')
    expect(skillAgentFor('CURSOR')).toBeNull()
  })

  it('skillTag / skillVersionNote per state', () => {
    const row = {
      path: '/x/skills/lumo',
      scope: 'user' as const,
      agent: 'claude-code',
      gitTracked: false,
    }
    expect(skillTag({ ...row, version: null, state: 'modified' })).toBe(
      'skill modified'
    )
    expect(
      skillVersionNote({ ...row, version: '1.0.0', state: 'newer' }, '0.9.0')
    ).toBeNull()
    expect(
      sessionSkillCopy({
        agent: 'cursor',
        cliVersion: '1.0.0',
        homeDir: home,
        cwd,
      })
    ).toBeNull()
  })
})
