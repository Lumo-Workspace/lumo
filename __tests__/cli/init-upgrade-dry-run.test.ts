/**
 * @jest-environment node
 */
import { execFileSync } from 'child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join, sep } from 'path'
import { init } from '@/cli/src/commands/init'
import {
  isInitDryRun,
  shouldAutoSync,
  shouldCheckForUpdates,
} from '@/cli/src/lib/auto-sync'
import { CODEX_RULES_MARKER } from '@/cli/src/lib/codex-rules'
import { readRegistry } from '@/cli/src/lib/install-registry'
import { hashSkillDir } from '@/cli/src/lib/skill-hash'
import {
  lumoHooksView,
  planUpgrade,
  renderUpgradePlan,
  textDiff,
} from '@/cli/src/lib/upgrade-dry-run'
import skillVersionHashes from '@/cli/src/lib/skill-version-hashes.json'

jest.mock('@/cli/src/lib/skill-version-hashes.json', () => ({}))
jest.mock('@/cli/src/lib/cli-version', () => ({
  readCliVersion: jest.fn(() => '2.0.0'),
}))
jest.mock('@/cli/src/lib/session-record-notice', () => ({
  fetchSessionRecordNotice: async () => null,
}))

let tmpRoots: string[]
let stdout: string
let stderr: string
let outSpy: jest.SpyInstance
let errSpy: jest.SpyInstance
let prevConfigDir: string | undefined

const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'lumo-dry-'))
  tmpRoots.push(d)
  return d
}

function writeSkill(dir: string, body: string): void {
  mkdirSync(join(dir, 'references'), { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), body)
  writeFileSync(join(dir, 'references', 'a.md'), 'ref')
}

function gitInit(dir: string): void {
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir })
}

beforeEach(() => {
  tmpRoots = []
  stdout = ''
  stderr = ''
  prevConfigDir = process.env.LUMO_CONFIG_DIR
  process.env.LUMO_CONFIG_DIR = tmp()
  for (const k of Object.keys(skillVersionHashes)) {
    delete (skillVersionHashes as Record<string, string>)[k]
  }
  outSpy = jest.spyOn(process.stdout, 'write').mockImplementation(c => {
    stdout += String(c)
    return true
  })
  errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(c => {
    stderr += String(c)
    return true
  })
})
afterEach(() => {
  outSpy.mockRestore()
  errSpy.mockRestore()
  if (prevConfigDir === undefined) delete process.env.LUMO_CONFIG_DIR
  else process.env.LUMO_CONFIG_DIR = prevConfigDir
  for (const d of tmpRoots) rmSync(d, { recursive: true, force: true })
})

function env(bundledBody = 'v1 body', cliVersion = '1.0.0') {
  const home = tmp()
  const project = tmp()
  gitInit(project)
  const bundled = join(tmp(), 'skill')
  writeSkill(bundled, bundledBody)
  return {
    home,
    project,
    bundled,
    deps: { cliVersion, homeDir: home, cwd: project, bundledSkillDir: bundled },
  }
}

type Snap = Map<string, string>

/** Every file and dir under `roots`: content + mtime (dirs: mtime only). */
function snapshot(roots: readonly string[]): Snap {
  const out: Snap = new Map()
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      const st = lstatSync(p)
      if (st.isDirectory()) {
        out.set(p, `dir ${st.mtimeMs}`)
        walk(p)
      } else {
        out.set(
          p,
          `${st.mtimeMs} ${st.mode} ${readFileSync(p).toString('base64')}`
        )
      }
    }
  }
  for (const r of roots) walk(r)
  return out
}

/** Files whose content was created, changed or removed between two snapshots. */
function changedFiles(before: Snap, after: Snap): string[] {
  const contentOf = (v: string | undefined) =>
    v === undefined || v.startsWith('dir ')
      ? v
      : v.split(' ').slice(2).join(' ')
  const keys = new Set([...before.keys(), ...after.keys()])
  return [...keys]
    .filter(k => !(before.get(k) ?? after.get(k))!.startsWith('dir '))
    .filter(k => contentOf(before.get(k)) !== contentOf(after.get(k)))
    .sort()
}

const STALE_BLOCK =
  '# >>> lumo prepare-commit-msg >>>\nold lumo line\n# <<< lumo <<<\n'

/**
 * Installs at 1.0.0 (user + project), then the CLI moves to 2.0.0 with a new
 * skill body and every hook file drifts: Claude settings lose a Lumo event
 * and carry foreign settings, ~/.codex/hooks.json loses Interrupt, the Codex
 * rule is an older Lumo version, the git hook block is stale.
 */
