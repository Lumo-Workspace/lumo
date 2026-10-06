/**
 * LUM-999 — pure aggregation of episode records into the README table, plus
 * the episodes.jsonl.gz codec (results.json keeps only the aggregated cells).
 */
import { createHash } from 'crypto'
import { gunzipSync, gzipSync } from 'zlib'
import type { Goal, Wording } from './fixtures'
import type { Verdict } from './judge'

/** Per-episode records, next to results.json. */
export const EPISODES_FILE = 'episodes.jsonl.gz'

export const ARMS = ['before', 'after', 'afterB'] as const
export type Arm = (typeof ARMS)[number]

export interface EpisodeRecord {
  key: string
  model: string
  arm: Arm
  variant: string
  /** A LUM-999 `ContextPath`, or a LUM-1003 path name. */
  path: string | null
  goal: Goal | null
  wording: Wording | null
  rep: number
  costUsd: number
  /** The run failed (API/budget/timeout) — excluded from the rates. */
  failed: boolean
  failReason: string | null
  numTurns: number | null
  durationMs: number
  verdict: Verdict | null
}

export interface CellSummary {
  model: string
  arm: Arm
  variant: string
  path: string | null
  goal: Goal | null
  wording: Wording | null
  n: number
  failed: number
  utility: number
  /** null for the clean baseline. */
  attackSuccesses: number | null
  readContext: number
  costUsd: number
}

export function episodeKey(
  model: string,
  arm: Arm,
  variant: string,
  rep: number
): string {
  return `${model}|${arm}|${variant}|${rep}`
}

export function summarize(records: EpisodeRecord[]): CellSummary[] {
  const cells = new Map<string, CellSummary>()
  for (const r of records) {
    const k = `${r.model}|${r.arm}|${r.variant}`
    let c = cells.get(k)
    if (!c) {
      c = {
        model: r.model,
        arm: r.arm,
        variant: r.variant,
        path: r.path,
        goal: r.goal,
        wording: r.wording,
        n: 0,
        failed: 0,
        utility: 0,
        attackSuccesses: r.goal ? 0 : null,
        readContext: 0,
        costUsd: 0,
      }
      cells.set(k, c)
    }
    c.costUsd += r.costUsd
    if (r.failed || !r.verdict) {
      c.failed += 1
      continue
    }
    c.n += 1
    if (r.verdict.utility) c.utility += 1
    if (r.verdict.readContext) c.readContext += 1
    if (c.attackSuccesses !== null && r.verdict.attackSuccess) {
      c.attackSuccesses += 1
    }
  }
  return [...cells.values()]
}

export function totalCost(records: EpisodeRecord[]): number {
  return records.reduce((s, r) => s + r.costUsd, 0)
}

function pct(k: number, n: number): string {
  if (n === 0) return '–'
  return `${Math.round((100 * k) / n)}% (${k}/${n})`
}

/** Markdown table: path × goal × wording × arm × model. */
export function renderTable(cells: CellSummary[]): string {
  const rows = [...cells].sort((a, b) =>
    [a.path ?? '', a.goal ?? '', a.wording ?? '', a.model, a.arm]
      .join('|')
      .localeCompare(
        [b.path ?? '', b.goal ?? '', b.wording ?? '', b.model, b.arm].join('|')
      )
  )
  const out = [
    '| path | goal | wording | model | arm | N | utility | ASR | read ctx | failed | cost $ |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ]
  for (const c of rows) {
    out.push(
      `| ${c.path ?? '(clean baseline)'} | ${c.goal ?? '–'} | ${c.wording ?? '–'} | ${c.model} | ${c.arm} | ${c.n} | ${pct(c.utility, c.n)} | ${
        c.attackSuccesses === null ? '–' : pct(c.attackSuccesses, c.n)
      } | ${c.readContext}/${c.n} | ${c.failed} | ${c.costUsd.toFixed(2)} |`
    )
  }
  return out.join('\n')
}

/** The uncompressed episodes stream: one minified record per line. */
export function episodesJsonl(records: EpisodeRecord[]): string {
  return records.map(r => `${JSON.stringify(r)}\n`).join('')
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** gzip of `episodesJsonl` (zlib writes mtime 0, so the bytes are stable). */
export function encodeEpisodes(records: EpisodeRecord[]): Buffer {
  return gzipSync(Buffer.from(episodesJsonl(records), 'utf8'), { level: 9 })
}

export function decodeEpisodes(gz: Buffer): {
  records: EpisodeRecord[]
  sha256: string
} {
  const text = gunzipSync(gz).toString('utf8')
  return {
    records: text
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l) as EpisodeRecord),
    sha256: sha256Hex(text),
  }
}

/**
 * results.json layout: indented, except that every array of objects (the
 * cells, the per-variant render hashes) prints one object per line. It is
 * listed in .prettierignore so the committed file stays byte-identical to
 * this writer's output and small enough for the PR review cap.
 */
export function formatResultsJson(results: object): string {
  const rows: string[] = []
  const text = JSON.stringify(
    results,
    (_k, v: unknown) => {
      if (
        Array.isArray(v) &&
        v.length > 0 &&
        v.every(x => x !== null && typeof x === 'object' && !Array.isArray(x))
      ) {
        return v.map(x => {
          rows.push(JSON.stringify(x))
          return `@@row${rows.length - 1}@@`
        })
      }
      return v
    },
    2
  )
  return `${text.replace(/"@@row(\d+)@@"/g, (_m, i: string) => rows[Number(i)] ?? '')}\n`
}

/**
 * README table: one row per path × goal × wording × model, arms side by side
 * (ASR, or utility for the clean baseline), then utility / N / cost totals.
 */
export function renderArmComparison(cells: CellSummary[]): string {
  const rows = new Map<string, Partial<Record<Arm, CellSummary>>>()
  for (const c of cells) {
    const k = [c.path ?? '', c.goal ?? '', c.wording ?? '', c.model].join('|')
    rows.set(k, { ...rows.get(k), [c.arm]: c })
  }
  const out = [
    '| path | goal | wording | model | ASR before | ASR after | utility (all arms) | N/arm | failed | cost $ |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ]
  const asr = (c: CellSummary | undefined): string =>
    !c
      ? 'not run'
      : c.attackSuccesses === null
        ? '–'
        : pct(c.attackSuccesses, c.n)
  for (const k of [...rows.keys()].sort()) {
    const r = rows.get(k) ?? {}
    const arms = ARMS.flatMap(a => (r[a] ? [r[a]] : []))
    const first = arms[0]
    if (!first) continue
    const util = arms.reduce((s, c) => s + c.utility, 0)
    const n = arms.reduce((s, c) => s + c.n, 0)
    out.push(
      `| ${first.path ?? '(clean baseline)'} | ${first.goal ?? '–'} | ${first.wording ?? '–'} | ${first.model} | ${asr(r.before)} | ${asr(r.after)} | ${pct(util, n)} | ${first.n} | ${arms.reduce((s, c) => s + c.failed, 0)} | ${arms.reduce((s, c) => s + c.costUsd, 0).toFixed(2)} |`
    )
  }
  return out.join('\n')
}
