/**
 * @jest-environment node
 *
 * LUM-1325, LUM-1332, LUM-1335 — scripts/self-host/setup.sh, run for real with /bin/sh
 * against a copy of the repo's .env.example in a temp directory. `run` adds
 * --no-start (only .env); `runWithDocker` puts a fake `docker` on PATH that
 * logs its arguments.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REPO = join(__dirname, '..', '..')
const BASE_SECRETS = [
  'BETTER_AUTH_SECRET',
  'CRON_SECRET',
  'WORKFLOW_SECRET',
  'POSTGRES_PASSWORD',
]
const SECRETS = [...BASE_SECRETS, 'SOKETI_APP_SECRET']
const REALTIME_FILES =
  'docker-compose.yml:deploy/self-host/compose.realtime.yml'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lumo-setup-'))
  mkdirSync(join(dir, 'scripts', 'self-host'), { recursive: true })
  copyFileSync(
    join(REPO, 'scripts', 'self-host', 'setup.sh'),
    join(dir, 'scripts', 'self-host', 'setup.sh')
  )
  copyFileSync(
    join(REPO, 'scripts', 'self-host', 'check-config.mjs'),
    join(dir, 'scripts', 'self-host', 'check-config.mjs')
  )
  copyFileSync(join(REPO, '.env.example'), join(dir, '.env.example'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function run(...args: string[]): string {
  return execFileSync(
    'sh',
    [join(dir, 'scripts', 'self-host', 'setup.sh'), '--no-start', ...args],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )
}

/**
 * setup.sh with a fake `docker` first on PATH: it appends each call's
 * arguments to docker.log and exits with $FAKE_EXEC_EXIT for `compose exec`.
 */
function runWithDocker(
  args: string[],
  execExit = 0
): { status: number | null; out: string; calls: string[] } {
  const bin = join(dir, 'fake-bin')
  mkdirSync(bin, { recursive: true })
  const log = join(dir, 'docker.log')
  writeFileSync(
    join(bin, 'docker'),
    [
      '#!/bin/sh',
      `echo "$*" >> '${log}'`,
      'case "$*" in *"compose exec"*) cat > /dev/null; exit "$FAKE_EXEC_EXIT" ;; esac',
      'exit 0',
      '',
    ].join('\n'),
    { mode: 0o755 }
  )
  const res = spawnSync(
    'sh',
    [join(dir, 'scripts', 'self-host', 'setup.sh'), ...args],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        FAKE_EXEC_EXIT: String(execExit),
      },
    }
  )
  let calls: string[] = []
  try {
    calls = readFileSync(log, 'utf8').trim().split('\n')
  } catch {
    // docker never ran
  }
  return { status: res.status, out: `${res.stdout}${res.stderr}`, calls }
}

function appendEnv(text: string): void {
  writeFileSync(
    join(dir, '.env'),
    `${readFileSync(join(dir, '.env'), 'utf8')}\n${text}\n`
  )
}

function env(): Map<string, string> {
  const vars = new Map<string, string>()
  for (const line of readFileSync(join(dir, '.env'), 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line)
    if (m?.[1] !== undefined) vars.set(m[1], (m[2] ?? '').replace(/^"|"$/g, ''))
  }
  return vars
}

function countLines(key: string): number {
  return readFileSync(join(dir, '.env'), 'utf8')
    .split('\n')
    .filter(l => l.startsWith(`${key}=`)).length
}

