/**
 * LUM-907: audit-log coverage registry — which code paths write an audit
 * event, which are still pending, and which OWNER-gated code is exempt.
 *
 * Inventory rule (the brief + the 2026-10-04 rulings): every SENSITIVE
 * MUTATION is audited, whoever performs it — not only OWNER-gated ones. By
 * category: members and invites; workspace, security and retention
 * settings; data export / deletion / AI-derived purge / session raw record;
 * task templates; integration connections, workspace-level (GitHub, Slack,
 * Sentry) and member-personal (API keys, Figma, Google Drive); document
 * public link / visibility; trash permanent deletion; boundary-crossing and
 * security / test-case dispositions. Out of scope: Slack project channel
 * create / delete (routine), and reads.
 *
 * The guard test (__tests__/audit/coverage-guard.test.ts) holds the code to
 * this file:
 *  - every INSTRUMENTED unit really calls `recordAuditEvent` with each of its
 *    actions;
 *  - every OWNER-gated unit it can find mechanically (a function or service
 *    method whose body checks `'OWNER'` or calls an owner-gate helper) is
 *    instrumented, pending, or exempt with a reason — so a new OWNER-gated
 *    method fails the guard until someone decides;
 *  - every action in AUDIT_ACTIONS is written somewhere.
 * Category-scoped points that are not OWNER-gated (invites, member-personal
 * connections) cannot be found mechanically; they are listed here by hand.
 *
 * PR1 shipped with a declared PENDING list (the PR3 points); PR3 emptied it
 * and the guard requires it to stay empty. Callers: every call of an
 * instrumented method from app/ — `fooService.bar(` or, for a module-level
 * function, `bar(` imported from its module (alias or relative path, either
 * quote style) — passes an audit context IN THAT CALL's arguments, inline or
 * through a local binding initialised with one (see passesAuditContext).
 *
 * Deliberately not audited (not sensitive, or not a member action): Slack
 * project channel create / delete; per-member document shares (exempt
 * below); the trash's 30-day purge cron (routine retention); reading the
 * audit log page by page.
 */
import type { AuditAction } from '@/lib/audit/actions'

/** A unit is `<repo-relative file>#<function or method name>`. */
export type AuditUnit = `${string}#${string}`

export const AUDIT_INSTRUMENTED: Readonly<
  Record<AuditUnit, readonly AuditAction[]>
