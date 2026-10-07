/**
 * LUM-1023: self-hosted cron schedule, generated from vercel.json.
 *
 * On Vercel the `crons` block in vercel.json drives the scheduled routes; a
 * self-hosted deployment has no such scheduler. This script renders the same
 * list as a crontab (`deploy/self-host/crontab`, readable by supercronic and by
 * system cron) whose every line calls `deploy/self-host/cron-run.sh`, which
 * sends `Authorization: Bearer $CRON_SECRET` — the header `requireCronAuth`
 * (lib/api/cron-auth.ts) checks — and honours the `LUMO_CRON_DISABLED` skip list.
 *
 * vercel.json stays the single source (plus the few self-host-only routes in
 * SELF_HOST_ONLY_CRONS, LUM-1030); __tests__/self-host-cron.test.ts fails
 * when the checked-in crontab drifts from it.
 *
 * Usage:
 *   tsx scripts/self-host-cron.ts          # rewrite deploy/self-host/crontab
 *   tsx scripts/self-host-cron.ts --check  # exit 1 if the crontab is stale
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface CronJob {
  path: string
  schedule: string
}

const ROOT = join(__dirname, '..')
export const VERCEL_JSON_PATH = join(ROOT, 'vercel.json')
export const CRONTAB_PATH = join(ROOT, 'deploy', 'self-host', 'crontab')
/** Where the crontab expects the runner inside the scheduler container. */
export const RUNNER_PATH = '/opt/lumo/cron-run.sh'

const FIELD = /^[0-9*/,-]+$/

/**
 * LUM-1030: routes only a self-hosted deployment schedules — appended after
 * the vercel.json jobs. The Vercel World has no graphile-worker queue, so
 * `workflow-queue-cleanup` must not run (or be listed) on Vercel.
 */
export const SELF_HOST_ONLY_CRONS: CronJob[] = [
  { path: '/api/cron/workflow-queue-cleanup', schedule: '40 3 * * *' },
]

/** The self-hosted schedule: vercel.json's jobs, then the self-host-only ones. */
export function selfHostJobs(
  vercelJobs: CronJob[],
  extra: CronJob[] = SELF_HOST_ONLY_CRONS
): CronJob[] {
  const onVercel = new Set(vercelJobs.map(j => j.path))
  for (const job of extra) {
    if (onVercel.has(job.path)) {
      throw new Error(
        `self-host-only cron ${job.path} is also in vercel.json — list it in one place`
      )
    }
  }
  return [...vercelJobs, ...extra]
}

/** Read and validate the `crons` array of a parsed vercel.json. */
export function parseVercelCrons(vercelJson: unknown): CronJob[] {
  const crons = (vercelJson as { crons?: unknown } | null)?.crons
  if (!Array.isArray(crons)) {
    throw new Error('vercel.json has no `crons` array')
  }
  return crons.map((entry, i) => {
    const { path, schedule } = (entry ?? {}) as Record<string, unknown>
    if (typeof path !== 'string' || !/^\/api\/[a-z0-9/-]+$/.test(path)) {
      throw new Error(`crons[${i}].path is not an /api/ route: ${String(path)}`)
    }
    if (
      typeof schedule !== 'string' ||
      schedule.trim().split(/\s+/).length !== 5 ||
      !schedule
        .trim()
        .split(/\s+/)
        .every(f => FIELD.test(f))
    ) {
      throw new Error(
        `crons[${i}].schedule is not a 5-field cron expression: ${String(schedule)}`
      )
    }
    return { path, schedule: schedule.trim().split(/\s+/).join(' ') }
  })
}

/**
 * The name a job is disabled by: `/api/cron/<name>` → `<name>`, any other
 * route → its path after `/api/` with slashes as dashes
 * (`/api/summaries/generate` → `summaries-generate`).
 */
export function jobName(path: string): string {
  const cron = path.match(/^\/api\/cron\/([a-z0-9-]+)$/)
  if (cron?.[1]) return cron[1]
  return path.replace(/^\/api\//, '').replace(/\//g, '-')
}

/** Render the crontab text for the given jobs (vercel.json order). */
export function renderCrontab(jobs: CronJob[]): string {
  const names = new Set<string>()
  for (const job of jobs) {
    const name = jobName(job.path)
    if (names.has(name)) throw new Error(`duplicate cron job name: ${name}`)
    names.add(name)
  }
  const header = [
    '# GENERATED from vercel.json by `npx tsx scripts/self-host-cron.ts` — do not edit by hand.',
    '# Self-host-only jobs (SELF_HOST_ONLY_CRONS in that script) follow the vercel.json ones.',
    '# __tests__/self-host-cron.test.ts fails when this file drifts from vercel.json.',
    '#',
    '# Each job calls cron-run.sh, which sends `Authorization: Bearer $CRON_SECRET`',
    '# to $APP_URL<path>. Disable jobs with LUMO_CRON_DISABLED=<name>,<name>',
    '# (the name is the second-to-last field). See docs/self-hosting/cron.md.',
    '',
  ]
  const lines = jobs.map(
    job => `${job.schedule} ${RUNNER_PATH} ${jobName(job.path)} ${job.path}`
  )
  return [...header, ...lines].join('\n') + '\n'
}

function main(): void {
  const check = process.argv.includes('--check')
  const jobs = selfHostJobs(
    parseVercelCrons(JSON.parse(readFileSync(VERCEL_JSON_PATH, 'utf8')))
  )
  const next = renderCrontab(jobs)
  let current = ''
  try {
    current = readFileSync(CRONTAB_PATH, 'utf8')
  } catch {
    current = ''
  }
  if (current === next) {
    process.stdout.write(
      `✓ deploy/self-host/crontab is up to date (${jobs.length} jobs)\n`
    )
    return
  }
  if (check) {
    process.stderr.write(
      '✗ deploy/self-host/crontab is out of date. Run `npx tsx scripts/self-host-cron.ts`.\n'
    )
    process.exit(1)
  }
  writeFileSync(CRONTAB_PATH, next, 'utf8')
  process.stdout.write(`wrote deploy/self-host/crontab (${jobs.length} jobs)\n`)
}

// Run only when invoked as a script (not when imported by tests).
if (process.argv[1] && process.argv[1].endsWith('self-host-cron.ts')) {
  main()
}
