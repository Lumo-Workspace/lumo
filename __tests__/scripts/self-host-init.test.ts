/**
 * @jest-environment node
 *
 * LUM-1325 — scripts/self-host/init.sh, run for real with /bin/sh against a
 * copy of the repo's .env.example in a temp directory.
 */
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REPO = join(__dirname, '..', '..')
const SECRETS = [
  'BETTER_AUTH_SECRET',
  'CRON_SECRET',
  'WORKFLOW_SECRET',
  'POSTGRES_PASSWORD',
  'MINIO_ROOT_PASSWORD',
  'SOKETI_APP_SECRET',
]

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lumo-init-'))
  mkdirSync(join(dir, 'scripts', 'self-host'), { recursive: true })
  copyFileSync(
    join(REPO, 'scripts', 'self-host', 'init.sh'),
    join(dir, 'scripts', 'self-host', 'init.sh')
  )
  copyFileSync(join(REPO, '.env.example'), join(dir, '.env.example'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function run(...args: string[]): string {
  return execFileSync(
    'sh',
    [join(dir, 'scripts', 'self-host', 'init.sh'), ...args],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }
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

describe('scripts/self-host/init.sh', () => {
  it('creates .env and fills every required secret with 64 hex chars', () => {
    const out = run()
    const vars = env()
    for (const name of SECRETS) {
      expect(vars.get(name)).toMatch(/^[0-9a-f]{64}$/)
      expect(countLines(name)).toBe(1)
    }
    expect(new Set(SECRETS.map(n => vars.get(n))).size).toBe(SECRETS.length)
    expect(out).toContain('Created .env from .env.example')
    expect(out).toContain('no email configured')
  })

  it('never overwrites a secret that already has a value', () => {
    run()
    const first = env()
    writeFileSync(
      join(dir, '.env'),
      readFileSync(join(dir, '.env'), 'utf8').replace(
        /^BETTER_AUTH_SECRET=.*$/m,
        'BETTER_AUTH_SECRET="kept-by-the-operator-0123456789abcdef"'
      )
    )
    const out = run('--url', 'https://lumo.example.com')
    const second = env()
    expect(second.get('BETTER_AUTH_SECRET')).toBe(
      'kept-by-the-operator-0123456789abcdef'
    )
    for (const name of SECRETS.filter(n => n !== 'BETTER_AUTH_SECRET')) {
      expect(second.get(name)).toBe(first.get(name))
      expect(countLines(name)).toBe(1)
    }
    expect(out).not.toContain('Created .env')
    expect(out).toContain('Kept existing BETTER_AUTH_SECRET')
  })

  it('--url https points every URL and the realtime origin at the domain', () => {
    run('--url', 'https://lumo.example.com/')
    const vars = env()
    expect(vars.get('NEXT_PUBLIC_APP_URL')).toBe('https://lumo.example.com')
    expect(vars.get('LUMO_PUBLIC_URL')).toBe('https://lumo.example.com')
    expect(vars.get('BETTER_AUTH_URL')).toBe('https://lumo.example.com')
    expect(vars.get('LUMO_DOMAIN')).toBe('lumo.example.com')
    expect(vars.get('SOKETI_PUBLIC_HOST')).toBe('lumo.example.com')
    expect(vars.get('SOKETI_PUBLIC_PORT')).toBe('443')
    expect(vars.get('SOKETI_PUBLIC_TLS')).toBe('true')
    expect(countLines('NEXT_PUBLIC_APP_URL')).toBe(1)
  })

  it('--url http keeps realtime on port 6001 without TLS', () => {
    run('--url=http://192.168.1.20:3000')
    const vars = env()
    expect(vars.get('NEXT_PUBLIC_APP_URL')).toBe('http://192.168.1.20:3000')
    expect(vars.get('SOKETI_PUBLIC_HOST')).toBe('192.168.1.20')
    expect(vars.get('SOKETI_PUBLIC_PORT')).toBe('6001')
    expect(vars.get('SOKETI_PUBLIC_TLS')).toBe('false')
    expect(vars.has('LUMO_DOMAIN')).toBe(false)
  })

  it('a later --url replaces the earlier one in place', () => {
    run('--url', 'https://old.example.com')
    run('--url', 'https://new.example.com')
    expect(env().get('NEXT_PUBLIC_APP_URL')).toBe('https://new.example.com')
    expect(countLines('LUMO_DOMAIN')).toBe(1)
    expect(countLines('SOKETI_PUBLIC_HOST')).toBe(1)
  })

  it('rejects a URL without a scheme and leaves .env URL untouched', () => {
    run()
    expect(() => run('--url', 'lumo.example.com')).toThrow()
    expect(env().get('NEXT_PUBLIC_APP_URL')).toBe('http://localhost:3000')
  })

  it('stays quiet about email once SMTP_URL is set', () => {
    run()
    writeFileSync(
      join(dir, '.env'),
      `${readFileSync(join(dir, '.env'), 'utf8')}\nSMTP_URL=smtp://mailpit:1025\n`
    )
    expect(run()).not.toContain('no email configured')
  })
})
