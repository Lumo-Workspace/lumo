/**
 * @jest-environment node
 */
/**
 * LUM-1028: the docker compose stack, its images and `.env.example` must stay
 * consistent with each other and with deploy/self-host (LUM-1023). These are
 * text-level checks (no YAML parser is a direct dependency); the real stack is
 * exercised end to end by the LUM-1028 test cases.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { CRONTAB_PATH, RUNNER_PATH } from '../scripts/self-host-cron'
import { MIN_SECRET_LENGTH } from '../lib/auth/better-auth/config'

const ROOT = join(__dirname, '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

const compose = read('docker-compose.yml')
const dockerfile = read('Dockerfile')
const cronDockerfile = read('deploy/self-host/cron.Dockerfile')
const envExample = read('.env.example')
const runner = read('deploy/self-host/cron-run.sh')
const guide = read('docs/self-hosting/README.md')
const OVERLAYS = ['realtime'] as const
const overlays = Object.fromEntries(
  OVERLAYS.map(name => [name, read(`deploy/self-host/compose.${name}.yml`)])
) as Record<(typeof OVERLAYS)[number], string>

/** Top-level service names of a compose file. */
function serviceNames(text: string): string[] {
  const body = text.slice(text.indexOf('\nservices:\n'))
  const end = body.indexOf('\nvolumes:')
  return [
    ...(end < 0 ? body : body.slice(0, end)).matchAll(
      /^ {2}([a-z][a-z0-9-]*):$/gm
    ),
  ].map(m => m[1]!)
}

/** `KEY: value` entries under one service's `environment:` in an overlay. */
function overlayEnvironment(
  text: string,
  service: string
): Map<string, string> {
  const lines = text.split('\n')
  const start = lines.indexOf(`  ${service}:`)
  const env = new Map<string, string>()
  let inEnv = false
  for (const line of lines.slice(start + 1)) {
    if (/^ {0,2}\S/.test(line)) break
    if (/^ {4}\S/.test(line)) inEnv = line === '    environment:'
    const m = /^ {6}([A-Z][A-Z0-9_]*): (.*)$/.exec(line)
    if (inEnv && m) env.set(m[1]!, m[2]!.replace(/^'(.*)'$/, '$1'))
  }
  return env
}

/** The indented block of one top-level compose service. */
function serviceBlock(name: string): string {
  const lines = compose.split('\n')
  const start = lines.indexOf(`  ${name}:`)
  if (start < 0) throw new Error(`service ${name} not found`)
  const body: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^ {0,2}\S/.test(line)) break
    body.push(line)
  }
  return body.join('\n')
}

/** `KEY: value` entries of the shared app environment (x-app-env). */
function appEnvironment(): Map<string, string> {
  const start = compose.indexOf('x-app-env:')
  const end = compose.indexOf('\nservices:')
  const block = compose.slice(start, end)
  const env = new Map<string, string>()
  for (const m of block.matchAll(/^ {4}([A-Z][A-Z0-9_]*): (.*)$/gm)) {
    env.set(m[1]!, m[2]!.replace(/^'(.*)'$/, '$1'))
  }
  return env
}

/** The `x-app-build` block (image build args). */
function composeBuildArgs(): string {
  return compose.slice(
    compose.indexOf('x-app-build:'),
    compose.indexOf('x-app-env:')
  )
}

/** Names `.env.example` documents, as a set or commented assignment. */
function documentedEnvNames(): Set<string> {
  const names = new Set<string>()
  for (const m of envExample.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)) {
    names.add(m[1]!)
  }
  return names
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry))
      out.push(p)
  }
  return out
}