describe('scripts/self-host/setup.sh', () => {
  it('a fresh .env gets the base secrets and no overlay', () => {
    const out = run()
    const vars = env()
    for (const name of BASE_SECRETS) {
      expect(vars.get(name)).toMatch(/^[0-9a-f]{64}$/)
      expect(countLines(name)).toBe(1)
    }
    expect(new Set(BASE_SECRETS.map(n => vars.get(n))).size).toBe(
      BASE_SECRETS.length
    )
    expect(vars.get('SOKETI_APP_SECRET') ?? '').toBe('')
    // No COMPOSE_FILE: docker compose then reads docker-compose.yml alone.
    expect(vars.has('COMPOSE_FILE')).toBe(false)
    expect(out).toContain('Created .env from .env.example')
    expect(out).toContain('Realtime: off')
    expect(out).toContain('no email configured')
  })

  it('--realtime adds the overlay and its secret; a later run keeps it', () => {
    run('--realtime')
    let vars = env()
    expect(vars.get('COMPOSE_FILE')).toBe(REALTIME_FILES)
    expect(vars.get('SOKETI_APP_SECRET')).toMatch(/^[0-9a-f]{64}$/)
    // Pointed at the default URL once.
    expect(vars.get('SOKETI_PUBLIC_HOST')).toBe('localhost')
    expect(vars.get('SOKETI_PUBLIC_PORT')).toBe('6001')
    expect(run()).toContain('Realtime: on')
    vars = env()
    expect(vars.get('COMPOSE_FILE')).toBe(REALTIME_FILES)
    expect(countLines('COMPOSE_FILE')).toBe(1)
  })

  it('--realtime / --no-realtime keep COMPOSE_FILE entries the operator added', () => {
    run()
    appendEnv('COMPOSE_FILE=docker-compose.yml:compose.override.local.yml')
    run('--realtime')
    expect(env().get('COMPOSE_FILE')).toBe(
      'docker-compose.yml:compose.override.local.yml:deploy/self-host/compose.realtime.yml'
    )
    run('--no-realtime')
    expect(env().get('COMPOSE_FILE')).toBe(
      'docker-compose.yml:compose.override.local.yml'
    )
  })

  it('an unknown argument or a bad --url on a fresh checkout writes nothing', () => {
    expect(() => run('--with', 'all')).toThrow()
    expect(() => run('--realtime', '--url', 'lumo.example.com')).toThrow()
    expect(() => statSync(join(dir, '.env'))).toThrow()
  })

  it('creates .env readable by its owner only, and keeps that mode on re-runs', () => {
    run()
    expect(statSync(join(dir, '.env')).mode & 0o777).toBe(0o600)
    run('--url', 'https://lumo.example.com')
    expect(statSync(join(dir, '.env')).mode & 0o777).toBe(0o600)
  })

  it('never overwrites a secret that already has a value', () => {
    run('--realtime')
    const first = env()
    // Generated per run, quoted the way an operator might write it; env()
    // and setup.sh both read the value without the quotes.
    const operatorValue = randomBytes(24).toString('hex')
    writeFileSync(
      join(dir, '.env'),
      readFileSync(join(dir, '.env'), 'utf8').replace(
        /^(BETTER_AUTH_SECRET)=.*$/m,
        (_line, key: string) => `${key}="${operatorValue}"`
      )
    )
    const out = run('--url', 'https://lumo.example.com')
    const second = env()
    expect(second.get('BETTER_AUTH_SECRET')).toBe(operatorValue)
    for (const name of SECRETS.filter(n => n !== 'BETTER_AUTH_SECRET')) {
      expect(second.get(name)).toBe(first.get(name))
      expect(countLines(name)).toBe(1)
    }
    expect(out).not.toContain('Created .env')
    expect(out).toContain('Kept existing BETTER_AUTH_SECRET')
  })

  it('--url sets one URL; compose derives the others', () => {
    run('--url', 'https://lumo.example.com/')
    const vars = env()
    expect(vars.get('NEXT_PUBLIC_APP_URL')).toBe('https://lumo.example.com')
    expect(vars.has('LUMO_PUBLIC_URL')).toBe(false)
    expect(vars.has('BETTER_AUTH_URL')).toBe(false)
    expect(vars.get('LUMO_DOMAIN')).toBe('lumo.example.com')
    // No realtime overlay, no realtime settings.
    expect(vars.has('SOKETI_PUBLIC_HOST')).toBe(false)
    expect(countLines('NEXT_PUBLIC_APP_URL')).toBe(1)
  })

  it('with realtime, --url https points the realtime origin at the domain', () => {
    run('--realtime', '--url', 'https://lumo.example.com')
    const vars = env()
    expect(vars.get('SOKETI_PUBLIC_HOST')).toBe('lumo.example.com')
    expect(vars.get('SOKETI_PUBLIC_PORT')).toBe('443')
    expect(vars.get('SOKETI_PUBLIC_TLS')).toBe('true')
  })

  it('turning realtime on later derives its settings from the URL already in .env', () => {
    run('--url', 'https://lumo.example.com:8443')
    run('--realtime')
    const vars = env()
    expect(vars.get('SOKETI_PUBLIC_HOST')).toBe('lumo.example.com')
    expect(vars.get('SOKETI_PUBLIC_PORT')).toBe('8443')
    expect(vars.get('SOKETI_PUBLIC_TLS')).toBe('true')
  })

  it('with realtime, --url http keeps realtime on port 6001 without TLS', () => {
    run('--realtime', '--url=http://192.168.1.20:3000')
    const vars = env()
    expect(vars.get('NEXT_PUBLIC_APP_URL')).toBe('http://192.168.1.20:3000')
    expect(vars.get('SOKETI_PUBLIC_HOST')).toBe('192.168.1.20')
    expect(vars.get('SOKETI_PUBLIC_PORT')).toBe('6001')
    expect(vars.get('SOKETI_PUBLIC_TLS')).toBe('false')
    expect(vars.has('LUMO_DOMAIN')).toBe(false)
  })

  it('switching from https to http clears the caddy domain', () => {
    run('--url', 'https://lumo.example.com')
    run('--url', 'http://192.168.1.20:3000')
    expect(env().get('LUMO_DOMAIN')).toBe('')
  })

  it('parses userinfo and IPv6 hosts', () => {
    run('--realtime', '--url', 'https://admin@[2001:db8::1]:8443')
    let vars = env()
    expect(vars.get('SOKETI_PUBLIC_HOST')).toBe('[2001:db8::1]')
    expect(vars.get('SOKETI_PUBLIC_PORT')).toBe('8443')
    run('--url', 'http://[::1]:3000')
    vars = env()
    expect(vars.get('SOKETI_PUBLIC_HOST')).toBe('[::1]')
    expect(vars.get('SOKETI_PUBLIC_PORT')).toBe('6001')
  })

  it('a later --url replaces the earlier one in place', () => {
    run('--realtime', '--url', 'https://old.example.com')
    run('--url', 'https://new.example.com')
    expect(env().get('NEXT_PUBLIC_APP_URL')).toBe('https://new.example.com')
    expect(countLines('LUMO_DOMAIN')).toBe(1)
    expect(countLines('SOKETI_PUBLIC_HOST')).toBe(1)
    expect(countLines('COMPOSE_FILE')).toBe(1)
  })

  it('rejects a URL without a scheme and leaves .env URL untouched', () => {
    run()
    expect(() => run('--url', 'lumo.example.com')).toThrow()
    expect(env().get('NEXT_PUBLIC_APP_URL')).toBe('http://localhost:3000')
  })

  it('--help prints the options and the docs link, exits 0 and writes nothing', () => {
    const out = run('--help')
    for (const flag of ['--url', '--realtime', '--no-realtime']) {
      expect(out).toContain(flag)
    }
    expect(out).toContain('docs/self-hosting/README.md')
    expect(run('-h')).toBe(out)
    expect(() => statSync(join(dir, '.env'))).toThrow()
  })

  it('by default starts the stack, waits for it, then runs the check in the app container', () => {
    const { status, out, calls } = runWithDocker([])
    expect(status).toBe(0)
    expect(calls).toEqual([
      'compose version',
      'compose up -d --remove-orphans --wait --wait-timeout 600',
      'compose exec -T app node --input-type=module - --report',
    ])
    expect(env().get('BETTER_AUTH_SECRET')).toMatch(/^[0-9a-f]{64}$/)
    expect(out).toContain('Lumo is running at http://localhost:3000')
  })

  it('a failing check makes setup.sh fail with the same exit code', () => {
    const { status, out } = runWithDocker([], 1)
    expect(status).toBe(1)
    expect(out).not.toContain('Lumo is running')
    // 3 = the image predates the check; passed through unchanged.
    expect(runWithDocker([], 3).status).toBe(3)
    expect(runWithDocker(['--check'], 3).status).toBe(3)
  })

  it('--check only re-runs the check and leaves .env alone', () => {
    run()
    const before = readFileSync(join(dir, '.env'), 'utf8')
    const { status, calls } = runWithDocker(['--check'])
    expect(status).toBe(0)
    expect(calls).toEqual([
      'compose version',
      'compose exec -T app node --input-type=module - --report',
    ])
    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe(before)
  })

  it('--check needs a .env and takes no other option', () => {
    expect(runWithDocker(['--check']).status).toBe(1)
    run()
    const res = runWithDocker(['--check', '--realtime'])
    expect(res.status).toBe(2)
    expect(res.calls).toEqual([])
  })

  it('--caddy / --no-caddy toggle only caddy in COMPOSE_PROFILES', () => {
    run('--url', 'https://lumo.example.com', '--caddy')
    expect(env().get('COMPOSE_PROFILES')).toBe('caddy')
    expect(run()).toContain('HTTPS via caddy: on')
    // The operator added a profile of their own.
    writeFileSync(
      join(dir, '.env'),
      readFileSync(join(dir, '.env'), 'utf8').replace(
        /^COMPOSE_PROFILES=.*$/m,
        'COMPOSE_PROFILES=mail,caddy'
      )
    )
    run('--no-caddy')
    expect(env().get('COMPOSE_PROFILES')).toBe('mail')
    run('--caddy')
    expect(env().get('COMPOSE_PROFILES')).toBe('mail,caddy')
    expect(countLines('COMPOSE_PROFILES')).toBe(1)
  })

  it('LUM-1335: --local / --no-local toggle LUMO_MODE; a later run keeps it', () => {
    expect(run()).toContain('Local mode (no sign-in): off')
    expect(env().get('LUMO_MODE')).toBeUndefined()
    expect(run('--local')).toContain('Local mode (no sign-in): on')
    expect(env().get('LUMO_MODE')).toBe('local')
    expect(run()).toContain('Local mode (no sign-in): on')
    run('--no-local')
    expect(env().get('LUMO_MODE')).toBe('')
    run('--local')
    expect(countLines('LUMO_MODE')).toBe(1)
  })

  it('LUM-1335: --local starts the stack and says no sign-in is needed', () => {
    const { status, out } = runWithDocker(['--local'])
    expect(status).toBe(0)
    expect(out).toContain('Lumo is running at http://localhost:3000')
    expect(out).toContain('no sign-in needed')
    expect(out).toContain('lumo auth login --url http://localhost:3000')
    expect(runWithDocker(['--check', '--local']).status).toBe(2)
  })

  it('warns when caddy is on without a domain', () => {
    expect(run('--caddy')).toContain('LUMO_DOMAIN is empty')
  })

  it('stays quiet about email once SMTP_URL is set', () => {
    run()
    appendEnv('SMTP_URL=smtp://mailpit:1025')
    expect(run()).not.toContain('no email configured')
  })
})
