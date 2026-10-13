/**
 * @jest-environment node
 *
 * LUM-1112 — after the Codex hook event set changes, say WHICH events need
 * Trust again: `init --upgrade` names the added/rewritten events, and
 * `session attach` / `session status` in a Codex shell list the Lumo events
 * that look untrusted in ~/.codex/config.toml once some events do arrive.
 */
// Jest gives the sandbox its own process.env, so HOME cannot steer
// os.homedir() — mock it instead.
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: jest.fn(),
}))
jest.mock('@/cli/src/lib/worktree-attach', () => ({
  attachWorktreeStep: jest.fn(),
}))
jest.mock('@/cli/src/lib/memory-auto', () => ({
  autoDownsyncOnAttach: jest.fn(),
}))
jest.mock('@/cli/src/lib/resolve-project', () => ({
  resolveBoundProjectId: jest.fn(async () => ({
    ok: false,
    error: 'not needed here',
  })),
}))
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: () => ({ token: 't', apiUrl: 'https://lumo.test' }),
  configDir: () => '/tmp/lumo-config',
}))
jest.mock('@/cli/src/lib/session-id', () => ({
  ...jest.requireActual('@/cli/src/lib/session-id'),
  resolveSessionId: async () => 'sess-1',
}))

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { execFileSync } from 'child_process'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { CODEX_HOOK_EVENTS } from '@/cli/src/lib/hooks-template'
import { mergeHooksFile, upgradeCodexHooksFile } from '@/cli/src/commands/init'
import {
  codexEventKey,
  codexLikelyUntrustedEvents,
  codexUntrustedEventsWarning,
} from '@/cli/src/lib/codex-hooks'
import { sessionStatus } from '@/cli/src/commands/session-status'
import { sessionAttach } from '@/cli/src/commands/session-attach'

const ALL = CODEX_HOOK_EVENTS.map(([e]) => e)

let home: string
let cwd: string
const ENV_KEYS = ['CODEX_THREAD_ID', 'CLAUDE_CODE_SESSION_ID'] as const
const savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))
const realFetch = global.fetch

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'lum1112-home-'))
  // Not a git repo, so only the user-level hooks file counts.
  cwd = mkdtempSync(join(tmpdir(), 'lum1112-cwd-'))
  ;(homedir as jest.Mock).mockReturnValue(home)
  jest.spyOn(process, 'cwd').mockReturnValue(cwd)
})

afterEach(() => {
  jest.restoreAllMocks()
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  global.fetch = realFetch
  rmSync(home, { recursive: true, force: true })
  rmSync(cwd, { recursive: true, force: true })
})

function userHooksPath(): string {
  return join(home, '.codex', 'hooks.json')
}

function installUserHooks(): string {
  const p = userHooksPath()
  mkdirSync(join(home, '.codex'), { recursive: true })
  mergeHooksFile(p, 'codex', CODEX_HOOK_EVENTS, { quiet: true })
  return p
}

function trust(hooksPath: string, events: readonly string[]): void {
  writeFileSync(
    join(home, '.codex', 'config.toml'),
    events
      .map(
        ev =>
          `[hooks.state."${hooksPath}:${codexEventKey(ev)}:0:0"]\ntrusted_hash = "sha256:x"\n`
      )
      .join('\n')
  )
}

function captureStdout(): { text: () => string } {
  let out = ''
  jest.spyOn(process.stdout, 'write').mockImplementation(((s: string) => {
    out += s
    return true
  }) as never)
  return { text: () => out }
}

// ─── init --upgrade names the events ───────────────────────────────────────

describe('upgradeCodexHooksFile lists the events to re-trust', () => {
  it('names an added event and a rewritten one', () => {
    const p = installUserHooks()
    const file = JSON.parse(readFileSync(p, 'utf8')) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>
    }
    delete file.hooks.Interrupt
    file.hooks.Stop![0]!.hooks[0]!.command = 'lumo hook stop'
    writeFileSync(p, JSON.stringify(file, null, 2))

    const out = captureStdout()
    expect(upgradeCodexHooksFile(p)).toBe('updated')
    expect(out.text()).toContain('re-trust in Codex /hooks')
    expect(out.text()).toContain(
      'Events to trust again: Interrupt (added), Stop (updated)'
    )
  })

  it('names nothing when the event set is unchanged', () => {
    const p = installUserHooks()
    const out = captureStdout()
    expect(upgradeCodexHooksFile(p)).toBe('unchanged')
    expect(out.text()).not.toContain('Events to trust again')
  })
})

// ─── the trust scan behind the warning ─────────────────────────────────────