> = {
  // Members and invites
  'lib/services/member.service.ts#updateMemberRole': ['member.role_changed'],
  'lib/services/member.service.ts#leaveWorkspace': ['member.left'],
  'lib/services/member.service.ts#removeMember': ['member.removed'],
  // Identity-provider deprovisioning: the Clerk webhook (WEBHOOK actor) and,
  // in Better Auth mode, the operator ban / remove scripts (SYSTEM actor,
  // LUM-1071) — both through deprovisionUser
  'lib/services/member-deprovision.service.ts#deprovisionUser': [
    'member.deprovisioned',
    'member.api_keys_revoked',
  ],
  'lib/services/invite.service.ts#createInvites': ['invite.created'],
  'lib/services/invite.service.ts#revokeInvite': ['invite.revoked'],
  'lib/services/invite.service.ts#resendInvite': ['invite.resent'],
  'lib/services/invite.service.ts#acceptInvite': ['invite.accepted'],
  'lib/services/invite.service.ts#joinPendingInvitesForEmails': [
    'invite.accepted',
  ],
  // Workspace settings (the three actions come from one diff, see
  // lib/audit/workspace-settings.ts)
  'lib/services/workspace.service.ts#updateWorkspace': [],
  // Data rights
  'lib/services/workspace-deletion.service.ts#scheduleDeletion': [
    'workspace.deletion_scheduled',
  ],
  'lib/services/workspace-deletion.service.ts#cancelDeletion': [
    'workspace.deletion_cancelled',
  ],
  'lib/services/workspace-export.service.ts#requestExport': [
    'data_export.requested',
  ],
  'lib/services/workspace-export.service.ts#openDownload': [
    'data_export.downloaded',
  ],
  'lib/services/ai-derived-content.service.ts#purge': [
    'ai_derived_content.purged',
  ],
  'lib/services/session-raw-record.service.ts#deleteRawRecord': [
    'session_raw_record.deleted',
  ],
  // Task templates
  'lib/services/task-template.service.ts#createTemplate': [
    'task_template.created',
  ],
  'lib/services/task-template.service.ts#updateTemplate': [
    'task_template.updated',
  ],
  'lib/services/task-template.service.ts#deleteTemplate': [
    'task_template.deleted',
  ],
  // Integrations (workspace-level, OWNER)
  'lib/services/github-app-install.service.ts#install': [
    'github_app.installed',
  ],
  'lib/services/github-app-install.service.ts#reverify': [
    'github_app.reverified',
  ],
  'lib/services/github-app-install.service.ts#uninstall': [
    'github_app.uninstalled',
  ],
  'lib/services/slack.service.ts#upsertIntegration': ['slack.connected'],
  'lib/services/slack.service.ts#deleteIntegration': ['slack.disconnected'],
  'lib/services/sentry.service.ts#connectIntegration': ['sentry.connected'],
  'lib/services/sentry.service.ts#disconnectIntegration': [
    'sentry.disconnected',
  ],
  // ── LUM-907 PR3 ──
  'lib/services/sentry.service.ts#createMapping': ['sentry.mapping_created'],
  'lib/services/sentry.service.ts#deleteMapping': ['sentry.mapping_deleted'],
  // GitHub App gone or suspended on GitHub — webhook (WEBHOOK) or the daily
  // access recheck (SYSTEM); both reach the workspace through this function.
  'lib/services/github-app-install.service.ts#removeInstallation': [
    'github_app.uninstalled',
    'github_app.suspended',
  ],
  // Member-personal connections
  'lib/services/api-key.service.ts#create': ['api_key.created'],
  'lib/services/api-key.service.ts#revoke': ['api_key.revoked'],
  'lib/services/figma-integration.service.ts#completeOauthFlow': [
    'figma.connected',
  ],
  'lib/services/figma-integration.service.ts#disconnectIntegration': [
    'figma.disconnected',
  ],
  'lib/services/google-drive-integration.service.ts#completeOauthFlow': [
    'google_drive.connected',
  ],
  'lib/services/google-drive-integration.service.ts#disconnectIntegration': [
    'google_drive.disconnected',
  ],
  'lib/services/github.service.ts#upsertIntegration': [
    'github_oauth.connected',
  ],
  'lib/services/github.service.ts#deleteIntegration': [
    'github_oauth.disconnected',
  ],
  // Workspace branding (the OWNER check moved here from the route)
  'lib/services/workspace-logo.service.ts#updateLogo': [
    'workspace.logo_updated',
  ],
  // Documents: visibility and the public link (document-owner gated)
  'lib/services/document.service.ts#updateDocument': [
    'document.visibility_changed',
    'document.public_link_enabled',
    'document.public_link_disabled',
  ],
  // Trash: the immediate erasure path
  'lib/services/trash.service.ts#deletePermanently': [
    'trash.deleted_permanently',
  ],
  // Human rulings
  'lib/services/boundary-crossing.service.ts#disposition': [
    'boundary_crossing.dispositioned',
  ],
  'lib/services/boundary-crossing.service.ts#revokeSuppressionRule': [
    'boundary_crossing.suppression_rule_revoked',
  ],
  // (Security finding rulings: the security plugin's units, classified in
  // its own registry — see AUDIT_PLUGIN_ACTIONS below.)
  'lib/services/test-case-defect-disposition.service.ts#rule': [
    'test_case_defect.dispositioned',
  ],
  // Reading the audit log out of Lumo (the CSV export; listing is exempt)
  'lib/services/audit-query.service.ts#exportAuditEventsCsv': [
    'audit_log.exported',
  ],
  // LUM-919: subprocessor change notice sent to a workspace's owners (SYSTEM)
  'lib/services/subprocessor-notice.service.ts#sendSubprocessorNotice': [
    'subprocessor_change.notified',
  ],
}

