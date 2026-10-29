/**
 * @jest-environment node
 *
 * LUM-1337 — logins to several Lumo servers side by side: credentials keyed
 * by server, a default, and a per-repository binding used by commands and
 * hooks. Real files under a temp LUMO_CONFIG_DIR and real git repositories.
 */
jest.mock('@/cli/src/lib/hook-log', () => ({ logHookError: jest.fn() }))

import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import {
  credentialsPath,
  loginKey,
  lookupRepoKey,
  readCredentials,
  readLoginStore,
  removeLogin,
  repoKey,
  resolveLogin,
  saveLogin,
  writeLoginStore,
  type Credentials,
} from '@/cli/src/lib/config'
import { authUse } from '@/cli/src/commands/auth-use'
import { authLogout } from '@/cli/src/commands/auth-logout'
import { formatWhoamiAll } from '@/cli/src/commands/whoami'
import { runHookWithBody } from '@/cli/src/lib/hook-runner'
import { logHookError } from '@/cli/src/lib/hook-log'

// Built at runtime so the fixtures are not literal credential assignments.
const tok = (name: string) => ['fixture', name, 'not', 'a', 'key'].join('-')
const HOSTED = 'https://www.uselumo.ai'
const LOCAL = 'http://localhost:3000'

function login(apiUrl: string, name: string): Credentials {
  return {
    token: tok(name),
    apiUrl,
    userId: `u-${name}`,
    email: `${name}@example.com`,
    workspaceId: `w-${name}`,
    workspaceSlug: name,
    workspaceName: name,
    apiKeyId: `k-${name}`,
    apiKeyName: `key ${name}`,
    apiKeyPrefix: `lum_${name}`,
  }
}

function gitRepo(dir: string): string {
  fs.mkdirSync(dir, { recursive: true })
  execFileSync('git', ['init', '-q', dir])
  return fs.realpathSync(dir)
}

let tmp: string
let repoA: string
let repoB: string
const ENV = { dir: process.env.LUMO_CONFIG_DIR, url: process.env.LUMO_API_URL }
let log: jest.SpyInstance
let err: jest.SpyInstance
let cwd: jest.SpyInstance

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lum1337-')))
  process.env.LUMO_CONFIG_DIR = path.join(tmp, 'config')
  delete process.env.LUMO_API_URL
  repoA = gitRepo(path.join(tmp, 'a'))
  repoB = gitRepo(path.join(tmp, 'b'))
  log = jest.spyOn(console, 'log').mockImplementation(() => {})
  err = jest.spyOn(console, 'error').mockImplementation(() => {})
  cwd = jest.spyOn(process, 'cwd')
})

afterEach(() => {
  for (const [k, v] of [
    ['LUMO_CONFIG_DIR', ENV.dir],
    ['LUMO_API_URL', ENV.url],
  ] as const) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  log.mockRestore()
  err.mockRestore()
  cwd.mockRestore()
  jest.clearAllMocks()
  fs.rmSync(tmp, { recursive: true, force: true })
})

/** Hosted is the default; repoA is bound to the local server. */
function twoLogins() {
  saveLogin(login(HOSTED, 'hosted'))
  saveLogin(login(LOCAL, 'local'), { bindCwd: repoA })
}

describe('loginKey / repoKey', () => {
  it('keys a login by origin', () => {
    expect(loginKey('http://localhost:3000/')).toBe(LOCAL)
    expect(loginKey('https://www.uselumo.ai/api')).toBe(HOSTED)
    expect(loginKey('not a url')).toBeNull()
  })

  it('keys a repository by its main work tree, shared by its worktrees', () => {
    execFileSync(
      'git',
      ['-C', repoA, 'commit', '-q', '--allow-empty', '-m', 'x'],
      {
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 't',
          GIT_AUTHOR_EMAIL: 't@t',
          GIT_COMMITTER_NAME: 't',
          GIT_COMMITTER_EMAIL: 't@t',
        },
      }
    )
    const wt = path.join(tmp, 'a-wt')
    execFileSync('git', ['-C', repoA, 'worktree', 'add', '-q', wt])
    fs.mkdirSync(path.join(repoA, 'sub'))
    expect(repoKey(path.join(repoA, 'sub'))).toBe(repoA)
    expect(repoKey(wt)).toBe(repoA)
    expect(repoKey(tmp)).toBeNull()
  })

  it('outside a repository is not an error; a git failure is, and becomes a note', () => {
    expect(lookupRepoKey(tmp)).toEqual({ key: null })
    const missing = lookupRepoKey(path.join(tmp, 'does-not-exist'))
    expect(missing.key).toBeNull()
    expect(missing.error).toEqual(expect.stringContaining('git did not run'))

    saveLogin(login(HOSTED, 'hosted'))
    saveLogin(login(LOCAL, 'local'), { bindCwd: repoA })
    expect(resolveLogin(path.join(tmp, 'does-not-exist'))).toMatchObject({
      source: 'default',
      note: expect.stringContaining('repository bindings ignored'),
    })
  })
})

