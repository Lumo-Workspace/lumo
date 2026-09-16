/**
 * LUM-794 — the deterministic "agent loop with no budget" rule (spec §6 L3,
 * third defect class). Pure: sources in, findings out; no I/O.
 *
 * What it decides: a model call (`SOURCE_RULES`, the same `llm-output` table
 * LUM-785 uses) sits inside a loop that has no way to end other than the
 * model choosing to stop — `while (true)` / `do … while (true)` / `for (;;)`
 * with no `break`, no `return`, no `throw` and no counter comparison anywhere
 * inside it, or a function that calls itself with a model call in between and
 * no guard of any kind in its body.
 *
 * The semgrep half of this task (`security/semgrep-rules/llm.yaml`) covers
 * the AI SDK's own shape — `tools:` with no `stopWhen` / `maxSteps`. This
 * half covers the loop a caller writes by hand around ANY model client,
 * which no single-call pattern can see.
 *
 * Under-approximates on purpose (宁可漏不可噪, the LUM-785 口径): ANY exit
 * path it can see, and any comparison that could be a counter check, silences
 * the loop. What survives is a loop with literally no way out — which is why
 * a hit is stamped DETERMINISTIC by stage A without a model or the falsifier
 * ever seeing it. Severity is MEDIUM for every shape: an unbounded agent loop
 * is a cost and availability defect, not a data-flow one, so it never blocks
 * DONE under the default policy.
 */
import ts from 'typescript'
import {
  buildGraph,
  calleeText,
  resolveCallee,
  type FileCtx,
  type SourceFileInput,
} from './build-subgraph'
import { SOURCE_RULES, matchCallRule } from './patterns'
import { reachability, type Reachability } from './query'
import type { Subgraph } from './types'

export const AGENT_LOOP_RULE_PREFIX = 'agent-loop-unbounded'

export const AGENT_LOOP_SHAPES = [
  'while-true',
  'for-ever',
  'recursion',
] as const
export type AgentLoopShape = (typeof AGENT_LOOP_SHAPES)[number]

export const AGENT_LOOP_SHAPE_META: Record<
  AgentLoopShape,
  { label: string; cwe: string }
> = {
  // No backticks in these strings: every finding field goes through
  // `redactKnownSecrets`, whose generic backtick-quoted-token pattern would
  // otherwise redact the shape out of our own title (`whil…(len 12)`).
  'while-true': {
    label: 'a while (true) loop with no exit path',
    cwe: 'CWE-770',
  },
  'for-ever': {
    label: 'a for (;;) loop with no exit path',
    cwe: 'CWE-770',
  },
  recursion: {
    label: 'unguarded self-recursion',
    cwe: 'CWE-674',
  },
}

/** Every shape is a cost/availability defect, never a data-flow one. */
export const AGENT_LOOP_SEVERITY = 'MEDIUM' as const

export interface AgentLoopFinding {
  shape: AgentLoopShape
  /** The enclosing function's symbol id (`<file>#<name>`). */
  symbol: string
  file: string
  /** 1-based line of the loop statement, or of the self-recursive function. */
  line: number
  /** The model call the loop re-issues. */
  call: {
    /** The call-site node id when the subgraph has one, else null. */
    symbol: string | null
    line: number
    callee: string
  }
  reachability: Reachability
}

export interface AgentLoopResult {
  subgraph: Subgraph
  findings: AgentLoopFinding[]
}

// ── internals ───────────────────────────────────────────────────────────────

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
}

/** `while (true)` / `while (1)` — the only constants this rule reads. */
function isAlwaysTrue(expr: ts.Expression | undefined): boolean {
  if (!expr) return false
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return true
  return ts.isNumericLiteral(expr) && expr.text === '1'
}

const COMPARISON_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
])

/**
 * Anything that could end the loop, or could be the counter check that
 * bounds it. Nested functions are walked too: their `return` is not this
 * loop's exit, but reading it as one only ever SUPPRESSES a report, which is
 * the direction this layer errs in.
 */
function hasExitPath(node: ts.Node): boolean {
  let found = false
  const visit = (n: ts.Node): void => {
    if (found) return
    if (
      ts.isBreakStatement(n) ||
      ts.isReturnStatement(n) ||
      ts.isThrowStatement(n) ||
      ts.isSwitchStatement(n)
    ) {
      found = true
      return
    }
    if (
      ts.isBinaryExpression(n) &&
      COMPARISON_OPERATORS.has(n.operatorToken.kind)
    ) {
      found = true
      return
    }
    ts.forEachChild(n, visit)
  }
  visit(node)
  return found
}

/**
 * A guard of any kind in the body of a self-recursive function: an `if`, a
 * ternary, a `&&` / `||` / `??` short circuit, a comparison, a `throw`. One
 * of these is where a depth cap would live, and this rule cannot tell which
 * one it is — so any of them means "not decidable", not "unbounded".
 */