async function driftedInstall() {
  const e = env('v1 body', '1.0.0')
  expect(await init({ user: true }, e.deps)).toBe(0)
  expect(await init({ project: true }, e.deps)).toBe(0)

  writeFileSync(join(e.bundled, 'SKILL.md'), 'v2 body\n')
  writeFileSync(join(e.bundled, 'references', 'new.md'), 'brand new ref\n')

  const settings = join(e.home, '.claude', 'settings.json')
  const s = JSON.parse(readFileSync(settings, 'utf8'))
  delete s.hooks.Stop
  s.hooks.PreToolUse.push({
    matcher: 'Bash',
    hooks: [{ type: 'command', command: 'echo private-user-hook' }],
  })
  s.hooks.MyOwnEvent = [
    { hooks: [{ type: 'command', command: 'echo another-private-hook' }] },
  ]
  s.apiKeyHelper = 'user-only-value-xyz'
  s.permissions = { allow: ['Bash(private-allow-rule)'] }
  writeFileSync(settings, JSON.stringify(s, null, 2) + '\n')

  const codexHooks = join(e.home, '.codex', 'hooks.json')
  const c = JSON.parse(readFileSync(codexHooks, 'utf8'))
  delete c.hooks.Interrupt
  writeFileSync(codexHooks, JSON.stringify(c, null, 2) + '\n')

  const rules = join(e.home, '.codex', 'rules', 'lumo.rules')
  writeFileSync(rules, `${CODEX_RULES_MARKER}\n# an older Lumo rule\n`)

  const hook = join(e.project, '.git', 'hooks', 'prepare-commit-msg')
  writeFileSync(hook, `#!/bin/sh\necho private-foreign-step\n${STALE_BLOCK}`)
  stdout = ''

  return {
    ...e,
    deps: { ...e.deps, cliVersion: '2.0.0' },
    settings,
    codexHooks,
    rules,
    hook,
    roots: [e.home, e.project, process.env.LUMO_CONFIG_DIR as string],
  }
}

