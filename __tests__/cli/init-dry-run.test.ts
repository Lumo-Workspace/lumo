/**
 * @jest-environment node
 */
import { execFileSync } from 'child_process'
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { init } from '@/cli/src/commands/init'
import { CODEX_RULES_MARKER } from '@/cli/src/lib/codex-rules'
import {
  displayPath,
  lumoHooksView,
  planInit,
  renderInitPlan,
  textDiff,
} from '@/cli/src/lib/init-dry-run'

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
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'lumo-dry-')))
  tmpRoots.push(d)
  return d
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

function env(cliVersion = '1.0.0') {
  const project = tmp()
  gitInit(project)
  return { project, deps: { cliVersion, cwd: project } }
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
 * Installs at 1.0.0, then every file drifts: Claude settings lose a Lumo
 * event and carry foreign settings, .codex/hooks.json loses SubagentStop, the
 * Codex rule is an older Lumo version, the git hook block is stale.
 */
async function driftedInstall() {
  const e = env('1.0.0')
  expect(await init({}, e.deps)).toBe(0)

  const settings = join(e.project, '.claude', 'settings.json')
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

  const codexHooks = join(e.project, '.codex', 'hooks.json')
  const c = JSON.parse(readFileSync(codexHooks, 'utf8'))
  delete c.hooks.SubagentStop
  writeFileSync(codexHooks, JSON.stringify(c, null, 2) + '\n')

  const rules = join(e.project, '.codex', 'rules', 'lumo.rules')
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
    roots: [e.project, process.env.LUMO_CONFIG_DIR as string],
  }
}

