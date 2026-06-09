import type { EvalCase } from './types'

/**
 * In-domain memory eval corpus (LUM-329). Authored from real Lumo prod memory
 * topics, **rewritten** (not copied) so nothing secret/internal leaks. The
 * `relationship` label is the ground truth; `expectedOp` is its 1:1 derivation
 * (re-asserted by eval-set.test.ts). The distractor pool for any one case's AR
 * scoring = every *other* case's `existing` content.
 *
 * Balance (see eval-set.test.ts): ≥10 per relationship, all four categories.
 *   CONTRADICTION → SUPERSEDE   REFINEMENT → UPDATE
 *   DUPLICATE     → NOOP        UNRELATED  → ADD (no positive; tests floor precision)
 */
export const evalSet: EvalCase[] = [
  // ── CONTRADICTION → SUPERSEDE ─────────────────────────────────────────────
  {
    id: 'contra-prisma-drift-01',
    category: 'TRAP',
    existing: {
      summary: 'Vercel CI runs prisma migrate deploy automatically on deploy',
      trigger: 'Merging a schema-change PR',
      outcome:
        'Production schema stays in sync with app code with no manual step',
    },
    candidate: {
      summary:
        'Vercel CI does NOT run prisma migrate deploy — prod schema drifts',
      trigger: 'Merging a schema-change PR',
      outcome:
        'App reads columns absent in prod → 500s until you migrate deploy manually',
      workaround:
        'Run prisma migrate deploy against prod after the deploy completes',
    },
    relationship: 'CONTRADICTION',
    expectedOp: 'SUPERSEDE',
    note: 'Direct negation of the earlier (wrong) belief that CI auto-migrates.',
  },
  {
    id: 'contra-task-mention-notify-02',
    category: 'DECISION',
    existing: {
      summary: 'Task mentions render as plain links, no notification',
      what: 'Mentioning a task in the editor renders a plain link and sends no notification',
      why: 'Task-mention notifications were not needed yet; keep the parser simple',
    },
    candidate: {
      summary: 'Task mentions now use a mention node and DO notify',
      what: 'Mentioning a task renders a mention node and triggers a notification to watchers',
      why: 'Universal entity mentions shipped; tasks are first-class mentionable entities',
    },
    relationship: 'CONTRADICTION',
    expectedOp: 'SUPERSEDE',
    note: 'Behavior reversed: no-notify → notify.',
  },
  {
    id: 'contra-locale-fallback-03',
    category: 'CONVENTION',
    existing: {
      rule: 'When a non-English locale is missing a key, fall back to the English string',
      scope: 'All react-intl message lookups across locale files',
    },
    candidate: {
      rule: 'Never fall back to English for a non-English locale — provide a real translation per language',
      scope:
        'All react-intl message lookups; the 16-locale parity test enforces it',
    },
    relationship: 'CONTRADICTION',
    expectedOp: 'SUPERSEDE',
    note: 'Opposite policy on missing-locale handling.',
  },
  {
    id: 'contra-recharts-dep-04',
    category: 'TRAP',
    existing: {
      summary: 'recharts is already a project dependency',
      trigger: 'Importing a shadcn/ui chart that depends on recharts',
      outcome: 'Chart renders normally',
    },
    candidate: {
      summary: 'recharts is NOT in package.json yet',
      trigger: 'Using a shadcn/ui chart without checking dependencies first',
      outcome: 'Import fails and the build breaks',
      workaround:
        'Add recharts to package.json (note it in the PR description) before importing',
    },
    relationship: 'CONTRADICTION',
    expectedOp: 'SUPERSEDE',
    note: 'Dependency present vs absent — contradictory facts.',
  },
  {
    id: 'contra-soft-delete-05',
    category: 'CONVENTION',
    existing: {
      rule: 'Hard-delete rows when a record is removed; no soft-delete bookkeeping',
      scope: 'Models that support a remove action',
    },
    candidate: {
      rule: 'Use a nullable timestamp (archivedAt/removedAt) for soft-delete; query filters exclude soft-deleted rows by default',
      scope: 'Any model that may need restoration or audit history',
    },
    relationship: 'CONTRADICTION',
    expectedOp: 'SUPERSEDE',
    note: 'Hard-delete vs soft-delete — replaced policy.',
  },
  {
    id: 'contra-cli-publish-pull-06',
    category: 'PROCEDURAL',
    existing: {
      summary: 'Publish the CLI directly from the local checkout',
      workflow:
        'Run npm publish from your working copy whenever a change is ready',
      trigger: 'Shipping a CLI change',
    },
    candidate: {
      summary: 'Pull latest main before publishing the CLI',
      workflow:
        'Check out and pull main, then bump version, then npm publish — never ship stale local code under a new version',
      trigger: 'Shipping a CLI change',
    },
    relationship: 'CONTRADICTION',
    expectedOp: 'SUPERSEDE',
    note: 'Publish-from-stale vs pull-first — corrected procedure.',
  },
  {
    id: 'contra-classifier-model-07',
    category: 'DECISION',
    existing: {
      summary:
        'Memory classifiers run on Haiku via a direct SDK forced-tool call',
      what: 'Layer-1/Layer-2 classification uses Claude Haiku through a direct Anthropic SDK call',
      why: 'Forced-tool calling on Haiku was the available path at the time',
    },
    candidate: {
      summary: 'Classifiers migrated to deepseek-v4-flash via the gateway',
      what: 'Classification uses deepseek-v4-flash through the AI gateway with generateObject',
      why: 'Cost reduction; the content model stays on Opus, only classifiers move',
    },
    relationship: 'CONTRADICTION',
    expectedOp: 'SUPERSEDE',
    note: 'Model + call path replaced.',
  },
  {
    id: 'contra-milestone-status-08',
    category: 'DECISION',
    existing: {
      summary: 'Milestone status is set manually',
      what: 'A milestone’s status (PLANNED/IN_PROGRESS/DONE) is edited by hand',
      why: 'Manual control was simplest initially',
    },
    candidate: {
      summary: 'Milestone status derives from task completion',
      what: 'Milestone status is computed from the completion of its tasks, not edited by hand',
      why: 'Manual status went stale — a near-complete milestone still showed PLANNED',
    },
    relationship: 'CONTRADICTION',
    expectedOp: 'SUPERSEDE',
    note: 'Manual vs derived status.',
  },
  {
    id: 'contra-mention-attr-09',
    category: 'TRAP',
    existing: {
      summary: 'Mention parser and renderer agree on the data attribute',
      trigger: 'Parsing stored mention HTML back into nodes',
      outcome: 'Mentions round-trip correctly',
    },
    candidate: {
      summary: 'Mention parser and renderer use mismatched attributes',
      trigger:
        'Parser looks for data-type=mention but the renderer emits data-mention-type',
      outcome:
        'Silent bug: tests on fake HTML pass, production never sends notifications',
      workaround:
        'Align parseHTML on the attribute the renderer actually emits',
    },
    relationship: 'CONTRADICTION',
    expectedOp: 'SUPERSEDE',
    note: 'Attributes agree vs mismatch.',
  },
  {
    id: 'contra-burndown-snapshot-10',
    category: 'PROCEDURAL',
    existing: {
      summary: 'Compute burndown from a single point-in-time snapshot',
      workflow: 'Count current task state once and chart it as the burndown',
      trigger: 'Rendering a sprint burndown',
    },
    candidate: {
      summary: 'Compute burndown by replaying TaskActivity events',
      workflow:
        'Replay status-change activities over the sprint window to build the daily series',
      trigger: 'Rendering a sprint burndown',
    },
    relationship: 'CONTRADICTION',
    expectedOp: 'SUPERSEDE',
    note: 'Snapshot-once misses mid-sprint toggles; replay replaces it.',
  },
  {
    id: 'contra-reuse-enum-11',
    category: 'CONVENTION',
    existing: {
      rule: 'Define a fresh enum for each new feature’s status/type constants',
      scope: 'New feature work that needs status or type values',
    },
    candidate: {
      rule: 'Reuse the existing enum (TaskStatus, TaskArtifactAgent, …) instead of defining a new one',
      scope: 'New feature work that needs status or type values',
    },
    relationship: 'CONTRADICTION',
    expectedOp: 'SUPERSEDE',
    note: 'New-enum vs reuse — opposite guidance.',
  },
  {
    id: 'contra-embedding-floor-12',
    category: 'DECISION',
    existing: {
      summary: 'The lexical 0.3 score floor is fine for the embedding path too',
      what: 'Reuse the lexical neighbor floor of 0.3 for embedding cosine scores',
      why: 'One floor is simpler',
    },
    candidate: {
      summary: 'The embedding path needs its own higher floor',
      what: 'Embedding cosine uses a separate, higher floor than the lexical 0.3',
      why: 'Unrelated sentence embeddings sit around 0.3–0.5 cosine, so 0.3 admits noise',
    },
    relationship: 'CONTRADICTION',
    expectedOp: 'SUPERSEDE',
    note: 'Shared floor vs separate higher floor.',
  },
  {
    id: 'contra-needsreauth-13',
    category: 'TRAP',
    existing: {
      summary: 'OAuth failures automatically set the needsReauth flag',
      trigger: 'A per-user OAuth token expires',
      outcome: 'The reconnect banner appears and the user re-authenticates',
    },
    candidate: {
      summary: 'Forgetting to set needsReauth → silent sync failures',
      trigger:
        'A per-user OAuth token expires but needsReauth is never written',
      outcome: 'The reconnect banner never shows; every sync fails silently',
      workaround:
        'Set needsReauth=true on the auth failure path so the card prompts reconnect',
    },
    relationship: 'CONTRADICTION',
    expectedOp: 'SUPERSEDE',
    note: 'Auto-set vs forgotten flag.',
  },
  {
    id: 'contra-selectvalue-14',
    category: 'TRAP',
    existing: {
      summary: 'shadcn SelectValue shows async-loaded options without flicker',
      trigger: 'Using shadcn Select with async option data',
      outcome: 'The selected label renders immediately',
    },
    candidate: {
      summary: 'SelectValue flashes a placeholder before async options mount',
      trigger: 'Using shadcn Select with async-loaded options',
      outcome:
        'Placeholder/narrow trigger renders first, then pops wider when the name arrives',
      workaround:
        'Prefetch a fallback object so the trigger shows the real label on first paint',
    },
    relationship: 'CONTRADICTION',
    expectedOp: 'SUPERSEDE',
    note: 'No-flicker vs flashes-placeholder.',
  },

  // ── REFINEMENT → UPDATE ───────────────────────────────────────────────────
  {
    id: 'refine-optimistic-onretry-01',
    category: 'CONVENTION',
    existing: {
      rule: 'For mutations that change visible UI state, use onMutate to update the cache immediately and snapshot for rollback on error',
      scope: 'Frontend mutations that update cached lists or detail views',
    },
    candidate: {
      rule: 'For optimistic mutations, also call onRetry in onError to refetch fresh data after rolling back from the snapshot',
      scope: 'Frontend mutations that update cached lists or detail views',
    },
    relationship: 'REFINEMENT',
    expectedOp: 'UPDATE',
    note: 'Adds the onError→onRetry refinement to the same rule.',
  },
  {
    id: 'refine-cli-publish-version-02',
    category: 'PROCEDURAL',
    existing: {
      summary: 'Publish the CLI after a feature merge',
      workflow: 'Check out main and pull, then run npm publish',
      trigger: 'A user-facing CLI change merged',
    },
    candidate: {
      summary: 'Publish the CLI with an explicit version bump step',
      workflow:
        'Check out main and pull, bump cli/package.json (minor for a new command, patch for a fix), commit the bump, then npm publish',
      trigger: 'A user-facing CLI change merged',
      steps: [
        'Check out main and pull',
        'Bump cli/package.json version',
        'Commit the bump and open a release PR',
        'Run npm publish after merge',
      ],
    },
    relationship: 'REFINEMENT',
    expectedOp: 'UPDATE',
    note: 'Adds the version-bump steps the base rule omitted.',
  },
  {
    id: 'refine-inmemory-fake-loc-03',
    category: 'DECISION',
    existing: {
      summary: 'Memory integration tests use an in-memory Prisma fake',
      what: 'Integration tests run real repo/apply logic against an in-memory Prisma fake',
      why: 'Method-level mocks can’t prove active-set convergence; real Postgres is absent in the suite',
    },
    candidate: {
      summary: 'The in-memory Prisma fake must live outside __tests__',
      what: 'The fake is placed under test-utils/, not __tests__, so jest’s testMatch doesn’t treat it as an empty suite',
      why: 'A helper file under __tests__ is picked up as a (failing) empty test file',
    },
    relationship: 'REFINEMENT',
    expectedOp: 'UPDATE',
    note: 'Adds the file-location constraint to the same fake decision.',
  },
  {
    id: 'refine-sanitize-scope-04',
    category: 'CONVENTION',
    existing: {
      rule: 'Any CLI output containing a server free-text field must be wrapped in sanitizeField() before printing',
      scope:
        'CLI stdout/stderr that includes member-editable text (title, body, comment, tag names, …)',
    },
    candidate: {
      rule: 'sanitizeField() applies to free-text fields only — id, url, and enum values are exempt',
      scope:
        'CLI stdout/stderr; structural fields (ids, urls, enums) skip sanitization',
    },
    relationship: 'REFINEMENT',
    expectedOp: 'UPDATE',
    note: 'Narrows the sanitize rule to exclude structural fields.',
  },
  {
    id: 'refine-budget-fallback-05',
    category: 'CONVENTION',
    existing: {
      rule: 'When injecting session-start context, rank items by priority with a budget allocator',
      scope: 'All session-start context injection',
    },
    candidate: {
      rule: 'The context budget allocator falls back to one-line summaries when tokens run out instead of dropping items',
      scope: 'All session-start context injection',
    },
    relationship: 'REFINEMENT',
    expectedOp: 'UPDATE',
    note: 'Adds the summary-line fallback behavior.',
  },
  {
    id: 'refine-twostage-nodelete-06',
    category: 'DECISION',
    existing: {
      summary:
        'Reconcile-on-write uses a two-stage Extract→Retrieve→Reconcile→Apply pipeline',
      what: 'Extraction is blind to existing memories; a second pass reconciles each candidate against its neighbors',
      why: 'Keeps retrieval cheap (no LLM) and isolates the LLM call to reconciliation',
    },
    candidate: {
      summary: 'Layer 2 reconciliation does not open the DELETE operation',
      what: 'The project-scope (Layer 2) reconcile pass emits ADD/UPDATE/SUPERSEDE/NOOP but never DELETE',
      why: 'Cross-session project memory should not be hard-removed by a single turn',
    },
    relationship: 'REFINEMENT',
    expectedOp: 'UPDATE',
    note: 'Refines the pipeline decision with the L2 no-DELETE constraint.',
  },
  {
    id: 'refine-snapshot-migration-07',
    category: 'TRAP',
    existing: {
      summary: 'Forecast snapshot hook is silent when its table is missing',
      trigger:
        'Marking a task DONE before the snapshot table exists in the environment',
      outcome:
        'The hook’s .catch(()=>{}) swallows the error and no snapshot is written',
    },
    candidate: {
      summary:
        'Forecast snapshot needs the migration deployed to the target DB',
      trigger:
        'Marking a task DONE before TaskForecastSnapshot is migrated in that environment',
      outcome:
        'No snapshot is written and the keep-first policy means re-runs won’t backfill it',
      workaround:
        'Verify the migration is deployed to the environment before relying on snapshots',
    },
    relationship: 'REFINEMENT',
    expectedOp: 'UPDATE',
    note: 'Adds the deploy-the-migration workaround to the same trap.',
  },
  {
    id: 'refine-reuse-statusicon-08',
    category: 'CONVENTION',
    existing: {
      rule: 'Reuse the existing enum instead of defining a new one for status/type constants',
      scope: 'New features needing status or type values',
    },
    candidate: {
      rule: 'Likewise reuse existing UI atoms (e.g. StatusIcon) instead of re-implementing them per feature',
      scope: 'New features needing status display or type constants',
    },
    relationship: 'REFINEMENT',
    expectedOp: 'UPDATE',
    note: 'Extends reuse from enums to UI components.',
  },
  {
    id: 'refine-hasfortask-noagg-09',
    category: 'PROCEDURAL',
    existing: {
      summary: 'Add a hasXxxForTask presence helper next to listByTask',
      workflow:
        'Implement hasXxxForTask(taskId) using findFirst select id to return a boolean',
      trigger: 'A view needs to know whether any row exists for a task',
    },
    candidate: {
      summary: 'Presence helper must not aggregate (no count)',
      workflow:
        'Use findFirst({ where:{taskId}, select:{id:true} }) — do NOT add a count aggregation',
      trigger: 'A view needs a boolean existence check for a task',
      steps: [
        'Add hasXxxForTask next to listByTask',
        'Mirror the list filter exactly',
        'Return boolean from findFirst; avoid count()',
      ],
    },
    relationship: 'REFINEMENT',
    expectedOp: 'UPDATE',
    note: 'Adds the no-aggregation constraint to the presence-helper procedure.',
  },
  {
    id: 'refine-lineage-birth-10',
    category: 'DECISION',
    existing: {
      summary: 'Lineage edges record which fragments fed a task',
      what: 'A LineageEdge is written per injected fragment for a task',
      why: 'Enables outcome attribution (merge-rate) per fragment',
    },
    candidate: {
      summary: 'Lineage edges are born at the session-start injection hook',
      what: 'Edges are created when fragments are injected at session start; manual task-context loads are skipped to avoid bias',
      why: 'Birth-at-injection gives a clean write/read key shared with the ranking reader',
    },
    relationship: 'REFINEMENT',
    expectedOp: 'UPDATE',
    note: 'Refines when/where edges are created.',
  },
  {
    id: 'refine-prefetch-initialdata-11',
    category: 'PROCEDURAL',
    existing: {
      summary: 'Prefetch first-paint data on the server',
      workflow:
        'Fetch the needed data in page.tsx and pass it down so the client has it on mount',
      trigger: 'A field needs data synchronously for first paint',
    },
    candidate: {
      summary:
        'Pass server-prefetched data as initialData/props, not a client fetch',
      workflow:
        'Query in page.tsx and hand the value down as initialData or props; don’t rely solely on a client fetch for first-paint values',
      trigger: 'A field needs data synchronously for first paint',
      steps: [
        'Identify the server fetch in page.tsx',
        'Query the value there',
        'Pass it as initialData/props to the field',
      ],
    },
    relationship: 'REFINEMENT',
    expectedOp: 'UPDATE',
    note: 'Adds the initialData wiring detail.',
  },
  {
    id: 'refine-prisma-drift-workaround-12',
    category: 'TRAP',
    existing: {
      summary:
        'Local prisma migrate dev rejects on checksum drift (P3008/P3012)',
      trigger:
        'A previously-applied migration has stale checksum drift in the dev DB',
      outcome: 'migrate dev refuses to proceed',
    },
    candidate: {
      summary: 'Work around prisma drift with db execute + migrate resolve',
      trigger:
        'migrate dev rejects on checksum drift (P3008/P3012) in the dev DB',
      outcome: 'You’re blocked from applying the new migration normally',
      workaround:
        'Hand-write the SQL, apply with prisma db execute, then migrate resolve --applied; never migrate reset',
    },
    relationship: 'REFINEMENT',
    expectedOp: 'UPDATE',
    note: 'Adds the concrete workaround to the drift trap.',
  },

  // ── DUPLICATE → NOOP (paraphrases; must still retrieve `existing`) ─────────
  {
    id: 'dup-embedding-paraphrase-01',
    category: 'TRAP',
    existing: {
      summary: 'Qwen3 embedding misses paraphrases',
      trigger: 'Relying solely on lexical similarity for neighbor retrieval',
      outcome:
        'A semantically equivalent paraphrase scores below a lexical lookalike, so true neighbors are missed',
    },
    candidate: {
      summary: 'Paraphrased facts get ranked below shared-word lookalikes',
      trigger: 'Using only lexical overlap to find similar memories',
      outcome:
        'A reworded but equivalent memory loses to a keyword match, so the real neighbor is skipped',
    },
    relationship: 'DUPLICATE',
    expectedOp: 'NOOP',
    note: 'Reworded statement of the same paraphrase-miss trap.',
  },
  {
    id: 'dup-service-tests-02',
    category: 'CONVENTION',
    existing: {
      rule: 'For a feature with a pure service function, write unit tests for the service AND component/integration tests for the UI that calls it',
      scope: 'All new service-layer features with a UI',
    },
    candidate: {
      rule: 'Cover both layers: service-level unit tests plus UI integration tests — don’t assume component tests alone suffice',
      scope: 'Every new service function that a component consumes',
    },
    relationship: 'DUPLICATE',
    expectedOp: 'NOOP',
    note: 'Same two-layer test rule, reworded.',
  },
  {
    id: 'dup-selectvalue-03',
    category: 'TRAP',
    existing: {
      summary: 'SelectValue flashes placeholder on async options',
      trigger: 'Using shadcn Select where options load asynchronously',
      outcome:
        'The trigger shows placeholder/narrow width, then expands when options mount — layout jank',
    },
    candidate: {
      summary: 'Async Select trigger janks before its options arrive',
      trigger: 'shadcn Select with options fetched after mount',
      outcome:
        'The trigger first paints a placeholder then widens once the real label loads',
    },
    relationship: 'DUPLICATE',
    expectedOp: 'NOOP',
    note: 'Same SelectValue jank, reworded.',
  },
  {
    id: 'dup-optimistic-04',
    category: 'DECISION',
    existing: {
      summary: 'Add onMutate/onError to invalidate-only mutations',
      what: 'Mutations that were invalidate-only gain onMutate optimistic updates and onError rollback',
      why: 'Improves perceived responsiveness — the user sees the change before the round-trip',
    },
    candidate: {
      summary: 'Make invalidate-only mutations optimistic',
      what: 'Give existing invalidate-only mutations an onMutate optimistic write with onError rollback',
      why: 'The UI updates instantly instead of waiting for the server response',
    },
    relationship: 'DUPLICATE',
    expectedOp: 'NOOP',
    note: 'Same optimistic-mutation decision, reworded.',
  },
  {
    id: 'dup-softdelete-05',
    category: 'CONVENTION',
    existing: {
      rule: 'Soft-delete with a nullable timestamp and exclude soft-deleted rows by default in queries',
      scope: 'Models needing restoration or audit history',
    },
    candidate: {
      rule: 'Prefer a nullable removedAt/archivedAt over hard delete; default query filters hide the archived rows',
      scope: 'Any model where you may need to restore or audit',
    },
    relationship: 'DUPLICATE',
    expectedOp: 'NOOP',
    note: 'Same soft-delete convention, reworded.',
  },
  {
    id: 'dup-prefetch-ssr-06',
    category: 'PROCEDURAL',
    existing: {
      summary: 'Prefetch on SSR to avoid a client loading flash',
      workflow:
        'Fetch the data in the server page and pass it down so first paint has it',
      trigger: 'A page depends on data available on the server',
    },
    candidate: {
      summary: 'Server-fetch first-paint data to kill the loading flicker',
      workflow:
        'Load the value in the server component and forward it to the client to avoid a mount-time spinner',
      trigger: 'The server already has the data the first render needs',
    },
    relationship: 'DUPLICATE',
    expectedOp: 'NOOP',
    note: 'Same SSR-prefetch procedure, reworded.',
  },
  {
    id: 'dup-mention-parsehtml-07',
    category: 'TRAP',
    existing: {
      summary: 'MentionWithType missing a parseHTML override',
      trigger: 'Rendering stored mention HTML in a read-only viewer',
      outcome:
        'The default parseHTML expects an attribute the renderer never emits, so old mention HTML degrades to plain text',
    },
    candidate: {
      summary: 'Read-only viewer can’t parse legacy mention HTML',
      trigger: 'Showing previously-saved mention markup in the read-only view',
      outcome:
        'Without a parseHTML override, stored mentions fail to re-parse and render as unstyled text/links',
    },
    relationship: 'DUPLICATE',
    expectedOp: 'NOOP',
    note: 'Same parseHTML-override trap, reworded.',
  },
  {
    id: 'dup-waterfall-prefetch-08',
    category: 'DECISION',
    existing: {
      summary: 'Move rarely-opened dropdown lists off the mount path',
      what: 'Sprint/milestone list queries move out of mount into the dropdown open handler',
      why: 'They cause a first-screen waterfall but users often never open the dropdown',
    },
    candidate: {
      summary: 'Defer optional dropdown fetches until the dropdown opens',
      what: 'Fetch sprint/milestone lists lazily on open rather than eagerly on mount',
      why: 'Eager fetches add a load waterfall for data most users don’t need',
    },
    relationship: 'DUPLICATE',
    expectedOp: 'NOOP',
    note: 'Same lazy-fetch decision, reworded.',
  },
  {
    id: 'dup-validation-lib-09',
    category: 'CONVENTION',
    existing: {
      rule: 'All validation of untrusted input lives in pure utility modules under lib/; callers import and call them',
      scope:
        'API URLs, file paths, user-authored text shown in terminal output',
    },
    candidate: {
      rule: 'Put untrusted-input checks in pure lib/ helpers and call them from callers, not inline',
      scope: 'URL, path, and free-text validation across the app and CLI',
    },
    relationship: 'DUPLICATE',
    expectedOp: 'NOOP',
    note: 'Same validation-in-lib convention, reworded.',
  },
  {
    id: 'dup-milestone-stale-10',
    category: 'TRAP',
    existing: {
      summary: 'Milestone status doesn’t reflect task completion',
      trigger:
        'A milestone has most tasks done but its hand-set status never updated',
      outcome:
        'Users see a stale status — a near-complete milestone shown as planned',
    },
    candidate: {
      summary: 'Manual milestone status goes stale vs its tasks',
      trigger:
        'Most of a milestone’s tasks are complete but its status was set by hand',
      outcome:
        'The displayed status lags reality, showing planned for an almost-finished milestone',
    },
    relationship: 'DUPLICATE',
    expectedOp: 'NOOP',
    note: 'Same stale-milestone trap, reworded.',
  },
  {
    id: 'dup-optimistic-steps-11',
    category: 'PROCEDURAL',
    existing: {
      summary: 'Optimistic update with snapshot rollback',
      workflow:
        'Snapshot query data in onMutate, apply optimistic update, roll back in onError, optionally invalidate in onSuccess',
      trigger: 'Adding an optimistic mutation',
    },
    candidate: {
      summary: 'Wire onMutate/onError/onSuccess for an optimistic mutation',
      workflow:
        'Capture cache in onMutate, write the optimistic value, restore on error, and refresh on success',
      trigger: 'Making a mutation optimistic',
    },
    relationship: 'DUPLICATE',
    expectedOp: 'NOOP',
    note: 'Same optimistic-mutation steps, reworded.',
  },
  {
    id: 'dup-area-chart-12',
    category: 'DECISION',
    existing: {
      summary: 'Replace the custom burndown chart with a shadcn Area Chart',
      what: 'Swap the hand-rolled sprint burndown for the shadcn/ui Area Chart',
      why: 'Cleaner, themeable, and reuses the existing --chart-* oklch palette for light/dark',
    },
    candidate: {
      summary:
        'Use the shadcn Area Chart for the burndown instead of a custom one',
      what: 'Render the sprint burndown with shadcn/ui Area Chart rather than a bespoke chart',
      why: 'It themes cleanly and reuses the project’s --chart-* tokens for both modes',
    },
    relationship: 'DUPLICATE',
    expectedOp: 'NOOP',
    note: 'Same area-chart decision, reworded.',
  },
  {
    id: 'dup-mention-empty-13',
    category: 'TRAP',
    existing: {
      summary: '@-mention shows empty in a single-user workspace',
      trigger: 'Typing @ in the editor in a workspace with only one member',
      outcome:
        'The people group is empty (self excluded) and entity search needs ≥1 char, so the dropdown looks broken',
    },
    candidate: {
      summary: 'Mention dropdown looks broken with only one member',
      trigger: 'Pressing @ in a solo-member workspace',
      outcome:
        'Self is filtered out and entity search wants a character, leaving an empty "no results" menu',
    },
    relationship: 'DUPLICATE',
    expectedOp: 'NOOP',
    note: 'Same empty-mention trap, reworded.',
  },

  // ── UNRELATED → ADD (candidate is a NEW fact; no true neighbor in the pool) ─
  {
    id: 'add-zindex-tokens-01',
    category: 'DECISION',
    existing: {
      summary: 'Color tokens unified onto an oklch model',
      what: 'globals.css base tokens move from hex to oklch with a 1:1 visual match',
      why: 'A single perceptual color model underpins the token system',
    },
    candidate: {
      summary: 'Adopt a 7-tier z-index token scale',
      what: 'Introduce @theme --z-index-* tokens with a load-bearing dropdown>modal ordering',
      why: 'Ad-hoc z-index values caused stacking conflicts; a tier scale makes layering explicit',
    },
    relationship: 'UNRELATED',
    expectedOp: 'ADD',
    note: 'Both DECISION/tokens but different subsystems — candidate is new.',
  },
  {
    id: 'add-worktree-loop-02',
    category: 'PROCEDURAL',
    existing: {
      summary: 'Publish the CLI after a feature merge',
      workflow: 'Pull main, bump version, npm publish',
      trigger: 'Shipping a CLI change',
    },
    candidate: {
      summary: 'Worktree-per-task dev loop',
      workflow:
        'lumo worktree add scaffolds .worktrees/<id> with a node_modules symlink off origin/main; run jest inside the worktree',
      trigger: 'Starting isolated work on a task',
    },
    relationship: 'UNRELATED',
    expectedOp: 'ADD',
    note: 'Different procedure entirely; no neighbor should match.',
  },
  {
    id: 'add-i18n-parity-03',
    category: 'CONVENTION',
    existing: {
      rule: 'Wrap member-editable CLI free-text in sanitizeField() before printing',
      scope: 'CLI stdout/stderr with server free-text fields',
    },
    candidate: {
      rule: 'Every one of the 16 locale files must match en.json’s key set and have non-empty values',
      scope: 'react-intl locale files; enforced by the parity test',
    },
    relationship: 'UNRELATED',
    expectedOp: 'ADD',
    note: 'Unrelated CONVENTION (i18n vs sanitization).',
  },
  {
    id: 'add-tiptap-bundle-04',
    category: 'TRAP',
    existing: {
      summary: 'recharts is not in package.json yet',
      trigger: 'Using a chart component without checking dependencies',
      outcome: 'Import fails, build breaks',
    },
    candidate: {
      summary: 'tiptap (~298KB) eagerly loaded bloats the bundle',
      trigger: 'Importing the editor stack on a route that renders it eagerly',
      outcome: 'First-load bundle balloons; the editor should be lazy-loaded',
      workaround:
        'Dynamically import the editor so tiptap is off the critical path',
    },
    relationship: 'UNRELATED',
    expectedOp: 'ADD',
    note: 'Different TRAP (bundle size vs missing dep).',
  },
  {
    id: 'add-gateway-jest-trap-05',
    category: 'TRAP',
    existing: {
      summary: 'Mention parser/renderer attribute mismatch',
      trigger: 'Parsing stored mention HTML',
      outcome: 'Mentions silently fail to round-trip',
    },
    candidate: {
      summary:
        'Static-importing @ai-sdk/gateway breaks jest via TransformStream',
      trigger:
        'A module statically imports anything transitively pulling in @ai-sdk/gateway, then a test loads it',
      outcome: 'The jest suite crashes on TransformStream',
      workaround:
        'Use dynamic await import() to break the chain in test-loaded modules',
    },
    relationship: 'UNRELATED',
    expectedOp: 'ADD',
    note: 'Different TRAP (jest gateway trap).',
  },
  {
    id: 'add-control-density-06',
    category: 'DECISION',
    existing: {
      summary: 'Two-stage reconcile pipeline',
      what: 'Extract→Retrieve→Reconcile→Apply keeps retrieval LLM-free',
      why: 'Isolates the LLM call to reconciliation',
    },
    candidate: {
      summary: 'Control size/density tier tokens on two axes',
      what: 'Introduce --spacing-* control height and inset tokens parameterizing size and density',
      why: 'One-off control sizing drifted; tier tokens standardize it',
    },
    relationship: 'UNRELATED',
    expectedOp: 'ADD',
    note: 'Different DECISION (control tokens).',
  },
  {
    id: 'add-radix-jsdom-07',
    category: 'TRAP',
    existing: {
      summary: 'SelectValue flashes placeholder on async options',
      trigger: 'shadcn Select with async data',
      outcome: 'Trigger janks when options mount',
    },
    candidate: {
      summary: 'Radix Select can’t open under jsdom',
      trigger: 'Asserting a Radix Select dropdown opens in a jsdom test',
      outcome: 'jsdom lacks hasPointerCapture so the menu never opens',
      workaround:
        'Test the gating via the hook’s enabled prop instead of simulating a real open',
    },
    relationship: 'UNRELATED',
    expectedOp: 'ADD',
    note: 'Different TRAP (jsdom Radix open) even though both touch Select.',
  },
  {
    id: 'add-nouncheckedindex-08',
    category: 'CONVENTION',
    existing: {
      rule: 'Reuse existing enums instead of defining new ones',
      scope: 'New features needing status/type constants',
    },
    candidate: {
      rule: 'noUncheckedIndexedAccess is on — arr[i] is T|undefined even after a length check; only tsc --noEmit catches it',
      scope: 'All TypeScript indexed access across the codebase',
    },
    relationship: 'UNRELATED',
    expectedOp: 'ADD',
    note: 'Different CONVENTION (tsc strictness).',
  },
  {
    id: 'add-detaillayout-flush-09',
    category: 'DECISION',
    existing: {
      summary: 'Milestone status derives from task completion',
      what: 'Milestone status is computed, not hand-set',
      why: 'Manual status went stale',
    },
    candidate: {
      summary: 'DetailLayout gains a flushSidebar variant',
      what: 'Sprint detail uses an edge-to-edge flush sidebar; Milestone keeps floating spacing via a variant prop',
      why: 'Two detail surfaces need different sidebar treatments without forking the layout',
    },
    relationship: 'UNRELATED',
    expectedOp: 'ADD',
    note: 'Different DECISION (layout variant).',
  },
  {
    id: 'add-comment-gutter-10',
    category: 'TRAP',
    existing: {
      summary: 'Manual milestone status goes stale',
      trigger: 'Most tasks done but status hand-set',
      outcome: 'Displayed status lags reality',
    },
    candidate: {
      summary: 'Comment gutter cards overlap with a constant height',
      trigger: 'Feeding the comment gutter a fixed card height',
      outcome: 'Cards overlap because real heights vary',
      workaround:
        'Measure actual height with a ResizeObserver, falling back to a constant',
    },
    relationship: 'UNRELATED',
    expectedOp: 'ADD',
    note: 'Different TRAP (gutter layout).',
  },
  {
    id: 'add-toc-race-11',
    category: 'TRAP',
    existing: {
      summary: 'Read-only viewer can’t parse legacy mention HTML',
      trigger: 'Showing saved mention markup read-only',
      outcome: 'Mentions render as plain text without a parseHTML override',
    },
    candidate: {
      summary: 'tiptap TOC onUpdate races storage.content',
      trigger: 'Reading storage.content inside the TOC onUpdate callback',
      outcome:
        'onUpdate fires before storage.content is assigned, yielding stale TOC data',
      workaround:
        'Pass the data payload into onUpdate instead of re-reading storage',
    },
    relationship: 'UNRELATED',
    expectedOp: 'ADD',
    note: 'Different TRAP (editor TOC race).',
  },
  {
    id: 'add-doc-tombstone-12',
    category: 'DECISION',
    existing: {
      summary: 'Two-stage reconcile pipeline keeps retrieval cheap',
      what: 'Extraction is blind; reconciliation sees neighbors',
      why: 'Isolates the LLM to reconciliation',
    },
    candidate: {
      summary: 'Deleting a doc-comment with replies leaves a tombstone',
      what: 'A parent comment with active replies is soft-deleted to a “[deleted]” placeholder, not hard-removed',
      why: 'Hard delete would orphan the reply thread',
    },
    relationship: 'UNRELATED',
    expectedOp: 'ADD',
    note: 'Different DECISION (comment tombstone).',
  },
  {
    id: 'add-hook-stdout-13',
    category: 'PROCEDURAL',
    existing: {
      summary: 'Prefetch first-paint data on the server',
      workflow: 'Fetch in page.tsx and pass down',
      trigger: 'First paint needs server data',
    },
    candidate: {
      summary: 'Inject hook output into Claude stdout',
      workflow:
        'The server afterRecord returns data; the CLI formats it into hookSpecificOutput lines parsed only on whitelisted paths',
      trigger: 'A session hook needs to surface server data to the agent',
    },
    relationship: 'UNRELATED',
    expectedOp: 'ADD',
    note: 'Different PROCEDURAL (hook stdout).',
  },
  {
    id: 'add-chart-palette-14',
    category: 'CONVENTION',
    existing: {
      rule: 'Validation of untrusted input lives in pure lib/ modules',
      scope: 'URLs, paths, terminal-bound free text',
    },
    candidate: {
      rule: 'Use the --chart-1..5 oklch categorical palette for chart series, not raw hex',
      scope: 'All chart series colors in light and dark mode',
    },
    relationship: 'UNRELATED',
    expectedOp: 'ADD',
    note: 'Different CONVENTION (chart palette).',
  },
  {
    id: 'add-two-test-roots-15',
    category: 'PROCEDURAL',
    existing: {
      summary: 'Add a presence helper next to listByTask',
      workflow: 'findFirst select id returns a boolean',
      trigger: 'A view needs an existence check',
    },
    candidate: {
      summary: 'Jest runs two test roots: __tests__/ and tests/',
      workflow:
        'When removing or renaming a symbol, grep both __tests__/ and tests/ and run the full jest as a backstop',
      trigger: 'Refactoring a symbol that tests may reference',
    },
    relationship: 'UNRELATED',
    expectedOp: 'ADD',
    note: 'Different PROCEDURAL (two test roots).',
  },
]
