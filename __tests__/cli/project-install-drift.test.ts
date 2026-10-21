/**
 * @jest-environment node
 *
 * LUM-1108 — the committed (git-tracked) Lumo install of the current repo
 * that is behind the CLI: which files, the reminder text and its fix
 * commands, once per session, silent outside git / without installs /
 * when the probe fails.
 */
import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { CODEX_RULES_MARKER, LUMO_CODEX_RULES } from '@/cli/src/lib/codex-rules'
import {
  buildLumoHookFragment,
  CODEX_HOOK_EVENTS,
  LUMO_HOOK_EVENTS,
} from '@/cli/src/lib/hooks-template'
import {
  projectClaudeSettingsTarget,
  projectCodexRulesTarget,
} from '@/cli/src/lib/install-plan'
import { writeMarker } from '@/cli/src/lib/install-registry'
import {
  alreadyNoted,
  markNoted,
  projectDriftNote,
  projectDriftOnce,
  projectInstallDrift,
} from '@/cli/src/lib/project-install-drift'
import { hashSkillDir } from '@/cli/src/lib/skill-hash'

const CLI = '1.120.0'
let tmp: string
let repo: string
let noted: string

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lum1108-')))
  repo = path.join(tmp, 'repo')
  fs.mkdirSync(repo, { recursive: true })
  noted = path.join(tmp, 'lumo', 'session-project-install-notes.json')
})
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

function git(...args: string[]): void {
  const r = spawnSync('git', args, { cwd: repo })
  expect(r.status).toBe(0)
}

