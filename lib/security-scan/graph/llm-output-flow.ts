/**
 * LUM-785 — the deterministic "model output reaches a dangerous sink" rule
 * (spec §6 L3, second defect class). Pure: sources in, flows out; no I/O.
 *
 * What it decides: a value bound from an `llm-output` call (SOURCE_RULES)
 * reaches, inside the same subgraph, a call matching one of
 * LLM_OUTPUT_TARGET_SINKS — either in the same function or through a chain
 * of resolved calls (the tainted value is passed as an argument and the
 * callee's parameter carries it on) — and NO function on that path calls a
 * `zod-parse` control. Anything it cannot see (aliases across collections,
 * calls it cannot resolve, more than LLM_OUTPUT_FLOW_MAX_HOPS hops) produces
 * no flow: this layer under-approximates on purpose (宁可漏不可噪), and a
 * flow it does report is stamped DETERMINISTIC by stage A without a model or
 * the falsifier ever seeing it.
 *
 * Taint is tracked by identifier name within one function (closures included
 * — a callback inside the function shares its scope): a binding whose
 * initializer contains a tainted identifier is tainted, except when that
 * initializer is itself a `zod-parse` call. Property reads (`out.text`,
 * `out.object.sql`), template literals and concatenation all keep the taint,
 * because the identifier is still in the expression.
 */
import ts from 'typescript'
import {
  buildGraph,
  calleeText,
  resolveCallee,
  type FileCtx,
  type GraphBuild,
  type SourceFileInput,
} from './build-subgraph'
import {
  CONTROL_RULES,
  NEW_EXPRESSION_SINKS,
  SINK_RULES,
  SOURCE_RULES,
  matchCallRule,
} from './patterns'
import { reachability, type Reachability } from './query'
import type { Subgraph } from './types'

export const LLM_OUTPUT_TARGET_SINKS = [
  'prisma-raw',
  'child-process',
  'eval',
  'new-function',
  'fs-write',
  'fetch',
] as const
export type LlmOutputTargetSink = (typeof LLM_OUTPUT_TARGET_SINKS)[number]

/** How many resolved calls a tainted value may travel through. */
export const LLM_OUTPUT_FLOW_MAX_HOPS = 4

export const LLM_OUTPUT_RULE_PREFIX = 'llm-output-to-sink'

/**
 * Severity + CWE per sink, used by stage A when it turns a flow into a
 * finding. Code / SQL / shell execution driven by model text is HIGH (it
 * blocks DONE under the default policy); a write or an outbound request the
 * model chose the target of is MEDIUM.
 */
export const LLM_OUTPUT_SINK_META: Record<
  LlmOutputTargetSink,
  { severity: 'HIGH' | 'MEDIUM'; cwe: string; label: string }
> = {
  'prisma-raw': { severity: 'HIGH', cwe: 'CWE-89', label: 'a raw SQL query' },
  'child-process': {
    severity: 'HIGH',
    cwe: 'CWE-78',
    label: 'a child process',
  },
  eval: { severity: 'HIGH', cwe: 'CWE-95', label: 'eval()' },
  'new-function': { severity: 'HIGH', cwe: 'CWE-95', label: 'new Function()' },
  'fs-write': {
    severity: 'MEDIUM',
    cwe: 'CWE-73',
    label: 'a filesystem write',
  },
  fetch: { severity: 'MEDIUM', cwe: 'CWE-918', label: 'an outbound fetch' },
}

export interface LlmOutputFlow {
  /** The function whose model-call result starts the flow, and that call. */
  source: { symbol: string; file: string; line: number; callee: string }
  /** The sink node (`<file>#<callee>@<line>`, same id as in the subgraph). */
  sink: {
    symbol: string
    file: string
    line: number
    callee: string
    rule: LlmOutputTargetSink
  }
  /** Function symbol ids from the source function to the sink's function, inclusive. */
  chain: string[]
  reachability: Reachability
}

export interface LlmOutputFlowResult {
  subgraph: Subgraph
  flows: LlmOutputFlow[]
}

