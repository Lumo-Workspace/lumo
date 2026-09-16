/**
 * LUM-739 — the mechanical gate (spec §6 L3 "Verify" step 1). No LLM: a
 * candidate survives only if its symbols can be placed in the repository, its
 * `file:line`s exist at the head sha, its entry really is an entry, and its
 * call chain is made of edges that connect entry to sink. Everything else is
 * dropped with a reason that lands in `huntAudit.rejected[]` — the audit is
 * the point, not the drop.
 *
 * LUM-798 — "placed in the repository", not "present in the subgraph". The
 * old gate demanded a `<file>#<name>` id out of `g.symbols` and rejected
 * everything else first, so in production all 23 candidates ever submitted
 * died on `symbol-not-in-subgraph` and NOTHING downstream — the line checks,
 * the chain checks, the falsifier — ever ran once. "Zero findings" meant
 * "never judged", not "judged and clean". Symbol placement is now three
 * tiers (see `repo-symbols.ts`):
 *
 *   subgraph  — the id is in the graph, as before;
 *   sink-rule — the name IS one of the system's own sink categories, which a
 *               library callee can never carry an id for;
 *   sandbox   — the file:line the candidate named really carries that
 *               identifier, which also settles definition-site vs call-site.
 *
 * What did NOT get looser: a name nothing in the repo can place is still
 * rejected (`symbol-not-found-in-repo`), a line past a known file's end is
 * still rejected, an entry the graph knows and calls something else is still
 * rejected, and a chain that contradicts itself is still rejected. What the
 * graph cannot ANSWER is now carried as `UNKNOWN` to the falsifier rather
 * than silently dropped — the LUM-739 rule, finally applied to naming too.
 */
import { reachability, type Reachability } from '../graph/query'
import type { Subgraph } from '../graph/types'
import {
  HuntCandidateSchema,
  huntFingerprint,
  type HuntCandidate,
} from './candidate'
import {
  candidateSymbolRefs,
  matchEntryRule,
  matchSinkRule,
  sightingKey,
  symbolNameOf,
} from './repo-symbols'

export interface RejectedCandidate {
  reason: string
  category: string
  sink: string
  /**
   * LUM-798 — the candidate in its own words, so a rejection can be re-read
   * after the fact instead of only counted. Absent when the submission did
   * not even parse (there is nothing to quote).
   */
  entry?: string
  file?: string
  line?: number
}

/** LUM-798 — which of the three tiers placed the sink symbol. */
export type SymbolResolution = 'subgraph' | 'sink-rule' | 'sandbox'

export interface VerifiedCandidate extends HuntCandidate {
  reachability: Reachability
  fingerprint: string
  /** LUM-798 — how the sink was placed in the repository. */
  resolvedBy: SymbolResolution
  /** The `SINK_RULES` id, when a rule is what placed it. */
  sinkRule?: string
  /**
   * At least one call-chain edge had an endpoint outside the subgraph, so the
   * graph could neither confirm nor deny it. Not a defect of the candidate —
   * a limit of the graph, and the falsifier's problem now.
   */
  chainUnverified?: boolean
  /**
   * Nothing could confirm the entry really is an entry point: the graph does
   * not hold it and no `ENTRY_RULES` pattern matches its file and name.
   */
  entryKindUnconfirmed?: boolean
}

/**
 * LUM-798 — where every candidate went, so the next round can read this
 * change's effect without re-deriving it. The four counters partition the
 * submissions: `subgraph + sinkRule + sandbox + rejected === candidates`.
 */
export interface ResolutionTally {
  subgraph: number
  sinkRule: number
  sandbox: number
  rejected: number
}

/**
 * LUM-798 — what the verification read of the checkout could confirm about
 * the candidates' own `file:line` claims. Gathered where the source is
 * already open, so the gate itself stays pure and synchronous.
 */
export interface RepoEvidence {
  /** `sightingKey` of every claim whose line really carries the identifier. */
  sightings: string[]
  /** Paths the read tried to open and could not: those files do not exist. */
  missingFiles: string[]
}

export const NO_REPO_EVIDENCE: RepoEvidence = {
  sightings: [],
  missingFiles: [],
}

export interface MechanicalVerifyResult {
  accepted: VerifiedCandidate[]
  rejected: RejectedCandidate[]
  resolution: ResolutionTally
}

function sinkSymbolOf(o: Record<string, unknown>): string {
  const sink = o.sink
  if (sink && typeof sink === 'object' && 'symbol' in sink) {
    const s = (sink as { symbol?: unknown }).symbol
    if (typeof s === 'string') return s
  }
  return ''
}

/**
 * Why a symbol could not be placed, told apart honestly. The verification
 * read only opens repo-relative TS/TSX paths, up to `SUBGRAPH_MAX_FILES` of
 * them — so a file that was never opened has not been judged, and saying "not
 * found in the repo" about it would be the same overclaim LUM-798 exists to
 * remove, one level down. A file that WAS read and does not carry the name is
 * a real answer.
 */