describe('self-host compose: scheduler', () => {
  it('the cron image installs crontab + runner where the crontab calls it', () => {
    const optDir = dirname(RUNNER_PATH)
    expect(CRONTAB_PATH).toMatch(/deploy\/self-host\/crontab$/)
    expect(cronDockerfile).toContain(`COPY crontab cron-run.sh ${optDir}/`)
    expect(cronDockerfile).toMatch(
      new RegExp(`CMD \\["/usr/bin/supercronic", "${optDir}/crontab"\\]`)
    )
    // cron-run.sh needs curl >= 7.76 (--fail-with-body).
    expect(cronDockerfile).toMatch(/apk add .*\bcurl\b/)
    expect(cronDockerfile).toMatch(/apk add .*\bsupercronic\b/)
  })

  it('the cron service builds from deploy/self-host and sets every variable cron-run.sh requires', () => {
    const cron = serviceBlock('cron')
    expect(cron).toMatch(
      /context: deploy\/self-host\n\s+dockerfile: cron\.Dockerfile/
    )
    const required = [...runner.matchAll(/\$\{([A-Z_]+):\?/g)].map(m => m[1]!)
    expect(required.sort()).toEqual(['APP_URL', 'CRON_SECRET'])
    for (const name of required) expect(cron).toMatch(new RegExp(`${name}: `))
    // The scheduler and the app must share one secret.
    expect(cron).toContain('CRON_SECRET: ${CRON_SECRET:?')
    expect(appEnvironment().get('CRON_SECRET')).toMatch(/^\$\{CRON_SECRET:\?/)
  })

  it('APP_URL reaches the app on the port next start listens on', () => {
    const port = appEnvironment().get('PORT')
    expect(port).toBe('3000')
    expect(serviceBlock('cron')).toContain(`APP_URL: http://app:${port}`)
  })
})

describe('self-host compose: app wiring', () => {
  const env = appEnvironment()

  it('the workflow worker delivers to the same port, carrying WORKFLOW_SECRET', () => {
    expect(env.get('WORKFLOW_TARGET_WORLD')).toBe('@workflow/world-postgres')
    expect(env.get('WORKFLOW_LOCAL_BASE_URL')).toBe(
      `http://workflow:\${WORKFLOW_SECRET}@localhost:${env.get('PORT')}`
    )
  })

  it('LUM-1032: pins the worker concurrency to the pg pool (world-postgres 5.x defaults to 50)', () => {
    expect(env.get('WORKFLOW_POSTGRES_WORKER_CONCURRENCY')).toBe('10')
  })

  it('every database URL disables TLS for the bundled Postgres (lib/db/prisma.ts forces verified TLS otherwise)', () => {
    for (const name of [
      'DATABASE_URL',
      'DATABASE_URL_UNPOOLED',
      'WORKFLOW_POSTGRES_URL',
    ]) {
      expect(env.get(name)).toMatch(/@postgres:5432\/lumo\?sslmode=disable$/)
    }
  })

  it('the app migrates, then bootstraps the World, then starts — no separate migrate service', () => {
    const cmd = dockerfile.match(/^CMD (.*)$/m)?.[1] ?? ''
    expect(cmd).toMatch(
      /npx prisma migrate deploy && npm run workflow:bootstrap && exec node node_modules\/next\/dist\/bin\/next start/
    )
    expect(serviceBlock('app')).toMatch(
      /postgres: \{ condition: service_healthy \}/
    )
    expect(serviceBlock('postgres')).toContain('pgvector/pgvector:pg16')
  })

  it('every app variable compose sets is documented in .env.example', () => {
    const documented = documentedEnvNames()
    const missing = [...env.keys()].filter(n => !documented.has(n))
    expect(missing).toEqual([])
  })

  it('every app variable an overlay sets is documented in .env.example', () => {
    const documented = documentedEnvNames()
    const set = OVERLAYS.flatMap(name => [
      ...overlayEnvironment(overlays[name], 'app').keys(),
    ])
    expect(set.length).toBeGreaterThan(0)
    expect(set.filter(n => !documented.has(n))).toEqual([])
  })

  it('every ${VAR} compose reads from .env is mentioned in .env.example', () => {
    const vars = new Set(
      [compose, ...Object.values(overlays)].flatMap(text =>
        [...text.matchAll(/\$\{([A-Z][A-Z0-9_]*)[:}-]/g)].map(m => m[1]!)
      )
    )
    const missing = [...vars].filter(
      v => !new RegExp(`\\b${v}\\b`).test(envExample)
    )
    expect(missing).toEqual([])
  })
})

describe('self-host compose: minimal base + optional overlays (LUM-1332)', () => {
  const env = appEnvironment()

  it('the base runs only Postgres, the app and cron (caddy / mailpit are profiles)', () => {
    expect(serviceNames(compose)).toEqual([
      'postgres',
      'app',
      'cron',
      'caddy',
      'mailpit',
    ])
    for (const name of [
      'REDIS_URL',
      'S3_BUCKET',
      'PUSHER_HOST',
      'NEXT_PUBLIC_PUSHER_HOST',
    ]) {
      expect(env.has(name)).toBe(false)
    }
  })

  it('the base stores files on the blob-data volume, in the directory the image owns', () => {
    expect(env.get('BLOB_STORAGE')).toBe('${BLOB_STORAGE:-disk}')
    expect(env.get('LOCAL_BLOB_DIR')).toBe('/var/lib/lumo/blobs')
    expect(serviceBlock('app')).toContain(
      'volumes: [blob-data:/var/lib/lumo/blobs]'
    )
    expect(dockerfile).toContain(
      'mkdir -p /var/lib/lumo/blobs && chown node:node /var/lib/lumo/blobs'
    )
  })

  it('links that leave the app default to the app URL, not the hosted service', () => {
    expect(env.get('LUMO_PUBLIC_URL')).toBe(
      '${LUMO_PUBLIC_URL:-${NEXT_PUBLIC_APP_URL:-http://localhost:3000}}'
    )
  })

  it('the realtime overlay adds Soketi and the app wiring for it', () => {
    expect(serviceNames(overlays.realtime)).toEqual(['soketi', 'app'])
    expect(
      overlayEnvironment(overlays.realtime, 'app').get('PUSHER_HOST')
    ).toBe('soketi')
  })

  it('own S3 / Redis come from .env: compose does not pin the storage backend', () => {
    expect(env.get('BLOB_STORAGE')).toBe('${BLOB_STORAGE:-disk}')
  })
})

describe('self-host image: NEXT_PUBLIC_* build args', () => {
  it('declares a build ARG for every NEXT_PUBLIC_* variable the app reads', () => {
    const used = new Set<string>()
    for (const dir of ['app', 'components', 'hooks', 'lib']) {
      for (const file of walk(join(ROOT, dir))) {
        for (const m of readFileSync(file, 'utf8').matchAll(
          /process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+)/g
        )) {
          used.add(m[1]!)
        }
      }
    }
    expect(used.size).toBeGreaterThan(0)
    const args = new Set(
      [...dockerfile.matchAll(/^ARG (NEXT_PUBLIC_[A-Z0-9_]+)/gm)].map(
        m => m[1]!
      )
    )
    expect([...used].filter(n => !args.has(n))).toEqual([])
  })

  it('compose passes the app URL and the browser-side Soketi settings as build args', () => {
    const build = composeBuildArgs()
    for (const name of [
      'NEXT_PUBLIC_APP_URL',
      'NEXT_PUBLIC_PUSHER_KEY',
      'NEXT_PUBLIC_PUSHER_HOST',
      'NEXT_PUBLIC_PUSHER_PORT',
      'NEXT_PUBLIC_PUSHER_USE_TLS',
    ]) {
      expect(build).toMatch(new RegExp(`\\n\\s+${name}: `))
    }
    // Server and browser must agree on the Soketi app key.
    expect(build).toContain('NEXT_PUBLIC_PUSHER_KEY: ${SOKETI_APP_KEY:-lumo}')
    const realtime = overlayEnvironment(overlays.realtime, 'app')
    expect(realtime.get('PUSHER_KEY')).toBe('${SOKETI_APP_KEY:-lumo}')
    expect(realtime.get('NEXT_PUBLIC_PUSHER_KEY')).toBe(
      '${SOKETI_APP_KEY:-lumo}'
    )
  })
})

describe('self-host auth: Better Auth, no Clerk account (LUM-1043)', () => {
  const env = appEnvironment()

  it('compose builds and runs with AUTH_PROVIDER=better-auth (static pages bake it in at build time)', () => {
    expect(composeBuildArgs()).toMatch(/\n\s+AUTH_PROVIDER: better-auth\n/)
    expect(env.get('AUTH_PROVIDER')).toBe('better-auth')
  })

  it('compose requires no CLERK_* / NEXT_PUBLIC_CLERK_* variable', () => {
    expect(compose).not.toMatch(/CLERK/)
  })

  it('BETTER_AUTH_SECRET is required; BETTER_AUTH_URL falls back to the app URL', () => {
    expect(env.get('BETTER_AUTH_SECRET')).toMatch(/^\$\{BETTER_AUTH_SECRET:\?/)
    expect(env.get('BETTER_AUTH_URL')).toBe(
      '${BETTER_AUTH_URL:-${NEXT_PUBLIC_APP_URL:-http://localhost:3000}}'
    )
  })

  it('the image defaults to better-auth at build AND runtime and accepts nothing else', () => {
    expect(dockerfile).toMatch(/^ARG AUTH_PROVIDER=better-auth$/m)
    const builder = dockerfile.slice(
      dockerfile.indexOf('AS builder'),
      dockerfile.indexOf('AS runner')
    )
    const runner = dockerfile.slice(dockerfile.indexOf('AS runner'))
    for (const stage of [builder, runner]) {
      expect(stage).toMatch(/^ARG AUTH_PROVIDER$/m)
      expect(stage).toMatch(/AUTH_PROVIDER=\$AUTH_PROVIDER\b/)
    }
    // LUM-1077: Clerk is gone — no Clerk build args, no clerk branch.
    expect(dockerfile).not.toMatch(/CLERK|clerk\)/)
    expect(builder).toMatch(/must be better-auth, got/)
  })

  it('the app refuses to start with a BETTER_AUTH_SECRET shorter than the library minimum', () => {
    const cmd = dockerfile.match(/^CMD (.*)$/m)?.[1] ?? ''
    expect(cmd).toContain(`\${#BETTER_AUTH_SECRET} -lt ${MIN_SECRET_LENGTH}`)
  })

  it('.env.example makes Better Auth the provider and has no Clerk variables', () => {
    const required = envExample.slice(0, envExample.indexOf('# 2. OPTIONAL'))
    expect(required).toMatch(/^AUTH_PROVIDER=better-auth$/m)
    expect(required).toMatch(/^BETTER_AUTH_SECRET=$/m)
    expect(envExample).not.toMatch(/CLERK[A-Z_]*=/)
  })

  it('the self-hosting guide no longer requires Clerk and documents the auth setup', () => {
    expect(guide).not.toMatch(/Clerk is required|A \*\*Clerk\*\* application/)
    for (const needle of [
      'BETTER_AUTH_SECRET',
      'openssl rand -hex 32',
      '/api/auth/callback/github',
      'AUTH_DISABLE_SIGNUP',
      'SMTP_URL=smtp://mailpit:1025',
      // MCP OAuth is served by the instance itself (LUM-1044).
      '<BETTER_AUTH_URL>/api/mcp',
      '/oauth/consent',
    ]) {
      expect(guide).toContain(needle)
    }
  })
})
