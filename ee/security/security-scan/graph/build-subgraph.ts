/**
 * LUM-739 — build the diff subgraph from TS/TSX sources with the typescript
 * compiler API (spec §6 L3 "Map"). Pure: sources in, `Subgraph` out; no
 * file system, no network. Two passes — declare every function-like symbol
 * across all files first, then link calls — so cross-file edges resolve
 * regardless of input order.
 *
 * Deliberately shallow: no type checker (no Program), so a call resolves to
 * a symbol only by lexical name (same file) or by import binding (other
 * file). Unresolved calls produce no edge — the graph under-approximates,
 * which is the safe direction for a layer that can only REJECT candidates
 * whose chain is not in the graph.
 */
import ts from 'typescript'
import {
  ENTRY_RULES,
  SINK_RULES,
  CONTROL_RULES,
  NEW_EXPRESSION_SINKS,
  matchCallRule,
  type EntryRule,
} from './patterns'
import { resolveImportCandidates } from './imports'
import type { Subgraph, GraphSymbol, GraphEdge, GraphFile } from './types'

export interface SourceFileInput {
  path: string
  source: string
  touched: boolean
}

/** Lines actually present (a trailing newline does not add an empty line). */
export function countLines(source: string): number {
  if (source.length === 0) return 0
  const n = source.split('\n').length
  return source.endsWith('\n') ? n - 1 : n
}

function parse(path: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
}

/** Module specifiers of every `import … from` / `export … from` in the file. */
export function listImports(path: string, source: string): string[] {
  const sf = parse(path, source)
  const out: string[] = []
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      out.push(st.moduleSpecifier.text)
    } else if (
      ts.isExportDeclaration(st) &&
      st.moduleSpecifier &&
      ts.isStringLiteral(st.moduleSpecifier)
    ) {
      out.push(st.moduleSpecifier.text)
    }
  }
  return out
}

// ── internals ───────────────────────────────────────────────────────────────

export interface ImportBinding {
  module: string
  /** Exported name, `'default'`, or `'*'` for a namespace import. */
  imported: string
}

/**
 * One parsed input file. Exported (LUM-785) so `llm-output-flow.ts` can run
 * its own pass over the same parse and the same symbol ids the subgraph
 * carries, instead of re-deriving either.
 */
export interface FileCtx {
  path: string
  sf: ts.SourceFile
  useServer: boolean
  imports: Map<string, ImportBinding>
  /** function-like node → symbol id */
  fnSymbols: Map<ts.Node, string>
}

class GraphBuilder {
  readonly symbols = new Map<string, GraphSymbol>()
  readonly edges = new Map<string, GraphEdge>()

  addSymbol(s: GraphSymbol): void {
    if (!this.symbols.has(s.id)) this.symbols.set(s.id, s)
  }

  addEdge(from: string, to: string): void {
    const key = `${from}->${to}`
    if (!this.edges.has(key)) this.edges.set(key, { from, to })
  }
}

function hasExportModifier(node: ts.Node): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
  return mods?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
}

function hasDefaultModifier(node: ts.Node): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
  return mods?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false
}

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
}

function isFunctionLike(
  node: ts.Node
): node is ts.ArrowFunction | ts.FunctionExpression {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node)
}

function entryRuleFor(
  ctx: FileCtx,
  name: string,
  exported: boolean
): EntryRule | null {
  if (!exported) return null
  for (const rule of ENTRY_RULES) {
    if (!rule.file.test(ctx.path)) continue
    if (rule.name && !rule.name.test(name)) continue
    if (rule.directive && !ctx.useServer) continue
    return rule
  }
  return null
}

function detectUseServer(sf: ts.SourceFile): boolean {
  const first = sf.statements[0]
  return (
    first !== undefined &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === 'use server'
  )
}

function collectImports(sf: ts.SourceFile): Map<string, ImportBinding> {
  const out = new Map<string, ImportBinding>()
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier))
      continue
    const moduleSpec = st.moduleSpecifier.text
    const clause = st.importClause
    if (!clause) continue
    if (clause.name)
      out.set(clause.name.text, { module: moduleSpec, imported: 'default' })
    const bindings = clause.namedBindings
    if (!bindings) continue
    if (ts.isNamespaceImport(bindings)) {
      out.set(bindings.name.text, { module: moduleSpec, imported: '*' })
    } else {
      for (const el of bindings.elements) {
        out.set(el.name.text, {
          module: moduleSpec,
          imported: el.propertyName?.text ?? el.name.text,
        })
      }
    }
  }
  return out
}

/** Pass 1: every named function-like declaration becomes a symbol. */
function declare(ctx: FileCtx, g: GraphBuilder): void {
  const { sf, path } = ctx
  const add = (node: ts.Node, name: string, exported: boolean): void => {
    const rule = entryRuleFor(ctx, name, exported)
    const id = `${path}#${name}`
    g.addSymbol({
      id,
      kind: rule ? 'entry' : 'function',
      file: path,
      line: lineOf(sf, node),
      name,
      rule: rule?.id ?? null,
      controls: [],
    })
    ctx.fnSymbols.set(node, id)
  }

  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st)) {
      const name =
        st.name?.text ?? (hasDefaultModifier(st) ? 'default' : undefined)
      if (name) add(st, name, hasExportModifier(st))
    } else if (ts.isVariableStatement(st)) {
      const exported = hasExportModifier(st)
      for (const decl of st.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue
        const varName = decl.name.text
        const init = decl.initializer
        if (isFunctionLike(init)) {
          add(init, varName, exported)
        } else if (ts.isObjectLiteralExpression(init)) {
          for (const prop of init.properties) {
            if (ts.isMethodDeclaration(prop) && ts.isIdentifier(prop.name)) {
              add(prop, `${varName}.${prop.name.text}`, exported)
            } else if (
              ts.isPropertyAssignment(prop) &&
              ts.isIdentifier(prop.name) &&
              isFunctionLike(prop.initializer)
            ) {
              add(prop.initializer, `${varName}.${prop.name.text}`, exported)
            }
          }
        }
      }
    } else if (ts.isClassDeclaration(st) && st.name) {
      const className = st.name.text
      const exported = hasExportModifier(st)
      for (const member of st.members) {
        if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name)) {
          add(member, `${className}.${member.name.text}`, exported)
        }
      }
    }
  }
}

