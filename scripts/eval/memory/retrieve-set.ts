/**
 * LUM-414 Retrieve-segment gold set. Task-style queries annotated against the
 * LUM-329 corpus: the retrieval pool is every same-language eval case's
 * `existing` content (the fragment store snapshot), and `relevantIds` lists the
 * pool members that SHOULD be injected for the query's task.
 *
 * Annotation rules:
 * - Relevance is TOPICAL ("a teammate starting this task would want this
 *   fragment on screen") — lifecycle correctness (stale/superseded beliefs) is
 *   the write path's job, not the Retrieve segment's, so a CONTRADICTION
 *   case's outdated `existing` still counts as relevant to its topic.
 * - The pool has deliberate near-duplicate clusters (ADD cases reuse other
 *   topics' `existing`). A query relevant to a topic lists EVERY cluster
 *   member, otherwise Precision@k is unfairly penalized.
 * - `relevantIds: []` marks an ABSTENTION negative control (LongMemEval): a
 *   task with no matching memory anywhere in the pool. The frozen test
 *   asserts these stay entirely below EMBEDDING_SCORE_FLOOR.
 */
import type { LineageStat } from '@/lib/lineage/ranking'
import { evalSet } from './eval-set'

export interface RetrieveQuery {
  id: string
  /** Task title, as the injection query would see it. */
  title: string
  /** Short task description (joined with the title as the embedded text). */
  description: string
  /** Pool case ids whose `existing` should be injected; [] = abstention. */
  relevantIds: string[]
  /** Annotator rationale — never fed to the model. */
  note?: string
}

/** The embedded query text — title + description, mirroring what a
 * task-grounded retrieval call would embed. */
export function retrieveQueryText(q: RetrieveQuery): string {
  return `${q.title}\n${q.description}`
}

/** Retrieval pool = same-language cases (their `existing` content), in corpus
 * order. Corpus order stands in for createdAt order ("fixed" policy). */
export const retrievePool = evalSet.filter(c => !c.id.startsWith('xlang-'))

