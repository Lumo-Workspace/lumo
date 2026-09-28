/**
 * LUM-893 stock — READ-ONLY. Lists OPEN, blocking HARDCODED_SECRET crossings
 * detected since PR 1153 (LUM-887) deployed, grouped by workspace and task,
 * with what the LUM-893 detector would now record. Prints counts, rule ids and
 * file names only (a crossing detail never holds a secret value). findMany
 * only — no writes; any disposition is the user's call.
 *
 *   DOTENV_CONFIG_PATH="$(pwd)/.env.production" npx tsx -r dotenv/config \
 *     scripts/analysis/lum893-crossing-stock/count.ts [--since <iso>]
 */
import { classifyCrossingDetail } from './classify'

const DEFAULT_SINCE = '2026-09-28T09:10:00Z'

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const { prisma } = await import('@/lib/db/prisma')
  const since = new Date(flag('--since') ?? DEFAULT_SINCE)
  console.log(
    `[read-only] LUM-893 crossing stock since ${since.toISOString()} · db ${new URL(process.env.DATABASE_URL ?? 'postgres://unset').host}`
  )

  const rows = await prisma.boundaryCrossing.findMany({
    where: {
      category: 'HARDCODED_SECRET',
      disposition: null,
      advisory: false,
      OR: [{ detectedAt: { gte: since } }, { lastSeenAt: { gte: since } }],
    },
    select: {
      id: true,
      detail: true,
      severity: true,
      detectedAt: true,
      task: {
        select: {
          number: true,
          status: true,
          team: {
            select: {
              identifier: true,
              workspace: { select: { slug: true } },
            },
          },
        },
      },
    },
    orderBy: { detectedAt: 'asc' },
  })

  const byWorkspace = new Map<string, typeof rows>()
  for (const r of rows) {
    const ws = r.task?.team.workspace.slug ?? '(no task)'
    byWorkspace.set(ws, [...(byWorkspace.get(ws) ?? []), r])
  }

  let lum887 = 0
  let advisoryNow = 0
  for (const [ws, list] of byWorkspace) {
    console.log(`\n${ws}: ${list.length} open blocking crossing(s)`)
    for (const r of list) {
      const c = classifyCrossingDetail(r.detail)
      if (c.lum887) lum887++
      if (c.advisoryNow) advisoryNow++
      const task = r.task
        ? `${r.task.team.identifier}-${r.task.number} (${r.task.status})`
        : '-'
      console.log(
        `  ${r.id}  ${task}  ${r.severity}  rule=${c.ruleId ?? '?'}` +
          `  file=${c.file ?? '?'}  lum887=${c.lum887}  advisoryUnderLUM893=${c.advisoryNow}` +
          `  detected=${r.detectedAt.toISOString()}`
      )
    }
  }
  console.log(
    `\nTotal ${rows.length} · from LUM-887 rules ${lum887} · would be advisory under LUM-893 ${advisoryNow}`
  )
  await prisma.$disconnect()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