/** `a.b.c` for a property chain of identifiers (or `this`); null otherwise. */
export function calleeText(expr: ts.Expression): string | null {
  if (ts.isIdentifier(expr)) return expr.text
  if (expr.kind === ts.SyntaxKind.ThisKeyword) return 'this'
  if (ts.isPropertyAccessExpression(expr)) {
    const left = calleeText(expr.expression)
    if (left === null) return null
    return `${left}.${expr.name.text}`
  }
  return null
}

/**
 * The symbol id a dotted callee resolves to — same file by lexical name, or
 * another input file through an import binding — or null when the graph
 * does not know it (bare packages, unresolved names). Shared by the call-edge
 * pass and the LUM-785 llm-output flow pass so both see the same edges.
 */
export function resolveCallee(
  ctx: FileCtx,
  known: ReadonlySet<string>,
  callee: string
): string | null {
  const local = `${ctx.path}#${callee}`
  if (known.has(local)) return local
  const dot = callee.indexOf('.')
  const head = dot === -1 ? callee : callee.slice(0, dot)
  const rest = dot === -1 ? '' : callee.slice(dot + 1)
  const binding = ctx.imports.get(head)
  if (!binding) return null
  for (const cand of resolveImportCandidates(ctx.path, binding.module)) {
    let name: string
    if (binding.imported === '*') {
      if (!rest) return null
      name = rest
    } else {
      name = rest ? `${binding.imported}.${rest}` : binding.imported
    }
    const id = `${cand}#${name}`
    if (known.has(id)) return id
  }
  return null
}

/** Pass 2: sinks, controls and call edges. */
function link(ctx: FileCtx, g: GraphBuilder, known: Set<string>): void {
  const { sf, path } = ctx
  const moduleId = `${path}#<module>`

  const enclosingOf = (node: ts.Node): string => {
    let cur: ts.Node | undefined = node.parent
    while (cur) {
      const id = ctx.fnSymbols.get(cur)
      if (id) return id
      cur = cur.parent
    }
    g.addSymbol({
      id: moduleId,
      kind: 'module',
      file: path,
      line: 1,
      name: '<module>',
      rule: null,
      controls: [],
    })
    return moduleId
  }

  const resolveTarget = (callee: string): string | null =>
    resolveCallee(ctx, known, callee)

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = calleeText(node.expression)
      if (callee !== null) {
        const from = enclosingOf(node)
        const line = lineOf(sf, node)
        const sink = matchCallRule(SINK_RULES, callee)
        const control = sink ? null : matchCallRule(CONTROL_RULES, callee)
        if (sink) {
          const id = `${path}#${callee}@${line}`
          g.addSymbol({
            id,
            kind: 'sink',
            file: path,
            line,
            name: callee,
            rule: sink.id,
            controls: [],
          })
          g.addEdge(from, id)
        } else if (control) {
          const id = `${path}#${callee}@${line}`
          g.addSymbol({
            id,
            kind: 'control',
            file: path,
            line,
            name: callee,
            rule: control.id,
            controls: [],
          })
          g.addEdge(from, id)
          const owner = g.symbols.get(from)
          if (owner && !owner.controls.includes(control.id))
            owner.controls.push(control.id)
        } else {
          const target = resolveTarget(callee)
          if (target && target !== from) g.addEdge(from, target)
        }
      }
    } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
      const ctor = node.expression.text
      const sink = matchCallRule(NEW_EXPRESSION_SINKS, ctor)
      if (sink) {
        const from = enclosingOf(node)
        const line = lineOf(sf, node)
        const id = `${path}#new ${ctor}@${line}`
        g.addSymbol({
          id,
          kind: 'sink',
          file: path,
          line,
          name: `new ${ctor}`,
          rule: sink.id,
          controls: [],
        })
        g.addEdge(from, id)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

/** The subgraph plus the parse it was built from (LUM-785). */
export interface GraphBuild {
  subgraph: Subgraph
  ctxs: FileCtx[]
  /** Every function-like symbol id declared across the inputs. */
  known: ReadonlySet<string>
}

export function buildGraph(inputs: SourceFileInput[]): GraphBuild {
  const g = new GraphBuilder()
  const ctxs: FileCtx[] = inputs.map(i => {
    const sf = parse(i.path, i.source)
    return {
      path: i.path,
      sf,
      useServer: detectUseServer(sf),
      imports: collectImports(sf),
      fnSymbols: new Map(),
    }
  })
  for (const ctx of ctxs) declare(ctx, g)
  const known = new Set(g.symbols.keys())
  for (const ctx of ctxs) link(ctx, g, known)
  const files: GraphFile[] = inputs.map(i => ({
    path: i.path,
    lineCount: countLines(i.source),
    touched: i.touched,
  }))
  return {
    subgraph: {
      symbols: [...g.symbols.values()],
      edges: [...g.edges.values()],
      files,
    },
    ctxs,
    known,
  }
}

export function buildSubgraph(inputs: SourceFileInput[]): Subgraph {
  return buildGraph(inputs).subgraph
}
