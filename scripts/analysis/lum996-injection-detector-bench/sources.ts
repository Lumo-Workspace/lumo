/**
 * LUM-996 — the public corpora, fetched at RUN TIME into a gitignored cache.
 *
 * Nothing here is vendored. Rows come from the Hugging Face datasets-server
 * JSON API (paged, no parquet parser, no new dependency) or from raw GitHub
 * files pinned to one commit, and are cached under `./.cache/` (covered by the
 * repo's `.cache` ignore rule). The read-out quotes example text only from
 * sources whose licence allows it (`quotable`); Tensor Trust ships without a
 * licence, so it contributes aggregate numbers and sample ids only.
 *
 * HackAPrompt (`hackaprompt/hackaprompt-dataset`) is gated behind a terms
 * acceptance and is deliberately not fetched; PINT is not public.
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { detectLang } from './classify'

export type Label = 'attack' | 'benign'

export interface Sample {
  dataset: string
  /** Stable id inside the dataset (split:row, sample_id, category:index, path#chunk). */
  ref: string
  text: string
  label: Label
  /** A category the dataset itself assigns (BIPIA), if any. */
  nativeCategory?: string
}

export interface DatasetInfo {
  id: string
  label: Label
  title: string
  licence: string
  url: string
  /** Upstream revision the rows were read at (HF commit / git sha). */
  revision: string
  /** May text from this dataset be quoted in committed files? */
  quotable: boolean
  note?: string
}

export const DATASETS_SERVER = 'https://datasets-server.huggingface.co'
export const HF_API = 'https://huggingface.co/api/datasets'
export const PAGE_SIZE = 100
export const PAGE_DELAY_MS = 500
/** A stalled connection fails the attempt (and is retried) instead of hanging. */
export const FETCH_TIMEOUT_MS = 60_000

/** Upstream revisions this read-out was produced from (verified 2026-10-05). */
export const PINNED = {
  deepset: {
    repo: 'deepset/prompt-injections',
    sha: '4f61ecb038e9c3fb77e21034b22511b523772cdd',
    splits: ['train', 'test'],
  },
  gandalf: {
    repo: 'Lakera/gandalf_ignore_instructions',
    sha: '04737b65e90a6794ec227012e4a255a7def6344b',
    splits: ['train', 'validation', 'test'],
  },
  multilingual: {
    repo: 'rikka-snow/prompt-injection-multilingual',
    sha: 'f1ad1f3dd44581f53a4c67e96a9dde2fb419ee5b',
    splits: ['train', 'test'],
  },
  tensorTrust: {
    repo: 'HumanCompatibleAI/tensor-trust-data',
    sha: '747a75e096761ebc01bd3970158827326b4add23',
    files: {
      hijacking:
        'benchmarks/hijacking-robustness/v1/hijacking_robustness_dataset.jsonl',
      extraction:
        'benchmarks/extraction-robustness/v1/extraction_robustness_dataset.jsonl',
    },
  },
  bipia: {
    repo: 'microsoft/BIPIA',
    sha: 'a004b69ec0dd446e0afd461d98cb5e96e120a5d0',
    files: {
      text: [
        'benchmark/text_attack_train.json',
        'benchmark/text_attack_test.json',
      ],
      code: [
        'benchmark/code_attack_train.json',
        'benchmark/code_attack_test.json',
      ],
    },
  },
} as const

export const DEFAULT_CACHE_DIR = join(__dirname, '.cache')

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

export function rawGithubUrl(repo: string, sha: string, path: string): string {
  return `https://raw.githubusercontent.com/${repo}/${sha}/${path}`
}

