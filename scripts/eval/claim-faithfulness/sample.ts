import { prisma } from '@/lib/db/prisma'
import { resolveDelivery } from '@/lib/claim-faithfulness/diff-oracle'
import {
  mapTaskRowToInputs,
  TASK_INPUT_SELECT,
} from '@/lib/claim-faithfulness/task-inputs'

// Read-only sampler: prints (identifier, claim, diff summary) for the user to
// hand-label into fixture.ts. Includes the 5 named anchors plus a recent sample.
const ANCHORS = ['LUM-539', 'LUM-565', 'LUM-567', 'LUM-540', 'LUM-522']

const SELECT = TASK_INPUT_SELECT

async function main(argv: string[]): Promise<number> {
  const limit = Number(
    argv.find(a => a.startsWith('--limit='))?.split('=')[1] ?? 20
  )
  const rows = await prisma.task.findMany({
    where: {
      status: { in: ['DONE', 'IN_REVIEW'] },
      claimSnapshot: { not: null },
    },
    select: SELECT,
    orderBy: { claimSnapshotAt: 'desc' },
    take: limit,
  })
  const inputs = rows.map(mapTaskRowToInputs)

  // Ensure anchors are present even if outside the recent window.
  for (const a of ANCHORS) {
    if (inputs.some(i => i.identifier === a)) continue
    const [team, num] = a.split('-')
    const r = await prisma.task.findFirst({
      where: { team: { identifier: team }, number: Number(num) },
      select: SELECT,
    })
    if (r) inputs.push(mapTaskRowToInputs(r))
  }

  for (const i of inputs) {
    const d = resolveDelivery(i.identifier)
    process.stdout.write(
      JSON.stringify({
        identifier: i.identifier,
        anchor: ANCHORS.includes(i.identifier),
        claim: i.claim,
        prNumbers: d?.prNumbers ?? [],
        files: d?.changedFiles.length ?? 0,
        churn: d ? d.additions + d.deletions : 0,
        subjects: d?.commitSubjects ?? [],
      }) + '\n'
    )
  }
  await prisma.$disconnect()
  return 0
}

if (process.argv[1]?.endsWith('sample.ts')) {
  main(process.argv.slice(2))
    .then(c => process.exit(c))
    .catch(e => {
      process.stderr.write(`sample: ${(e as Error).message}\n`)
      process.exit(1)
    })
}
