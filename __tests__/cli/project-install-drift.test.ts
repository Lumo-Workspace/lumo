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
import { LUMO_SKILL_STUB } from '@/cli/src/lib/skill-stub'
import {
  alreadyNoted,
  markNoted,
  projectDriftNote,
  projectDriftOnce,
  projectInstallDrift,
} from '@/cli/src/lib/project-install-drift'

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

/** A committed skill copy (pre-LUM-1292): never a drift item any more. */
function skill(agentDir: string, version: string): void {
  write(
    path.join(agentDir, 'skills', 'lumo', 'SKILL.md'),
    `# lumo ${version}\n`
  )
}

const json = (v: unknown): string => JSON.stringify(v, null, 2) + '\n'

/** Lumo hooks for every event but the last one — what an older CLI wrote. */
function olderHooks(
  agent: string,
  events: ReadonlyArray<readonly [string, string]>
): string {
  return json(buildLumoHookFragment(agent, events.slice(0, -1)))
}

/** Both frozen skill stubs, as `lumo init` writes them. */
function stubs(): void {
  write('.claude/skills/lumo/SKILL.md', LUMO_SKILL_STUB)
  write('.agents/skills/lumo/SKILL.md', LUMO_SKILL_STUB)
}

/** A repo whose committed installs are all current (plus an old skill copy). */
function currentInstall(): void {
  git('init', '-q')
  skill('.agents', CLI)
  write('.claude/settings.json', json(buildLumoHookFragment('claude-code')))
  write(
    '.codex/hooks.json',
    json(buildLumoHookFragment('codex', CODEX_HOOK_EVENTS))
  )
  write('.codex/rules/lumo.rules', LUMO_CODEX_RULES)
  stubs()
}

const kinds = () =>
  projectInstallDrift({ cwd: repo, cliVersion: CLI }).map(i => [
    i.kind,
    i.relPath,
  ])

