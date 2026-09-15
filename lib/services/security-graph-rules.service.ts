/**
 * LUM-785 — the I/O half of the deterministic graph rules (spec §6 L3,
 * "llm-output → sink"). Runs INSIDE stage A, in process, before the managed
 * scan and the hunt are even started: it reads the PR's touched TS/TSX files
 * plus one hop of their imports at the head sha, builds the diff subgraph,
 * and turns every `findLlmOutputFlows` flow into a DETERMINISTIC finding row.
 * The pure logic lives in `lib/security-scan/graph/llm-output-flow.ts`.
 *
 * Why here and not in the hunt workflow: the hunt is routinely PARTIAL and is
 * only started when its trigger fires; this rule is decidable from the graph
 * alone, so it must not wait for — or depend on — a model run. Its rows never
 * see the falsifier: they go straight into stage A's `persistResult`.
 *
 * Never throws. A GitHub read that fails, or a graph that could not be built,
 * returns `partial: true` with the reason; stage A logs it and marks the scan
 * partial (P9: a layer that could not run is a fact, not a blank).
 */
import { createHash } from 'node:crypto'
import { readRepoFile } from '@/lib/integrations/github/contents'
import { redactKnownSecrets } from '@/lib/security-scan'
import {
  listImports,
  type SourceFileInput,
} from '@/lib/security-scan/graph/build-subgraph'
import {
  isGraphSourcePath,
  resolveImportCandidates,
} from '@/lib/security-scan/graph/imports'
import {
  findLlmOutputFlows,
  LLM_OUTPUT_RULE_PREFIX,
  LLM_OUTPUT_SINK_META,
  type LlmOutputFlow,
} from '@/lib/security-scan/graph/llm-output-flow'
import { SUBGRAPH_MAX_FILES } from '@/lib/security-scan/graph/types'
import type { NewFindingInput } from '@/lib/repositories/pr-security-scan.repository'

/**
 * Upper bound on GitHub content reads per scan: one per touched file, then
 * up to four candidates per unresolved import, so the cap on FILES alone
 * would not bound the calls.
 */
export const GRAPH_RULE_MAX_READS = SUBGRAPH_MAX_FILES * 3

const TITLE_MAX = 200
const DETAIL_MAX = 2000
const EVIDENCE_MAX = 1000
const PATH_MAX = 400
const CONTROL_CHARS = /[\x00-\x08\x0B-\x1F]/g

function clean(text: string, max: number): string {
  return redactKnownSecrets(text).replace(CONTROL_CHARS, '').slice(0, max)
}

/** `sha256(llm-output-to-sink:<sinkSymbol>:<sourceSymbol>)`, 16 hex like every other fingerprint. */
export function graphRuleFingerprint(
  sinkSymbol: string,
  sourceSymbol: string
): string {
  return createHash('sha256')
    .update(`${LLM_OUTPUT_RULE_PREFIX}:${sinkSymbol}:${sourceSymbol}`)
    .digest('hex')
    .slice(0, 16)
}

/** Pure; exported for tests. One finding row per flow. */
export function toGraphRuleRows(
  scanId: string,
  flows: LlmOutputFlow[]
): NewFindingInput[] {
  return flows.map(f => {
    const meta = LLM_OUTPUT_SINK_META[f.sink.rule]
    const chain = [...f.chain, f.sink.symbol]
    const callChain: Array<{ from: string; to: string }> = []
    for (let i = 1; i < chain.length; i++) {
      callChain.push({
        from: clean(chain[i - 1]!, PATH_MAX),
        to: clean(chain[i]!, PATH_MAX),
      })
    }
    return {
      scanId,
      kind: 'VULNERABILITY',
      ruleId: `${LLM_OUTPUT_RULE_PREFIX}:${f.sink.rule}`,
      severity: meta.severity,
      provenance: 'DETERMINISTIC',
      filePath: clean(f.sink.file, PATH_MAX),
      line: f.sink.line,
      title: clean(
        `Model output reaches ${meta.label} (${f.sink.callee})`,
        TITLE_MAX
      ),
      detail: clean(
        `The result of ${f.source.callee} in ${f.source.symbol} (${f.source.file}:${f.source.line}) ` +
          `reaches ${f.sink.callee} at ${f.sink.file}:${f.sink.line} with no schema parse on the path ` +
          `(${f.chain.length - 1} call hop${f.chain.length === 2 ? '' : 's'}; reachability ${f.reachability}). ` +
          `Model output is untrusted input: validate it with a schema (zod parse) before it drives ${meta.label}, ` +
          `or never let it choose the target at all.`,
        DETAIL_MAX
      ),
      evidence: clean(chain.join(' → '), EVIDENCE_MAX),
      fingerprint: graphRuleFingerprint(f.sink.symbol, f.source.symbol),
      externalRef: null,
      disposition: null,
      cwe: meta.cwe,
      reachability: f.reachability,
      callChain,
    }
  })
}

