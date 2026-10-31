/**
 * @jest-environment node
 *
 * LUM-1344 — every `app/api/admin/**\/route.ts` is platform-admin only: each
 * exported HTTP handler must call `requirePlatformAdmin` imported from
 * `@/lib/auth/platform-admin`. The repo-wide auth-guard coverage test only
 * asks that a route authenticates *somehow*; this one pins the admin surface
 * to the admin guard, per handler (a GET guarded next to an unguarded POST
 * fails here).
 *
 * TypeScript AST, not text search: a guard name in a comment or string, or a
 * local function that happens to be called `requirePlatformAdmin`, does not
 * count.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, posix, relative } from 'node:path'
import ts from 'typescript'

const ROOT = join(__dirname, '..', '..')
const ADMIN_DIR = join(ROOT, 'app', 'api', 'admin')
const GUARD = 'requirePlatformAdmin'
const GUARD_MODULE = '@/lib/auth/platform-admin'

const HTTP_METHODS = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
])

function listRouteFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listRouteFiles(full))
    else if (entry.name === 'route.ts') out.push(full)
  }
  return out.sort()
}

/** Local names bound to the guard by `import { requirePlatformAdmin [as x] }`. */
function guardLocalNames(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>()
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue
    if (stmt.moduleSpecifier.text !== GUARD_MODULE) continue
    const bindings = stmt.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue
    for (const el of bindings.elements) {
      const imported = (el.propertyName ?? el.name).text
      if (imported === GUARD) names.add(el.name.text)
    }
  }
  return names
}

function callsGuard(body: ts.Node, guards: Set<string>): boolean {
  let found = false
  const visit = (node: ts.Node): void => {
    if (found) return
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      guards.has(node.expression.text)
    ) {
      found = true
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(body)
  return found
}

function isExported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some(
      m => m.kind === ts.SyntaxKind.ExportKeyword
    )
  )
}

/**
 * Exported HTTP handlers of a route source → whether each calls the guard.
 * Re-exports (`export { GET } from …`) are reported as unguarded: the admin
 * surface must guard in the file itself.
 */
function scanAdminRoute(
  source: string,
  fileName = 'route.ts'
): Map<string, boolean> {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const guards = guardLocalNames(sf)
  const handlers = new Map<string, boolean>()
  for (const stmt of sf.statements) {
    if (
      ts.isFunctionDeclaration(stmt) &&
      isExported(stmt) &&
      stmt.name &&
      HTTP_METHODS.has(stmt.name.text)
    ) {
      handlers.set(stmt.name.text, !!stmt.body && callsGuard(stmt.body, guards))
    } else if (ts.isVariableStatement(stmt) && isExported(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue
        if (!HTTP_METHODS.has(decl.name.text)) continue
        handlers.set(
          decl.name.text,
          !!decl.initializer && callsGuard(decl.initializer, guards)
        )
      }
    } else if (ts.isExportDeclaration(stmt) && stmt.exportClause) {
      if (!ts.isNamedExports(stmt.exportClause)) continue
      for (const el of stmt.exportClause.elements) {
        if (HTTP_METHODS.has(el.name.text)) handlers.set(el.name.text, false)
      }
    }
  }
  return handlers
}

const files = listRouteFiles(ADMIN_DIR)
const rel = (f: string) => relative(ROOT, f).split(/[\\/]/).join(posix.sep)

describe('app/api/admin routes require platform admin (LUM-1344)', () => {
  it('finds admin route files', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files.map(f => [rel(f), f]))(
    '%s guards every exported handler',
    (_name, file) => {
      const handlers = scanAdminRoute(readFileSync(file, 'utf8'), file)
      expect(handlers.size).toBeGreaterThan(0)
      const unguarded = [...handlers].filter(([, ok]) => !ok).map(([m]) => m)
      expect(unguarded).toEqual([])
    }
  )
})

describe('scanAdminRoute', () => {
  const IMPORT = `import { requirePlatformAdmin } from '@/lib/auth/platform-admin'\n`

  it('accepts a guarded function handler and an aliased import', () => {
    const src = `import { requirePlatformAdmin as gate } from '@/lib/auth/platform-admin'
      export async function GET(r: Request) { const a = await gate(r); return a }`
    expect([...scanAdminRoute(src)]).toEqual([['GET', true]])
  })

  it('flags an unguarded handler next to a guarded one', () => {
    const src = `${IMPORT}
      export async function GET(r: Request) { return requirePlatformAdmin(r) }
      export const POST = async (r: Request) => new Response('ok')`
    expect([...scanAdminRoute(src)]).toEqual([
      ['GET', true],
      ['POST', false],
    ])
  })

  it('does not count a comment, a string, or a local look-alike', () => {
    const src = `function requirePlatformAdmin(_r: Request) { return null }
      // requirePlatformAdmin(request)
      export async function GET(r: Request) {
        requirePlatformAdmin(r); return new Response('requirePlatformAdmin(r)')
      }`
    expect([...scanAdminRoute(src)]).toEqual([['GET', false]])
  })

  it('does not count the guard imported from another module', () => {
    const src = `import { requirePlatformAdmin } from '@/lib/auth'
      export async function GET(r: Request) { return requirePlatformAdmin(r) }`
    expect([...scanAdminRoute(src)]).toEqual([['GET', false]])
  })

  it('treats a re-exported handler as unguarded', () => {
    const src = `export { GET } from '../other/route'`
    expect([...scanAdminRoute(src)]).toEqual([['GET', false]])
  })
})
