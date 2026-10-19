/**
 * LUM-894 — every stored column the stock count scans. Tables written through
 * the hook redaction pipeline (HookEvent) and ones written with no redaction at
 * all are both listed; the classifier runs the whole registry on each.
 *
 * `delegate` is the Prisma client property, `fields` the columns read (select),
 * `where` an optional filter. Pruned HookEvent rows lose `payload` but keep the
 * extracted `toolDetail` / `turnSummary`, so they get their own entry.
 */
export interface StockTable {
  label: string
  delegate: string
  fields: readonly string[]
  workspaceField?: string
  where?: Record<string, unknown>
}

export const STOCK_TABLES: readonly StockTable[] = [
  {
    label: 'HookEvent (unpruned)',
    delegate: 'hookEvent',
    fields: ['payload', 'toolDetail', 'turnSummary'],
    workspaceField: 'workspaceId',
    where: { payloadPrunedAt: null },
  },
  {
    label: 'HookEvent (pruned: toolDetail/turnSummary)',
    delegate: 'hookEvent',
    fields: ['toolDetail', 'turnSummary'],
    workspaceField: 'workspaceId',
    where: { payloadPrunedAt: { not: null } },
  },
  {
    label: 'PrSecurityFinding',
    delegate: 'prSecurityFinding',
    fields: [
      'title',
      'detail',
      'evidence',
      'dispositionNote',
      'suggestedReason',
      'callChain',
    ],
  },
  {
    label: 'PrSecurityScan',
    delegate: 'prSecurityScan',
    fields: [
      'error',
      'huntAudit',
      'stages',
      'prSummary',
      'huntJob',
      // LUM-1155: model-written labels over the code.
      'sequenceDiagram',
    ],
    workspaceField: 'workspaceId',
  },
  {
    label: 'BoundaryCrossing',
    delegate: 'boundaryCrossing',
    fields: [
      'detail',
      'target',
      'dispositionNote',
      'systemExplanation',
      'policyRuleText',
    ],
  },
  {
    label: 'BoundaryCrossingExplanation',
    delegate: 'boundaryCrossingExplanation',
    fields: ['note'],
  },
  {
    label: 'Memory',
    delegate: 'memory',
    fields: ['content'],
    workspaceField: 'workspaceId',
  },
  {
    label: 'Session',
    delegate: 'session',
    fields: ['summary', 'runSummary'],
    workspaceField: 'workspaceId',
  },
  { label: 'Comment', delegate: 'comment', fields: ['body'] },
  {
    label: 'TaskArtifact',
    delegate: 'taskArtifact',
    fields: ['title', 'content', 'summary'],
    workspaceField: 'workspaceId',
  },
  { label: 'TaskActivity', delegate: 'taskActivity', fields: ['payload'] },
  {
    label: 'Task',
    delegate: 'task',
    fields: [
      'title',
      'description',
      'spec',
      'claimSnapshot',
      'commentsSummary',
      'agentError',
    ],
  },
  {
    label: 'Document',
    delegate: 'document',
    fields: ['title', 'content', 'sourceMarkdown', 'summary'],
    workspaceField: 'workspaceId',
  },
  {
    label: 'DocumentRevision',
    delegate: 'documentRevision',
    fields: ['content', 'sourceMarkdown'],
    workspaceField: 'workspaceId',
  },
  {
    label: 'TaskSlackContext',
    delegate: 'taskSlackContext',
    fields: ['snapshot', 'summary'],
    workspaceField: 'workspaceId',
  },
  {
    label: 'TaskWebLink',
    delegate: 'taskWebLink',
    fields: ['title', 'description', 'note', 'body'],
    workspaceField: 'workspaceId',
  },
  {
    label: 'TestCaseRun',
    delegate: 'testCaseRun',
    fields: ['evidence', 'note', 'failedStepText', 'actual', 'stepResults'],
  },
  {
    label: 'PrCommentSyncJob',
    delegate: 'prCommentSyncJob',
    fields: ['payload', 'lastError'],
    workspaceField: 'workspaceId',
  },
  {
    // LUM-1240: written redacted (STORAGE_REDACTED_FIELDS.feedback).
    label: 'Feedback',
    delegate: 'feedback',
    fields: ['title', 'steps', 'expected', 'actual'],
    workspaceField: 'workspaceId',
  },
  {
    label: 'FeedbackReply',
    delegate: 'feedbackReply',
    fields: ['body'],
  },
]