/**
 * LUM-1071: entry points that only delegate to an instrumented unit (key →
 * the unit it calls). The guard checks the delegation really happens and
 * holds their app/ callers to the same audit-context rule as instrumented
 * units, so moving the body behind a wrapper does not drop a caller check.
 */
export const AUDIT_DELEGATES: Readonly<Record<AuditUnit, AuditUnit>> = {
  // The Clerk webhook's entry; the provider-neutral core writes the audit.
  'lib/services/member-deprovision.service.ts#deprovisionClerkUser':
    'lib/services/member-deprovision.service.ts#deprovisionUser',
}

/**
 * Units whose actions are produced indirectly (named here so the guard can
 * still check every action is written somewhere).
 */
export const AUDIT_INDIRECT_ACTIONS: Readonly<
  Record<AuditUnit, readonly AuditAction[]>
> = {
  'lib/services/workspace.service.ts#updateWorkspace': [
    'workspace.settings_updated',
    'workspace.security_settings_updated',
    'workspace.retention_updated',
  ],
}

/**
 * LUM-1065: audit actions written by an installed plugin, not by the core.
 * They stay in AUDIT_ACTIONS (existing audit rows carry them and the audit
 * log renders them); the plugin's units that write them are classified in
 * the plugin's own registry and held to this same guard by the plugin's
 * tests. Without the plugin, nothing writes them.
 */
export const AUDIT_PLUGIN_ACTIONS: readonly AuditAction[] = [
  'security_finding.dispositioned',
  'security_finding.suggestions_confirmed',
  // LUM-1133: per-repository automatic PR review settings
  'repository.review_settings_updated',
]

/**
 * In scope but not yet instrumented. PR1 shipped the PR3 points here; PR3
 * instrumented every one of them, and the guard now requires this list to
 * stay EMPTY: a new sensitive unit is instrumented or exempt with a reason,
 * never parked.
 */
export const AUDIT_PENDING: Readonly<Record<AuditUnit, string>> = {}

const GATE_HELPER = 'owner-gate helper; the methods that call it are classified'
const READ_ONLY = 'read-only'

/** OWNER-gated units that are not sensitive mutations, with the reason. */
export const AUDIT_EXEMPT: Readonly<Record<AuditUnit, string>> = {
  'lib/services/ai-derived-content.service.ts#requireOwner': GATE_HELPER,
  'lib/services/workspace-deletion.service.ts#requireOwner': GATE_HELPER,
  'lib/services/workspace-export.service.ts#assertOwner': GATE_HELPER,
  'lib/services/task-template.service.ts#assertCanManage': GATE_HELPER,
  'lib/services/github-app-install.service.ts#requireReverifiableInstallation':
    GATE_HELPER,
  'lib/services/session-raw-record.service.ts#canDeleteSessionRawRecord':
    'permission predicate; deleteRawRecord is audited',
  'lib/services/document.service.ts#getUserRole':
    'computes a document role (document owner, not workspace OWNER)',
  'lib/services/ai-derived-content.service.ts#getStatus': READ_ONLY,
  'lib/services/github-app-install.service.ts#getStatus': READ_ONLY,
  'lib/services/github-app-install.service.ts#startReverify':
    'read-only gate before the GitHub round trip; reverify is audited',
  'lib/services/workspace-export.service.ts#listExports': READ_ONLY,
  'lib/services/workspace-deletion.service.ts#deleteNow':
    'runs the purge at once: the audit rows go with the workspace and the WorkspaceDeletionReceipt is the lasting record (deletion_scheduled precedes it)',
  'app/api/teams/route.ts#GET': READ_ONLY,
  // LUM-1071: the operator scripts' dry run (deprovisionUser is audited).
  'lib/services/member-deprovision.service.ts#planDeprovision': READ_ONLY,
  // LUM-907 PR2: reading the audit log itself (list + CSV export).
  'lib/services/audit-query.service.ts#assertOwner': GATE_HELPER,
  'lib/services/audit-query.service.ts#listAuditEvents': READ_ONLY,
  // LUM-907 PR3 ruling: per-member document shares are routine
  // collaboration (who on the team may read or edit one page), not a change
  // of who OUTSIDE can read it; visibility and the public link are audited.
  'app/api/documents/[id]/shares/route.ts#POST':
    'per-member document share (routine collaboration; visibility and public link changes are audited in updateDocument)',
  'app/api/documents/[id]/shares/[shareId]/route.ts#PATCH':
    'per-member document share role change (routine collaboration)',
  'app/api/documents/[id]/shares/[shareId]/route.ts#DELETE':
    'per-member document share removal (routine collaboration)',
}