export function cacheName(key: string): string {
  return `${key.replace(/[^A-Za-z0-9._-]+/g, '__')}.json`
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

// ─── fetch + cache ──────────────────────────────────────────────────────────

async function fetchWithRetry(url: string): Promise<Response> {
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 8; attempt++) {
    let waitMs = Math.min(60_000, 2000 * 2 ** attempt)
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (res.ok) return res
      lastErr = new Error(`HTTP ${res.status} for ${url}`)
      if (res.status !== 429 && res.status < 500) break
      const retryAfter = Number(res.headers.get('retry-after'))
      if (Number.isFinite(retryAfter) && retryAfter > 0)
        waitMs = Math.max(waitMs, retryAfter * 1000)
    } catch (err) {
      lastErr = err
    }
    if (attempt < 7) await new Promise(r => setTimeout(r, waitMs))
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

export interface FetchOptions {
  cacheDir: string
  /** Never touch the network; a missing cache entry is an error. */
  offline: boolean
}

async function cached<T>(
  opts: FetchOptions,
  key: string,
  produce: () => Promise<T>
): Promise<T> {
  const file = join(opts.cacheDir, cacheName(key))
  if (existsSync(file)) return JSON.parse(await readFile(file, 'utf8')) as T
  if (opts.offline)
    throw new Error(`--offline: cache miss for ${key} (${file})`)
  const value = await produce()
  await mkdir(opts.cacheDir, { recursive: true })
  await writeFile(file, JSON.stringify(value))
  return value
}

interface RowsPage {
  rows: Array<{ row: Record<string, unknown>; truncated_cells?: string[] }>
  num_rows_total: number
}

/** The live HEAD revision of an HF dataset (never cached). */
async function liveHfRevision(repo: string): Promise<string> {
  const res = await fetchWithRetry(`${HF_API}/${repo}`)
  const j = (await res.json()) as { sha?: string }
  if (!j.sha) throw new Error(`no sha in HF API response for ${repo}`)
  return j.sha
}

export interface HfSplitRows {
  /** The revision the rows were read at, checked before AND after paging. */
  revision: string
  rows: Record<string, unknown>[]
}

/**
 * Every row of one HF split, via the datasets-server, cached together with
 * the revision it was read at — so a cached split always reports the revision
 * of its own rows, and the drift check compares the data actually scored.
 * Fails on truncation, or when the dataset moved while it was being paged.
 */
async function hfSplit(
  opts: FetchOptions,
  repo: string,
  split: string
): Promise<HfSplitRows> {
  return cached(opts, `hf-split__${repo}__${split}`, async () => {
    const before = await liveHfRevision(repo)
    const rows: Record<string, unknown>[] = []
    let total = Infinity
    for (let offset = 0; offset < total; offset += PAGE_SIZE) {
      const res = await fetchWithRetry(rowsUrl(repo, split, offset))
      const page = (await res.json()) as RowsPage
      total = page.num_rows_total
      for (const r of page.rows) {
        if (r.truncated_cells && r.truncated_cells.length > 0)
          throw new Error(`${repo}/${split}: truncated cell at ${offset}`)
        rows.push(r.row)
      }
      if (page.rows.length === 0) break
      // Be polite to the datasets-server: it rate-limits bursts (HTTP 429).
      await new Promise(r => setTimeout(r, PAGE_DELAY_MS))
    }
    const after = await liveHfRevision(repo)
    if (before !== after)
      throw new Error(
        `${repo}/${split}: revision moved from ${before} to ${after} while paging; re-run`
      )
    return { revision: before, rows }
  })
}

/**
 * The one revision a dataset's splits were read at, and a drift note when it
 * is not the pinned one. Splits read at different revisions are an error.
 */
export function resolveRevision(
  repo: string,
  pinned: string,
  revisions: string[]
): { revision: string; drift: string | null } {
  const distinct = [...new Set(revisions)]
  if (distinct.length !== 1)
    throw new Error(
      `${repo}: splits were read at different revisions (${distinct.join(', ')}); clear the cache and re-run`
    )
  const revision = distinct[0]!
  return {
    revision,
    drift:
      revision === pinned
        ? null
        : `${repo}: pinned ${pinned}, cached/fetched ${revision}`,
  }
}

async function githubText(
  opts: FetchOptions,
  repo: string,
  sha: string,
  path: string
): Promise<string> {
  return cached(opts, `gh__${repo}__${sha}__${path}`, async () => {
    const res = await fetchWithRetry(rawGithubUrl(repo, sha, path))
    return res.text()
  })
}

// ─── row → sample parsers (pure) ────────────────────────────────────────────

/** `{text, label}` rows → samples; label 1 = attack, 0 = benign. */
export function parseLabelledRows(
  rows: Record<string, unknown>[],
  split: string,
  attackDataset: string,
  benignDataset: string
): Sample[] {
  return rows.map((row, i) => {
    const text = row.text
    const label = row.label
    if (typeof text !== 'string')
      throw new Error(`${attackDataset} ${split}:${i}: text is not a string`)
    if (label !== 0 && label !== 1)
      throw new Error(`${attackDataset} ${split}:${i}: unexpected label`)
    return label === 1
      ? { dataset: attackDataset, ref: `${split}:${i}`, text, label: 'attack' }
      : { dataset: benignDataset, ref: `${split}:${i}`, text, label: 'benign' }
  })
}

/** Tensor Trust JSONL → the `attack` field of every line. */
export function parseTensorTrust(jsonl: string, dataset: string): Sample[] {
  const out: Sample[] = []
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue
    const row = JSON.parse(line) as { sample_id?: unknown; attack?: unknown }
    if (typeof row.attack !== 'string')
      throw new Error(`${dataset}: a line has no string "attack"`)
    out.push({
      dataset,
      ref: String(row.sample_id ?? out.length),
      text: row.attack,
      label: 'attack',
    })
  }
  return out
}

