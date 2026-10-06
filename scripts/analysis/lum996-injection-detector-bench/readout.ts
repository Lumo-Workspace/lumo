/**
 * LUM-1007 — the committed read-out, split in two (the LUM-999 pattern):
 *
 *  - `results-classifier.json`: small, human-readable — context (pools,
 *    dataset order, model configs, grid) + the aggregates the README cites.
 *  - `results-classifier.rows.jsonl.gz`: one minified record per (model,
 *    sample) — the per-sample detail every aggregate is computed from. No
 *    sample text is stored, only dataset ids + refs, so non-quotable sets
 *    (Tensor Trust) stay unquoted.
 *
 * `buildAggregates` is the only producer of the JSON's `aggregates`; the jest
 * suite decodes the gz, checks its sha256 against the JSON and rebuilds the
 * aggregates from it, so the two files cannot drift apart.
 */
import { createHash } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import {
  armReport,
  armsFor,
  chooseThreshold,
  chunkCounts,
  percentile,
  sliceReport,
  type Arm,
  type ArmReport,
  type BenchRow,
  type Pools,
  type SliceReport,
  type ThresholdChoice,
} from './combine'

export const DETAIL_FILE = 'results-classifier.rows.jsonl.gz'

/** One per (model, sample). The regex fields repeat for every model. */
export interface DetailRow extends BenchRow {
  model: string
}

/** The uncompressed detail stream: one minified record per line. */
export function detailJsonl(rows: DetailRow[]): string {
  return rows.map(r => `${JSON.stringify(r)}\n`).join('')
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** gzip of `detailJsonl` (zlib writes mtime 0, so equal input → equal bytes). */
export function encodeDetail(rows: DetailRow[]): Buffer {
  return gzipSync(Buffer.from(detailJsonl(rows), 'utf8'), { level: 9 })
}

export function decodeDetail(gz: Buffer): {
  rows: DetailRow[]
  sha256: string
} {
  const text = gunzipSync(gz).toString('utf8')
  return {
    rows: text
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l) as DetailRow),
    sha256: sha256Hex(text),
  }
}

export interface ModelContext {
  id: string
  maxTokens: number
  reportThresholds: number[]
}

/** Everything besides the rows that the aggregates depend on. */
export interface ReadoutContext {
  fprBound: number
  pools: Pools
  /** Dataset ids in report order (chunk counts). */
  datasetOrder: string[]
  thresholdGrid: number[]
  models: ModelContext[]
  slice: {
    id: string
    /** Authored language per slice ref (the slice is reported by it). */
    langByRef: Record<string, string>
    verbatimRefs: string[]
  }
}

export interface ModelAggregates {
  id: string
  thresholdChoice: { classifier: ThresholdChoice; or: ThresholdChoice }
  chunking: {
    chunkedSamples: number
    totalSamples: number
    byDataset: ReturnType<typeof chunkCounts>
  }
  classifierLatencyMs: Record<
    'all' | 'unchunked' | 'chunked',
    { p50: number; p95: number }
  >
  heldout: ArmReport[]
  plainAgentAddressed: SliceReport[]
}

export interface Aggregates {
  regex: { heldout: ArmReport; plainAgentAddressed: SliceReport }
  models: ModelAggregates[]
}

function latency(ms: number[]): { p50: number; p95: number } {
  return { p50: percentile(ms, 50), p95: percentile(ms, 95) }
}

/** Pure: the JSON's `aggregates` from the detail rows + context. */
export function buildAggregates(
  rows: DetailRow[],
  ctx: ReadoutContext
): Aggregates {
  const langOf = (ref: string): string => ctx.slice.langByRef[ref] ?? 'other'
  const slice = (rs: BenchRow[], arm: Arm): SliceReport =>
    sliceReport(rs, arm, ctx.slice.id, langOf, ctx.slice.verbatimRefs)
  const first = ctx.models[0]
  if (!first) throw new Error('no models in context')
  // The regex fields are identical across models; read them off the first.
  const regexRows = rows.filter(r => r.model === first.id)
  const regexArm: Arm = { id: 'regex', kind: 'regex' }
  return {
    regex: {
      heldout: armReport(
        regexRows,
        regexArm,
        ctx.pools,
        ctx.fprBound,
        'heldout'
      ),
      plainAgentAddressed: slice(regexRows, regexArm),
    },
    models: ctx.models.map(m => {
      const mine = rows.filter(r => r.model === m.id)
      const pick = (kind: 'classifier' | 'or'): ThresholdChoice =>
        chooseThreshold(
          mine,
          kind,
          m.id,
          ctx.pools,
          ctx.fprBound,
          ctx.thresholdGrid
        )
      const choice = { classifier: pick('classifier'), or: pick('or') }
      const arms = armsFor(m.id, m.reportThresholds, {
        classifier: choice.classifier.threshold,
        or: choice.or.threshold,
      })
      const chunked = mine.filter(r => r.chunks > 1)
      return {
        id: m.id,
        thresholdChoice: choice,
        chunking: {
          chunkedSamples: chunked.length,
          totalSamples: mine.length,
          byDataset: chunkCounts(mine, ctx.datasetOrder),
        },
        classifierLatencyMs: {
          all: latency(mine.map(r => r.clfMs)),
          unchunked: latency(
            mine.filter(r => r.chunks === 1).map(r => r.clfMs)
          ),
          chunked: latency(chunked.map(r => r.clfMs)),
        },
        heldout: arms.map(a =>
          armReport(mine, a, ctx.pools, ctx.fprBound, 'heldout')
        ),
        plainAgentAddressed: arms.map(a => slice(mine, a)),
      }
    }),
  }
}

/**
 * Compact, stable JSON: indented, but any object or array whose values are
 * all primitives (a Wilson rate, an arm, a chunk count, the grid) prints on
 * one line. Listed in .prettierignore so the file stays exactly this.
 */
export function formatReadout(value: unknown): string {
  const isLeaf = (v: unknown): boolean =>
    v !== null &&
    typeof v === 'object' &&
    Object.values(v as object).every(x => x === null || typeof x !== 'object')
  const walk = (v: unknown, indent: string): string => {
    if (v === null || typeof v !== 'object' || isLeaf(v))
      return JSON.stringify(v)
    const inner = `${indent}  `
    if (Array.isArray(v))
      return v.length === 0
        ? '[]'
        : `[\n${v.map(x => `${inner}${walk(x, inner)}`).join(',\n')}\n${indent}]`
    const entries = Object.entries(v as Record<string, unknown>).filter(
      ([, x]) => x !== undefined
    )
    return entries.length === 0
      ? '{}'
      : `{\n${entries
          .map(([k, x]) => `${inner}${JSON.stringify(k)}: ${walk(x, inner)}`)
          .join(',\n')}\n${indent}}`
  }
  return `${walk(value, '')}\n`
}