// ── internals ───────────────────────────────────────────────────────────────

const TARGET_SINKS: ReadonlySet<string> = new Set(LLM_OUTPUT_TARGET_SINKS)

function isTargetSink(rule: string): rule is LlmOutputTargetSink {
  return TARGET_SINKS.has(rule)
}

/** Strip `await`, parentheses and type-only wrappers. */
function unwrap(expr: ts.Expression): ts.Expression {
  let cur = expr
  for (;;) {
    if (ts.isAwaitExpression(cur)) cur = cur.expression
    else if (ts.isParenthesizedExpression(cur)) cur = cur.expression
    else if (ts.isAsExpression(cur)) cur = cur.expression
    else if (ts.isNonNullExpression(cur)) cur = cur.expression
    else if (ts.isTypeAssertionExpression(cur)) cur = cur.expression
    else if (ts.isSatisfiesExpression(cur)) cur = cur.expression
    else return cur
  }
}

/**
 * The call at the root of a property/element chain:
 * `(await openai.chat.completions.create(...)).choices[0].message` → the
 * `create` call; a plain call is its own root.
 */
function rootCall(expr: ts.Expression): ts.CallExpression | null {
  let cur = unwrap(expr)
  for (;;) {
    if (ts.isCallExpression(cur)) return cur
    if (ts.isPropertyAccessExpression(cur) || ts.isElementAccessExpression(cur))
      cur = unwrap(cur.expression)
    else return null
  }
}

function callRuleOf(
  rules: Parameters<typeof matchCallRule>[0],
  call: ts.CallExpression
): string | null {
  const callee = calleeText(call.expression)
  return callee === null ? null : (matchCallRule(rules, callee)?.id ?? null)
}

/** Every identifier a binding name introduces (`x`, `{ a, b: c }`, `[d]`). */
function boundNames(name: ts.BindingName, out: string[] = []): string[] {
  if (ts.isIdentifier(name)) out.push(name.text)
  else {
    for (const el of name.elements) {
      if (ts.isBindingElement(el)) boundNames(el.name, out)
    }
  }
  return out
}

/** The names each parameter of a function-like node binds, by position. */
function paramNames(node: ts.Node): string[][] {
  if (!ts.isFunctionLike(node)) return []
  return node.parameters.map(p => boundNames(p.name))
}

function isRestParam(node: ts.Node, index: number): boolean {
  if (!ts.isFunctionLike(node)) return false
  const last = node.parameters[node.parameters.length - 1]
  return (
    last !== undefined &&
    last.dotDotDotToken !== undefined &&
    index >= node.parameters.length - 1
  )
}

/**
 * Does the expression mention a tainted identifier? Property NAMES are not
 * references (`out.text` mentions `out`, not `text`; `{ sql: x }` mentions
 * `x`, not `sql`), and type positions are skipped entirely.
 */