describe('lumo init --dry-run', () => {
  it('writes nothing — no install file, registry or lock (contents and mtimes unchanged)', async () => {
    const d = await driftedInstall()
    const before = snapshot(d.roots)
    expect(await init({ dryRun: true }, d.deps)).toBe(0)
    expect(snapshot(d.roots)).toEqual(before)
    expect(stdout.split('\n')[0]).toBe(
      `Lumo init --dry-run — repo ${d.project}, nothing is written (CLI 2.0.0)`
    )
  })

  it('writes nothing for a fresh install either and lists what it would install', async () => {
    const e = env('1.0.0')
    const roots = [e.project, process.env.LUMO_CONFIG_DIR as string]
    const before = snapshot(roots)
    expect(await init({ dryRun: true }, e.deps)).toBe(0)
    expect(snapshot(roots)).toEqual(before)
    expect(readdirSync(process.env.LUMO_CONFIG_DIR as string)).toEqual([])
    expect(stdout).toContain('.claude/skills/lumo/SKILL.md')
    expect(stdout).toContain('.agents/skills/lumo/SKILL.md')
    expect(stdout).toContain(
      'would install .claude/settings.json — Claude settings hooks: add'
    )
    expect(stdout).toContain(
      'would install .codex/hooks.json — Codex hooks: add 9'
    )
    expect(stdout).toContain(
      '⚠ Codex runs these hooks only after you trust them — events:'
    )
    expect(stdout).toContain(
      'would install .codex/rules/lumo.rules — Codex rule'
    )
    expect(stdout).toContain(
      'would install .git/hooks/prepare-commit-msg — prepare-commit-msg hook: new hook with the Lumo block'
    )
    expect(stdout).toContain('Run `lumo init` to apply.')
  })

  it('refuses $HOME, writing nothing', async () => {
    const dir = tmp()
    expect(await init({ dryRun: true }, { cwd: dir, homeDir: dir })).toBe(1)
    expect(stderr).toContain('home directory')
    expect(stdout).toBe('')
  })

  it('prints path, action and a unified diff for every file type', async () => {
    const d = await driftedInstall()
    expect(await init({ dryRun: true }, d.deps)).toBe(0)
    // Claude settings: normalized Lumo-only JSON diff
    expect(stdout).toContain(
      'would update .claude/settings.json — Claude settings hooks: add 1, update 0 Lumo event (agent=claude-code)'
    )
    expect(stdout).toMatch(
      /\n {4}\+ +"command": "lumo hook stop --agent claude-code"\n/
    )
    // Codex hooks.json
    expect(stdout).toContain(
      'would update .codex/hooks.json — Codex hooks: add 1, update 0 Lumo event'
    )
    expect(stdout).toContain(
      '"command": "lumo hook subagent-stop --agent codex"'
    )
    // Codex rules: whole Lumo-owned file diffed
    expect(stdout).toContain(
      'would update .codex/rules/lumo.rules — Codex rule: Lumo-managed file differs from this CLI — rewritten'
    )
    expect(stdout).toContain('    -# an older Lumo rule')
    expect(stdout).toContain('    +prefix_rule(')
    // git hook: only the Lumo block
    expect(stdout).toContain(
      'would update .git/hooks/prepare-commit-msg — prepare-commit-msg hook: Lumo block replaced'
    )
    expect(stdout).toContain('    -old lumo line')
    expect(stdout).not.toContain('private-foreign-step')
    expect(stdout).toMatch(/\d+ of \d+ would change/)
    expect(stdout).toContain('Run `lumo init` to apply.')
  })

  it('narrows to --agent and names it in the apply command', async () => {
    const d = await driftedInstall()
    expect(await init({ agent: 'codex', dryRun: true }, d.deps)).toBe(0)
    expect(stdout).toContain('.codex/hooks.json')
    expect(stdout).not.toContain('.claude/settings.json')
    expect(stdout).toContain('Run `lumo init --agent codex` to apply')
  })

  it('never prints settings.json content that is not Lumo’s — it is folded to counts', async () => {
    const d = await driftedInstall()
    await init({ dryRun: true }, d.deps)
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
    await init({ dryRun: true }, d.deps)
    const items = planInit({
      tokens: ['claude-code', 'codex'],
      root: d.project,
    })
    expect(items.filter(i => i.retrust).map(i => i.path)).toEqual([
      d.codexHooks,
    ])
    expect(stdout).toContain(
      '⚠ Codex will ask to trust these hooks again — events: SubagentStop (added)'
    )
    expect(stdout).toContain('1 would make Codex ask to trust hooks')
  })

  it('does not mark re-trust when Codex hooks are already complete', async () => {
    const e = env('1.0.0')
    await init({ agent: 'codex' }, e.deps)
    stdout = ''
    await init({ agent: 'codex', dryRun: true }, e.deps)
    expect(stdout).toContain('· .codex/hooks.json — Codex hooks: up to date')
    expect(stdout).not.toContain('trust')
  })

  it('previews exactly what the real `lumo init` then changes', async () => {
    const d = await driftedInstall()
    const items = planInit({
      tokens: ['claude-code', 'codex'],
      root: d.project,
    })
    const before = snapshot(d.roots)
    expect(await init({}, d.deps)).toBe(0)
    const changed = changedFiles(before, snapshot(d.roots))
    const writing = items.filter(
      i => i.action === 'update' || i.action === 'install'
    )
    for (const f of changed)
      expect(writing.some(i => i.path === f) ? f : `unpreviewed: ${f}`).toBe(f)
    for (const i of writing)
      expect(changed.includes(i.path) ? i.path : `unchanged: ${i.path}`).toBe(
        i.path
      )
    expect(writing.length).toBe(4)
  })

  it('says "nothing to change" when every file is up to date', async () => {
    const e = env('1.0.0')
    await init({}, e.deps)
    stdout = ''
    expect(await init({ dryRun: true }, e.deps)).toBe(0)
    expect(stdout).toContain('Nothing to change — all')
    expect(stdout).toContain('up to date or left as is.')
    expect(stdout).not.toContain('would update')
    expect(stdout).not.toContain('to apply')
  })

  it('reports a foreign rule as skipped, without a diff, and counts it as no change', async () => {
    const e = env('2.0.0')
    await init({}, e.deps)
    const rules = join(e.project, '.codex', 'rules', 'lumo.rules')
    writeFileSync(rules, '# the user’s own rules\n')
    stdout = ''
    const before = snapshot([e.project])
    expect(await init({ dryRun: true }, e.deps)).toBe(0)
    expect(snapshot([e.project])).toEqual(before)
    expect(stdout).toContain(
      '⚠ skip .codex/rules/lumo.rules — Codex rule: not written by Lumo — left as is (move it aside and re-run `lumo init`'
    )
    expect(stdout).not.toContain('---')
    expect(stdout).toContain('Nothing to change')
  })

  it('lists an unparseable settings.json as an error, keeps going and exits 1', async () => {
    const d = await driftedInstall()
    writeFileSync(d.settings, '{ not json')
    const before = snapshot(d.roots)
    expect(await init({ dryRun: true }, d.deps)).toBe(1)
    expect(snapshot(d.roots)).toEqual(before)
    expect(stdout).toContain(
      `✗ cannot plan .claude/settings.json — Claude settings hooks: Cannot parse existing ${d.settings}`
    )
    expect(stdout).toContain('would update .codex/hooks.json')
    expect(stdout).toContain('1 cannot be planned')
  })

  it('notes a git-tracked target', async () => {
    const e = env('1.0.0')
    await init({ agent: 'claude-code' }, e.deps)
    const settings = join(e.project, '.claude', 'settings.json')
    const s = JSON.parse(readFileSync(settings, 'utf8'))
    delete s.hooks.Stop
    writeFileSync(settings, JSON.stringify(s, null, 2) + '\n')
    execFileSync('git', ['add', '.'], { cwd: e.project })
    execFileSync('git', ['commit', '-q', '--no-gpg-sign', '-m', 'x'], {
      cwd: e.project,
    })
    stdout = ''
    await init({ agent: 'claude-code', dryRun: true }, e.deps)
    expect(stdout).toContain(
      'ℹ tracked by git — the change would show up in `git diff` for you to commit'
    )
  })

  it('skips a core.hooksPath git hook (never written) in the preview too', async () => {
    const e = env('1.0.0')
    execFileSync('git', ['config', 'core.hooksPath', '.husky'], {
      cwd: e.project,
    })
    mkdirSync(join(e.project, '.husky'))
    expect(await init({ agent: 'claude-code', dryRun: true }, e.deps)).toBe(0)
    expect(stdout).toContain(
      '⚠ skip .husky — prepare-commit-msg hook: core.hooksPath is set'
    )
    expect(stdout).toContain('`lumo init` prints the block to add by hand')
  })
})

