/**
 * LUM-858: which workspace-keyed models does a GDPR workspace export carry?
 *
 * Every model with a direct `workspaceId` column is either EXPORTED (its rows,
 * or the rows hanging off it, land in the archive) or EXCLUDED with a reason.
 * The coverage guard test holds every such model to one of the two buckets, so
 * a new workspace-scoped model cannot ship without someone deciding whether
 * customers get it back.
 */

/** Direct-`workspaceId` models whose data is in the archive. */
export const EXPORTED_MODELS = [
  'Team',
  'WorkspaceMember',
  'Actor',
  'Project',
  // LUM-992: Task carries a denormalized workspaceId; tasks were already in
  // the archive (the `tasks` kind).
  'Task',
  'Initiative',
  'Priority',
  'Document',
  'DocumentTemplate',
  'TaskTemplate',
  'Tag',
  'Memory',
  'TaskArtifact',
  'TaskDependency',
  // LUM-907: the workspace audit log.
  'AuditEvent',
] as const

const INTEGRATION = 'integration credentials and connection config — secrets'
const TELEMETRY = 'agent-run telemetry / derived signal, not authored content'
const MIRROR = 'a copy of third-party data whose system of record is elsewhere'

/** Direct-`workspaceId` models deliberately left out, with the reason. */
export const EXCLUDED_MODELS: Readonly<Record<string, string>> = {
  WorkspaceDeletionReceipt: 'evidence about a deleted workspace',
  WorkspaceExport: 'the export audit trail itself',
  AgentProfile: 'agent runtime configuration',
  View: 'saved UI view configuration',
  Notification: 'transient per-user inbox',
  Draft: 'unsent editor autosave',
  DocumentRevision: 'edit history; the current document is exported',
  WorkspaceSummary: 'AI-generated digest, derived from exported data',
  WorkspaceInvite: 'pending invitation tokens — secrets',
  GitHubIntegration: INTEGRATION,
  GitHubAppInstallation: INTEGRATION,
  SlackIntegration: INTEGRATION,
  SentryIntegration: INTEGRATION,
  FigmaIntegration: INTEGRATION,
  GoogleDriveIntegration: INTEGRATION,
  PullRequest: MIRROR,
  PrSecurityScan: 'scan output derived from repository code',
  PrCommentSyncJob: 'background job queue',
  TaskSlackContext: MIRROR,
  TaskWebLink: MIRROR,
  TaskFigmaLink: MIRROR,
  McpAuditLog: 'operational access log',
  HookEvent: TELEMETRY,
  Session: TELEMETRY,
  TaskAttributionSegment: TELEMETRY,
  // LUM-932: operational audit of a token-usage correction (revert data for
  // Session usage columns), derived from telemetry — not workspace content.
  UsageResyncAudit: TELEMETRY,
  Worktree: TELEMETRY,
  MemoryStaleAnchorReport: TELEMETRY,
  LineageEdge: TELEMETRY,
  MilestoneMemoryEdge: TELEMETRY,
  DroppedFragment: TELEMETRY,
  OutcomeSignal: TELEMETRY,
  // LUM-1059: gained a denormalised workspaceId for its `<TEAM>-X<n>` number;
  // detector output about agent runs, never part of the export.
  BoundaryCrossing: TELEMETRY,
  // LUM-919: the exported audit log carries the same notice as an event.
  SubprocessorNoticeDelivery:
    "Lumo's record of the subprocessor notices it emailed (idempotency)",
}

const MODEL_BLOCK_RE = /^model (\w+) \{([\s\S]*?)\n\}/gm
const WORKSPACE_ID_FIELD_RE = /^\s+workspaceId\s+String\??(\s|$)/m

/** Every model in the schema text that has its own `workspaceId` column. */
export function workspaceKeyedModels(schema: string): string[] {
  return [...schema.matchAll(MODEL_BLOCK_RE)]
    .filter(m => WORKSPACE_ID_FIELD_RE.test(m[2] as string))
    .map(m => m[1] as string)
}

/** Workspace-keyed models that are neither exported nor excluded. */
export function unclassifiedModels(schema: string): string[] {
  const classified = new Set<string>([
    ...EXPORTED_MODELS,
    ...Object.keys(EXCLUDED_MODELS),
  ])
  return workspaceKeyedModels(schema).filter(m => !classified.has(m))
}
