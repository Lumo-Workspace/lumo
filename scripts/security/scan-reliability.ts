/**
 * LUM-832 — print the scan reliability read-out (internal ops number).
 *
 *   npx tsx scripts/security/scan-reliability.ts [--since 2026-09-18] [--until 2026-09-25]
 *
 * Reads the database named by DATABASE_URL; read-only.
 */
import 'dotenv/config'
import { securityScanReliabilityService } from '@/ee/security/services/security-scan-reliability.service'
import { formatScanReliability } from '@/ee/security/security-scan/reliability'

export function parseReliabilityArgs(argv: string[]): {
  since?: Date
  until?: Date
} {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag)
    return i >= 0 ? (argv[i + 1] ?? null) : null
  }
  const parse = (flag: string): Date | undefined => {
    const raw = get(flag)
    if (raw === null) return undefined
    const date = new Date(raw)
    if (Number.isNaN(date.getTime())) throw new Error(`${flag}: not a date`)
    return date
  }
  const since = parse('--since')
  const until = parse('--until')
  return {
    ...(since ? { since } : {}),
    ...(until ? { until } : {}),
  }
}

async function main(): Promise<void> {
  const r = await securityScanReliabilityService.summarize(
    parseReliabilityArgs(process.argv.slice(2))
  )
  process.stdout.write(
    `window ${r.since} → ${r.until}\n${formatScanReliability(r)}\n`
  )
}

async function run(): Promise<void> {
  try {
    await main()
    process.exit(0)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`)
    process.exit(1)
  }
}

if (require.main === module) void run()
