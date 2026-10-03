import fs from 'fs'
import path from 'path'
import ts from 'typescript'

/**
 * LUM-889 — the AST audit behind the GitHub token-mint guard
 * (`__tests__/lib/integrations/github/token-mint-guard.lum889.test.ts`).
 *
 * LUM-883 narrowed every installation token to one confirmed repository; its
 * regex guard missed aliased imports, dynamic `import()` / `require`, the
 * unscoped helpers, a hand-built `access_tokens` POST under the App JWT, and
 * allowed whole files rather than call sites. This walks the TypeScript AST
 * (same approach as the LUM-877 ZDR guard, `zdr-import-audit.ts`) so the
 * import FORM does not matter — what is checked is which mint a module can
 * reach and from which function it calls it.
 */

/** Where the mint is implemented — the only module that may touch the App's own credentials. */
export const AUTH_IMPLEMENTATION = path.join(
  'lib',
  'integrations',
  'github',
  'auth.ts'
)
/** The public barrel; it re-exports the checked mints and nothing unchecked. */
export const GITHUB_BARREL = path.join(
  'lib',
  'integrations',
  'github',
  'index.ts'
)

/**
 * Functions of the auth module that mint WITHOUT the confirmed-list check
 * (or, for `getGithubAppJwt`, hand out the credential every mint is made
 * with). Each use outside `auth.ts` must be a call site on the allowlist.
 */
export const UNCHECKED_MINTS = [
  'createInstallationToken',
  'createRepoScopedToken',
  'createRepoTokenForInstallation',
  'getGithubAppJwt',
] as const
export type UncheckedMint = (typeof UNCHECKED_MINTS)[number]

/** The pre-LUM-883 workspace-wide helper; it must not come back under any import. */
const REMOVED_HELPERS = new Set(['getGithubInstallationToken'])

/** Mints the barrel may re-export. The other two stay internal (LUM-889). */
const BARREL_REEXPORTS = new Set<string>([
  'createInstallationToken',
  'getGithubAppJwt',
])

/**
 * Packages that can sign as the App or mint an installation token on their
 * own — reaching any of them bypasses `auth.ts` entirely.
 */
const APP_AUTH_PACKAGE =
  /^(?:@octokit\/auth-app|@octokit\/app|octokit|universal-github-app-jwt)(?:\/|$)/

/** `POST /app/installations/{id}/access_tokens` — a mint by hand under the App JWT. */
const ACCESS_TOKENS_ENDPOINT = /access_tokens/

/**
 * file → mint → the functions in that file allowed to use it. A file on this
 * list may NOT use the mint from any other function — so a new caller added
 * next to an allowed one still fails the guard.
 */
export type CallSiteAllowlist = Readonly<
  Record<string, Partial<Record<UncheckedMint, readonly string[]>>>
>

const GITHUB_DIR = 'lib/integrations/github'

/**
 * Whether `specifier` resolves to the github integration (barrel or auth.ts).
 * Every spelling the compiler accepts counts: the `@/` alias, a relative
 * path, and the bare `baseUrl: "."` form (`lib/integrations/github/auth`),
 * each after POSIX normalisation — so `./`, `..` and `//` segments do not
 * hide the module.
 */
export function isGithubAuthModule(
  specifier: string,
  fromFile: string
): boolean {
  const from = fromFile.split(path.sep).join('/')
  const raw = specifier.startsWith('@/')
    ? specifier.slice(2)
    : specifier.startsWith('.')
      ? path.posix.join(path.posix.dirname(from), specifier)
      : specifier
  const target = path.posix.normalize(raw).replace(/\/+$/, '')
  const bare = target.replace(/\.(ts|js)$/, '').replace(/\/index$/, '')
  return bare === GITHUB_DIR || bare === `${GITHUB_DIR}/auth`
}

function moduleSpecifierOf(node: ts.Node): string | null {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier &&
    ts.isStringLiteral(node.moduleSpecifier)
  )
    return node.moduleSpecifier.text
  if (
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference) &&
    ts.isStringLiteral(node.moduleReference.expression)
  )
    return node.moduleReference.expression.text
  if (ts.isCallExpression(node) && node.arguments.length >= 1) {
    const arg = node.arguments[0]!
    const literal =
      ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)
    if (!literal) return null
    if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return arg.text
    if (ts.isIdentifier(node.expression) && node.expression.text === 'require')
      return arg.text
    // jest.requireActual / jest.requireMock in non-test code is still a load.
    if (
      ts.isPropertyAccessExpression(node.expression) &&
      /^require(Actual|Mock)$/.test(node.expression.name.text)
    )
      return arg.text
  }
  return null
}

