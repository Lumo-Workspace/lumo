/**
 * LUM-1234 — TRACE data source (PatronusAI/trace-dataset, arXiv 2601.20103):
 * a gated Hugging Face dataset, fetched at run time into a local cache OUTSIDE
 * the repository and read from there.
 *
 * Licensing: CC-BY-SA-4.0 — share-alike would attach to anything derived from
 * the rows verbatim, so no row, excerpt or fixture copied from it is ever
 * committed. Access is gated: the user accepts the conditions on the dataset
 * page once, then `hf auth login` (or HF_TOKEN) makes it downloadable. Rows come
 * from the datasets-server JSON API (no parquet parser, no new dependency).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { DATASETS_SERVER, PAGE_SIZE } from '../lum948-basharena/download'

export const TRACE_DATASET = 'PatronusAI/trace-dataset'
export const TRACE_SPLIT = 'train'
export const TRACE_PAGE = `https://huggingface.co/datasets/${TRACE_DATASET}`

/** How to get access — named by every "can't read the data" error. */
export const TRACE_ACCESS_STEP = `accept the access conditions at ${TRACE_PAGE} with your HF account, then run \`hf auth login\` (or set HF_TOKEN; a fine-grained token also needs "read access to public gated repos")`

export function defaultTraceDir(): string {
  return join(homedir(), '.cache', 'lumo-lum1234-trace')
}

export function traceCacheFile(dir: string): string {
  return join(dir, 'trace-dataset__train.json')
}

/** HF_TOKEN, else the token `hf auth login` stored. Never logged. */
export async function hfToken(
  env: Record<string, string | undefined> = process.env
): Promise<string | null> {
  if (env['HF_TOKEN']?.trim()) return env['HF_TOKEN'].trim()
  const home = env['HF_HOME'] || join(homedir(), '.cache', 'huggingface')
  try {
    const t = (await readFile(join(home, 'token'), 'utf8')).trim()
    return t || null
  } catch {
    return null
  }
}

interface RowsPage {
  rows: Array<{ row: Record<string, unknown>; truncated_cells?: string[] }>
  num_rows_total: number
}

async function fetchPage(url: string, token: string): Promise<RowsPage> {
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) return (await res.json()) as RowsPage
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        throw Object.assign(
          new Error(
            `HTTP ${res.status} from the datasets server — no access to ${TRACE_DATASET}: ${TRACE_ACCESS_STEP}`
          ),
          { fatal: true }
        )
      }
      lastErr = new Error(`HTTP ${res.status} for ${url}`)
      if (res.status !== 429 && res.status < 500) break
    } catch (err) {
      if ((err as { fatal?: boolean }).fatal) throw err
      lastErr = err
    }
    if (attempt < 4) await new Promise(r => setTimeout(r, 1000 * 2 ** attempt))
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

/** Every row. Fails loudly if a cell came back truncated. */
export async function downloadTrace(
  token: string
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  let total = Infinity
  for (let offset = 0; offset < total; offset += PAGE_SIZE) {
    const q = new URLSearchParams({
      dataset: TRACE_DATASET,
      config: 'default',
      split: TRACE_SPLIT,
      offset: String(offset),
      length: String(PAGE_SIZE),
    })
    const page = await fetchPage(`${DATASETS_SERVER}/rows?${q}`, token)
    total = page.num_rows_total
    for (const r of page.rows) {
      if (r.truncated_cells?.length) {
        throw new Error(
          `${TRACE_DATASET}: truncated cells ${r.truncated_cells.join(',')} — the JSON API cannot serve this row whole`
        )
      }
      out.push(r.row)
    }
    if (page.rows.length === 0) break
  }
  if (out.length !== total) {
    throw new Error(`${TRACE_DATASET}: got ${out.length} of ${total} rows`)
  }
  return out
}

/** A `--data` value → the cache file: a `.json` path as is, else a dir. */
export function resolveTraceFile(data: string | undefined): string {
  if (data?.endsWith('.json')) return data
  return traceCacheFile(data ?? defaultTraceDir())
}

/** How to fill the cache from a parquet copy you already have access to. */
export function parquetHint(file: string): string {
  return `uv run --with pyarrow python -I scripts/analysis/lum1234-trace/parquet_to_json.py <train.parquet> ${file}`
}

/**
 * Cached rows. Offline unless `download`: a missing cache throws naming the
 * fetch command, the HF access step, and the parquet-copy alternative.
 */
export async function loadTraceRows(opts: {
  file: string
  download: boolean
  fetchCommand: string
  log?: (m: string) => void
}): Promise<Record<string, unknown>[]> {
  const { file } = opts
  try {
    const rows = JSON.parse(await readFile(file, 'utf8')) as unknown
    if (!Array.isArray(rows)) {
      throw new Error('not a JSON array of rows')
    }
    return rows as Record<string, unknown>[]
  } catch (err) {
    if (!opts.download) {
      const reason =
        (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? `missing cache ${file}`
          : `unreadable cache ${file} (${(err as Error).message})`
      throw new Error(
        `${reason} — fetch it with \`${opts.fetchCommand}\` (gated dataset: ${TRACE_ACCESS_STEP}); or, from a parquet copy you have access to: \`${parquetHint(file)}\``
      )
    }
  }
  const token = await hfToken()
  if (!token) {
    throw new Error(`no Hugging Face token found — ${TRACE_ACCESS_STEP}`)
  }
  opts.log?.(`downloading ${TRACE_DATASET} …`)
  const rows = await downloadTrace(token)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(rows))
  opts.log?.(`  ${rows.length} rows → ${file}`)
  return rows
}