describe('codexLikelyUntrustedEvents', () => {
  it('lists the Lumo events with no trust entry when some are trusted', () => {
    const p = installUserHooks()
    trust(
      p,
      ALL.filter(e => e !== 'Interrupt' && e !== 'PostCompact')
    )
    expect(codexLikelyUntrustedEvents({ home, cwd })).toEqual([
      'PostCompact',
      'Interrupt',
    ])
  })

  it('is empty when every Lumo event is trusted', () => {
    const p = installUserHooks()
    trust(p, ALL)
    expect(codexLikelyUntrustedEvents({ home, cwd })).toEqual([])
  })

  it('stays silent (null) when no Lumo event looks trusted — the scan cannot be relied on', () => {
    installUserHooks()
    expect(codexLikelyUntrustedEvents({ home, cwd })).toBeNull()
  })

  it('stays silent (null) when no Codex hooks file carries Lumo hooks', () => {
    expect(codexLikelyUntrustedEvents({ home, cwd })).toBeNull()
  })

  it('does not report events of a hooks file whose trust it cannot read', () => {
    // User file: old set without Interrupt, all trusted. Repo file: the full
    // set, trusted under a key the scan does not see (none of its events
    // match) — its Interrupt may well be trusted, so it is not reported.
    const user = installUserHooks()
    const raw = JSON.parse(readFileSync(user, 'utf8')) as {
      hooks: Record<string, unknown>
    }
    delete raw.hooks.Interrupt
    writeFileSync(user, JSON.stringify(raw, null, 2))
    trust(
      user,
      ALL.filter(e => e !== 'Interrupt')
    )
    const repo = mkdtempSync(join(tmpdir(), 'lum1112-repo-'))
    try {
      execFileSync('git', ['init', '-q'], { cwd: repo })
      mkdirSync(join(repo, '.codex'), { recursive: true })
      mergeHooksFile(
        join(repo, '.codex', 'hooks.json'),
        'codex',
        CODEX_HOOK_EVENTS,
        {
          quiet: true,
        }
      )
      expect(codexLikelyUntrustedEvents({ home, cwd: repo })).toEqual([])
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('accepts trust keyed by the realpath of the hooks file', () => {
    const p = installUserHooks()
    const real = realpathSync(p)
    trust(
      real,
      ALL.filter(e => e !== 'Stop')
    )
    expect(codexLikelyUntrustedEvents({ home, cwd })).toEqual(['Stop'])
  })
})

it('the warning hedges and points at /hooks', () => {
  const w = codexUntrustedEventsWarning(['Interrupt', 'Stop'])
  expect(w).toContain('may not be trusted')
  expect(w).toContain('Interrupt, Stop')
  expect(w).toContain('/hooks')
})

// ─── session status / attach ───────────────────────────────────────────────

function mockSessionServer(eventCount: number): void {
  global.fetch = jest.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () =>
      String(url).endsWith('/bind-task')
        ? {
            taskId: 'task_1',
            taskIdentifier: 'LUM-1',
            taskTitle: 'T',
            retaggedEventCount: 0,
            memorySection: '',
          }
        : {
            exists: true,
            sessionId: 'sess-1',
            eventCount,
            taskIdentifier: null,
            taskTitle: null,
          },
  })) as unknown as typeof fetch
}

async function runStatus(): Promise<string> {
  const err = jest.spyOn(console, 'error').mockImplementation(() => {})
  captureStdout()
  await sessionStatus()
  return err.mock.calls.map(c => String(c[0])).join('\n')
}

async function runAttach(): Promise<string> {
  const log = jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
  captureStdout()
  await sessionAttach('LUM-1')
  return log.mock.calls.map(c => String(c[0])).join('\n')
}

describe.each([
  ['session status', runStatus],
  ['session attach', runAttach],
])('%s', (_name, run) => {
  it('warns with the missing events in a Codex session that has some events', async () => {
    process.env.CODEX_THREAD_ID = 'thread-1'
    const p = installUserHooks()
    trust(
      p,
      ALL.filter(e => e !== 'Interrupt')
    )
    mockSessionServer(5)
    const out = await run()
    expect(out).toContain('may not be trusted in Codex: Interrupt')
  })

  it('does not warn when every Lumo event is trusted', async () => {
    process.env.CODEX_THREAD_ID = 'thread-1'
    const p = installUserHooks()
    trust(p, ALL)
    mockSessionServer(5)
    expect(await run()).not.toContain('may not be trusted')
  })

  it('leaves a Claude Code session alone', async () => {
    delete process.env.CODEX_THREAD_ID
    process.env.CLAUDE_CODE_SESSION_ID = 'sess-1'
    const p = installUserHooks()
    trust(
      p,
      ALL.filter(e => e !== 'Interrupt')
    )
    mockSessionServer(5)
    expect(await run()).not.toContain('may not be trusted')
  })
})