function isTypeOnlyImport(node: ts.Node): boolean {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause
    if (!clause) return false
    if (clause.isTypeOnly) return true
    if (clause.name) return false
    const nb = clause.namedBindings
    if (!nb || ts.isNamespaceImport(nb)) return false
    return nb.elements.every(e => e.isTypeOnly)
  }
  if (ts.isExportDeclaration(node)) {
    if (node.isTypeOnly) return true
    const clause = node.exportClause
    return (
      !!clause &&
      ts.isNamedExports(clause) &&
      clause.elements.every(e => e.isTypeOnly)
    )
  }
  if (ts.isImportEqualsDeclaration(node)) return node.isTypeOnly
  return false
}

/** The nearest named function / method / class member enclosing `node`. */
function enclosingFunction(node: ts.Node): string {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (
      (ts.isFunctionDeclaration(n) ||
        ts.isMethodDeclaration(n) ||
        ts.isFunctionExpression(n)) &&
      n.name &&
      (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name))
    )
      return n.name.text
    if (
      (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) &&
      n.parent &&
      (ts.isVariableDeclaration(n.parent) ||
        ts.isPropertyAssignment(n.parent) ||
        ts.isPropertyDeclaration(n.parent)) &&
      (ts.isIdentifier(n.parent.name) || ts.isStringLiteral(n.parent.name))
    )
      return n.parent.name.text
  }
  return '<module>'
}

/** What a dynamic load of the auth module binds, and where those names live. */
interface DynamicBindings {
  /** local name → the export it is bound to */
  bindings: Map<string, string>
  /** exports read right at the load site */
  directUses: string[]
  /** locals that hold the whole module object (a `.then(m => …)` parameter) */
  namespaces: string[]
  /** the node the locals are visible in; `undefined` = the whole file */
  scope?: ts.Node
}

/** `{ a, b: c }` → `{ a: 'a', c: 'b' }`; `null` when it cannot be followed by name. */
function objectPatternBindings(
  pattern: ts.ObjectBindingPattern
): Map<string, string> | null {
  const bindings = new Map<string, string>()
  for (const el of pattern.elements) {
    if (el.dotDotDotToken || !ts.isIdentifier(el.name)) return null
    const key = el.propertyName ?? el.name
    if (!ts.isIdentifier(key) && !ts.isStringLiteral(key)) return null
    bindings.set(el.name.text, key.text)
  }
  return bindings
}

/**
 * The parent chain of a dynamic `import()` / `require()` up to what consumes
 * the module object: `const { a: b } = await import(x)` → `{ a: 'b' }`;
 * `(await import(x)).a` → `{ a: null }` (a use right there);
 * `import(x).then(m => …)` / `.then(({ a }) => …)` → the callback parameter,
 * scoped to the callback; anything else → `null` (the whole module escapes
 * and cannot be followed by name).
 */
function dynamicBindings(call: ts.CallExpression): DynamicBindings | null {
  let node: ts.Node = call
  const climb = () => {
    while (ts.isParenthesizedExpression(node.parent)) node = node.parent
  }
  climb()
  if (ts.isAwaitExpression(node.parent)) {
    node = node.parent
    climb()
  }
  const parent = node.parent
  if (
    ts.isVariableDeclaration(parent) &&
    ts.isObjectBindingPattern(parent.name)
  ) {
    const bindings = objectPatternBindings(parent.name)
    return bindings && { bindings, directUses: [], namespaces: [] }
  }
  // `import(x).then(m => …)` — the callback receives the module object.
  if (
    ts.isPropertyAccessExpression(parent) &&
    parent.expression === node &&
    parent.name.text === 'then' &&
    ts.isCallExpression(parent.parent) &&
    parent.parent.expression === parent
  ) {
    const cb = parent.parent.arguments[0]
    if (!cb || !(ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)))
      return null
    const param = cb.parameters[0]
    const none = { bindings: new Map<string, string>(), directUses: [] }
    if (!param) return { ...none, namespaces: [], scope: cb }
    if (param.dotDotDotToken) return null
    if (ts.isIdentifier(param.name))
      return { ...none, namespaces: [param.name.text], scope: cb }
    if (ts.isObjectBindingPattern(param.name)) {
      const bindings = objectPatternBindings(param.name)
      return bindings && { bindings, directUses: [], namespaces: [], scope: cb }
    }
    return null
  }
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node)
    return {
      bindings: new Map(),
      directUses: [parent.name.text],
      namespaces: [],
    }
  // `({ a } = await import(x))` — destructuring assignment to declared names.
  if (
    ts.isBinaryExpression(parent) &&
    parent.right === node &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
  ) {
    let left: ts.Node = parent.left
    while (ts.isParenthesizedExpression(left)) left = left.expression
    if (ts.isObjectLiteralExpression(left)) {
      const bindings = new Map<string, string>()
      for (const p of left.properties) {
        if (ts.isShorthandPropertyAssignment(p))
          bindings.set(p.name.text, p.name.text)
        else if (
          ts.isPropertyAssignment(p) &&
          ts.isIdentifier(p.initializer) &&
          (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))
        )
          bindings.set(p.initializer.text, p.name.text)
        else return null
      }
      return { bindings, directUses: [], namespaces: [] }
    }
  }
  return null
}