/** BIPIA `{category: [attack, …]}` → samples carrying the native category. */
export function parseBipia(
  raw: unknown,
  dataset: string,
  file: string
): Sample[] {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error(`${dataset} ${file}: expected an object of categories`)
  const out: Sample[] = []
  for (const [category, attacks] of Object.entries(raw)) {
    if (!Array.isArray(attacks))
      throw new Error(`${dataset} ${file}: ${category} is not an array`)
    attacks.forEach((text: unknown, i) => {
      if (typeof text !== 'string')
        throw new Error(`${dataset} ${file}: ${category}[${i}] not a string`)
      out.push({
        dataset,
        ref: `${file.replace(/^.*\//, '')}:${category}:${i}`,
        text,
        label: 'attack',
        nativeCategory: category,
      })
    })
  }
  return out
}

/** Drop empty texts and exact duplicates (after trim), keeping the first. */
export function dedupe(samples: Sample[]): Sample[] {
  const seen = new Set<string>()
  const out: Sample[] = []
  for (const s of samples) {
    const key = `${s.dataset}\u0000${s.text.trim()}`
    if (!s.text.trim() || seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out
}

// ─── loaders ────────────────────────────────────────────────────────────────

export interface PublicCorpus {
  samples: Sample[]
  datasets: DatasetInfo[]
  /** Upstream revisions that differ from PINNED (empty = reproducible). */
  drift: string[]
}

export async function loadPublicCorpus(
  opts: FetchOptions
): Promise<PublicCorpus> {
  const samples: Sample[] = []
  const drift: string[] = []
  const datasets: DatasetInfo[] = []

  /** Read every split of an HF dataset; record drift from the pinned sha. */
  const hfDataset = async (p: {
    repo: string
    sha: string
    splits: readonly string[]
  }): Promise<{ revision: string; splits: Array<[string, HfSplitRows]> }> => {
    const splits: Array<[string, HfSplitRows]> = []
    for (const split of p.splits)
      splits.push([split, await hfSplit(opts, p.repo, split)])
    const r = resolveRevision(
      p.repo,
      p.sha,
      splits.map(([, x]) => x.revision)
    )
    if (r.drift) drift.push(r.drift)
    return { revision: r.revision, splits }
  }

  // deepset/prompt-injections — Apache-2.0, EN + DE, attacks and benign.
  {
    const p = PINNED.deepset
    const { revision: rev, splits } = await hfDataset(p)
    for (const [split, { rows }] of splits)
      samples.push(
        ...parseLabelledRows(rows, split, 'deepset-attacks', 'deepset-benign')
      )
    const base = {
      licence: 'Apache-2.0',
      url: `https://huggingface.co/datasets/${p.repo}`,
      revision: rev,
      quotable: true,
    }
    datasets.push(
      {
        id: 'deepset-attacks',
        label: 'attack',
        title: `${p.repo} (label 1)`,
        ...base,
      },
      {
        id: 'deepset-benign',
        label: 'benign',
        title: `${p.repo} (label 0)`,
        ...base,
      }
    )
  }

  // Lakera Gandalf "ignore instructions" — MIT, EN, attacks only.
  {
    const p = PINNED.gandalf
    const { revision: rev, splits } = await hfDataset(p)
    for (const [split, { rows }] of splits) {
      rows.forEach((row, i) => {
        if (typeof row.text !== 'string')
          throw new Error(`${p.repo} ${split}:${i}: text is not a string`)
        samples.push({
          dataset: 'lakera-gandalf',
          ref: `${split}:${i}`,
          text: row.text,
          label: 'attack',
        })
      })
    }
    datasets.push({
      id: 'lakera-gandalf',
      label: 'attack',
      title: p.repo,
      licence: 'MIT',
      url: `https://huggingface.co/datasets/${p.repo}`,
      revision: rev,
      quotable: true,
    })
  }

  // rikka-snow multilingual — MIT; only its Chinese rows are used (the rest
  // are translations of deepset and would double-count it).
  {
    const p = PINNED.multilingual
    const { revision: rev, splits } = await hfDataset(p)
    for (const [split, { rows }] of splits) {
      const parsed = parseLabelledRows(
        rows,
        split,
        'multilingual-zh-attacks',
        'multilingual-zh-benign'
      )
      samples.push(...parsed.filter(s => detectLang(s.text) === 'zh'))
    }
    const base = {
      licence: 'MIT (third-party; machine-translated from deepset)',
      url: `https://huggingface.co/datasets/${p.repo}`,
      revision: rev,
      quotable: true,
      note: 'Rows the language tagger reads as Chinese (CJK >= 30% of letters, no kana); the other languages are translations of deepset and would double-count it.',
    }
    datasets.push(
      {
        id: 'multilingual-zh-attacks',
        label: 'attack',
        title: `${p.repo} zh (label 1)`,
        ...base,
      },
      {
        id: 'multilingual-zh-benign',
        label: 'benign',
        title: `${p.repo} zh (label 0)`,
        ...base,
      }
    )
  }

  // Tensor Trust — no licence in the repo: aggregate numbers only.
  {
    const p = PINNED.tensorTrust
    for (const [kind, path] of Object.entries(p.files)) {
      const id = `tensor-trust-${kind}`
      samples.push(
        ...parseTensorTrust(await githubText(opts, p.repo, p.sha, path), id)
      )
      datasets.push({
        id,
        label: 'attack',
        title: `${p.repo} ${kind} robustness benchmark (attack field)`,
        licence: 'none stated — not quoted, not vendored',
        url: `https://github.com/${p.repo}/blob/${p.sha}/${path}`,
        revision: p.sha,
        quotable: false,
      })
    }
  }

  // BIPIA — MIT (Microsoft); the attack instructions only, scored standalone.
  {
    const p = PINNED.bipia
    for (const [kind, files] of Object.entries(p.files)) {
      const id = `bipia-${kind}`
      for (const file of files)
        samples.push(
          ...parseBipia(
            JSON.parse(await githubText(opts, p.repo, p.sha, file)),
            id,
            file
          )
        )
      datasets.push({
        id,
        label: 'attack',
        title: `${p.repo} ${kind} attacks (train + test)`,
        licence: 'MIT',
        url: `https://github.com/${p.repo}/tree/${p.sha}/benchmark`,
        revision: p.sha,
        quotable: true,
        note: 'Indirect-injection payloads scored on their own, not embedded in the host email/table/code context.',
      })
    }
  }

  return { samples: dedupe(samples), datasets, drift }
}
