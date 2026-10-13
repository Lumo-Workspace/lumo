/**
 * LUM-1114 report — reads an export (export.ts) and prints the false-positive
 * patterns, most human review first. Offline: no DB, no network.
 *
 *   npx tsx scripts/analysis/lum1114-crossing-fp-clusters/report.ts \
 *     --in /tmp/lum1114/crossings.json [--top 25] [--category INFRA_TERMINATION] [--json]
 */
import { readFile } from 'node:fs/promises'
import {
  clusterCrossings,
  formatClusters,
  type ExportedCrossing,
} from './cluster'

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main(): Promise<void> {
  const input = flag('--in')
  if (!input) throw new Error('--in <export.json> is required')
  const top = Number.parseInt(flag('--top') ?? '25', 10)
  if (!Number.isInteger(top) || top < 1)
    throw new Error('--top: positive integer')
  const category = flag('--category')

  const rows = JSON.parse(await readFile(input, 'utf8')) as ExportedCrossing[]
  const clusters = clusterCrossings(
    category ? rows.filter(r => r.category === category) : rows
  )
  process.stdout.write(
    process.argv.includes('--json')
      ? `${JSON.stringify(clusters, null, 2)}\n`
      : `${formatClusters(clusters, { top })}\n`
  )
}

main().catch(err => {
  process.stderr.write(`lum1114 report: ${(err as Error).message}\n`)
  process.exit(1)
})