function mentionsTainted(expr: ts.Node, tainted: ReadonlySet<string>): boolean {
  let hit = false
  const visit = (node: ts.Node): void => {
    if (hit) return
    if (ts.isTypeNode(node)) return
    if (ts.isIdentifier(node)) {
      const parent = node.parent
      if (ts.isPropertyAccessExpression(parent) && parent.name === node) return
      if (ts.isPropertyAssignment(parent) && parent.name === node) return
      if (tainted.has(node.text)) hit = true
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(expr)
  return hit
}

interface SinkHit {
  id: string
  rule: LlmOutputTargetSink
  line: number
  callee: string
}

interface CallHit {
  target: string
  /** Argument positions that carry taint. */
  args: number[]
}

interface FnFacts {
  tainted: Set<string>
  llmCalls: Array<{ line: number; callee: string }>
  sinks: SinkHit[]
  calls: CallHit[]
  hasZodParse: boolean
}

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
}

/**
 * One function's facts under a set of already-tainted names (its tainted
 * parameters). Walks the body including nested closures, but not into other
 * DECLARED functions (they are their own symbols).
 */
function analyzeFunction(
  ctx: FileCtx,
  known: ReadonlySet<string>,
  selfId: string,
  fnNode: ts.Node,
  seeds: Iterable<string>
): FnFacts {
  const tainted = new Set<string>(seeds)
  const llmCalls: FnFacts['llmCalls'] = []
  const sinks: SinkHit[] = []
  const calls: CallHit[] = []
  let hasZodParse = false

  const bindings: Array<{ names: string[]; init: ts.Expression }> = []
  const body = ts.isFunctionLike(fnNode)
    ? (fnNode as ts.FunctionLikeDeclaration).body
    : undefined
  if (!body) return { tainted, llmCalls, sinks, calls, hasZodParse }

  const collect = (node: ts.Node): void => {
    if (node !== fnNode && ctx.fnSymbols.has(node)) return
    if (ts.isVariableDeclaration(node) && node.initializer) {
      bindings.push({
        names: boundNames(node.name),
        init: node.initializer,
      })
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left)
    ) {
      bindings.push({ names: [node.left.text], init: node.right })
    }
    if (ts.isCallExpression(node)) {
      const callee = calleeText(node.expression)
      if (callee !== null) {
        if (matchCallRule(SOURCE_RULES, callee)) {
          llmCalls.push({ line: lineOf(ctx.sf, node), callee })
        }
        const control = matchCallRule(CONTROL_RULES, callee)
        if (control?.id === 'zod-parse') hasZodParse = true
      }
    }
    ts.forEachChild(node, collect)
  }
  collect(body)

  // Seed: bindings whose initializer's root call is a model call.
  for (const b of bindings) {
    const call = rootCall(b.init)
    if (call && callRuleOf(SOURCE_RULES, call)) {
      for (const n of b.names) tainted.add(n)
    }
  }
  // Propagate through bindings to a fixpoint (bounded; each pass adds names).
  for (let pass = 0; pass < 8; pass++) {
    let grew = false
    for (const b of bindings) {
      if (b.names.every(n => tainted.has(n))) continue
      const call = rootCall(b.init)
      if (call && callRuleOf(CONTROL_RULES, call) === 'zod-parse') continue
      if (!mentionsTainted(b.init, tainted)) continue
      for (const n of b.names) {
        if (!tainted.has(n)) {
          tainted.add(n)
          grew = true
        }
      }
    }
    if (!grew) break
  }
  if (tainted.size === 0)
    return { tainted, llmCalls, sinks, calls, hasZodParse }

  // Sinks and outgoing calls that receive taint.
  const scan = (node: ts.Node): void => {
    if (node !== fnNode && ctx.fnSymbols.has(node)) return
    if (ts.isCallExpression(node)) {
      const callee = calleeText(node.expression)
      if (callee !== null) {
        const line = lineOf(ctx.sf, node)
        const sink = matchCallRule(SINK_RULES, callee)
        if (sink) {
          if (
            isTargetSink(sink.id) &&
            node.arguments.some(a => mentionsTainted(a, tainted))
          ) {
            sinks.push({
              id: `${ctx.path}#${callee}@${line}`,
              rule: sink.id,
              line,
              callee,
            })
          }
        } else if (!matchCallRule(CONTROL_RULES, callee)) {
          const target = resolveCallee(ctx, known, callee)
          if (target && target !== selfId) {
            const args: number[] = []
            node.arguments.forEach((a, i) => {
              if (!ts.isSpreadElement(a) && mentionsTainted(a, tainted))
                args.push(i)
            })
            if (args.length > 0) calls.push({ target, args })
          }
        }
      }
    } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
      const ctor = node.expression.text
      const sink = matchCallRule(NEW_EXPRESSION_SINKS, ctor)
      if (
        sink &&
        isTargetSink(sink.id) &&
        (node.arguments ?? []).some(a => mentionsTainted(a, tainted))
      ) {
        const line = lineOf(ctx.sf, node)
        sinks.push({
          id: `${ctx.path}#new ${ctor}@${line}`,
          rule: sink.id,
          line,
          callee: `new ${ctor}`,
        })
      }
    }
    ts.forEachChild(node, scan)
  }
  scan(body)
  return { tainted, llmCalls, sinks, calls, hasZodParse }
}