describe('init --upgrade --dry-run', () => {
  it('writes nothing — no install file, marker, registry record or lock (contents and mtimes unchanged)', async () => {
    const d = await driftedInstall()
    const registryBefore = readRegistry()
    const before = snapshot(d.roots)
    expect(await init({ upgrade: true, dryRun: true }, d.deps)).toBe(0)
    expect(snapshot(d.roots)).toEqual(before)
    expect(readRegistry()).toEqual(registryBefore)
    expect(stdout.split('\n')[0]).toBe(
      'Lumo init --upgrade — dry run, nothing is written (CLI 2.0.0)'
    )
  })

  it('prints path, action and a unified diff for every install type', async () => {
    const d = await driftedInstall()
    expect(await init({ upgrade: true, dryRun: true }, d.deps)).toBe(0)
    // skill dir: 1107 file list + per-file unified diff
    expect(stdout).toContain(
      'would update ~/.claude/skills/lumo — skill: 1.0.0 → 2.0.0: 2 files changed'
    )
    expect(stdout).toContain('    + references/new.md (+1)')
    expect(stdout).toContain('    ~ SKILL.md (+1 −1)')
    expect(stdout).toContain('    --- a/SKILL.md\n    +++ b/SKILL.md')
    expect(stdout).toContain('    -v1 body')
    expect(stdout).toContain('    +v2 body')
    expect(stdout).toContain('    +brand new ref')
    // Claude settings: normalized Lumo-only JSON diff
    expect(stdout).toContain(
      'would update ~/.claude/settings.json — Claude settings hooks: add 1, update 0 Lumo event (agent=claude-code)'
    )
    expect(stdout).toMatch(
      /\n {4}\+ +"command": "lumo hook stop --agent claude-code"\n/
    )
    // Codex hooks.json
    expect(stdout).toContain(
      'would update ~/.codex/hooks.json — Codex hooks: add 1, update 0 Lumo event'
    )
    expect(stdout).toContain('"command": "lumo hook interrupt --agent codex"')
    // Codex rules: whole Lumo-owned file diffed
    expect(stdout).toContain(
      'would update ~/.codex/rules/lumo.rules — Codex rule: Lumo-managed file differs from this CLI — rewritten'
    )
    expect(stdout).toContain('    -# an older Lumo rule')
    expect(stdout).toContain('    +prefix_rule(')
    // git hook: only the Lumo block
    expect(stdout).toContain(
      `would update ${d.hook} — prepare-commit-msg hook: Lumo block replaced`
    )
    expect(stdout).toContain('    -old lumo line')
    expect(stdout).not.toContain('private-foreign-step')
    expect(stdout).toMatch(/\d+ of \d+ would change/)
    expect(stdout).toContain('Run `lumo init --upgrade` to apply')
  })

  it('never prints settings.json content that is not Lumo’s — it is folded to counts', async () => {
    const d = await driftedInstall()
    await init({ upgrade: true, dryRun: true }, d.deps)
    for (const secret of [
      'private-user-hook',
      'another-private-hook',
      'user-only-value-xyz',
      'private-allow-rule',
      'apiKeyHelper',
      'permissions',
      'MyOwnEvent',
      'Bash',
    ])
      expect(stdout).not.toContain(secret)
    expect(stdout).toContain(
      "ℹ only Lumo's `lumo hook …` entries are shown; other settings are folded"
    )
    // the view the diff is computed on folds them to counts
    const view = lumoHooksView(JSON.parse(readFileSync(d.settings, 'utf8')))
    expect(view).toContain('"… 1 other hook group"')
    expect(view).toContain('"…": "1 other event"')
    expect(view).toContain('"…": "2 other settings"')
    expect(view).not.toMatch(/private|user-only|MyOwnEvent|apiKeyHelper/)
  })

  it('marks only Codex hooks.json changes as needing Trust again, naming the events', async () => {
    const d = await driftedInstall()
    await init({ upgrade: true, dryRun: true }, d.deps)
    const items = planUpgrade({
      cliVersion: '2.0.0',
      homeDir: d.home,
      cwd: d.project,
      bundled: d.bundled,
    })
    expect(items.filter(i => i.retrust).map(i => i.path)).toEqual([
      d.codexHooks,
    ])
    expect(stdout).toContain(
      '⚠ Codex will ask to trust these hooks again — events: Interrupt (added)'
    )
    expect(stdout).toContain('1 would make Codex ask to trust hooks again')
  })

  it('does not mark re-trust when Codex hooks are already complete', async () => {
    const e = env('v1 body', '1.0.0')
    await init({ user: true, agent: 'codex' }, e.deps)
    stdout = ''
    await init({ upgrade: true, dryRun: true }, e.deps)
    expect(stdout).toContain('· ~/.codex/hooks.json — Codex hooks: up to date')
    expect(stdout).not.toContain('trust')
  })

  it('previews exactly what the real init --upgrade then changes', async () => {
    const d = await driftedInstall()
    const items = planUpgrade({
      cliVersion: '2.0.0',
      homeDir: d.home,
      cwd: d.project,
      bundled: d.bundled,
    })
    const registry = join(
      process.env.LUMO_CONFIG_DIR as string,
      'installs.json'
    )
    const before = snapshot(d.roots)
    expect(await init({ upgrade: true }, d.deps)).toBe(0)
    const changed = changedFiles(before, snapshot(d.roots)).filter(
      f => f !== registry
    )
    const writing = items.filter(
      i => i.action === 'update' || i.action === 'adopt'
    )
    const covers = (item: { path: string }, f: string) =>
      f === item.path || f.startsWith(item.path + sep)
    for (const f of changed)
      expect(writing.some(i => covers(i, f)) ? f : `unpreviewed: ${f}`).toBe(f)
    for (const i of writing)
      expect(
        changed.some(f => covers(i, f)) ? i.path : `unchanged: ${i.path}`
      ).toBe(i.path)
    expect(writing.length).toBeGreaterThan(0)
  })

  it('says "nothing to change" when every install is up to date', async () => {
    const e = env('v1 body', '1.0.0')
    await init({ user: true }, e.deps)
    await init({ project: true }, e.deps)
    stdout = ''
    expect(await init({ upgrade: true, dryRun: true }, e.deps)).toBe(0)
    expect(stdout).toContain('Nothing to change — all')
    expect(stdout).toContain('up to date or left as is.')
    expect(stdout).not.toContain('would update')
    expect(stdout).not.toContain('Run `lumo init --upgrade` to apply')
  })

  it('says nothing to change when no install exists', async () => {
    const e = env()
    expect(await init({ upgrade: true, dryRun: true }, e.deps)).toBe(0)
    expect(stdout).toContain(
      'No Lumo installs found — nothing to change. Run `lumo init` to install.'
    )
  })

  it('reports skipped copies (modified, newer, foreign rule) without diffs and counts them as no change', async () => {
    const e = env('v2 body', '2.0.0')
    const modified = join(e.home, '.claude', 'skills', 'lumo')
    writeSkill(modified, 'hand edited')
    const newer = join(e.home, '.agents', 'skills', 'lumo')
    writeSkill(newer, 'newer body')
    writeFileSync(
      join(newer, '.lumo-install.json'),
      JSON.stringify({
        version: '9.0.0',
        hash: hashSkillDir(newer),
        agent: 'codex',
        installedAt: 'x',
      })
    )
    const rules = join(e.home, '.codex', 'rules', 'lumo.rules')
    mkdirSync(join(rules, '..'), { recursive: true })
    writeFileSync(rules, '# the user’s own rules\n')
    writeFileSync(
      join(process.env.LUMO_CONFIG_DIR as string, 'installs.json'),
      JSON.stringify({
        lastSyncedVersion: null,
        installs: [
          {
            kind: 'codex-rules',
            path: rules,
            scope: 'user',
            agent: 'codex',
            version: '1.0.0',
            installedAt: 'x',
          },
        ],
      })
    )
    const before = snapshot([e.home, process.env.LUMO_CONFIG_DIR as string])
    expect(await init({ upgrade: true, dryRun: true }, e.deps)).toBe(0)
    expect(snapshot([e.home, process.env.LUMO_CONFIG_DIR as string])).toEqual(
      before
    )
    expect(stdout).toContain(
      '⚠ skip ~/.claude/skills/lumo — skill: modified locally'
    )
    expect(stdout).toContain(
      '⚠ skip ~/.agents/skills/lumo — skill: 9.0.0 is newer than this CLI (2.0.0) — never downgraded'
    )
    expect(stdout).toContain(
      "⚠ skip ~/.codex/rules/lumo.rules — Codex rule: no longer Lumo's Codex rule — left as is"
    )
    expect(stdout).not.toContain('---')
    expect(stdout).toContain('Nothing to change')
  })

  it('previews adopting a legacy copy as a marker-only write and does not write the marker', async () => {
    const e = env('v1 body', '1.0.0')
    const skill = join(e.home, '.claude', 'skills', 'lumo')
    writeSkill(skill, 'v1 body')
    ;(skillVersionHashes as Record<string, string>)[hashSkillDir(skill)] =
      '1.0.0'
    expect(await init({ upgrade: true, dryRun: true }, e.deps)).toBe(0)
    expect(stdout).toContain(
      'would adopt ~/.claude/skills/lumo — skill: matches the 1.0.0 skill — writes only the .lumo-install.json marker'
    )
    expect(existsSync(join(skill, '.lumo-install.json'))).toBe(false)
    expect(readRegistry().installs).toEqual([])
  })

  it('lists an unparseable settings.json as an error, keeps going and exits 1', async () => {
    const d = await driftedInstall()
    writeFileSync(d.settings, '{ not json')
    const before = snapshot(d.roots)
    expect(await init({ upgrade: true, dryRun: true }, d.deps)).toBe(1)
    expect(snapshot(d.roots)).toEqual(before)
    expect(stdout).toContain(
      `✗ cannot plan ~/.claude/settings.json — Claude settings hooks: Cannot parse existing ${d.settings}`
    )
    expect(stdout).toContain('would update ~/.codex/hooks.json')
    expect(stdout).toContain('1 cannot be planned')
  })

  it('notes a git-tracked target', async () => {
    const e = env('v1 body', '1.0.0')
    await init({ project: true, agent: 'claude-code' }, e.deps)
    execFileSync('git', ['add', '.'], { cwd: e.project })
    execFileSync('git', ['commit', '-q', '--no-gpg-sign', '-m', 'x'], {
      cwd: e.project,
    })
    writeFileSync(join(e.bundled, 'SKILL.md'), 'v2 body')
    stdout = ''
    await init(
      { upgrade: true, dryRun: true },
      { ...e.deps, cliVersion: '2.0.0' }
    )
    expect(stdout).toContain(
      'ℹ tracked by git — the update would leave 1 file changed for you to commit in a PR'
    )
  })

  it('rejects --dry-run without --upgrade and writes nothing', async () => {
    const e = env()
    const before = snapshot([e.home, e.project])
    expect(await init({ project: true, dryRun: true }, e.deps)).toBe(1)
    expect(stderr).toContain('--dry-run only works with --upgrade')
    expect(snapshot([e.home, e.project])).toEqual(before)
  })
})

