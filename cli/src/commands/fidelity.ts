import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'

/**
 * `lumo fidelity show <task>` — the LUM-610 mechanical change-pattern read-out
 * (fidelity axis, second block, on the LUM-609 delivery-snapshot foundation).
 *
 * Per delivery snapshot it discloses two compositions and NOTHING else — no
 * single score, no good/bad verdict (approach (a): purely mechanical):
 *   • grounding — how much of the FROZEN contract is externally grounded
 *     (EXTERNAL_FACT) vs self-confirming (agent-authored) vs inconclusive.
 *     `grounded` is a machine-checkable UPPER BOUND.
 *   • independence — criteria ADDED/UPDATED after work started (round>0) that
 *     the delivery rode on: backward-inference suspects. Direction left blank.
 */

const EFFECTIVE_KINDS = [
  'EXTERNAL_FACT',
  'AGENT_CONSTRUCTED_STATE',
  'UNVERIFIED_ASSERTION',
  'PENDING_OUTCOME',
  'UNCLASSIFIED',
] as const

type EffectiveKindDto = (typeof EFFECTIVE_KINDS)[number]

interface SuspectDto {
  criterionId: string
  op: 'ADDED' | 'UPDATED'
  round: number
  causeTag: string | null
  at: string
}

interface DeliveryDto {
  snapshotId: string
  frozenAt: string
  trigger: string
  sessionId: string | null
  total: number
  grounding: {
    grounded: number
    selfConfirming: number
    inconclusive: number
    byEffectiveKind: Record<EffectiveKindDto, number>
  }
  independence: {
    total: number
    postStartChanges: number
    suspects: SuspectDto[]
  }
}

interface FidelityReportDto {
  taskId: string
  workStartedAt: string | null
  hasSnapshots: boolean
  deliveries: DeliveryDto[]
  caveat: string
}

export interface FidelityShowOptions {
  json?: boolean
}

function authBase():
  | { base: string; headers: Record<string, string> }
  | { error: string } {
  const creds = readCredentials()
  if (!creds) return { error: 'not logged in. Run `lumo auth login` first.' }
  const base = trimTrailingSlash(resolveAuthedApiUrl(creds.apiUrl))
  const headers: Record<string, string> = {
    Authorization: `Bearer ${creds.token}`,
  }
  const sessionId = process.env.CLAUDE_CODE_SESSION_ID
  if (sessionId) headers['X-Lumo-Session-Id'] = sessionId
  return { base, headers }
}

function formatReport(report: FidelityReportDto, taskId: string): string {
  const lines: string[] = []
  lines.push(`Fidelity change-pattern — ${sanitizeField(taskId)}`)

  if (!report.hasSnapshots) {
    lines.push(
      '  No delivery snapshot on record (task never entered IN_REVIEW, or ' +
        'predates the LUM-609 freeze). Nothing to read yet — not a pass.'
    )
    lines.push('')
    lines.push(`  ${report.caveat}`)
    return lines.join('\n') + '\n'
  }

  report.deliveries.forEach((d, i) => {
    const when = d.frozenAt.slice(0, 19).replace('T', ' ')
    lines.push('')
    lines.push(
      `  Delivery ${i + 1}/${report.deliveries.length} · frozen ${when}Z · ${sanitizeField(d.trigger)} · ${d.total} criteria`
    )

    const g = d.grounding
    lines.push(
      `    grounding:    grounded ${g.grounded}  ·  self-confirming ${g.selfConfirming}  ·  inconclusive ${g.inconclusive}   (grounded = machine-checkable upper bound)`
    )
    const kinds = EFFECTIVE_KINDS.filter(k => g.byEffectiveKind[k] > 0)
      .map(k => `${k} ${g.byEffectiveKind[k]}`)
      .join(', ')
    lines.push(`      effective kinds: ${kinds || '(none)'}`)

    const ind = d.independence
    lines.push(
      `    independence: ${ind.postStartChanges}/${ind.total} criteria ADDED/UPDATED after work started (backward-inference suspects; direction not judged)`
    )
    for (const s of ind.suspects) {
      const cause = s.causeTag ? ` · ${sanitizeField(s.causeTag)}` : ''
      lines.push(
        `      ↳ ${sanitizeField(s.criterionId)}  ${s.op}@round${s.round}${cause}  (${s.at.slice(0, 10)})`
      )
    }
  })

  lines.push('')
  lines.push(`  ${report.caveat}`)
  return lines.join('\n') + '\n'
}

export async function fidelityShow(
  taskId: string | undefined,
  options: FidelityShowOptions = {}
): Promise<number | void> {
  if (!taskId || taskId.trim() === '') {
    console.error('Error: a task is required: lumo fidelity show <task>')
    return 1
  }
  const auth = authBase()
  if ('error' in auth) {
    console.error(`Error: ${auth.error}`)
    return 1
  }

  let res: Response
  try {
    res = await fetch(
      `${auth.base}/api/tasks/${encodeURIComponent(taskId)}/fidelity`,
      { headers: auth.headers }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API (${msg})`)
    return 1
  }
  if (res.status === 401) {
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }
  if (res.status === 404) {
    console.error(`Error: task ${sanitizeField(taskId)} not found.`)
    return 1
  }
  if (!res.ok) {
    console.error(
      `Error: could not read the fidelity change-pattern (HTTP ${res.status}).`
    )
    return 1
  }

  const report = (await res.json()) as FidelityReportDto
  if (options.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
    return
  }
  process.stdout.write(formatReport(report, taskId))
  return
}