function write(rel: string, content: string): string {
  const file = path.join(repo, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
  return file
}

function skill(agentDir: string, version: string): string {
  const dir = path.join(repo, agentDir, 'skills', 'lumo')
  write(
    path.join(agentDir, 'skills', 'lumo', 'SKILL.md'),
    `# lumo ${version}\n`
  )
  writeMarker(dir, {
    version,
    hash: hashSkillDir(dir),
    agent: agentDir === '.agents' ? 'codex' : 'claude-code',
    installedAt: '2026-10-13T00:00:00.000Z',
  })
  return dir
}

const json = (v: unknown): string => JSON.stringify(v, null, 2) + '\n'

/** Lumo hooks for every event but the last one — what an older CLI wrote. */
function olderHooks(
  agent: string,
  events: ReadonlyArray<readonly [string, string]>
): string {
  return json(buildLumoHookFragment(agent, events.slice(0, -1)))
}

/** A repo whose four committed installs are all current. */
function currentInstall(): void {
  git('init', '-q')
  skill('.agents', CLI)
  write('.claude/settings.json', json(buildLumoHookFragment('claude-code')))
  write(
    '.codex/hooks.json',
    json(buildLumoHookFragment('codex', CODEX_HOOK_EVENTS))
  )
  write('.codex/rules/lumo.rules', LUMO_CODEX_RULES)
}

const kinds = () =>
  projectInstallDrift({ cwd: repo, cliVersion: CLI }).map(i => [
    i.kind,
    i.relPath,
    i.version,
  ])

describe('projectInstallDrift', () => {
  it('everything current: nothing reported', () => {
    currentInstall()
    git('add', '-A')
    expect(kinds()).toEqual([])
  })

  it('a committed skill copy behind the CLI is reported with its version', () => {
    currentInstall()
    skill('.agents', '1.102.0')
    git('add', '-A')
    expect(kinds()).toEqual([['skill', '.agents/skills/lumo', '1.102.0']])
  })

  it('committed hooks and rules behind the CLI are reported', () => {
    currentInstall()
    write('.claude/settings.json', olderHooks('claude-code', LUMO_HOOK_EVENTS))
    write('.codex/hooks.json', olderHooks('codex', CODEX_HOOK_EVENTS))
    write('.codex/rules/lumo.rules', `${CODEX_RULES_MARKER}\n# old rules\n`)
    git('add', '-A')
    expect(kinds()).toEqual([
      ['claude-settings', '.claude/settings.json', null],
      ['codex-hooks', '.codex/hooks.json', null],
      ['codex-rules', '.codex/rules/lumo.rules', null],
    ])
  })

  it('committed settings still holding retired WorktreeCreate are reported (LUM-1235)', () => {
    currentInstall()
    const settings = buildLumoHookFragment('claude-code')
    settings.hooks!.WorktreeCreate = [
      {
        hooks: [
          {
            type: 'command',
            command: 'lumo hook worktree-create --agent claude-code',
          },
        ],
      },
    ]
    write('.claude/settings.json', json(settings))
    git('add', '-A')
    expect(kinds()).toEqual([
      ['claude-settings', '.claude/settings.json', null],
    ])
  })

  it('a settings file holding only the retired entries is still a target (LUM-1235)', () => {
    write(
      '.claude/settings.json',
      json({
        hooks: {
          WorktreeRemove: [
            {
              hooks: [
                {
                  type: 'command',
                  command: 'lumo hook worktree-remove --agent cursor',
                },
              ],
            },
          ],
        },
      })
    )
    expect(projectClaudeSettingsTarget(repo)).toEqual({
      path: path.join(repo, '.claude', 'settings.json'),
      agent: 'cursor',
    })
  })

  it('the same stale files, not tracked by git: nothing reported', () => {
    git('init', '-q')
    skill('.agents', '1.102.0')
    write('.codex/hooks.json', olderHooks('codex', CODEX_HOOK_EVENTS))
    write('.codex/rules/lumo.rules', `${CODEX_RULES_MARKER}\n# old rules\n`)
    expect(kinds()).toEqual([])
  })

  it('uncommitted settings still holding Lumo hooks for dropped events are reported as drifted', () => {
    git('init', '-q')
    const settings = buildLumoHookFragment('claude-code')
    settings.hooks!.WorktreeCreate = [
      {
        hooks: [
          {
            type: 'command',
            command: 'lumo hook worktree-create --agent claude-code',
          },
        ],
      },
    ]
    write('.claude/settings.json', json(settings))
    const items = projectInstallDrift({ cwd: repo, cliVersion: CLI })
    expect(items.map(i => [i.kind, i.relPath])).toEqual([
      ['claude-settings', '.claude/settings.json'],
    ])
  })

  it('uncommitted settings that are merely behind (no retired entries): nothing reported', () => {
    git('init', '-q')
    write('.claude/settings.json', olderHooks('claude-code', LUMO_HOOK_EVENTS))
    expect(kinds()).toEqual([])
  })

  it('not a git repo: nothing reported', () => {
    skill('.agents', '1.102.0')
    write('.codex/rules/lumo.rules', `${CODEX_RULES_MARKER}\n# old rules\n`)
    expect(kinds()).toEqual([])
  })

  it('a git repo without any Lumo install: nothing reported', () => {
    git('init', '-q')
    write('README.md', 'hi\n')
    write('.claude/settings.json', json({ hooks: {} }))
    write('.codex/rules/lumo.rules', 'prefix_rule(pattern = ["ls"])\n')
    git('add', '-A')
    expect(kinds()).toEqual([])
  })

  it('newer and modified copies are not reported (the fix would skip them)', () => {
    git('init', '-q')
    skill('.agents', '9.0.0')
    const claude = skill('.claude', '1.0.0')
    fs.appendFileSync(path.join(claude, 'SKILL.md'), 'edited\n')
    git('add', '-A')
    expect(kinds()).toEqual([])
  })

  it('unreadable files are skipped, never thrown', () => {
    currentInstall()
    write('.codex/hooks.json', '{ "lumo hook x --agent codex" ')
    fs.rmSync(path.join(repo, '.claude', 'settings.json'))
    fs.mkdirSync(path.join(repo, '.claude', 'settings.json'))
    git('add', '-A')
    expect(kinds()).toEqual([])
  })
})

describe('projectDriftNote', () => {
  const item = (
    kind: 'skill' | 'codex-rules' | 'claude-settings',
    relPath: string,
    version: string | null = null,
    agent = kind === 'claude-settings' ? 'claude-code' : 'codex'
  ) => ({
    kind,
    path: path.join(repo, relPath),
    relPath,
    version,
    agent,
  })

  it('no drift: no note', () => {
    expect(projectDriftNote([], CLI)).toBeNull()
  })

  it('skill only: `lumo skill update --scope project` and the PR step', () => {
    expect(
      projectDriftNote([item('skill', '.agents/skills/lumo', '1.102.0')], CLI)
    ).toBe(
      'committed Lumo install behind lumo 1.120.0: .agents/skills/lumo 1.102.0 — run `lumo skill update --scope project`, then commit the changes in a PR'
    )
  })

  it('hooks / rules only: re-run `lumo init --scope project` for their agent, with its dry run', () => {
    expect(
      projectDriftNote([item('codex-rules', '.codex/rules/lumo.rules')], CLI)
    ).toBe(
      'committed Lumo install behind lumo 1.120.0: .codex/rules/lumo.rules — run `lumo init --scope project --agent codex` (preview with `--dry-run`), then commit the changes in a PR (an outdated rules file may let newer lumo commands run outside the sandbox)'
    )
    expect(
      projectDriftNote(
        [item('claude-settings', '.claude/settings.json', null, 'cursor')],
        CLI
      )
    ).toContain('run `lumo init --scope project --agent cursor` (preview with')
  })

  it('hooks of two agents: plain `lumo init --scope project`', () => {
    const note = projectDriftNote(
      [
        item('claude-settings', '.claude/settings.json'),
        item('codex-rules', '.codex/rules/lumo.rules'),
      ],
      CLI
    )
    expect(note).toContain(
      'run `lumo init --scope project` (preview with `--dry-run`)'
    )
    expect(note).not.toContain('--upgrade')
  })

  it('both, with the session copy among them: both commands and the restart', () => {
    expect(
      projectDriftNote(
        [
          item('skill', '.agents/skills/lumo', '1.102.0'),
          item('codex-rules', '.codex/rules/lumo.rules'),
        ],
        CLI,
        { restart: true }
      )
    ).toBe(
      'committed Lumo install behind lumo 1.120.0: .agents/skills/lumo 1.102.0, .codex/rules/lumo.rules — run `lumo skill update --scope project` and `lumo init --scope project --agent codex` (preview with `--dry-run`), then commit the changes in a PR, then restart the session (an outdated rules file may let newer lumo commands run outside the sandbox)'
    )
  })
})

describe('once per session', () => {
  beforeEach(() => {
    currentInstall()
    write('.codex/rules/lumo.rules', `${CODEX_RULES_MARKER}\n# old rules\n`)
    git('add', '-A')
  })
  const once = (sessionId: string | null) =>
    projectDriftOnce({
      cwd: repo,
      cliVersion: CLI,
      sessionId,
      notedFile: noted,
    }).length

  it('the first SessionStart of a session gets it, later ones do not', () => {
    expect(once('s1')).toBe(1)
    expect(once('s1')).toBe(0)
    expect(once('s2')).toBe(1)
    expect(alreadyNoted(noted, 's1')).toBe(true)
  })

  it('no drift: the session is not used up', () => {
    write('.codex/rules/lumo.rules', LUMO_CODEX_RULES)
    expect(once('s1')).toBe(0)
    expect(alreadyNoted(noted, 's1')).toBe(false)
  })

  it('a held lock: say nothing rather than risk a repeat', () => {
    fs.mkdirSync(path.dirname(noted), { recursive: true })
    fs.writeFileSync(`${noted}.lock`, String(process.pid))
    expect(once('s1')).toBe(0)
  })

  it('markNoted keeps only the newest 200 sessions', () => {
    for (let i = 0; i < 205; i++) markNoted(noted, `s${i}`)
    expect(alreadyNoted(noted, 's4')).toBe(false)
    expect(alreadyNoted(noted, 's5')).toBe(true)
    expect(alreadyNoted(noted, 's204')).toBe(true)
  })

  it('a corrupt state file is treated as empty', () => {
    fs.mkdirSync(path.dirname(noted), { recursive: true })
    fs.writeFileSync(noted, '{not json')
    expect(once('s1')).toBe(1)
  })
})

describe('the committed installs the drift check looks at', () => {
  it('collects the repo .claude/settings.json (with its agent token) and Lumo rules', () => {
    currentInstall()
    write(
      '.claude/settings.json',
      json(buildLumoHookFragment('cursor', LUMO_HOOK_EVENTS.slice(0, 2)))
    )
    expect(projectClaudeSettingsTarget(repo)).toEqual({
      path: path.join(repo, '.claude', 'settings.json'),
      agent: 'cursor',
    })
    expect(projectCodexRulesTarget(repo)).toBe(
      path.join(repo, '.codex', 'rules', 'lumo.rules')
    )
  })

  it.each([
    ['lumo hook stop --agent gemini', 'gemini-cli'],
    ['lumo hook stop --agent bogus', 'claude-code'],
    ['lumo hook stop --verbose --agent cursor', 'claude-code'],
    ['lumo hook stop', 'claude-code'],
  ])('agent token of %s is %s', (command, agent) => {
    git('init', '-q')
    write(
      '.claude/settings.json',
      json({ hooks: { Stop: [{ hooks: [{ type: 'command', command }] }] } })
    )
    expect(projectClaudeSettingsTarget(repo)?.agent).toBe(agent)
  })

  it('a settings file without Lumo hooks and a foreign rules file are not targets', () => {
    git('init', '-q')
    write('.claude/settings.json', json({ hooks: { Stop: [] } }))
    write('.codex/rules/lumo.rules', 'prefix_rule(pattern = ["ls"])\n')
    expect(projectClaudeSettingsTarget(repo)).toBeNull()
    expect(projectCodexRulesTarget(repo)).toBeNull()
  })
})