describe('startup side effects', () => {
  const argv = (...a: string[]) => ['node', 'lumo', ...a]
  it('skips auto-sync and the update check for an init/setup dry run only', () => {
    expect(isInitDryRun(argv('init', '--upgrade', '--dry-run'))).toBe(true)
    expect(isInitDryRun(argv('setup', '--dry-run', '--upgrade'))).toBe(true)
    expect(isInitDryRun(argv('init', '--upgrade'))).toBe(false)
    expect(isInitDryRun(argv('memory', 'push', '--dry-run'))).toBe(false)
    expect(shouldAutoSync(argv('init', '--upgrade', '--dry-run'))).toBe(false)
    expect(shouldCheckForUpdates(argv('init', '--upgrade', '--dry-run'))).toBe(
      false
    )
    expect(shouldAutoSync(argv('init', '--upgrade'))).toBe(true)
    expect(shouldCheckForUpdates(argv('init', '--upgrade'))).toBe(true)
  })
})

describe('lumoHooksView', () => {
  it('keeps only lumo hook entries, sorted, and folds the rest to counts', () => {
    const view = lumoHooksView({
      model: 'x',
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: 'command',
                command: 'lumo hook stop --agent claude-code',
              },
              { type: 'command', command: 'say done' },
            ],
          },
        ],
        Alpha: [{ hooks: [{ type: 'command', command: 'mine' }] }],
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'mine2' }] },
          {
            hooks: [
              {
                type: 'command',
                command: 'lumo hook pre-tool-use --agent claude-code',
              },
            ],
          },
        ],
      },
    })
    expect(JSON.parse(view)).toEqual({
      hooks: {
        PreToolUse: [
          {
            hooks: [
              {
                type: 'command',
                command: 'lumo hook pre-tool-use --agent claude-code',
              },
            ],
          },
          '… 1 other hook group',
        ],
        Stop: [
          {
            hooks: [
              {
                type: 'command',
                command: 'lumo hook stop --agent claude-code',
              },
              '… 1 other hook',
            ],
          },
        ],
        '…': '1 other event',
      },
      '…': '1 other setting',
    })
    expect(view).not.toMatch(/mine|say done|Alpha|model|Bash/)
  })

  it('shows the matcher of a group holding a Lumo hook', () => {
    const view = JSON.parse(
      lumoHooksView({
        hooks: {
          PreToolUse: [
            {
              matcher: 'Edit',
              hooks: [
                {
                  type: 'command',
                  command: 'lumo hook pre-tool-use --agent claude-code',
                },
              ],
            },
          ],
        },
      })
    )
    expect(view.hooks.PreToolUse[0].matcher).toBe('Edit')
  })

  it('renders a non-object file as an empty view', () => {
    expect(lumoHooksView(null)).toBe('{}\n')
  })
})