interface FnRef {
  ctx: FileCtx
  node: ts.Node
}

function indexFunctions(build: GraphBuild): Map<string, FnRef> {
  const out = new Map<string, FnRef>()
  for (const ctx of build.ctxs) {
    for (const [node, id] of ctx.fnSymbols) out.set(id, { ctx, node })
  }
  return out
}

/** Names the callee binds for the tainted argument positions. */
function seedsForCallee(target: FnRef, args: number[]): string[] {
  const params = paramNames(target.node)
  const out: string[] = []
  for (const i of args) {
    const names = params[i]
    if (names) out.push(...names)
    else if (isRestParam(target.node, i)) {
      const last = params[params.length - 1]
      if (last) out.push(...last)
    }
  }
  return out
}

/**
 * Build the subgraph and find every llm-output → target-sink flow in it.
 */
export function findLlmOutputFlows(
  inputs: SourceFileInput[]
): LlmOutputFlowResult {
  const build = buildGraph(inputs)
  const fns = indexFunctions(build)
  const flows: LlmOutputFlow[] = []
  const seen = new Set<string>()

  const report = (
    source: LlmOutputFlow['source'],
    chain: string[],
    sinkCtx: FileCtx,
    hit: SinkHit
  ): void => {
    const key = `${source.symbol}|${hit.id}`
    if (seen.has(key)) return
    seen.add(key)
    flows.push({
      source,
      sink: {
        symbol: hit.id,
        file: sinkCtx.path,
        line: hit.line,
        callee: hit.callee,
        rule: hit.rule,
      },
      chain,
      reachability: reachability(build.subgraph, hit.id),
    })
  }

  for (const [originId, origin] of fns) {
    const facts = analyzeFunction(
      origin.ctx,
      build.known,
      originId,
      origin.node,
      []
    )
    if (facts.llmCalls.length === 0 || facts.tainted.size === 0) continue
    // A schema parse anywhere on the path is the control this rule respects.
    if (facts.hasZodParse) continue
    const first = facts.llmCalls[0]!
    const source: LlmOutputFlow['source'] = {
      symbol: originId,
      file: origin.ctx.path,
      line: first.line,
      callee: first.callee,
    }
    for (const hit of facts.sinks) report(source, [originId], origin.ctx, hit)

    const visited = new Set<string>()
    const queue: Array<{ id: string; seeds: string[]; chain: string[] }> = []
    for (const c of facts.calls) {
      const target = fns.get(c.target)
      if (!target) continue
      const seeds = seedsForCallee(target, c.args)
      if (seeds.length > 0)
        queue.push({ id: c.target, seeds, chain: [originId, c.target] })
    }
    while (queue.length > 0) {
      const item = queue.shift()!
      const hops = item.chain.length - 1
      if (hops > LLM_OUTPUT_FLOW_MAX_HOPS) continue
      const key = `${item.id}|${[...item.seeds].sort().join(',')}`
      if (visited.has(key)) continue
      visited.add(key)
      const ref = fns.get(item.id)
      if (!ref) continue
      const inner = analyzeFunction(
        ref.ctx,
        build.known,
        item.id,
        ref.node,
        item.seeds
      )
      if (inner.hasZodParse) continue
      for (const hit of inner.sinks) report(source, item.chain, ref.ctx, hit)
      for (const c of inner.calls) {
        if (item.chain.includes(c.target)) continue
        const target = fns.get(c.target)
        if (!target) continue
        const seeds = seedsForCallee(target, c.args)
        if (seeds.length > 0)
          queue.push({
            id: c.target,
            seeds,
            chain: [...item.chain, c.target],
          })
      }
    }
  }
  return { subgraph: build.subgraph, flows }
}