function notPlaced(
  symbol: string,
  file: string,
  read: Map<string, number>
): string {
  return read.has(file)
    ? `symbol-not-found-in-repo:${symbol}`
    : `symbol-not-verifiable:${file}`
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
  raw: unknown[],
  evidence: RepoEvidence = NO_REPO_EVIDENCE
): MechanicalVerifyResult {
  const symbols = new Map(g.symbols.map(s => [s.id, s]))
  const files = new Map(g.files.map(f => [f.path, f.lineCount]))
  const edges = new Set(g.edges.map(e => `${e.from}->${e.to}`))
  const sighted = new Set(evidence.sightings)
  const absent = new Set(evidence.missingFiles)
  const seen = new Set<string>()
  const accepted: VerifiedCandidate[] = []
  const rejected: RejectedCandidate[] = []
  const resolution: ResolutionTally = {
    subgraph: 0,
    sinkRule: 0,
    sandbox: 0,
    rejected: 0,
  }

  for (const item of raw) {
    const parsed = HuntCandidateSchema.safeParse(item)
    if (!parsed.success) {
      const o = (item && typeof item === 'object' ? item : {}) as Record<
        string,
        unknown
      >
      const issue = parsed.error.issues[0]
      resolution.rejected += 1
      rejected.push({
        reason: `schema:${issue?.path.join('.') || '?'}:${issue?.message ?? 'invalid'}`,
        category: typeof o.category === 'string' ? o.category : 'unknown',
        sink: sinkSymbolOf(o),
      })
      continue
    }
    const c = parsed.data
    const reject = (reason: string) => {
      resolution.rejected += 1
      rejected.push({
        reason,
        category: c.category,
        sink: c.sink.symbol,
        entry: c.entry.symbol,
        file: c.sink.file,
        line: c.sink.line,
      })
    }

    // A path the verification read TRIED and could not open is a fact about
    // the repository, not a gap in the graph: the candidate named a file that
    // is not in the checkout. This is what keeps a fabricated location out.
    const gone = [c.sink, c.entry].find(r => absent.has(r.file))
    if (gone) {
      reject(`file-not-found:${gone.file}`)
      continue
    }
    // Only a file the graph actually read has a length to be past. An unread
    // file cannot make this check fail — it makes it silent, which is the
    // LUM-798 distinction between "wrong" and "unanswerable".
    const bad = [c.sink, c.entry].find(r => {
      const n = files.get(r.file)
      return n !== undefined && (r.line < 1 || r.line > n)
    })
    if (bad) {
      reject(`line-out-of-range:${bad.file}:${bad.line}`)
      continue
    }

    // The sink, in three tiers. Order matters only for the audit label: a
    // symbol the graph holds is reported as `subgraph` even when a rule would
    // also have matched it, because that is the stronger placement.
    const sinkSymbol = symbols.get(c.sink.symbol)
    const sinkRule = sinkSymbol ? null : matchSinkRule(c.sink.symbol)
    const sinkSighted =
      !sinkSymbol && !sinkRule && sighted.has(sightingKey(c.sink))
    const resolvedBy: SymbolResolution | null = sinkSymbol
      ? 'subgraph'
      : sinkRule
        ? 'sink-rule'
        : sinkSighted
          ? 'sandbox'
          : null
    if (!resolvedBy) {
      reject(notPlaced(c.sink.symbol, c.sink.file, files))
      continue
    }

    // The entry gets two of the three tiers: no rule table names an entry by
    // callee, so it is the graph or the line it was claimed on.
    const entrySymbol = symbols.get(c.entry.symbol)
    if (!entrySymbol && !sighted.has(sightingKey(c.entry))) {
      reject(notPlaced(c.entry.symbol, c.entry.file, files))
      continue
    }
    // Only the graph can say what KIND a symbol is, and when it says "not an
    // entry" that is a contradiction, not a gap — still a rejection. When the
    // graph has no opinion, `ENTRY_RULES` is asked for a signal and the
    // candidate carries the answer instead of dying on it.
    if (entrySymbol && entrySymbol.kind !== 'entry') {
      reject(`entry-not-entry:${c.entry.symbol}`)
      continue
    }
    const entryKindUnconfirmed =
      entrySymbol === undefined &&
      matchEntryRule(c.entry.file, symbolNameOf(c.entry.symbol)) === null

    // An edge is only wrong if the graph holds BOTH of its endpoints and not
    // the edge between them. An edge into a symbol the graph never saw is
    // unanswerable — before LUM-798 it was fatal, which is arithmetically
    // guaranteed for any candidate whose sink the graph also lacked.
    const decidable = c.call_chain.filter(
      e => symbols.has(e.from) && symbols.has(e.to)
    )
    const missing = decidable.find(e => !edges.has(`${e.from}->${e.to}`))
    if (missing) {
      reject(`edge-not-in-subgraph:${missing.from}->${missing.to}`)
      continue
    }
    // Self-consistency needs no graph at all: the chain must start at the
    // entry the candidate named, end at its sink, and join up.
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
    resolution[resolvedBy === 'sink-rule' ? 'sinkRule' : resolvedBy] += 1
    accepted.push({
      ...c,
      // UNKNOWN when the graph cannot place the sink — the falsifier's input,
      // never read as "unreachable" (see `reachability`).
      reachability: reachability(g, c.sink.symbol),
      fingerprint,
      resolvedBy,
      ...(sinkRule ? { sinkRule: sinkRule.id } : {}),
      ...(decidable.length < c.call_chain.length
        ? { chainUnverified: true }
        : {}),
      ...(entryKindUnconfirmed ? { entryKindUnconfirmed: true } : {}),
    })
  }
  return { accepted, rejected, resolution }
}

/** LUM-798 — the refs a raw submission claims; re-exported for the read side. */
export { candidateSymbolRefs }