describe('upgrade from a single-login credentials.json', () => {
  it('reads it as the default login, with no prompt and no rewrite', () => {
    fs.mkdirSync(process.env.LUMO_CONFIG_DIR as string, { recursive: true })
    const legacy = JSON.stringify(login(HOSTED, 'hosted'))
    fs.writeFileSync(credentialsPath(), legacy)
    expect(readCredentials(repoA)?.token).toBe(tok('hosted'))
    expect(readLoginStore().default).toBe(HOSTED)
    expect(fs.readFileSync(credentialsPath(), 'utf8')).toBe(legacy)
  })

  it('keeps the old login when a second server is added', () => {
    fs.mkdirSync(process.env.LUMO_CONFIG_DIR as string, { recursive: true })
    fs.writeFileSync(credentialsPath(), JSON.stringify(login(HOSTED, 'hosted')))
    saveLogin(login(LOCAL, 'local'), { bindCwd: repoA })
    expect(readCredentials(repoB)?.token).toBe(tok('hosted'))
    expect(readCredentials(repoA)?.token).toBe(tok('local'))
  })
})

describe('resolveLogin', () => {
  it('uses the repository binding, else the default', () => {
    twoLogins()
    expect(resolveLogin(repoA)).toMatchObject({ source: 'repo', repo: repoA })
    expect(readCredentials(repoA)?.apiUrl).toBe(LOCAL)
    expect(readCredentials(path.join(repoA, '.'))?.apiUrl).toBe(LOCAL)
    expect(resolveLogin(repoB)).toMatchObject({ source: 'default' })
    expect(readCredentials(tmp)?.apiUrl).toBe(HOSTED)
  })

  it('LUMO_API_URL picks the matching login (its own token)', () => {
    twoLogins()
    process.env.LUMO_API_URL = 'http://localhost:3000'
    expect(resolveLogin(repoB)).toMatchObject({
      source: 'env',
      creds: { token: tok('local') },
    })
  })

  it('LUMO_API_URL with no matching login keeps the repo/default login', () => {
    twoLogins()
    process.env.LUMO_API_URL = 'https://staging.uselumo.ai'
    expect(readCredentials(repoA)?.apiUrl).toBe(LOCAL)
  })

  it('a binding to a server no longer logged in falls back to the default, with a note', () => {
    saveLogin(login(HOSTED, 'hosted'))
    const store = readLoginStore()
    store.repos[repoA] = 'https://gone.example.com'
    writeLoginStore(store)
    const onNote = jest.fn()
    expect(readCredentials(repoA, { onNote })?.apiUrl).toBe(HOSTED)
    expect(onNote).toHaveBeenCalledWith(
      expect.stringContaining('not logged in')
    )
  })

  it('no logins → null', () => {
    expect(readCredentials(repoA)).toBeNull()
  })
})

