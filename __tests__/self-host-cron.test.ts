/**
 * @jest-environment node
 */
/**
 * LUM-1023: the self-hosted crontab is generated from vercel.json, and its
 * runner sends the header `requireCronAuth` accepts.
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'

import { NextRequest } from 'next/server'

import { requireCronAuth } from '@/lib/api/cron-auth'
import {
  CRONTAB_PATH,
  RUNNER_PATH,
  SELF_HOST_ONLY_CRONS,
  VERCEL_JSON_PATH,
  jobName,
  parseVercelCrons,
  renderCrontab,
  selfHostJobs,
} from '../scripts/self-host-cron'

const RUNNER = join(__dirname, '..', 'deploy', 'self-host', 'cron-run.sh')

describe('self-host crontab drift guard', () => {
  const vercelJobs = parseVercelCrons(
    JSON.parse(readFileSync(VERCEL_JSON_PATH, 'utf8'))
  )
  const crontab = readFileSync(CRONTAB_PATH, 'utf8')

  it('checked-in deploy/self-host/crontab equals the render of vercel.json', () => {
    // On failure: run `npx tsx scripts/self-host-cron.ts` and commit the result.
    expect(crontab).toBe(renderCrontab(selfHostJobs(vercelJobs)))
  })

  it('schedules every vercel.json cron (and each self-host-only one) exactly once with the same expression', () => {
    const lines = crontab
      .split('\n')
      .filter(l => l.trim() && !l.startsWith('#'))
    expect(lines).toHaveLength(vercelJobs.length + SELF_HOST_ONLY_CRONS.length)
    for (const job of [...vercelJobs, ...SELF_HOST_ONLY_CRONS]) {
      const matching = lines.filter(l => l.endsWith(` ${job.path}`))
      expect(matching).toEqual([
        `${job.schedule} ${RUNNER_PATH} ${jobName(job.path)} ${job.path}`,
      ])
    }
  })
})

describe('parseVercelCrons', () => {
  it('returns path + normalised schedule', () => {
    expect(
      parseVercelCrons({
        crons: [{ path: '/api/cron/purge-trash', schedule: ' 10  4 * * * ' }],
      })
    ).toEqual([{ path: '/api/cron/purge-trash', schedule: '10 4 * * *' }])
  })

  it('rejects a missing crons array', () => {
    expect(() => parseVercelCrons({})).toThrow(/no `crons` array/)
  })

  it('rejects a non-/api path (would be passed to the shell)', () => {
    expect(() =>
      parseVercelCrons({
        crons: [{ path: '/api/cron/x; rm -rf /', schedule: '* * * * *' }],
      })
    ).toThrow(/not an \/api\/ route/)
  })

  it('rejects a schedule that is not five cron fields', () => {
    expect(() =>
      parseVercelCrons({ crons: [{ path: '/api/cron/x', schedule: '@daily' }] })
    ).toThrow(/5-field/)
    expect(() =>
      parseVercelCrons({
        crons: [{ path: '/api/cron/x', schedule: '* * * *' }],
      })
    ).toThrow(/5-field/)
  })
})

describe('jobName', () => {
  it('uses the last segment for /api/cron routes', () => {
    expect(jobName('/api/cron/triage-crossings')).toBe('triage-crossings')
  })

  it('dash-joins other /api routes', () => {
    expect(jobName('/api/summaries/generate')).toBe('summaries-generate')
  })
})

describe('renderCrontab', () => {
  it('rejects two routes that map to the same job name', () => {
    expect(() =>
      renderCrontab([
        { path: '/api/cron/a', schedule: '* * * * *' },
        { path: '/api/cron/a', schedule: '0 * * * *' },
      ])
    ).toThrow(/duplicate cron job name: a/)
  })
})

describe('cron-run.sh against a real HTTP server', () => {
  let server: Server
  let baseUrl: string
  let received: { url: string | undefined; status: number }[]

  beforeAll(async () => {
    process.env.CRON_SECRET = 'test-cron-secret'
    server = createServer((req: IncomingMessage, res) => {
      // Gate the request with the real route helper, as the app would.
      const headers = new Headers()
      if (req.headers.authorization)
        headers.set('authorization', req.headers.authorization)
      const denied = requireCronAuth(
        new NextRequest(`http://localhost${req.url}`, { headers })
      )
      const status = denied ? 401 : 200
      received.push({ url: req.url, status })
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(denied ? { error: 'Unauthorized' } : { ok: true }))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    delete process.env.CRON_SECRET
    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  beforeEach(() => {
    received = []
  })

  function run(
    args: string[],
    env: Record<string, string>
  ): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise(resolve => {
      const child = spawn('sh', [RUNNER, ...args], {
        env: {
          NODE_ENV: 'test',
          PATH: process.env.PATH ?? '/usr/bin:/bin',
          ...env,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
      child.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
      child.on('close', (code: number | null) =>
        resolve({ code, stdout, stderr })
      )
    })
  }

  it('calls APP_URL<path> with a bearer header requireCronAuth accepts', async () => {
    const r = await run(['purge-trash', '/api/cron/purge-trash'], {
      APP_URL: `${baseUrl}/`,
      CRON_SECRET: 'test-cron-secret',
    })
    expect(r.code).toBe(0)
    expect(received).toEqual([{ url: '/api/cron/purge-trash', status: 200 }])
    expect(r.stdout).toContain('lumo-cron purge-trash: ok')
    expect(r.stdout + r.stderr).not.toContain('test-cron-secret')
  })

  it('exits non-zero when the app rejects the secret', async () => {
    const r = await run(['purge-trash', '/api/cron/purge-trash'], {
      APP_URL: baseUrl,
      CRON_SECRET: 'wrong',
    })
    expect(r.code).not.toBe(0)
    expect(received).toEqual([{ url: '/api/cron/purge-trash', status: 401 }])
    expect(r.stderr).toContain('FAILED')
  })

  it('skips a job listed in LUMO_CRON_DISABLED without calling the app', async () => {
    const r = await run(['triage-crossings', '/api/cron/triage-crossings'], {
      APP_URL: baseUrl,
      CRON_SECRET: 'test-cron-secret',
      LUMO_CRON_DISABLED: 'rejudge-crossings,\n\ttriage-crossings ',
    })
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('skipped')
    expect(received).toEqual([])
  })

  it('does not skip on a name that is only a substring of a disabled one', async () => {
    const r = await run(['crossings', '/api/cron/purge-trash'], {
      APP_URL: baseUrl,
      CRON_SECRET: 'test-cron-secret',
      LUMO_CRON_DISABLED: 'triage-crossings',
    })
    expect(r.code).toBe(0)
    expect(received).toHaveLength(1)
  })

  it('fails without calling the app when CRON_SECRET is unset', async () => {
    const r = await run(['purge-trash', '/api/cron/purge-trash'], {
      APP_URL: baseUrl,
    })
    expect(r.code).not.toBe(0)
    expect(r.stderr).toContain('CRON_SECRET is not set')
    expect(received).toEqual([])
  })
})

describe('selfHostJobs (LUM-1030)', () => {
  it('appends the self-host-only jobs after the vercel.json ones', () => {
    const vercel = [{ path: '/api/cron/purge-trash', schedule: '10 4 * * *' }]
    expect(selfHostJobs(vercel)).toEqual([...vercel, ...SELF_HOST_ONLY_CRONS])
  })

  it('keeps workflow-queue-cleanup out of vercel.json (the Vercel World has no queue to clean)', () => {
    const vercelPaths = parseVercelCrons(
      JSON.parse(readFileSync(VERCEL_JSON_PATH, 'utf8'))
    ).map(j => j.path)
    expect(SELF_HOST_ONLY_CRONS.map(j => j.path)).toContain(
      '/api/cron/workflow-queue-cleanup'
    )
    for (const job of SELF_HOST_ONLY_CRONS) {
      expect(vercelPaths).not.toContain(job.path)
    }
  })

  it('refuses a self-host-only job that is also in vercel.json', () => {
    const dup = { path: '/api/cron/x', schedule: '* * * * *' }
    expect(() => selfHostJobs([dup], [dup])).toThrow(/also in vercel.json/)
  })

  it('every self-host-only job has a route file gated by requireCronAuth', () => {
    for (const job of SELF_HOST_ONLY_CRONS) {
      const route = join(__dirname, '..', 'app', job.path, 'route.ts')
      expect(readFileSync(route, 'utf8')).toContain('requireCronAuth')
    }
  })
})
