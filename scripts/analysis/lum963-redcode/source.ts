/**
 * LUM-963 — RedCode-Exec source: pinned upstream files, local cache, loader.
 *
 * RedCode (Guo et al., NeurIPS 2024 Datasets & Benchmarks,
 * https://github.com/AI-secure/RedCode). The code is MIT and the dataset under
 * `dataset/` is CC BY 4.0, so quoting items in reports is allowed with
 * attribution (see RESULTS.md). The data is still fetched into a cache OUTSIDE
 * the repository at run time, pinned to one commit — same workflow as the
 * BashArena / R-Judge evals, and no repository bloat. Plain `fetch`, no new
 * dependency.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const REDCODE_REPO = 'AI-secure/RedCode'
export const REDCODE_SHA = 'c84b6db88fd8bd258e29f12e692ccfd4287a454d'

export type RedCodeLanguage = 'bash' | 'python'

/** Scenario indices that ship a file, per language (upstream dropped five
 *  scenarios from Bash for compatibility). */
export const BASH_INDICES = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 13, 14, 15, 16, 18, 20, 21, 22, 23, 25,
] as const
export const PYTHON_INDICES = Array.from({ length: 27 }, (_, i) => i + 1)

export function upstreamPath(lang: RedCodeLanguage, index: number): string {
  return lang === 'bash'
    ? `dataset/RedCode-Exec/bash2text_dataset_json/index${index}_30_codes_full_upd.json`
    : `dataset/RedCode-Exec/py2text_dataset_json/index${index}_30_codes_full.json`
}

export function rawUrl(path: string, sha: string = REDCODE_SHA): string {
  return `https://raw.githubusercontent.com/${REDCODE_REPO}/${sha}/${path}`
}

export function defaultCacheDir(): string {
  return join(homedir(), '.cache', 'lumo-lum963-redcode', REDCODE_SHA)
}

/** One RedCode-Exec item. Only `Index`, `Language` and `Code` are used. */
export interface RedCodeItem {
  Index: string
  Language: string
  Code: string
  Text_summary?: string
}

export interface LoadedItem {
  lang: RedCodeLanguage
  /** Scenario index (the file's number). */
  scenario: number
  /** Upstream item id, e.g. `7_12`. */
  id: string
  code: string
}

/** Validate one file's JSON — throws on a shape we do not understand. */
export function parseItems(
  raw: unknown,
  lang: RedCodeLanguage,
  scenario: number
): LoadedItem[] {
  if (!Array.isArray(raw)) {
    throw new Error(`${lang} #${scenario}: expected a JSON array`)
  }
  return raw.map((r, i) => {
    const o = (r ?? {}) as Record<string, unknown>
    if (typeof o.Code !== 'string' || o.Code.trim() === '') {
      throw new Error(`${lang} #${scenario} item ${i}: missing Code`)
    }
    const id = typeof o.Index === 'string' ? o.Index : `${scenario}_${i + 1}`
    return { lang, scenario, id, code: o.Code }
  })
}

async function fetchJson(url: string): Promise<unknown> {
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url)
      if (res.ok) return await res.json()
      lastErr = new Error(`HTTP ${res.status} for ${url}`)
      if (res.status !== 429 && res.status < 500) break
    } catch (err) {
      lastErr = err
    }
    await new Promise(r => setTimeout(r, 1000 * 2 ** attempt))
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

function cacheFile(dir: string, lang: RedCodeLanguage, index: number) {
  return join(dir, `${lang}-index${index}.json`)
}

/** Every item of every scenario for the given languages, cache first. */
export async function loadAll(
  dir: string,
  langs: RedCodeLanguage[],
  opts: { refresh?: boolean; log?: (m: string) => void } = {}
): Promise<LoadedItem[]> {
  const out: LoadedItem[] = []
  for (const lang of langs) {
    const indices: readonly number[] =
      lang === 'bash' ? BASH_INDICES : PYTHON_INDICES
    for (const index of indices) {
      const file = cacheFile(dir, lang, index)
      let raw: unknown = null
      if (!opts.refresh) {
        try {
          raw = JSON.parse(await readFile(file, 'utf8'))
        } catch {
          raw = null // cache miss → download below
        }
      }
      if (raw === null) {
        opts.log?.(`downloading ${lang} #${index} …`)
        raw = await fetchJson(rawUrl(upstreamPath(lang, index)))
        await mkdir(dir, { recursive: true })
        await writeFile(file, JSON.stringify(raw))
      }
      out.push(...parseItems(raw, lang, index))
    }
  }
  return out
}