function hasRecursionGuard(node: ts.Node): boolean {
  let found = false
  const visit = (n: ts.Node): void => {
    if (found) return
    if (
      ts.isIfStatement(n) ||
      ts.isConditionalExpression(n) ||
      ts.isSwitchStatement(n) ||
      ts.isThrowStatement(n)
    ) {
      found = true
      return
    }
    if (ts.isBinaryExpression(n)) {
      const op = n.operatorToken.kind
      if (
        COMPARISON_OPERATORS.has(op) ||
        op === ts.SyntaxKind.AmpersandAmpersandToken ||
        op === ts.SyntaxKind.BarBarToken ||
        op === ts.SyntaxKind.QuestionQuestionToken
      ) {
        found = true
        return
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(node)
  return found
}

interface LlmCallHit {
  line: number
  callee: string
}

/**
 * Model calls inside `root`, not descending into OTHER declared functions
 * (those are their own symbols, analysed on their own turn).
 */
function llmCallsIn(
  ctx: FileCtx,
  root: ts.Node,
  stopAtFnSymbols: boolean
): LlmCallHit[] {
  const hits: LlmCallHit[] = []
  const visit = (n: ts.Node): void => {
    if (n !== root && stopAtFnSymbols && ctx.fnSymbols.has(n)) return
    if (ts.isCallExpression(n)) {
      const callee = calleeText(n.expression)
      if (callee !== null && matchCallRule(SOURCE_RULES, callee)) {
        hits.push({ line: lineOf(ctx.sf, n), callee })
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(root)
  return hits
}

/** The loop statements directly inside one function body, with their shape. */
function unboundedLoopsIn(
  ctx: FileCtx,
  fnNode: ts.Node,
  body: ts.Node
): Array<{ node: ts.Node; shape: AgentLoopShape }> {
  const out: Array<{ node: ts.Node; shape: AgentLoopShape }> = []
  const visit = (n: ts.Node): void => {
    if (n !== fnNode && ctx.fnSymbols.has(n)) return
    let shape: AgentLoopShape | null = null
    if (ts.isWhileStatement(n) && isAlwaysTrue(n.expression))
      shape = 'while-true'
    else if (ts.isDoStatement(n) && isAlwaysTrue(n.expression))
      shape = 'while-true'
    else if (ts.isForStatement(n) && n.condition === undefined)
      shape = 'for-ever'
    if (shape !== null) {
      out.push({ node: n, shape })
      // A loop nested inside an unbounded one adds nothing: the outer one is
      // already the finding.
      return
    }
    ts.forEachChild(n, visit)
  }
  visit(body)
  return out
}

function bodyOf(node: ts.Node): ts.Node | undefined {
  return ts.isFunctionLike(node)
    ? (node as ts.FunctionLikeDeclaration).body
    : undefined
}

/** Does this function call itself? Resolved through the graph's own table. */
function callsItself(
  ctx: FileCtx,
  known: ReadonlySet<string>,
  selfId: string,
  fnNode: ts.Node,
  body: ts.Node
): boolean {
  let found = false
  const visit = (n: ts.Node): void => {
    if (found) return
    if (n !== fnNode && ctx.fnSymbols.has(n)) return
    if (ts.isCallExpression(n)) {
      const callee = calleeText(n.expression)
      if (callee !== null && resolveCallee(ctx, known, callee) === selfId) {
        found = true
        return
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(body)
  return found
}

/**
 * Build the subgraph and find every unbounded agent loop in it.
 */
export function findUnboundedAgentLoops(
  inputs: SourceFileInput[]
): AgentLoopResult {
  const build = buildGraph(inputs)
  const findings: AgentLoopFinding[] = []
  const seen = new Set<string>()

  const push = (
    ctx: FileCtx,
    symbol: string,
    shape: AgentLoopShape,
    line: number,
    hit: LlmCallHit
  ): void => {
    const key = `${symbol}|${shape}|${line}`
    if (seen.has(key)) return
    seen.add(key)
    const callSymbol = `${ctx.path}#${hit.callee}@${hit.line}`
    const known = build.subgraph.symbols.some(s => s.id === callSymbol)
    findings.push({
      shape,
      symbol,
      file: ctx.path,
      line,
      call: {
        symbol: known ? callSymbol : null,
        line: hit.line,
        callee: hit.callee,
      },
      reachability: known
        ? reachability(build.subgraph, callSymbol)
        : 'UNKNOWN',
    })
  }

  for (const ctx of build.ctxs) {
    for (const [fnNode, symbol] of ctx.fnSymbols) {
      const body = bodyOf(fnNode)
      if (!body) continue

      for (const loop of unboundedLoopsIn(ctx, fnNode, body)) {
        const calls = llmCallsIn(ctx, loop.node, false)
        if (calls.length === 0) continue
        if (hasExitPath(loop.node)) continue
        push(ctx, symbol, loop.shape, lineOf(ctx.sf, loop.node), calls[0]!)
      }

      const direct = llmCallsIn(ctx, body, true)
      if (direct.length === 0) continue
      if (!callsItself(ctx, build.known, symbol, fnNode, body)) continue
      if (hasRecursionGuard(body)) continue
      push(ctx, symbol, 'recursion', lineOf(ctx.sf, fnNode), direct[0]!)
    }
  }

  return { subgraph: build.subgraph, findings }
}