describe('saveLogin / removeLogin', () => {
  it('the first login becomes the default; later ones bind the repo they ran in', () => {
    expect(saveLogin(login(HOSTED, 'hosted'), { bindCwd: repoA })).toEqual({
      key: HOSTED,
      isDefault: true,
      boundRepo: null,
    })
    expect(saveLogin(login(LOCAL, 'local'), { bindCwd: repoA })).toEqual({
      key: LOCAL,
      isDefault: false,
      boundRepo: repoA,
    })
    expect(readLoginStore().repos).toEqual({ [repoA]: LOCAL })
  })

  it('a non-default login outside a repository binds nothing', () => {
    saveLogin(login(HOSTED, 'hosted'))
    expect(
      saveLogin(login(LOCAL, 'local'), { bindCwd: tmp }).boundRepo
    ).toBeNull()
    expect(readLoginStore().repos).toEqual({})
  })

  it('re-logging in to the default inside a bound repo drops its binding', () => {
    twoLogins()
    saveLogin(login(HOSTED, 'hosted2'), { bindCwd: repoA })
    expect(readCredentials(repoA)?.token).toBe(tok('hosted2'))
    expect(readLoginStore().repos).toEqual({})
  })

  it('removes only the targeted login and the bindings to it', () => {
    twoLogins()
    expect(removeLogin(LOCAL)?.removed.email).toBe('local@example.com')
    const store = readLoginStore()
    expect(Object.keys(store.logins)).toEqual([HOSTED])
    expect(store.repos).toEqual({})
    expect(readCredentials(repoA)?.apiUrl).toBe(HOSTED)
  })

  it('removing the default promotes the one login left; the last one deletes the file', () => {
    twoLogins()
    removeLogin(HOSTED)
    expect(readLoginStore().default).toBe(LOCAL)
    removeLogin(LOCAL)
    expect(fs.existsSync(credentialsPath())).toBe(false)
    expect(removeLogin(LOCAL)).toBeNull()
  })

  it('removing the default with several logins left promotes the first by URL', () => {
    twoLogins()
    saveLogin(login('https://lumo.example.com', 'third'))
    expect(removeLogin(HOSTED)?.newDefault).toBe(LOCAL)
    expect(readLoginStore().default).toBe(LOCAL)
    expect(readCredentials(repoB)?.apiUrl).toBe(LOCAL)
  })

  it('a non-default removal promotes nothing', () => {
    twoLogins()
    expect(removeLogin(LOCAL)?.newDefault).toBeNull()
    expect(readLoginStore().default).toBe(HOSTED)
  })

  it('writes through a temp file: a failed write leaves the old file intact', () => {
    saveLogin(login(HOSTED, 'hosted'))
    const before = fs.readFileSync(credentialsPath(), 'utf8')
    expect(fs.readdirSync(path.dirname(credentialsPath()))).toEqual([
      'credentials.json',
    ])
    // Block the temp path so the write fails before the rename.
    const blocker = `${credentialsPath()}.${process.pid}.tmp`
    fs.mkdirSync(blocker)
    expect(() => saveLogin(login(LOCAL, 'local'))).toThrow()
    expect(fs.readFileSync(credentialsPath(), 'utf8')).toBe(before)
    fs.rmdirSync(blocker)
  })

  it('writes the file 0600', () => {
    saveLogin(login(HOSTED, 'hosted'))
    expect(fs.statSync(credentialsPath()).mode & 0o777).toBe(0o600)
  })
})

describe('lumo auth use', () => {
  it('binds this repository to a logged-in server', async () => {
    twoLogins()
    cwd.mockReturnValue(repoB)
    await expect(authUse('http://localhost:3000/')).resolves.toBeUndefined()
    expect(readCredentials(repoB)?.apiUrl).toBe(LOCAL)
  })

  it('refuses a server the user never logged in to (exit 1, nothing written)', async () => {
    twoLogins()
    cwd.mockReturnValue(repoB)
    const before = fs.readFileSync(credentialsPath(), 'utf8')
    await expect(authUse('https://evil.example.com')).resolves.toBe(1)
    expect(fs.readFileSync(credentialsPath(), 'utf8')).toBe(before)
  })

  it('--default changes the default; --unbind drops the binding', async () => {
    twoLogins()
    cwd.mockReturnValue(tmp)
    await authUse(LOCAL, { default: true })
    expect(readCredentials(repoB)?.apiUrl).toBe(LOCAL)
    cwd.mockReturnValue(repoA)
    await authUse(HOSTED)
    expect(readCredentials(repoA)?.apiUrl).toBe(HOSTED)
    await authUse(undefined, { unbind: true })
    expect(readCredentials(repoA)?.apiUrl).toBe(LOCAL)
  })

  it('outside a repository without --default → exit 1', async () => {
    twoLogins()
    cwd.mockReturnValue(tmp)
    await expect(authUse(LOCAL)).resolves.toBe(1)
  })

  it('no URL and no --unbind → usage error 2', async () => {
    await expect(authUse(undefined)).resolves.toBe(2)
  })
})