describe('renderUpgradePlan', () => {
  it('keeps the first line machine-parsable and indents diff lines under their install', () => {
    const text = renderUpgradePlan(
      [
        {
          kind: 'git-hook',
          path: '/r/.git/hooks/prepare-commit-msg',
          action: 'update',
          summary: 'Lumo block replaced',
          notes: [],
          diffs: ['--- a\n+++ b\n@@ -1 +1 @@\n-x\n+y'],
          retrust: false,
        },
      ],
      { cliVersion: '3.0.0', home: '/h' }
    )
    expect(text.split('\n')[0]).toBe(
      'Lumo init --upgrade — dry run, nothing is written (CLI 3.0.0)'
    )
    expect(text).toContain('    -x\n    +y')
    expect(text).toContain('1 of 1 would change.')
  })
})

describe('textDiff', () => {
  it('says so when only the final newline differs instead of printing nothing', () => {
    expect(textDiff('a\nb', 'a\nb\n', 'x', 'y')).toBe(
      '--- x\n+++ y\n(only the final newline differs)'
    )
    // a lone newline is one blank line: a real one-line add
    expect(textDiff('', '\n', 'x', 'y')).toBe('--- x\n+++ y\n@@ -0,0 +1 @@\n+')
    expect(textDiff('a\n', 'a\n', 'x', 'y')).toBe('')
    expect(textDiff('', '', 'x', 'y')).toBe('')
  })

  it('renders a missing side as a whole-file hunk', () => {
    expect(textDiff('', 'one\ntwo\n', '/dev/null', 'b/f')).toBe(
      '--- /dev/null\n+++ b/f\n@@ -0,0 +1,2 @@\n+one\n+two'
    )
    expect(textDiff('gone\n', '', 'a/f', '/dev/null')).toBe(
      '--- a/f\n+++ /dev/null\n@@ -1 +0,0 @@\n-gone'
    )
  })
})