export const retrieveQuerySet: RetrieveQuery[] = [
  // ── Positive queries (≥1 relevant fragment in the pool) ──────────────────
  {
    id: 'rq-schema-migration-01',
    title: 'Add a status column to Project and ship the schema migration',
    description:
      'New nullable column on the Project model with a Prisma migration; needs to reach production safely and apply cleanly on dev databases.',
    relevantIds: [
      'contra-prisma-drift-01',
      'refine-prisma-drift-workaround-12',
    ],
    note: 'Prisma migration topic cluster: prod deploy behavior + dev drift workaround.',
  },
  {
    id: 'rq-task-archive-02',
    title: 'Support archiving tasks instead of deleting them',
    description:
      'Users want to remove tasks from view but restore them later; decide how removal is persisted and how queries hide archived rows.',
    relevantIds: ['contra-soft-delete-05', 'dup-softdelete-05'],
    note: 'Soft-delete cluster (old hard-delete belief + reworded convention).',
  },
  {
    id: 'rq-mention-notify-03',
    title: 'Notify watchers when a task is mentioned in a comment',
    description:
      'Mentioning a task in the comment editor should trigger a notification to the task watchers; mentions are parsed from the stored comment HTML.',
    relevantIds: [
      'contra-task-mention-notify-02',
      'contra-mention-attr-09',
      'add-gateway-jest-trap-05',
    ],
    note: 'Mention-notification cluster incl. the parser/renderer attribute facts (notification parsing depends on them).',
  },
  {
    id: 'rq-readonly-mentions-04',
    title: 'Mentions render as plain text in the read-only description view',
    description:
      'Previously saved descriptions show @-mentions as unstyled text in the read-only viewer instead of mention chips.',
    relevantIds: ['dup-mention-parsehtml-07', 'add-toc-race-11'],
    note: 'Read-only mention parseHTML cluster (add-toc-race-11 existing is the same fact).',
  },
  {
    id: 'rq-i18n-strings-05',
    title: 'Add user-facing strings for the new export dialog',
    description:
      'The export dialog introduces a handful of new react-intl messages that must land in every locale file.',
    relevantIds: ['contra-locale-fallback-03'],
    note: 'Only the locale-fallback fact covers i18n in the pool.',
  },
  {
    id: 'rq-burndown-fix-06',
    title: 'Sprint burndown shows wrong remaining counts mid-sprint',
    description:
      'The burndown line ignores tasks that flipped status back and forth during the sprint; the chart itself also needs a refresh.',
    relevantIds: ['contra-burndown-snapshot-10', 'dup-area-chart-12'],
    note: 'Burndown computation + burndown chart component.',
  },
  {
    id: 'rq-milestone-stale-07',
    title: 'Milestone page shows PLANNED although most tasks are done',
    description:
      'Milestone status lags the actual completion of its tasks; figure out why the displayed status goes stale and fix it.',
    relevantIds: [
      'contra-milestone-status-08',
      'dup-milestone-stale-10',
      'add-comment-gutter-10',
      'add-detaillayout-flush-09',
    ],
    note: 'Milestone-status cluster: manual-status belief, stale trap (×2 copies), derived-status fact.',
  },
  {
    id: 'rq-status-badge-08',
    title: 'Add a verification-status badge to the task card',
    description:
      'Task cards need a small badge reflecting the acceptance verification state; it needs status constants and an icon treatment.',
    relevantIds: [
      'contra-reuse-enum-11',
      'refine-reuse-statusicon-08',
      'add-nouncheckedindex-08',
    ],
    note: 'Enum/UI-atom reuse cluster.',
  },
  {
    id: 'rq-optimistic-status-09',
    title: 'Task status dropdown should update instantly',
    description:
      'Changing a task status waits for the server round-trip before the UI updates; make the mutation feel immediate with safe rollback.',
    relevantIds: [
      'refine-optimistic-onretry-01',
      'dup-optimistic-04',
      'dup-optimistic-steps-11',
    ],
    note: 'Optimistic-mutation cluster.',
  },
  {
    id: 'rq-select-flash-10',
    title: 'Assignee dropdown flashes a placeholder while options load',
    description:
      'The assignee Select renders narrow with a placeholder, then pops wider when member options arrive from the API.',
    relevantIds: [
      'contra-selectvalue-14',
      'dup-selectvalue-03',
      'add-radix-jsdom-07',
    ],
    note: 'shadcn SelectValue async-options cluster.',
  },
  {
    id: 'rq-cli-release-11',
    title: 'Release the new CLI subcommand to npm',
    description:
      'The doc section commands merged to main; publish a new @lumoai/cli version so agents get the new surface.',
    relevantIds: [
      'contra-cli-publish-pull-06',
      'refine-cli-publish-version-02',
      'add-worktree-loop-02',
    ],
    note: 'CLI publish cluster.',
  },
  {
    id: 'rq-classifier-cost-12',
    title: 'Reduce the LLM cost of the memory classifiers',
    description:
      'Classification calls dominate the AI bill; evaluate moving the classifier calls to a cheaper model without touching the content model.',
    relevantIds: ['contra-classifier-model-07'],
    note: 'Classifier-model fact only.',
  },
  {
    id: 'rq-dedup-threshold-13',
    title: 'Tune the similarity threshold for memory dedup neighbors',
    description:
      'Near-duplicate project memories slip past the neighbor retrieval; calibrate the score cutoff used when matching candidates to existing memories.',
    relevantIds: ['contra-embedding-floor-12', 'dup-embedding-paraphrase-01'],
    note: 'Embedding floor + paraphrase-miss retrieval facts.',
  },
  {
    id: 'rq-slack-resync-14',
    title: 'Slack sync stops silently after the token expires',
    description:
      'Per-user Slack OAuth tokens expire and the integration never recovers; users see no error and no reconnect prompt.',
    relevantIds: ['contra-needsreauth-13'],
    note: 'needsReauth trap.',
  },
  {
    id: 'rq-first-paint-15',
    title: 'Project selector renders empty on first paint',
    description:
      'The selector shows a blank state until a client fetch resolves, even though the server already knows the projects at render time.',
    relevantIds: [
      'refine-prefetch-initialdata-11',
      'dup-prefetch-ssr-06',
      'add-hook-stdout-13',
    ],
    note: 'Server-prefetch-first-paint cluster.',
  },
  {
    id: 'rq-injection-budget-16',
    title: 'Session-start context overflows the token budget on big tasks',
    description:
      'Tasks with many linked resources blow past the injection budget and items get cut; review how the allocator decides what survives.',
    relevantIds: ['refine-budget-fallback-05'],
    note: 'Budget-allocator fact.',
  },
  {
    id: 'rq-memory-dedupe-17',
    title: 'Duplicate project memories pile up from repeated sessions',
    description:
      'Each session re-extracts near-identical facts; the write path should reconcile candidates against existing memories instead of appending.',
    relevantIds: [
      'refine-twostage-nodelete-06',
      'add-control-density-06',
      'add-doc-tombstone-12',
    ],
    note: 'Two-stage reconcile cluster (×3 copies in pool).',
  },
  {
    id: 'rq-artifact-dot-18',
    title: 'Show an indicator dot on task rows that have artifacts',
    description:
      'The task list needs a cheap boolean per row: does this task have any artifacts? Avoid heavy per-row queries.',
    relevantIds: ['refine-hasfortask-noagg-09', 'add-two-test-roots-15'],
    note: 'Presence-helper cluster.',
  },
  {
    id: 'rq-velocity-chart-19',
    title: 'Add a sprint velocity chart to the analytics page',
    description:
      'Render completed-points-per-sprint as a chart; pick the chart component and check what charting library support exists.',
    relevantIds: [
      'contra-recharts-dep-04',
      'add-tiptap-bundle-04',
      'dup-area-chart-12',
    ],
    note: 'Charting cluster: recharts dependency facts + shadcn chart decision.',
  },
  {
    id: 'rq-cli-comments-print-20',
    title: 'CLI command to print a task comment thread in the terminal',
    description:
      'Add a lumo subcommand that prints member-authored comment bodies to stdout; comment text is untrusted free text.',
    relevantIds: [
      'refine-sanitize-scope-04',
      'add-i18n-parity-03',
      'dup-validation-lib-09',
      'add-chart-palette-14',
    ],
    note: 'Untrusted-terminal-output cluster: sanitizeField (×2 copies) + validation-in-lib (×2 copies).',
  },
  {
    id: 'rq-dark-mode-token-21',
    title: 'New banner component colors look wrong in dark mode',
    description:
      'The banner hardcodes colors that break in dark mode; align it with the design-token system.',
    relevantIds: ['add-zindex-tokens-01'],
    note: 'Color-token fact (oklch base tokens).',
  },
  {
    id: 'rq-memory-int-test-22',
    title: 'Integration-test the memory supersede path without a real database',
    description:
      'Cover the supersede/active-read flow end to end in jest; decide what gets faked and where the test helpers live.',
    relevantIds: ['refine-inmemory-fake-loc-03', 'dup-service-tests-02'],
    note: 'In-memory Prisma fake + two-layer test convention.',
  },
  {
    id: 'rq-lineage-contrib-23',
    title: 'Show which injected memories contributed to merged PRs',
    description:
      'Surface per-fragment outcome attribution: which fragments fed tasks that merged, so memory value is auditable.',
    relevantIds: ['refine-lineage-birth-10'],
    note: 'Lineage-edge fact.',
  },
  {
    id: 'rq-dropdown-mount-24',
    title: 'Task detail fires sprint and milestone list requests on mount',
    description:
      'Opening a task detail page eagerly fetches dropdown option lists most users never open, adding a first-screen waterfall.',
    relevantIds: ['dup-waterfall-prefetch-08'],
    note: 'Lazy-dropdown-fetch decision.',
  },
  {
    id: 'rq-forecast-snapshot-25',
    title: 'Task DONE does not produce a forecast snapshot in staging',
    description:
      'Marking tasks done on the staging environment writes no forecast snapshot row and nothing is logged.',
    relevantIds: ['refine-snapshot-migration-07'],
    note: 'Forecast-snapshot silent-hook trap.',
  },

  // ── Abstention negative controls (no matching memory in the pool) ─────────
  {
    id: 'rq-abstain-stripe-01',
    title: 'Integrate Stripe usage-based billing',
    description:
      'Meter workspace seat usage, sync it to Stripe subscriptions, and reconcile invoice webhooks against local billing records.',
    relevantIds: [],
    note: 'Billing/payments is absent from the pool.',
  },
  {
    id: 'rq-abstain-websocket-02',
    title: 'Show live presence avatars on the board',
    description:
      'Stream who is currently viewing a board over a WebSocket connection and render floating presence avatars per column.',
    relevantIds: [],
    note: 'Realtime presence is absent from the pool.',
  },
  {
    id: 'rq-abstain-k8s-03',
    title: 'Provision a Kubernetes staging cluster with Helm',
    description:
      'Stand up a staging cluster, write Helm charts for the app and worker deployments, and wire cluster autoscaling.',
    relevantIds: [],
    note: 'Infrastructure/K8s is absent from the pool.',
  },
  {
    id: 'rq-abstain-otel-04',
    title: 'Add OpenTelemetry tracing to the API layer',
    description:
      'Instrument request handling with distributed trace spans and export them to a collector for latency analysis.',
    relevantIds: [],
    note: 'Observability/tracing is absent from the pool.',
  },
  {
    id: 'rq-abstain-pdf-05',
    title: 'Parse uploaded PDF attachments into searchable text',
    description:
      'Extract text from PDF files attached to tasks so attachment content becomes full-text searchable.',
    relevantIds: [],
    note: 'PDF parsing/attachments are absent from the pool.',
  },
  {
    id: 'rq-abstain-shortcuts-06',
    title: 'Add a keyboard-shortcut cheatsheet overlay',
    description:
      'Pressing ? opens an overlay listing all keyboard shortcuts, grouped by surface, with the platform-correct modifier keys.',
    relevantIds: [],
    note: 'Keyboard shortcuts are absent from the pool.',
  },
]

