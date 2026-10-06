# Scheduled jobs (cron) when self-hosting

On Vercel, the `crons` block in `vercel.json` calls Lumo's scheduled routes. A
self-hosted deployment has no Vercel scheduler, so something else has to call
them. This repo ships that schedule:

| File                           | What it is                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| `deploy/self-host/crontab`     | One line per job, generated from `vercel.json`. Works with supercronic or cron.           |
| `deploy/self-host/cron-run.sh` | Calls one route with `Authorization: Bearer $CRON_SECRET`. Needs `sh` and `curl` (7.76+). |

Each crontab line runs `/opt/lumo/cron-run.sh <job-name> <path>`, so put both
files under `/opt/lumo/` in whatever runs the schedule.

## Environment

Set these in the scheduler's environment:

| Variable             | Required | Meaning                                                                                         |
| -------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `CRON_SECRET`        | yes      | The same value the app has. Every cron route returns 401 when the app's `CRON_SECRET` is unset. |
| `APP_URL`            | yes      | Base URL the scheduler can reach the app on, e.g. `http://app:3000`.                            |
| `LUMO_CRON_DISABLED` | no       | Comma-separated job names to skip, e.g. `triage-crossings,rejudge-crossings`.                   |

Generate a secret with `openssl rand -hex 32` and give the app and the scheduler
the same value.

## Running with supercronic

[supercronic](https://github.com/aptible/supercronic) is a cron for containers:
it reads a crontab, passes the container's environment to every job, and logs
each job's output to stdout.

```bash
cp deploy/self-host/crontab deploy/self-host/cron-run.sh /opt/lumo/
CRON_SECRET=... APP_URL=http://app:3000 supercronic /opt/lumo/crontab
```

A successful call logs `lumo-cron <job-name>: ok` with the route's JSON
response; a non-2xx response logs `FAILED` and the job exits non-zero.

## Running with system cron

System cron does not pass your shell environment to jobs. Put the variables at
the top of the crontab (or in `/etc/environment`) before installing it:

```bash
sudo mkdir -p /opt/lumo && sudo cp deploy/self-host/cron-run.sh /opt/lumo/
{ echo "CRON_SECRET=..."; echo "APP_URL=http://localhost:3000"; cat deploy/self-host/crontab; } | crontab -
```

Times are in the scheduler's timezone. Vercel runs crons in UTC, so set
`TZ=UTC` on the scheduler to keep the same times.

## Turning jobs off

The job name is the second-to-last field of each crontab line (`purge-trash`,
`summaries-generate`, …). Either list it in `LUMO_CRON_DISABLED` or comment the
line out in your installed copy.

If you do not use PR security scanning (no GitHub App connected), these jobs
have nothing to do and can be disabled: `sweep-security-scans`,
`prune-security-sarif`, `sweep-unconfirmed-scan-code`,
`sweep-expired-scan-evidence`, `recheck-github-access`. Keep them if you do scan
PRs: the last three are what delete scanned code once it is no longer needed.

`triage-crossings` calls a model every 5 minutes for workspaces with AI review
on; disable it if you have no model provider configured.

## Changing the schedule

`vercel.json` is the source. After editing its `crons`, regenerate and commit
the crontab:

```bash
npx tsx scripts/self-host-cron.ts          # rewrite deploy/self-host/crontab
npx tsx scripts/self-host-cron.ts --check  # exit 1 if it is out of date
```

`__tests__/self-host-cron.test.ts` fails when the two disagree.