describe('displayPath', () => {
  it('is relative inside the repo and absolute outside it', () => {
    expect(displayPath('/r/.codex/hooks.json', '/r')).toBe('.codex/hooks.json')
    expect(displayPath('/elsewhere/x', '/r')).toBe('/elsewhere/x')
    expect(displayPath('/r', '/r')).toBe('/r')
  })
})

describe('lumo init --upgrade is removed', () => {
  it.each([[{ upgrade: true }], [{ upgrade: true, dryRun: true }]])(
    '%o exits 2 (usage) with the migration message and writes nothing',
    async opts => {
      const e = env()
      const roots = [e.project, process.env.LUMO_CONFIG_DIR as string]
      const before = snapshot(roots)
      expect(await init(opts, e.deps)).toBe(2)
      expect(stderr).toBe(
        'Error: `lumo init --upgrade` was removed — re-run `lumo init` in the repo to refresh (optionally `--agent <token>`); preview it with `lumo init --dry-run`.\n'
      )
      expect(stdout).toBe('')
      expect(snapshot(roots)).toEqual(before)
    }
  )
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

describe('renderInitPlan', () => {
  it('keeps the first line machine-parsable and indents diff lines under their install', () => {
    const text = renderInitPlan(
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
      {
        cliVersion: '3.0.0',
        root: '/r',
        applyCommand: 'lumo init',
      }
    )
    expect(text.split('\n')[0]).toBe(
      'Lumo init --dry-run — repo /r, nothing is written (CLI 3.0.0)'
    )
    expect(text).toContain(
      'would update .git/hooks/prepare-commit-msg — prepare-commit-msg hook'
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