/**
 * Synthetic per-fragment lineage stats for the proven-value ordering ablation —
 * a NULL MODEL, deliberately uncorrelated with any query's relevance (assigned
 * by pool index, not content): every 7th fragment is proven-low, every 3rd
 * (that isn't a 7th) is high-merge, the rest are cold. The ablation therefore
 * measures how much relevance-blind lineage reordering moves injection
 * Precision@k — NOT whether prod lineage stats are good.
 */
export function syntheticLineageStats(
  poolIds: string[]
): Map<string, LineageStat> {
  const stats = new Map<string, LineageStat>()
  poolIds.forEach((id, i) => {
    if (i % 7 === 0) stats.set(id, { resolvedTasks: 4, mergedTasks: 1 })
    else if (i % 3 === 0) stats.set(id, { resolvedTasks: 5, mergedTasks: 4 })
  })
  return stats
}

/** Return human-readable problems with the gold set ([] = valid). */
export function validateRetrieveSet(
  queries: RetrieveQuery[],
  poolIds: Set<string>
): string[] {
  const errs: string[] = []
  const seen = new Set<string>()
  for (const q of queries) {
    if (!q.id) errs.push('(missing query id)')
    if (seen.has(q.id)) errs.push(`${q.id}: duplicate id`)
    seen.add(q.id)
    if (!q.title.trim()) errs.push(`${q.id}: empty title`)
    if (!q.description.trim()) errs.push(`${q.id}: empty description`)
    const isAbstain = q.id.startsWith('rq-abstain-')
    if (isAbstain && q.relevantIds.length > 0) {
      errs.push(`${q.id}: abstention query must have no relevantIds`)
    }
    if (!isAbstain && q.relevantIds.length === 0) {
      errs.push(`${q.id}: positive query needs at least one relevantId`)
    }
    const relSeen = new Set<string>()
    for (const rid of q.relevantIds) {
      if (!poolIds.has(rid)) errs.push(`${q.id}: unknown relevantId ${rid}`)
      if (relSeen.has(rid)) errs.push(`${q.id}: duplicate relevantId ${rid}`)
      relSeen.add(rid)
    }
  }
  return errs
}
