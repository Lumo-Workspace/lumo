/**
 * LUM-949 — R-Judge data source: pinned upstream location, runtime download into
 * a local cache OUTSIDE the repository, and loading/validation of the records.
 *
 * Licensing: the upstream repository (github.com/Lordog/R-Judge) declares no
 * license, so the data is never committed here. It is fetched at run time into
 * `~/.cache/lumo-lum949-rjudge/<sha>/` (override with --data-dir) and read from
 * there. Pinned to one commit so every run scores the same records.
 */
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const RJUDGE_REPO = 'Lordog/R-Judge'
/** main @ 2025-05-15 — the commit every number in RESULTS.md was produced from. */
export const RJUDGE_SHA = '83ce301da3ad50dd8b397e772863f5411c3d3dc2'

/** Every data file in the pinned commit (`data/<Category>/<name>.json`). */
export const RJUDGE_FILES: readonly string[] = [
  'Application/chatbot',
  'Application/dh_app',
  'Application/ds_app',
  'Application/mail',
  'Application/medical',
  'Application/phone',
  'Application/productivity',
  'Application/socialapp',
  'Finance/bitcoin',
  'Finance/dh_finance',
  'Finance/ds_finance',
  'Finance/moneymanagement',
  'Finance/webshop',
  'IoT/household',
  'IoT/phone_iot',
  'IoT/trafficdispatch',
  'Program/code_agentmonitor',
  'Program/dh_program',
  'Program/ds_program',
  'Program/phone_program',
  'Program/security',
  'Program/software',
  'Program/terminal',
  'Web/dh_web',
  'Web/ds_web',
  'Web/webbrowser',
  'Web/websearch',
]

export function defaultDataDir(): string {
  return join(homedir(), '.cache', 'lumo-lum949-rjudge', RJUDGE_SHA)
}

export function rawUrl(file: string): string {
  return `https://raw.githubusercontent.com/${RJUDGE_REPO}/${RJUDGE_SHA}/data/${file}.json`
}

/** One turn message as it appears in the upstream JSON. */
export interface RJudgeMessage {
  role: string
  content?: unknown
  thought?: unknown
  action?: unknown
}

/** One upstream record, plus where it came from (`file` = `Category/name`). */
export interface RJudgeRecord {
  file: string
  /** Top-level upstream category (Program / Application / Finance / IoT / Web). */
  category: string
  id: number
  scenario: string
  label: 0 | 1
  riskDescription: string
  attackType: string
  contents: RJudgeMessage[][]
}

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * Validate one parsed upstream file into records. Pure. Rows that do not carry
 * the schema's required fields are dropped and counted, never guessed at.
 */
export function parseRecordFile(
  file: string,
  json: unknown
): { records: RJudgeRecord[]; invalid: number } {
  if (!Array.isArray(json)) return { records: [], invalid: 0 }
  const category = file.split('/')[0] ?? file
  const records: RJudgeRecord[] = []
  let invalid = 0
  for (const row of json) {
    if (
      !isObj(row) ||
      typeof row.id !== 'number' ||
      (row.label !== 0 && row.label !== 1) ||
      !Array.isArray(row.contents)
    ) {
      invalid++
      continue
    }
    records.push({
      file,
      category,
      id: row.id,
      scenario: typeof row.scenario === 'string' ? row.scenario : '',
      label: row.label,
      riskDescription:
        typeof row.risk_description === 'string' ? row.risk_description : '',
      attackType: typeof row.attack_type === 'string' ? row.attack_type : '',
      contents: row.contents.map(turn =>
        Array.isArray(turn)
          ? turn.filter(isObj).map(m => m as RJudgeMessage)
          : []
      ),
    })
  }
  return { records, invalid }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function localPath(dir: string, file: string): string {
  return join(dir, `${file}.json`)
}

/** Fetch every pinned file that is not cached yet. Network only here. */
export async function downloadAll(
  dir: string,
  log: (line: string) => void
): Promise<void> {
  for (const file of RJUDGE_FILES) {
    const target = localPath(dir, file)
    if (await exists(target)) continue
    const res = await fetch(rawUrl(file))
    if (!res.ok) throw new Error(`download ${file}: HTTP ${res.status}`)
    await mkdir(join(dir, file.split('/')[0] ?? ''), { recursive: true })
    await writeFile(target, await res.text())
    log(`downloaded ${file}`)
  }
}

/** Load every pinned file from the cache dir. Throws if one is missing. */
export async function loadAll(
  dir: string
): Promise<{ records: RJudgeRecord[]; invalid: number }> {
  const records: RJudgeRecord[] = []
  let invalid = 0
  for (const file of RJUDGE_FILES) {
    const target = localPath(dir, file)
    if (!(await exists(target))) {
      throw new Error(`${target} missing — run with --download first`)
    }
    const parsed = parseRecordFile(
      file,
      JSON.parse(await readFile(target, 'utf8'))
    )
    records.push(...parsed.records)
    invalid += parsed.invalid
  }
  return { records, invalid }
}