describe('projectInstallDrift', () => {
  it('everything current: nothing reported', () => {
    currentInstall()
    git('add', '-A')
    expect(kinds()).toEqual([])
  })

  it('an old full skill copy at a stub path is a differing stub (init replaces it)', () => {
    currentInstall()
    skill('.agents', '1.102.0')
    skill('.claude', '1.0.0')
    git('add', '-A')
    expect(kinds()).toEqual([
      ['skill-stub', '.claude/skills/lumo/SKILL.md'],
      ['skill-stub', '.agents/skills/lumo/SKILL.md'],
    ])
  })

  it('a missing stub is reported only for an agent whose Lumo install is here', () => {
    currentInstall()
    fs.rmSync(path.join(repo, '.agents'), { recursive: true })
    git('add', '-A')
    expect(kinds()).toEqual([['skill-stub', '.agents/skills/lumo/SKILL.md']])
    fs.rmSync(path.join(repo, '.codex'), { recursive: true })
    git('add', '-A')
    expect(kinds()).toEqual([])
  })

  it('stub drift is worded like the other items: committed vs local', () => {
    currentInstall()
    write('.claude/skills/lumo/SKILL.md', 'x')
    git('add', '-A')
    const tracked = projectInstallDrift({ cwd: repo, cliVersion: CLI })
    expect(projectDriftNote(tracked, CLI)).toBe(
      'committed Lumo install behind lumo 1.120.0: .claude/skills/lumo/SKILL.md — run `lumo init --agent claude-code` (preview with `--dry-run`), then commit the changes in a PR'
    )
    git('rm', '-q', '--cached', '.claude/skills/lumo/SKILL.md')
    const local = projectInstallDrift({ cwd: repo, cliVersion: CLI })
    expect(projectDriftNote(local, CLI)).toMatch(/^local Lumo install behind/)
  })

  it('committed hooks and rules behind the CLI are reported', () => {
    currentInstall()
    write('.claude/settings.json', olderHooks('claude-code', LUMO_HOOK_EVENTS))
    write('.codex/hooks.json', olderHooks('codex', CODEX_HOOK_EVENTS))
    write('.codex/rules/lumo.rules', `${CODEX_RULES_MARKER}\n# old rules\n`)
    git('add', '-A')
    expect(kinds()).toEqual([
      ['claude-settings', '.claude/settings.json'],
      ['codex-hooks', '.codex/hooks.json'],
      ['codex-rules', '.codex/rules/lumo.rules'],
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
    expect(kinds()).toEqual([['claude-settings', '.claude/settings.json']])
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

  it('the same stale files, not tracked by git: only the outdated Codex rules are reported (fail-open), marked untracked', () => {
    git('init', '-q')
    stubs()
    write('.codex/hooks.json', olderHooks('codex', CODEX_HOOK_EVENTS))
    write('.codex/rules/lumo.rules', `${CODEX_RULES_MARKER}\n# old rules\n`)
    const items = projectInstallDrift({ cwd: repo, cliVersion: CLI })
    expect(items.map(i => [i.kind, i.tracked])).toEqual([
      ['codex-rules', false],
    ])
  })

  it('a tracked outdated rules file is reported as tracked', () => {
    git('init', '-q')
    stubs()
    write('.codex/rules/lumo.rules', `${CODEX_RULES_MARKER}\n# old rules\n`)
    git('add', '-A')
    const items = projectInstallDrift({ cwd: repo, cliVersion: CLI })
    expect(items.map(i => [i.kind, i.tracked])).toEqual([['codex-rules', true]])
  })

  it('current untracked rules: nothing reported', () => {
    git('init', '-q')
    stubs()
    write('.codex/rules/lumo.rules', LUMO_CODEX_RULES)
    expect(kinds()).toEqual([])
  })

  it('uncommitted settings still holding Lumo hooks for dropped events are reported as drifted', () => {
    git('init', '-q')
    stubs()
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
    stubs()
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
    kind: 'codex-rules' | 'claude-settings' | 'skill-stub',
    relPath: string,
    agent = kind === 'claude-settings' ? 'claude-code' : 'codex',
    tracked = true
  ) => ({
    kind,
    path: path.join(repo, relPath),
    relPath,
    agent,
    tracked,
  })

  it('no drift: no note', () => {
    expect(projectDriftNote([], CLI)).toBeNull()
  })

  it('one agent: re-run `lumo init --agent <token>`, with its dry run', () => {
    expect(
      projectDriftNote([item('codex-rules', '.codex/rules/lumo.rules')], CLI)
    ).toBe(
      'committed Lumo install behind lumo 1.120.0: .codex/rules/lumo.rules — run `lumo init --agent codex` (preview with `--dry-run`), then commit the changes in a PR (an outdated rules file may let newer lumo commands run outside the sandbox)'
    )
    expect(
      projectDriftNote(
        [item('claude-settings', '.claude/settings.json', 'cursor')],
        CLI
      )
    ).toContain('run `lumo init --agent cursor` (preview with')
  })

  it('untracked items: "local" wording, no commit-in-a-PR step', () => {
    expect(
      projectDriftNote(
        [item('codex-rules', '.codex/rules/lumo.rules', 'codex', false)],
        CLI
      )
    ).toBe(
      'local Lumo install behind lumo 1.120.0: .codex/rules/lumo.rules — run `lumo init --agent codex` (preview with `--dry-run`) (an outdated rules file may let newer lumo commands run outside the sandbox)'
    )
  })

  it('two agents: plain `lumo init`, never --scope / skill update', () => {
    const note = projectDriftNote(
      [
        item('claude-settings', '.claude/settings.json'),
        item('codex-rules', '.codex/rules/lumo.rules'),
      ],
      CLI
    )
    expect(note).toContain('run `lumo init` (preview with `--dry-run`)')
    expect(note).not.toMatch(/--scope|skill update|--upgrade/)
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
