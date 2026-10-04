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
 * PR1 ships with a declared PENDING list (the PR3 points); PR3 empties it and
 * the guard then requires it to stay empty.
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
 * In scope but not yet instrumented — LUM-907 PR3. The guard accepts these
 * in PR1; PR3 must empty this list.
 */
export const AUDIT_PENDING: Readonly<Record<AuditUnit, string>> = {
  'app/api/users/api-keys/route.ts#POST':
    'API key create (member-personal; routes call miscRepository directly — needs an api-key service first)',
  'app/api/users/api-keys/[id]/route.ts#DELETE':
    'API key revoke (member-personal; same as above)',
  'lib/services/figma-integration.service.ts#completeOauthFlow':
    'Figma connect (member-personal)',
  'lib/services/figma-integration.service.ts#disconnectIntegration':
    'Figma disconnect (member-personal)',
  'lib/services/google-drive-integration.service.ts#completeOauthFlow':
    'Google Drive connect (member-personal)',
  'lib/services/google-drive-integration.service.ts#disconnectIntegration':
    'Google Drive disconnect (member-personal)',
  'lib/services/github.service.ts#upsertIntegration':
    'GitHub OAuth connect (member-personal GitHubIntegration)',
  'lib/services/github.service.ts#deleteIntegration':
    'GitHub OAuth disconnect (member-personal GitHubIntegration)',
  'lib/services/document.service.ts#updateDocument':
    'document visibility / public link change (document-owner gated)',
  'lib/services/sentry.service.ts#createMapping': 'Sentry project mapping add',
  'lib/services/sentry.service.ts#deleteMapping':
    'Sentry project mapping remove',
  'lib/services/github-app-install.service.ts#applyInstallationEvent':
    'GitHub App removed / suspended on GitHub (webhook, SYSTEM actor)',
  'lib/services/trash.service.ts#deletePermanently': 'trash permanent delete',
  'lib/services/boundary-crossing.service.ts#disposition':
    'boundary-crossing ruling',
  'lib/services/test-case-defect-disposition.service.ts#rule':
    'test-case defect disposition',
  'app/api/workspaces/me/logo/route.ts#POST':
    'workspace logo change (OWNER check lives in the route)',
}

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
