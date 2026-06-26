import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'

interface CriteriaAuditReport {
  total: number
  classified: number
  byEffectiveKind: Record<string, number>
  selfConfirmingGreenRatio: number
}

const KIND_ORDER = [
  'EXTERNAL_FACT',
  'AGENT_CONSTRUCTED_STATE',
  'PENDING_OUTCOME',
  'UNVERIFIED_ASSERTION',
  'UNCLASSIFIED',
] as const

export function formatAuditReport(r: CriteriaAuditReport): string {
  const lines: string[] = ['Criteria referent-kind audit (workspace)', '']
  for (const k of KIND_ORDER) {
    const n = r.byEffectiveKind[k] ?? 0
    const pct = r.total === 0 ? 0 : Math.round((n / r.total) * 100)
    lines.push(`  ${k.padEnd(24)} ${String(n).padStart(4)}  (${pct}%)`)
  }
  lines.push('')
  const pct = Math.round(r.selfConfirmingGreenRatio * 100)
  lines.push(
    `  self-confirming green: ${pct}% of ${r.classified} classified criteria`
  )
  lines.push(
    `  (AGENT_CONSTRUCTED_STATE + UNVERIFIED_ASSERTION — green that confirms only the agent's own work)`
  )
  return lines.join('\n') + '\n'
}

/** `lumo criteria audit` — workspace-level referent-kind distribution. */
export async function criteriaAudit(): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }
  const base = trimTrailingSlash(resolveAuthedApiUrl(creds.apiUrl))
  let res: Response
  try {
    res = await fetch(`${base}/api/criteria/audit`, {
      headers: { Authorization: `Bearer ${creds.token}` },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API (${msg})`)
    return 1
  }
  if (!res.ok) {
    console.error(`Error: criteria audit failed (HTTP ${res.status})`)
    return 1
  }
  const report = (await res.json()) as CriteriaAuditReport
  process.stdout.write(formatAuditReport(report))
}