/**
 * Violations for one source module, as `"<file>: <what>"` lines. `file` is
 * repo-relative. `auth.ts` itself is the implementation and is exempt from
 * the mint rules (not from nothing — it is still the only App-auth importer).
 */
export function auditTokenMints(
  file: string,
  source: string,
  allowlist: CallSiteAllowlist
): string[] {
  const out: string[] = []
  const isAuthImpl = file === AUTH_IMPLEMENTATION
  const isBarrel = file === GITHUB_BARREL
  const allowed = allowlist[file] ?? {}
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )

  // local identifier → the unchecked mint it is bound to, per visible scope
  const localMint = new Map<string, Array<[ts.Node, UncheckedMint]>>()
  // namespace / default / whole-module bindings of the auth module, per scope
  const opaqueLocals = new Map<string, ts.Node[]>()
  const within = (node: ts.Node, scope: ts.Node) =>
    node.pos >= scope.pos && node.end <= scope.end
  const bindMint = (local: string, mint: UncheckedMint, scope: ts.Node) =>
    localMint.set(local, [...(localMint.get(local) ?? []), [scope, mint]])
  const bindOpaque = (local: string, scope: ts.Node) =>
    opaqueLocals.set(local, [...(opaqueLocals.get(local) ?? []), scope])
  const mintOf = (id: ts.Identifier): UncheckedMint | undefined =>
    localMint.get(id.text)?.find(([scope]) => within(id, scope))?.[1]
  const isOpaque = (id: ts.Identifier): boolean =>
    (opaqueLocals.get(id.text) ?? []).some(scope => within(id, scope))
  const isMint = (name: string): name is UncheckedMint =>
    (UNCHECKED_MINTS as readonly string[]).includes(name)

  const recordMintUse = (mint: UncheckedMint, site: ts.Node) => {
    if (isAuthImpl) return
    const fn = enclosingFunction(site)
    if (!(allowed[mint] ?? []).includes(fn)) {
      out.push(`${file}: ${mint} used in ${fn}`)
    }
  }

  const collect = (node: ts.Node): void => {
    const specifier = moduleSpecifierOf(node)
    if (specifier !== null && !isTypeOnlyImport(node)) {
      if (APP_AUTH_PACKAGE.test(specifier) && !isAuthImpl) {
        out.push(`${file}: loads ${specifier}`)
      }
      if (isGithubAuthModule(specifier, file) && !isAuthImpl) {
        if (ts.isImportDeclaration(node)) {
          const clause = node.importClause
          if (clause?.name) bindOpaque(clause.name.text, sf)
          const nb = clause?.namedBindings
          if (nb && ts.isNamespaceImport(nb)) bindOpaque(nb.name.text, sf)
          if (nb && ts.isNamedImports(nb)) {
            for (const el of nb.elements) {
              if (el.isTypeOnly) continue
              const original = (el.propertyName ?? el.name).text
              if (REMOVED_HELPERS.has(original))
                out.push(`${file}: imports removed ${original}`)
              if (isMint(original)) bindMint(el.name.text, original, sf)
            }
          }
        } else if (ts.isExportDeclaration(node)) {
          const clause = node.exportClause
          if (!clause) {
            out.push(`${file}: export * from ${specifier}`)
          } else if (ts.isNamespaceExport(clause)) {
            out.push(
              `${file}: export * as ${clause.name.text} from ${specifier}`
            )
          } else {
            for (const el of clause.elements) {
              if (el.isTypeOnly) continue
              const original = (el.propertyName ?? el.name).text
              if (!isMint(original)) continue
              if (!(isBarrel && BARREL_REEXPORTS.has(original)))
                out.push(`${file}: re-exports ${original}`)
            }
          }
        } else if (ts.isImportEqualsDeclaration(node)) {
          bindOpaque(node.name.text, sf)
        } else if (ts.isCallExpression(node)) {
          const followed = dynamicBindings(node)
          if (!followed) {
            out.push(`${file}: loads ${specifier} as a whole module`)
          } else {
            const scope = followed.scope ?? sf
            for (const [local, original] of followed.bindings) {
              if (REMOVED_HELPERS.has(original))
                out.push(`${file}: imports removed ${original}`)
              if (isMint(original)) bindMint(local, original, scope)
            }
            for (const local of followed.namespaces) bindOpaque(local, scope)
            for (const name of followed.directUses) {
              if (isMint(name)) recordMintUse(name, node)
            }
          }
        }
      }
    }
    // A hand-built mint: the access_tokens endpoint in any string.
    if (
      !isAuthImpl &&
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)) &&
      ACCESS_TOKENS_ENDPOINT.test(node.text)
    ) {
      out.push(`${file}: builds an installation access_tokens request`)
    }
    ts.forEachChild(node, collect)
  }
  collect(sf)

  // Second pass: every reference to a bound mint, and every member read off
  // a whole-module binding (`gh.createInstallationToken`, `gh['…']`).
  const isDeclarationName = (id: ts.Identifier): boolean => {
    const p = id.parent
    return (
      (ts.isImportSpecifier(p) && p.name === id) ||
      (ts.isBindingElement(p) && p.name === id) ||
      ts.isImportClause(p) ||
      ts.isNamespaceImport(p) ||
      ts.isImportEqualsDeclaration(p) ||
      // the `m` in `.then(m => …)` declares the module binding
      (ts.isParameter(p) && p.name === id) ||
      // the `a` in `({ a } = await import(x))` is the binding itself
      (ts.isShorthandPropertyAssignment(p) &&
        ts.isObjectLiteralExpression(p.parent) &&
        ts.isBinaryExpression(p.parent.parent) &&
        p.parent.parent.left === p.parent) ||
      (ts.isPropertyAssignment(p) &&
        p.initializer === id &&
        ts.isObjectLiteralExpression(p.parent) &&
        ts.isBinaryExpression(p.parent.parent) &&
        p.parent.parent.left === p.parent)
    )
  }
  const refs = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && !isDeclarationName(node)) {
      const p = node.parent
      const isPropertyName =
        (ts.isPropertyAccessExpression(p) && p.name === node) ||
        (ts.isPropertyAssignment(p) && p.name === node)
      const mint = mintOf(node)
      if (mint && !isPropertyName) recordMintUse(mint, node)
      if (isOpaque(node) && !isPropertyName) {
        if (ts.isPropertyAccessExpression(p) && p.expression === node) {
          if (isMint(p.name.text)) recordMintUse(p.name.text, p)
          if (REMOVED_HELPERS.has(p.name.text))
            out.push(`${file}: uses removed ${p.name.text}`)
        } else if (
          ts.isElementAccessExpression(p) &&
          p.expression === node &&
          ts.isStringLiteralLike(p.argumentExpression)
        ) {
          const name = p.argumentExpression.text
          if (isMint(name)) recordMintUse(name, p)
        } else {
          // passed around / spread / computed key: cannot be followed by name.
          out.push(
            `${file}: whole github auth module escapes in ${enclosingFunction(node)}`
          )
        }
      }
    }
    ts.forEachChild(node, refs)
  }
  refs(sf)
  return out
}

/** Source files under `dir` (repo-relative), skipping tests, build output and dependencies. */
export function runtimeSourceFiles(root: string, dir: string): string[] {
  const abs = path.join(root, dir)
  if (!fs.existsSync(abs)) return []
  if (fs.statSync(abs).isFile()) return [dir]
  const out: string[] = []
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (
      [
        'node_modules',
        'dist',
        '.next',
        '__tests__',
        'test-support',
        'fixtures',
      ].includes(entry.name)
    )
      continue
    const rel = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...runtimeSourceFiles(root, rel))
    else if (
      /\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(entry.name) &&
      !/\.d\.ts$/.test(entry.name) &&
      !/\.test\.[cm]?[jt]sx?$/.test(entry.name)
    )
      out.push(rel)
  }
  return out
}