/** Matches an OWNER check or a call to one of the owner-gate helpers. */
export const OWNER_GATE_RE =
  /'OWNER'|\brequireOwner\(|\bassertOwner\(|\bassertCanManage\(|\brequireReverifiableInstallation\(/

const KEYWORDS = new Set([
  'if',
  'for',
  'while',
  'switch',
  'return',
  'catch',
  'await',
  'function',
  'try',
  'else',
  'do',
  'with',
])

/**
 * A unit header: a top-level `function` declaration, or a 2-space-indented
 * object method — `  async name(`, `  name(` whose line ends the signature
 * with `{` or opens a multi-line parameter list, or `  name: async`. A plain
 * call statement at that indent (`  assertOwner(role)`) is not a header.
 */
const UNIT_HEADER_RE =
  /^(?:(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*[<(]|  async\s+(\w+)\s*\(|  (\w+)\((?:.*\)(?:\s*:[^=]*)?\s*\{|)$|  (\w+):\s*async\b)/

/**
 * Split a TypeScript source into top-level functions and 2-space-indented
 * object-literal methods (`  async name(`, `  name(`, `  name: async`). A
 * unit's body runs to the next unit header. Text analysis, not a parser: it
 * fits this codebase's prettier-formatted services and route handlers.
 */
export function parseUnits(
  source: string
): Array<{ name: string; body: string }> {
  const units: Array<{ name: string; body: string[] }> = []
  for (const line of source.split('\n')) {
    const m = line.match(UNIT_HEADER_RE)
    const name = m?.[1] ?? m?.[2] ?? m?.[3] ?? m?.[4]
    if (name && !KEYWORDS.has(name)) {
      units.push({ name, body: [line] })
    } else {
      units[units.length - 1]?.body.push(line)
    }
  }
  return units.map(u => ({ name: u.name, body: u.body.join('\n') }))
}

/** `file#unit` for every unit of `source` whose body passes an OWNER gate. */
export function ownerGatedUnits(file: string, source: string): AuditUnit[] {
  return parseUnits(source)
    .filter(u => OWNER_GATE_RE.test(u.body))
    .map(u => `${file}#${u.name}` as AuditUnit)
}

/** The body of one unit, or null when the file has no such unit. */
export function unitBody(source: string, name: string): string | null {
  return parseUnits(source).find(u => u.name === name)?.body ?? null
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * How an app file calls one instrumented unit, as regexes: `fooService.bar(`
 * for a service-object method (`lib/services/foo.service.ts#bar`), and for a
 * module-level `export function bar` also `bar(` in a file importing the
 * module plus any `fooService.alias(` the service object maps to it
 * (`alias: bar,`). `moduleSource` is the unit's own file. `modulePath` is the
 * module's repo-relative path without `.ts`, matched against the caller's
 * resolved import specifiers.
 */
export function instrumentedCallPatterns(
  unit: AuditUnit,
  moduleSource: string
): { direct: RegExp; modulePath: string | null; bare: RegExp | null } {
  const i = unit.lastIndexOf('#')
  const file = unit.slice(0, i)
  const name = unit.slice(i + 1)
  const base = file
    .slice(file.lastIndexOf('/') + 1)
    .replace(/\.service\.ts$/, '')
  const service = `${base.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())}Service`
  const moduleLevel = new RegExp(
    `^export\\s+(?:async\\s+)?function\\s+${escapeRe(name)}\\s*[<(]`,
    'm'
  ).test(moduleSource)
  const methods = [name]
  if (moduleLevel) {
    const aliasRe = new RegExp(`^\\s+(\\w+):\\s*${escapeRe(name)},?\\s*$`, 'gm')
    for (const m of moduleSource.matchAll(aliasRe)) methods.push(m[1]!)
  }
  return {
    direct: new RegExp(
      methods.map(m => `\\b${service}\\.${escapeRe(m)}\\(`).join('|')
    ),
    modulePath: moduleLevel ? file.replace(/\.ts$/, '') : null,
    bare: moduleLevel ? new RegExp(`(?<![.\\w])${escapeRe(name)}\\(`) : null,
  }
}

/** Normalize a posix path: drop `.` segments and fold `..` ones. */
function normalizePosix(p: string): string {
  const out: string[] = []
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return out.join('/')
}

/**
 * The repo-relative module paths (no extension) `source` imports: `@/x`
 * aliases and `./` / `../` paths relative to `callerFile`, in single or
 * double quotes, from static `from '…'` and dynamic `import('…')`.
 */
export function importedModules(source: string, callerFile: string): string[] {
  const dir = callerFile.includes('/')
    ? callerFile.slice(0, callerFile.lastIndexOf('/'))
    : ''
  const specRe = /(?:\bfrom\s*|\bimport\s*\(\s*)(['"])([^'"]+)\1/g
  const out: string[] = []
  for (const m of source.matchAll(specRe)) {
    const spec = m[2]!
    let resolved: string | null = null
    if (spec.startsWith('@/')) resolved = spec.slice(2)
    else if (spec.startsWith('./') || spec.startsWith('../'))
      resolved = normalizePosix(`${dir}/${spec}`)
    if (resolved) out.push(resolved.replace(/\.(?:ts|tsx|js)$/, ''))
  }
  return out
}

function importsModule(
  source: string,
  callerFile: string,
  p: ReturnType<typeof instrumentedCallPatterns>
): boolean {
  return Boolean(
    p.modulePath && importedModules(source, callerFile).includes(p.modulePath)
  )
}

/** True when `source` (an app file at `callerFile`) calls the unit `p`. */
export function callsInstrumentedUnit(
  source: string,
  p: ReturnType<typeof instrumentedCallPatterns>,
  callerFile: string
): boolean {
  return auditedCallArguments(source, p, callerFile).length > 0
}

/**
 * When `i` starts a comment (`//`, `/* … *\/`) or a string / template
 * literal, the index of its last character; otherwise null. Comments are
 * checked first, so an apostrophe inside one never opens a "string".
 */
function skipNonCode(source: string, i: number): number | null {
  const c = source[i]
  if (c === '/' && source[i + 1] === '/') {
    const end = source.indexOf('\n', i)
    return end === -1 ? source.length - 1 : end - 1
  }
  if (c === '/' && source[i + 1] === '*') {
    const end = source.indexOf('*/', i + 2)
    return end === -1 ? source.length - 1 : end + 1
  }
  if (c === "'" || c === '"' || c === '`') {
    let j = i + 1
    for (; j < source.length && source[j] !== c; j++) {
      if (source[j] === '\\') j++
    }
    return j
  }
  return null
}

/**
 * The argument text `(…)` of a call whose opening parenthesis is at `open`,
 * balanced over (), [] and {}, skipping comments and string literals.
 */
export function callArguments(source: string, open: number): string {
  let depth = 0
  for (let i = open; i < source.length; i++) {
    const skip = skipNonCode(source, i)
    if (skip !== null) {
      i = skip
      continue
    }
    const c = source[i]!
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') {
      depth--
      if (depth === 0) return source.slice(open, i + 1)
    }
  }
  return source.slice(open)
}

/** `text` with its comments removed (strings kept as they are). */
export function stripComments(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const skip = skipNonCode(text, i)
    if (skip === null) {
      out += text[i]
      continue
    }
    if (text[i] === '/') out += ' '
    else out += text.slice(i, skip + 1)
    i = skip
  }
  return out
}

/** One call of an audited unit: its argument text and where the call is. */
export interface AuditedCall {
  args: string
  index: number
}

/** Every call site of the unit `p` in `source` (arguments without comments). */
export function auditedCallArguments(
  source: string,
  p: ReturnType<typeof instrumentedCallPatterns>,
  callerFile: string
): AuditedCall[] {
  const res = [p.direct]
  if (p.bare && importsModule(source, callerFile, p)) res.push(p.bare)
  const out: AuditedCall[] = []
  for (const re of res) {
    for (const m of source.matchAll(new RegExp(re.source, 'g'))) {
      out.push({
        args: stripComments(callArguments(source, m.index! + m[0].length - 1)),
        index: m.index!,
      })
    }
  }
  return out
}

/** A request audit context, or an explicit system / webhook one. */
const AUDIT_CONTEXT_RE =
  /\bmemberAuditContext\(|\b(?:SYSTEM|WEBHOOK)_AUDIT_CONTEXT\b/

/**
 * The text of a statement starting at `start`, up to the first `;` or line
 * break outside any bracket (so a multi-line call or object is whole).
 */
function statementText(source: string, start: number): string {
  let depth = 0
  for (let i = start; i < source.length; i++) {
    const skip = skipNonCode(source, i)
    if (skip !== null) {
      i = skip
      continue
    }
    const c = source[i]!
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (depth <= 0 && (c === ';' || c === '\n')) {
      return source.slice(start, i)
    }
  }
  return source.slice(start)
}

/**
 * The part of `source` a binding used at `index` can come from: from the
 * header of the unit (function / handler / method) enclosing `index` up to
 * `index` itself — never another function, never after the call.
 */
function enclosingScopeBefore(source: string, index: number): string {
  let unitStart = 0
  let offset = 0
  for (const line of source.split('\n')) {
    if (offset > index) break
    const m = line.match(UNIT_HEADER_RE)
    const name = m?.[1] ?? m?.[2] ?? m?.[3] ?? m?.[4]
    if (name && !KEYWORDS.has(name)) unitStart = offset
    offset += line.length + 1
  }
  return source.slice(unitStart, index)
}

/**
 * True when `name` appears in `args` as a value (`audit`, `{ audit }`,
 * `x: audit`, `c ? audit : y`), not only as an object key (`{ audit: … }`).
 */
function usedAsValue(args: string, name: string): boolean {
  const re = new RegExp(`(?<![.\\w$])${escapeRe(name)}(?![\\w$])`, 'g')
  for (const m of args.matchAll(re)) {
    const before = args.slice(0, m.index!).trimEnd().slice(-1)
    const after = args.slice(m.index! + name.length).trimStart()[0]
    const isKey = (before === '{' || before === ',') && after === ':'
    if (!isKey) return true
  }
  return false
}

/**
 * True when a call hands the audited method an audit context: inline
 * (`memberAuditContext(…)` or an explicit SYSTEM / WEBHOOK context), or
 * through a local binding initialised with one (`const audit =
 * memberAuditContext(…)` … `install({ …, audit })`) declared in the same
 * function, before the call. Mentioning memberAuditContext elsewhere in the
 * file — or binding the same name in another function — is not enough.
 */
export function passesAuditContext(source: string, call: AuditedCall): boolean {
  if (AUDIT_CONTEXT_RE.test(call.args)) return true
  const scope = enclosingScopeBefore(source, call.index)
  const bindingRe = /\b(?:const|let|var)\s+(\w+)(?:\s*:[^=\n]+)?\s*=\s*/g
  for (const m of scope.matchAll(bindingRe)) {
    if (!usedAsValue(call.args, m[1]!)) continue
    const init = stripComments(statementText(scope, m.index! + m[0].length))
    if (AUDIT_CONTEXT_RE.test(init)) return true
  }
  return false
}
