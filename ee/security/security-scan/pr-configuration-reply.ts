/**
 * LUM-1153 — the reply to `@<app> configuration`: the effective review
 * settings for one PR and where each value came from. PURE.
 *
 * Generic by design: it walks whatever keys it is given — every entry of
 * the LUM-1146 effective config (`repoConfigService.effective()`), every
 * stored workspace switch, every effective layer — so a key added to the
 * `.lumo.yaml` field registry, to the workspace switches or to the layers
 * shows up here without touching this file. Values are rendered by type.
 *
 * Values from `.lumo.yaml` are the repository's own text: each one is
 * shown as an inert, length-capped code span (no mention pings, no markup,
 * no table breakouts).
 */

/** One resolved key of the repository config (LUM-1146's shape). */
export interface ConfigurationEntry {
  /** The YAML key that sets it. */
  key: string
  value: unknown
  /** `file` | `repository` | `default` (an unknown source prints as is). */
  source: string
}

export interface ConfigurationFileState {
  status: string
  sha: string | null
  problems: readonly string[]
  unknownKeys: readonly string[]
}

export interface PrConfigurationView {
  /** null = the repository config could not be read from GitHub. */
  repo: {
    config: Readonly<Record<string, ConfigurationEntry>>
    file: ConfigurationFileState
    /** The branch the file was read from (the PR's base). */
    ref: string | null
    /**
     * The PR's base could not be read, so this is the default branch's
     * config — what the next review applies only if the base matches it.
     */
    fromDefaultBranch?: boolean
  } | null
  /** The workspace's stored switches (name → value). */
  switches: Readonly<Record<string, unknown>>
  /** The switches' defaults, to tell a changed value from an untouched one. */
  switchDefaults: Readonly<Record<string, unknown>>
  /** What runs after the platform ceiling (name → on/off). */
  layers: Readonly<Record<string, boolean>>
}

/** Items shown per list value; the rest are counted. */
export const CONFIG_REPLY_MAX_ITEMS = 20
/** Characters shown per scalar / list item. */
export const CONFIG_REPLY_MAX_CHARS = 80

const FILE = '`.lumo.yaml`'

const SOURCE_LABELS: Record<string, string> = {
  file: FILE,
  repository: 'repository settings',
  default: 'default',
}

/** One value as an inert code span: no backticks, controls, pipes or newlines. */
function code(raw: string): string {
  const s = raw
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/`/g, "'")
    .replace(/\|/g, '\\|')
  const cut =
    s.length > CONFIG_REPLY_MAX_CHARS
      ? `${s.slice(0, CONFIG_REPLY_MAX_CHARS)}…`
      : s
  return `\`${cut.length > 0 ? cut : ' '}\``
}

/** PURE — any config value as one table cell. */
export function formatConfigValue(value: unknown): string {
  if (value === null || value === undefined) return '_(none)_'
  if (typeof value === 'boolean') return value ? 'on' : 'off'
  if (typeof value === 'number' || typeof value === 'bigint')
    return code(String(value))
  if (typeof value === 'string') return code(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return '_(none)_'
    const shown = value
      .slice(0, CONFIG_REPLY_MAX_ITEMS)
      .map(v => (typeof v === 'string' ? code(v) : formatConfigValue(v)))
    const more = value.length - shown.length
    return more > 0 ? `${shown.join(', ')} +${more} more` : shown.join(', ')
  }
  return code(JSON.stringify(value) ?? '')
}

/** `securityAiReviewEnabled` → `aiReviewEnabled` (the column's own name otherwise). */
function switchName(column: string): string {
  const m = /^security([A-Z])(.*)$/.exec(column)
  return m ? `${m[1]!.toLowerCase()}${m[2]}` : column
}

/** `managedScan` → `managed scan`. */
function layerName(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function short(sha: string | null): string {
  return sha ? ` at \`${sha.slice(0, 7)}\`` : ''
}

function fileLine(file: ConfigurationFileState, ref: string | null): string[] {
  const where = `${ref ? ` on \`${ref.replace(/`/g, "'")}\`` : ''}${short(file.sha)}`
  const lines: string[] = []
  switch (file.status) {
    case 'loaded':
      lines.push(`${FILE}${where}: applied.`)
      break
    case 'absent':
      lines.push(`No ${FILE}${where} — Lumo's repository settings apply.`)
      break
    case 'invalid':
      lines.push(
        `${FILE}${where} is invalid, so it is **not applied** — Lumo's repository settings apply:`
      )
      for (const p of file.problems) lines.push(`- ${code(p)}`)
      break
    case 'unreadable':
      lines.push(
        `${FILE}${where} could not be read — Lumo's repository settings apply.`
      )
      break
    default:
      lines.push(`${FILE}${where}: ${code(file.status)}.`)
  }
  if (file.unknownKeys.length > 0)
    lines.push(
      `Unknown keys (ignored): ${file.unknownKeys.map(k => code(k)).join(', ')}`
    )
  return lines
}

function table(header: [string, string, string], rows: string[][]): string {
  return [
    `| ${header.join(' | ')} |`,
    '| --- | --- | --- |',
    ...rows.map(r => `| ${r.join(' | ')} |`),
  ].join('\n')
}

/** PURE — the reply body (without its marker). */
export function buildConfigurationReply(view: PrConfigurationView): string {
  const parts: string[] = ['⚙️ **Effective review configuration for this PR**']

  parts.push('**Repository**')
  if (view.repo) {
    if (view.repo.fromDefaultBranch)
      parts.push(
        "⚠️ Lumo couldn't read this PR's base branch, so this is the repository's **default branch** config; a review applies the file on the PR's base."
      )
    parts.push(fileLine(view.repo.file, view.repo.ref).join('\n'))
    const rows = Object.values(view.repo.config).map(e => [
      code(e.key),
      formatConfigValue(e.value),
      SOURCE_LABELS[e.source] ?? code(e.source),
    ])
    if (rows.length > 0) parts.push(table(['Key', 'Value', 'Source'], rows))
    parts.push(
      `Precedence: ${FILE} on the PR's base branch > repository settings in Lumo > default. A ${FILE} change made in this PR applies once it is merged.`
    )
  } else {
    parts.push(
      "⚠️ Lumo couldn't read this repository's review configuration from GitHub — try again later."
    )
  }

  const switchRows = Object.entries(view.switches).map(([name, value]) => [
    code(switchName(name)),
    formatConfigValue(value),
    name in view.switchDefaults && sameValue(value, view.switchDefaults[name])
      ? 'default'
      : 'workspace setting',
  ])
  parts.push('**Workspace**')
  if (switchRows.length > 0)
    parts.push(table(['Setting', 'Value', 'Source'], switchRows))
  const layers = Object.entries(view.layers).map(
    ([name, on]) => `${layerName(name)}: ${on ? 'on' : 'off'}`
  )
  if (layers.length > 0)
    parts.push(`Running on this deployment: ${layers.join(' · ')}`)
  parts.push(
    'A workspace owner changes these in Settings → Code review → Review behavior (or `lumo workspace security-scan update`; CLI 1.125 and older: `lumo workspace security-scan`). Findings that block DONE are cleared only by a disposition in Lumo, never by configuration.'
  )
  return parts.join('\n\n')
}