describe('lumo auth logout', () => {
  it('without --url removes the login this repository uses, only that one', async () => {
    twoLogins()
    cwd.mockReturnValue(repoA)
    await authLogout()
    expect(Object.keys(readLoginStore().logins)).toEqual([HOSTED])
  })

  it('--url removes that server; removing the default names the new one', async () => {
    twoLogins()
    cwd.mockReturnValue(repoA)
    await authLogout({ url: HOSTED })
    expect(readCredentials(repoA)?.apiUrl).toBe(LOCAL)
    expect(log.mock.calls.flat().join('\n')).toContain(
      `Default login is now ${LOCAL}`
    )
  })

  it('--url of a server not logged in is a no-op', async () => {
    twoLogins()
    await expect(authLogout({ url: 'https://x.example.com' })).resolves.toBe(0)
    expect(Object.keys(readLoginStore().logins)).toHaveLength(2)
  })
})

describe('whoami with several logins', () => {
  it('lists every login and marks the one this repository uses', () => {
    twoLogins()
    const store = readLoginStore()
    const usedA = resolveLogin(repoA, store)!
    expect(formatWhoamiAll(store, usedA)).toEqual([
      '* local@example.com · workspace local · key lum_local · local · http://localhost:3000 (this repo)',
      '  hosted@example.com · workspace hosted · key lum_hosted (default)',
    ])
    const usedB = resolveLogin(repoB, store)!
    expect(formatWhoamiAll(store, usedB)).toEqual([
      '  local@example.com · workspace local · key lum_local · local · http://localhost:3000',
      '* hosted@example.com · workspace hosted · key lum_hosted (default)',
    ])
  })

  it('marks a repo-bound login "this repo" and --full names the binding', () => {
    twoLogins()
    const store = readLoginStore()
    const used = resolveLogin(repoA, store)!
    const lines = formatWhoamiAll(store, used, { full: true })
    expect(lines.join('\n')).toContain(
      '* Logged in as local@example.com (this repo)'
    )
    expect(lines[lines.length - 1]).toBe(`This repository: ${repoA} → ${LOCAL}`)
  })

  it('a single login prints exactly as before', () => {
    saveLogin(login(HOSTED, 'hosted'))
    const store = readLoginStore()
    expect(formatWhoamiAll(store, resolveLogin(repoA, store)!)).toEqual([
      'hosted@example.com · workspace hosted · key lum_hosted',
    ])
  })

  it('--json keeps the used login at the top level and lists every login, never a token', () => {
    twoLogins()
    const store = readLoginStore()
    const [line] = formatWhoamiAll(store, resolveLogin(repoA, store)!, {
      json: true,
    })
    const out = JSON.parse(line as string)
    expect(out.apiUrl).toBe(LOCAL)
    expect(
      out.logins.map(
        (l: { apiUrl: string; used: boolean; default: boolean }) => [
          l.apiUrl,
          l.used,
          l.default,
        ]
      )
    ).toEqual([
      [LOCAL, true, false],
      [HOSTED, false, true],
    ])
    expect(line).not.toContain('fixture-')
  })
})

describe('hooks follow the repository the event came from', () => {
  const ok = () => new Response('{}', { status: 200 })

  it('posts a bound repo’s events to the local server with the local token, others to hosted', async () => {
    twoLogins()
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async () => ok())
    await runHookWithBody('user-prompt-submit', JSON.stringify({ cwd: repoA }))
    await runHookWithBody('user-prompt-submit', JSON.stringify({ cwd: repoB }))
    const sent = fetchSpy.mock.calls.map(([url, init]) => [
      String(url),
      (init?.headers as Record<string, string>).Authorization,
    ])
    expect(sent).toEqual([
      [`${LOCAL}/api/hooks/user-prompt-submit`, `Bearer ${tok('local')}`],
      [`${HOSTED}/api/hooks/user-prompt-submit`, `Bearer ${tok('hosted')}`],
    ])
    fetchSpy.mockRestore()
  })

  it('an unknown binding falls back to the default and logs to hook.log (never throws)', async () => {
    saveLogin(login(HOSTED, 'hosted'))
    const store = readLoginStore()
    store.repos[repoA] = 'https://gone.example.com'
    writeLoginStore(store)
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async () => ok())
    await expect(
      runHookWithBody('user-prompt-submit', JSON.stringify({ cwd: repoA }))
    ).resolves.toBeUndefined()
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      `${HOSTED}/api/hooks/user-prompt-submit`
    )
    expect(logHookError).toHaveBeenCalledWith(
      '[user-prompt-submit]',
      expect.stringContaining('not logged in')
    )
    fetchSpy.mockRestore()
  })
})
