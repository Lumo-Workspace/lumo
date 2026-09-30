import path from 'path'
import ts from 'typescript'

/**
 * LUM-877 — the import audit behind the ZDR "no bypass" guard
 * (`__tests__/lib/ai/zdr-gateway.test.ts`). It reads each module's import
 * graph edges from the TypeScript AST instead of regex-matching source text,
 * so comments, aliases (`{ gateway as g }`), namespace / default / `require` /
 * `import()` / re-export forms and `import type` are all told apart.
 */

export const ZDR_WRAPPER = path.join('lib', 'ai', 'gateway.ts')

type RefKind =
  | 'side-effect' // import '<spec>'
  | 'import' // import { a } / import d / import * as ns
  | 'export' // export … from '<spec>'
  | 'dynamic' // import('<spec>')
  | 'require' // require('<spec>') / import x = require('<spec>')

export interface ImportRef {
  specifier: string
  kind: RefKind
  /** Erased by the compiler (`import type`, all-`type` specifiers). */
  typeOnly: boolean
  /** Imported (original) names; `null` = the whole module object, not analysable by name. */
  names: string[] | null
}

function bindingNames(pattern: ts.ObjectBindingPattern): string[] | null {
  const names: string[] = []
  for (const el of pattern.elements) {
    if (el.dotDotDotToken) return null // `...rest` holds every export
    const key = el.propertyName ?? el.name
    if (!ts.isIdentifier(key) && !ts.isStringLiteral(key)) return null
    names.push(key.text)
  }
  return names
}

/** `const { a } = await import(x)` / `(await import(x)).a` → the names; otherwise null. */
function dynamicImportNames(call: ts.CallExpression): string[] | null {
  let node: ts.Node = call
  while (ts.isParenthesizedExpression(node.parent)) node = node.parent
  if (!ts.isAwaitExpression(node.parent)) return null
  node = node.parent
  while (ts.isParenthesizedExpression(node.parent)) node = node.parent
  const parent = node.parent
  if (
    ts.isVariableDeclaration(parent) &&
    ts.isObjectBindingPattern(parent.name)
  )
    return bindingNames(parent.name)
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node)
    return [parent.name.text]
  return null
}