export interface GraphRulesJob {
  scanId: string
  workspaceId: string
  /** `owner/repo` */
  repo: string
  headSha: string
  /** TS/TSX paths the PR diff added lines to (already `isGraphSourcePath`-filtered). */
  touchedSourcePaths: string[]
}

export interface GraphRulesResult {
  rows: NewFindingInput[]
  /** Files the graph was built from (touched + one-hop imports). */
  files: number
  /**
   * True only when a read FAILED: the layer could not do its job and the scan
   * is marked partial (P9). A cap that was hit is `capped`, not partial —
   * LUM-762 established that a bounded graph is the rule's design, not a
   * truncated run, and letting the cap set `partial` made PARTIAL routine.
   */
  partial: boolean
  /** SUBGRAPH_MAX_FILES / GRAPH_RULE_MAX_READS was hit; the answer is a lower bound by design. */
  capped: boolean
  /** The failure, when `partial`. */
  error?: string
}

/** A repo-relative path a GitHub read may follow (no `..`, not absolute). */
function isReadablePath(path: string): boolean {
  if (!isGraphSourcePath(path)) return false
  if (path.startsWith('/')) return false
  return !path.split('/').includes('..')
}

/**
 * Touched files first, then one hop of their `@/` / relative imports, until
 * SUBGRAPH_MAX_FILES files are in hand or GRAPH_RULE_MAX_READS reads have
 * been spent. Exported for the service test; pure apart from `read`.
 */
/* eslint-disable no-unused-vars -- parameter name in a type declaration */
export type ReadRepoFileAtHead = (path: string) => Promise<string | null>
/* eslint-enable no-unused-vars */

export async function collectDiffGraphInputs(
  job: Omit<GraphRulesJob, 'scanId'>,
  read: ReadRepoFileAtHead = path =>
    readRepoFile({
      workspaceId: job.workspaceId,
      fullName: job.repo,
      path,
      ref: job.headSha,
    })
): Promise<{ inputs: SourceFileInput[]; capped: boolean }> {
  const touched = [...new Set(job.touchedSourcePaths)]
    .filter(isReadablePath)
    .sort()
  const inputs: SourceFileInput[] = []
  const attempted = new Set<string>()
  let reads = 0
  let capped = false

  const fetch = async (path: string, isTouched: boolean): Promise<boolean> => {
    if (attempted.has(path)) return false
    attempted.add(path)
    if (inputs.length >= SUBGRAPH_MAX_FILES || reads >= GRAPH_RULE_MAX_READS) {
      capped = true
      return false
    }
    reads += 1
    const source = await read(path)
    if (source === null) return false
    inputs.push({ path, source, touched: isTouched })
    return true
  }

  for (const path of touched) await fetch(path, true)
  const touchedInputs = [...inputs]
  for (const input of touchedInputs) {
    for (const spec of listImports(input.path, input.source)) {
      for (const cand of resolveImportCandidates(input.path, spec)) {
        if (!isReadablePath(cand)) continue
        if (inputs.some(i => i.path === cand)) break
        if (await fetch(cand, false)) break
      }
    }
  }
  return { inputs, capped }
}

export const securityGraphRulesService = {
  /** Never throws — see the module header. */
  async run(job: GraphRulesJob): Promise<GraphRulesResult> {
    if (job.touchedSourcePaths.length === 0) {
      return { rows: [], files: 0, partial: false, capped: false }
    }
    try {
      const { inputs, capped } = await collectDiffGraphInputs(job)
      if (inputs.length === 0)
        return { rows: [], files: 0, partial: false, capped }
      const { flows } = findLlmOutputFlows(inputs)
      return {
        rows: toGraphRuleRows(job.scanId, flows),
        files: inputs.length,
        partial: false,
        capped,
      }
    } catch (error) {
      return {
        rows: [],
        files: 0,
        partial: true,
        capped: false,
        error: (error instanceof Error ? error.message : String(error)).slice(
          0,
          300
        ),
      }
    }
  },
}
