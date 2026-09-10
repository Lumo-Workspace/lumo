/**
 * LUM-739 — the mechanical gate (spec §6 L3 "Verify" step 1). No LLM: a
 * candidate survives only if every symbol it names is in the subgraph, its
 * `file:line`s exist at the head sha (the subgraph carries line counts), its
 * entry really is an entry, and its call chain is made of subgraph edges
 * that connect entry to sink. Everything else is dropped with a reason that
 * lands in `huntAudit.rejected[]` — the audit is the point, not the drop.
 */
import { reachability, type Reachability } from '../graph/query'
import type { Subgraph } from '../graph/types'
import {
  HuntCandidateSchema,
  huntFingerprint,
  type HuntCandidate,
} from './candidate'

export interface RejectedCandidate {
  reason: string
  category: string
  sink: string
}

export interface VerifiedCandidate extends HuntCandidate {
  reachability: Reachability
  fingerprint: string
}

export interface MechanicalVerifyResult {
  accepted: VerifiedCandidate[]
  rejected: RejectedCandidate[]
}

function sinkSymbolOf(o: Record<string, unknown>): string {
  const sink = o.sink
  if (sink && typeof sink === 'object' && 'symbol' in sink) {
    const s = (sink as { symbol?: unknown }).symbol
    if (typeof s === 'string') return s
  }
  return ''
}

function chainConnects(c: HuntCandidate): boolean {
  const first = c.call_chain[0]
  const last = c.call_chain[c.call_chain.length - 1]
  if (!first || !last) return false
  if (first.from !== c.entry.symbol || last.to !== c.sink.symbol) return false
  for (let i = 1; i < c.call_chain.length; i++) {
    if (c.call_chain[i]!.from !== c.call_chain[i - 1]!.to) return false
  }
  return true
}

export function mechanicalVerify(
  g: Subgraph,
  raw: unknown[]
): MechanicalVerifyResult {
  const symbols = new Map(g.symbols.map(s => [s.id, s]))
  const files = new Map(g.files.map(f => [f.path, f.lineCount]))
  const edges = new Set(g.edges.map(e => `${e.from}->${e.to}`))
  const seen = new Set<string>()
  const accepted: VerifiedCandidate[] = []
  const rejected: RejectedCandidate[] = []

  for (const item of raw) {
    const parsed = HuntCandidateSchema.safeParse(item)
    if (!parsed.success) {
      const o = (item && typeof item === 'object' ? item : {}) as Record<
        string,
        unknown
      >
      const issue = parsed.error.issues[0]
      rejected.push({
        reason: `schema:${issue?.path.join('.') || '?'}:${issue?.message ?? 'invalid'}`,
        category: typeof o.category === 'string' ? o.category : 'unknown',
        sink: sinkSymbolOf(o),
      })
      continue
    }
    const c = parsed.data
    const reject = (reason: string) =>
      rejected.push({ reason, category: c.category, sink: c.sink.symbol })

    const sink = symbols.get(c.sink.symbol)
    const entry = symbols.get(c.entry.symbol)
    if (!sink) {
      reject(`symbol-not-in-subgraph:${c.sink.symbol}`)
      continue
    }
    if (!entry) {
      reject(`symbol-not-in-subgraph:${c.entry.symbol}`)
      continue
    }
    if (entry.kind !== 'entry') {
      reject(`entry-not-entry:${c.entry.symbol}`)
      continue
    }
    const bad = [c.sink, c.entry].find(r => {
      const n = files.get(r.file)
      return n === undefined || r.line < 1 || r.line > n
    })
    if (bad) {
      reject(`line-out-of-range:${bad.file}:${bad.line}`)
      continue
    }
    const missing = c.call_chain.find(e => !edges.has(`${e.from}->${e.to}`))
    if (missing) {
      reject(`edge-not-in-subgraph:${missing.from}->${missing.to}`)
      continue
    }
    if (!chainConnects(c)) {
      reject('chain-disconnected')
      continue
    }
    const fingerprint = huntFingerprint(
      c.category,
      c.sink.symbol,
      c.entry.symbol
    )
    if (seen.has(fingerprint)) {
      reject('duplicate')
      continue
    }
    seen.add(fingerprint)
    accepted.push({
      ...c,
      reachability: reachability(g, c.sink.symbol),
      fingerprint,
    })
  }
  return { accepted, rejected }
}