export function collectImports(fileName: string, source: string): ImportRef[] {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    /\.[jt]sx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const refs: ImportRef[] = []

  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const specifier = node.moduleSpecifier.text
      const clause = node.importClause
      if (!clause) {
        refs.push({
          specifier,
          kind: 'side-effect',
          typeOnly: false,
          names: [],
        })
      } else {
        const named =
          clause.namedBindings && ts.isNamedImports(clause.namedBindings)
            ? clause.namedBindings.elements
            : null
        const wholeModule =
          !!clause.name ||
          (!!clause.namedBindings && ts.isNamespaceImport(clause.namedBindings))
        const values = named ? named.filter(e => !e.isTypeOnly) : []
        refs.push({
          specifier,
          kind: 'import',
          typeOnly: clause.isTypeOnly || (!wholeModule && values.length === 0),
          names: wholeModule
            ? null
            : values.map(e => (e.propertyName ?? e.name).text),
        })
      }
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const clause = node.exportClause
      const values =
        clause && ts.isNamedExports(clause)
          ? clause.elements.filter(e => !e.isTypeOnly)
          : null
      refs.push({
        specifier: node.moduleSpecifier.text,
        kind: 'export',
        typeOnly: node.isTypeOnly || (values !== null && values.length === 0),
        names: values ? values.map(e => (e.propertyName ?? e.name).text) : null,
      })
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      refs.push({
        specifier: node.moduleReference.expression.text,
        kind: 'require',
        typeOnly: node.isTypeOnly,
        names: null,
      })
    } else if (ts.isCallExpression(node) && node.arguments.length >= 1) {
      const arg = node.arguments[0]!
      const literal =
        ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)
      if (literal && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        refs.push({
          specifier: arg.text,
          kind: 'dynamic',
          typeOnly: false,
          names: dynamicImportNames(node),
        })
      } else if (
        literal &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'require'
      ) {
        refs.push({
          specifier: arg.text,
          kind: 'require',
          typeOnly: false,
          names: null,
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return refs
}

/** Does `specifier`, imported from repo-relative `fromFile`, resolve to lib/ai/gateway? */
export function isZdrWrapper(specifier: string, fromFile: string): boolean {
  if (specifier === '@/lib/ai/gateway') return true
  if (!specifier.startsWith('.')) return false
  const resolved = path.normalize(path.join(path.dirname(fromFile), specifier))
  return (
    resolved.replace(/\.(ts|js)$/, '') === path.join('lib', 'ai', 'gateway')
  )
}

const isAiPackage = (s: string) => s === 'ai' || s.startsWith('ai/')
// Any model-provider SDK talks to a model without the gateway, let alone ZDR.
const PROVIDER_SDK =
  /^(?:@ai-sdk\/|@anthropic-ai\/|openai(?:\/|$)|@google\/(?:genai|generative-ai)|@mistralai\/|groq-sdk$|cohere-ai$|@openrouter\/|ollama(?:\/|$)|@huggingface\/inference$|replicate$|together-ai$)/
// `ai` re-exports the UNWRAPPED `gateway` / `createGateway` (no ZDR fetch).
const GATEWAY_NAME = /gateway/i
/**
 * Value exports of `ai` that never send a request — error classes and schema /
 * tool helpers. An allowlist on purpose: any other value import (including
 * functions added in future `ai` releases, e.g. `experimental_transcribe`)
 * counts as a model call site.
 */
export const AI_NON_MODEL_EXPORTS = new Set([
  'APICallError',
  'NoObjectGeneratedError',
  'jsonSchema',
  'zodSchema',
  'tool',
  'stepCountIs',
  'hasToolCall',
])

/**
 * Violations for a runtime module (app, lib, root files …). A module that
 * imports a model function from `ai` must carry a bare side-effect import of
 * the wrapper — `import '@/lib/ai/gateway'` — because only that form survives
 * compilation unconditionally: TypeScript drops a named import whose bindings
 * go unused, and `import type` entirely. Dynamic-only use of `ai` may instead
 * load the wrapper with `import()`.
 */
export function auditRuntimeModule(file: string, source: string): string[] {
  const refs = collectImports(file, source)
  const out: string[] = []
  let staticCall = false
  let dynamicCall = false

  for (const ref of refs) {
    if (ref.typeOnly) continue
    const spec = ref.specifier
    if (PROVIDER_SDK.test(spec)) {
      if (!(file === ZDR_WRAPPER && spec === '@ai-sdk/gateway'))
        out.push(`provider SDK '${spec}' bypasses lib/ai/gateway`)
      continue
    }
    if (!isAiPackage(spec)) continue
    if (ref.kind === 'export') {
      out.push(`re-exports '${spec}' — call sites must import it themselves`)
      continue
    }
    if (ref.kind === 'side-effect') continue
    if (ref.names === null) {
      out.push(
        `${ref.kind} of '${spec}' without named bindings cannot be audited — use named imports`
      )
      continue
    }
    for (const n of ref.names.filter(n => GATEWAY_NAME.test(n)))
      out.push(`'${n}' from '${spec}' is the unwrapped gateway (no ZDR)`)
    if (ref.names.some(n => !AI_NON_MODEL_EXPORTS.has(n))) {
      if (ref.kind === 'dynamic') dynamicCall = true
      else staticCall = true
    }
  }

  const wrapperRefs = refs.filter(
    r => !r.typeOnly && isZdrWrapper(r.specifier, file)
  )
  const sideEffectLoad = wrapperRefs.some(r => r.kind === 'side-effect')
  const dynamicLoad = wrapperRefs.some(r => r.kind === 'dynamic')
  if (staticCall && !sideEffectLoad)
    out.push(
      "imports an 'ai' model function without `import '@/lib/ai/gateway'`"
    )
  else if (dynamicCall && !sideEffectLoad && !dynamicLoad)
    out.push(
      "dynamic-imports an 'ai' model function without loading lib/ai/gateway"
    )
  return out
}

/** Is this module an `ai` model call site (a value import beyond the non-model allowlist)? */
export function isAiCallSite(file: string, source: string): boolean {
  return collectImports(file, source).some(
    r =>
      !r.typeOnly &&
      isAiPackage(r.specifier) &&
      r.kind !== 'side-effect' &&
      (r.names === null || r.names.some(n => !AI_NON_MODEL_EXPORTS.has(n)))
  )
}

/** Scripts: does this module reach the AI Gateway around the ZDR wrapper? */
export function importsUnwrappedGateway(file: string, source: string): boolean {
  return collectImports(file, source).some(
    r =>
      !r.typeOnly &&
      (r.specifier === '@ai-sdk/gateway' ||
        (isAiPackage(r.specifier) &&
          r.kind !== 'side-effect' &&
          (r.names === null || r.names.some(n => GATEWAY_NAME.test(n)))))
  )
}
