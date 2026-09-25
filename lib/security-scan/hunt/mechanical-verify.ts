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
  fileSightingKey,
  matchEntryRule,
  matchSinkRule,
  sameSymbolRef,
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
   *
   * LUM-798 follow-up — BOTH locations, each tagged with whose it is. The
   * first version carried one `file`/`line` pair, always the sink's, so a row
   * reading `symbol-not-found-in-repo:POST` printed the SINK's location next
   * to a failure of the ENTRY. Eight production rows were unreadable that
   * way, and the misreading is silent — the fields look right.
   */
  entry?: string
  sinkFile?: string
  sinkLine?: number
  entryFile?: string
  entryLine?: number
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
  /**
   * LUM-798 follow-up — the entry was placed by its name occurring somewhere
   * in the file it claimed, not on the line it claimed. The symbol is real;
   * the line is the agent's and unverified.
   */
  entryLineUnconfirmed?: boolean
}

/**
 * LUM-798 follow-up — where every candidate went, on TWO axes, because one
 * axis answered the wrong question.
 *
 * The first shape of this tally only counted a placement when the candidate
 * went on to survive every later check. Twenty-eight production scans later
 * it read `subgraph 0 · sinkRule 0 · sandbox 0 · rejected 40` — while 21 of
 * those 40 had in fact been placed and then died at the chain check. So the
 * counter built to answer "did the new placement logic work" could not
 * distinguish "never placed" from "placed, then rejected downstream": the
 * exact zero-versus-never confusion this task exists to remove, reproduced
 * in its own read-out.
 *
 * Two partitions of the same submissions, each exact:
 *   placement — `placed.* + unplaced === candidates`
 *   outcome   — `accepted + rejected === candidates`
 * and `accepted <= placed.subgraph + placed.sinkRule + placed.sandbox`.
 *
 * The nesting is deliberate: a pre-follow-up row is flat, so no reader can
 * mistake one shape's numbers for the other's.
 */
export interface ResolutionTally {
  /** How the SINK was placed, counted AT placement — survival is the other axis. */
  placed: { subgraph: number; sinkRule: number; sandbox: number }
  /** Placement never happened: it failed, or the submission never parsed. */
  unplaced: number
  /** Of the placed, how many survived every later check. */
  accepted: number
  /** Rejected at any stage, placement included. */
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
  /**
   * LUM-798 follow-up — `fileSightingKey` of every claim whose name occurs
   * SOMEWHERE in the file it named. The entry's fallback only; see
   * `fileSightingKey` for why the sink does not get one.
   */
  fileSightings: string[]
  /** Paths the read tried to open and could not: those files do not exist. */
  missingFiles: string[]
}

export const NO_REPO_EVIDENCE: RepoEvidence = {
  sightings: [],
  fileSightings: [],
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
  if (
    !sameSymbolRef(first.from, c.entry.symbol) ||
    !sameSymbolRef(last.to, c.sink.symbol)
  ) {
    return false
  }
  for (let i = 1; i < c.call_chain.length; i++) {
    if (!sameSymbolRef(c.call_chain[i]!.from, c.call_chain[i - 1]!.to)) {
      return false
    }
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
  const sightedInFile = new Set(evidence.fileSightings ?? [])
  const absent = new Set(evidence.missingFiles)
  const seen = new Set<string>()
  const accepted: VerifiedCandidate[] = []
  const rejected: RejectedCandidate[] = []
  const resolution: ResolutionTally = {
    placed: { subgraph: 0, sinkRule: 0, sandbox: 0 },
    unplaced: 0,
    accepted: 0,
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
      // Never parsed, so placement never ran: `unplaced`, not a placement
      // that failed. Both partitions stay exact either way.
      resolution.unplaced += 1
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
        sinkFile: c.sink.file,
        sinkLine: c.sink.line,
        entryFile: c.entry.file,
        entryLine: c.entry.line,
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
      resolution.unplaced += 1
      reject(notPlaced(c.sink.symbol, c.sink.file, files))
      continue
    }
    // Counted HERE, at placement — not at acceptance. Whether this candidate
    // survives the entry, edge and chain checks below is the other axis, and
    // conflating the two is what made the first tally unreadable.
    resolution.placed[resolvedBy === 'sink-rule' ? 'sinkRule' : resolvedBy] += 1

    // The entry: the graph, the line it was claimed on, or — LUM-798
    // follow-up — anywhere in the file it was claimed in. The last tier is
    // the entry's alone: its line is context, the sink's line is the claim.
    const entrySymbol = symbols.get(c.entry.symbol)
    const entrySightedAtLine = sighted.has(sightingKey(c.entry))
    const entrySightedInFile =
      !entrySightedAtLine &&
      sightedInFile.has(fileSightingKey(c.entry.file, c.entry.symbol))
    if (!entrySymbol && !entrySightedAtLine && !entrySightedInFile) {
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
    // Placed, but only by "the name is somewhere in that file" — weaker than
    // the line the candidate actually claimed, and the falsifier is told so
    // rather than the difference being lost.
    const entryLineUnconfirmed = entrySymbol === undefined && entrySightedInFile

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
    // entry the candidate named, end at its sink, and join up — comparing
    // symbols across naming LEVELS (LUM-798 follow-up), never across paths.
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
    resolution.accepted += 1
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
      ...(entryLineUnconfirmed ? { entryLineUnconfirmed: true } : {}),
    })
  }
  return { accepted, rejected, resolution }
}

/** LUM-798 — the refs a raw submission claims; re-exported for the read side. */
export { candidateSymbolRefs }
