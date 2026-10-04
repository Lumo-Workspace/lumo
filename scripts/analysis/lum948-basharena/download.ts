/**
 * LUM-948 — fetch the BashArena trajectory datasets into a LOCAL cache.
 *
 * Both third-party datasets carry no license, so they are never committed:
 * rows are pulled at run time from the Hugging Face datasets-server JSON API
 * (paged, 100 rows per call — no parquet parser, no new dependency) and cached
 * outside the repository (default `~/.cache/lumo-lum948-basharena`).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DATASETS_SERVER = 'https://datasets-server.huggingface.co'
export const PAGE_SIZE = 100

export const SOURCES = [
  { dataset: 'abhayesian/basharena-monitor-eval', split: 'train' },
  { dataset: 'mandliya/basharena-synthetic-trajectories', split: 'train' },
  { dataset: 'mandliya/basharena-synthetic-trajectories', split: 'test' },
] as const

export const DEFAULT_CACHE_DIR = join(
  homedir(),
  '.cache',
  'lumo-lum948-basharena'
)

export function rowsUrl(
  dataset: string,
  split: string,
  offset: number,
  length: number = PAGE_SIZE
): string {
  const q = new URLSearchParams({
    dataset,
    config: 'default',
    split,
    offset: String(offset),
    length: String(length),
  })
  return `${DATASETS_SERVER}/rows?${q.toString()}`
}

export function cacheFile(dir: string, dataset: string, split: string): string {
  return join(
    dir,
    `${dataset.replace(/[^A-Za-z0-9._-]+/g, '__')}__${split}.json`
  )
}

interface RowsPage {
  rows: Array<{ row: Record<string, unknown>; truncated_cells?: string[] }>
  num_rows_total: number
}

async function fetchPage(url: string): Promise<RowsPage> {
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url)
      if (res.ok) return (await res.json()) as RowsPage
      lastErr = new Error(`HTTP ${res.status} for ${url}`)
      if (res.status !== 429 && res.status < 500) break
    } catch (err) {
      lastErr = err
    }
    await new Promise(r => setTimeout(r, 1000 * 2 ** attempt))
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

/** Every row of one split. Fails loudly if a cell came back truncated. */
export async function downloadSplit(
  dataset: string,
  split: string
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  let total = Infinity
  for (let offset = 0; offset < total; offset += PAGE_SIZE) {
    const page = await fetchPage(rowsUrl(dataset, split, offset))
    total = page.num_rows_total
    for (const r of page.rows) {
      if (r.truncated_cells && r.truncated_cells.length > 0) {
        throw new Error(
          `${dataset}/${split}: truncated cells ${r.truncated_cells.join(',')} — the JSON API cannot serve this row whole`
        )
      }
      out.push(r.row)
    }
    if (page.rows.length === 0) break
  }
  if (out.length !== total) {
    throw new Error(`${dataset}/${split}: got ${out.length} of ${total} rows`)
  }
  return out
}

/** Cached rows, downloading on a miss (or always with `refresh`). */
export async function loadSplit(
  dir: string,
  dataset: string,
  split: string,
  opts: { refresh?: boolean; log?: (m: string) => void } = {}
): Promise<Record<string, unknown>[]> {
  const file = cacheFile(dir, dataset, split)
  if (!opts.refresh) {
    try {
      return JSON.parse(await readFile(file, 'utf8')) as Record<
        string,
        unknown
      >[]
    } catch {
      // cache miss → download below
    }
  }
  opts.log?.(`downloading ${dataset} [${split}] …`)
  const rows = await downloadSplit(dataset, split)
  await mkdir(dir, { recursive: true })
  await writeFile(file, JSON.stringify(rows))
  opts.log?.(`  ${rows.length} rows → ${file}`)
  return rows
}
