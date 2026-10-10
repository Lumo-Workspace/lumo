/**
 * LUM-1061 (RFC docs/rfc/2026-10-10-LUM-1058-plugin-boundary.md §3.2) — the
 * server-side plugin contract of the MIT core.
 *
 * The core only knows these interfaces. A plugin (today: the security plugin
 * in `ee/security/server.ts`) registers contributors through
 * {@link PluginRegistrar}; the core reads them through `getPluginRegistry()`
 * (`lib/plugins/registry.ts`). With no plugin installed every extension point
 * degrades to "nothing contributed" — see each contributor's doc for what
 * that means on its surface.
 *
 * This file holds the extension points PR2 wires (DONE gate, agent context,
 * core events, retention). The crossing detector / explainer / policy rule
 * source (PR4) and the workspace settings / client UI slots (PR3) join it in
 * their own PRs.
 */

/** A server plugin. `register` runs once per process (see registry.ts). */
export interface LumoServerPlugin {
  /** Stable id, e.g. `'security'`. Also names the plugin's PreToolUse field. */
  id: string
  register(api: PluginRegistrar): void
}

export interface PluginRegistrar {
  /** Extra blockers the DONE gate merges into its verdict. */
  doneGate(g: DoneGateContributor): void
  /** Sections for session-start / attach, task status and PreToolUse. */
  agentContext(c: AgentContextContributor): void
  /** Subscribe to a core domain event (see {@link CoreEvents}). */
  on<E extends keyof CoreEvents>(event: E, handler: CoreEventHandler<E>): void
  /** Retention stock categories and repository-code disposal. */
  retention(r: RetentionContributor): void
}

// ── DONE gate ────────────────────────────────────────────────────────────────

/** One open item that refuses DONE (e.g. an undispositioned PR finding). */
export interface DoneBlocker {
  ruleId: string
  filePath: string
}

/**
 * Merged into `readDoneVerdict`. Fail-closed: a contributor that throws makes
 * the gate throw (a blocker that cannot be read must not read as "none").
 * No contributor → no extra blockers; the gate decides on crossings and test
 * cases alone.
 */
export interface DoneGateContributor {
  id: string
  openBlockers(taskId: string): Promise<DoneBlocker[]>
}

// ── agent context ────────────────────────────────────────────────────────────

/** One row a plugin adds to the task-status `nextActions` list. */
export interface PluginNextAction {
  kind: string
}

/**
 * A plugin's share of the task-status read model: rows for `nextActions`
 * (listed before the core's advisories) and top-level report fields the
 * plugin owns (e.g. `securityFindings`).
 */
export interface TaskStatusSection {
  nextActions: PluginNextAction[]
  fields: Record<string, unknown>
}

/**
 * Every method is optional and best-effort from the core's side: a method
 * that throws is logged and contributes nothing, so a plugin can never take
 * session-start, attach, task status or the PreToolUse hook down. A plugin
 * that needs a fail-closed marker (e.g. "could not confirm") returns it
 * itself, as data.
 */
export interface AgentContextContributor {
  id: string
  /**
   * Markdown section for session-start and `session attach`; `''` when there
   * is nothing to show. Sections of several contributors are joined by a
   * blank line.
   */
  sessionStart?(input: {
    taskId: string
    taskIdentifier: string
  }): Promise<string>
  /** The plugin's part of `lumo task status`. */
  taskStatus?(taskId: string): Promise<TaskStatusSection>
  /**
   * One-shot reminder injected before a tool call; `null` when there is
   * nothing new. Served on the PreToolUse response as `<id>Reminder`.
   */
  preToolUseReminder?(input: {
    sessionId: string | null
    taskId: string
  }): Promise<string | null>
}

// ── core events ──────────────────────────────────────────────────────────────

export interface CoreEvents {
  /** A task-linked pull_request webhook event, after the PR row is stored. */
  'github.pullRequest': {
    workspaceId: string
    taskId: string
    pullRequestId: string
    action: string
    /** Derived from the payload: 'open' | 'closed' | 'merged'. */
    state: string
  }
  /** A branch push (not a tag, not a deletion). */
  'github.push': {
    workspaceId: string
    repo: string
    branch: string
    isDefaultBranch: boolean
    headSha: string
  }
  /** A PR was linked to a task by hand (`lumo pr link`, the web UI). */
  'task.prLinked': { taskId: string; pullRequestId: string }
}

/**
 * Fire-and-forget: the core calls handlers synchronously and never awaits
 * them. A handler that starts background work registers it itself with
 * `waitUntil` from `@/lib/runtime/wait-until`. A handler that throws is
 * logged and never breaks the caller.
 */
export type CoreEventHandler<E extends keyof CoreEvents> = (
  payload: CoreEvents[E]
) => void

// ── retention ────────────────────────────────────────────────────────────────

/** Options of a retention-stock plan / apply run. */
export interface RetentionStockRunOptions {
  now?: Date
  /** apply: process at most this many due rows. */
  limit?: number
  /** apply: rows per write batch. */
  batchSize?: number
  /** crossing-raw: override the detected LUM-912 rollout instant. */
  crossingRolloutAt?: Date
  onBatch?: (progress: { processed: number; lastId: string }) => void
}

/** One stock row as classified: due (with a reason) or held. */
export type RetentionStockClassified<T> =
  | { due: true; row: T; reason: string; workspaceId: string; at: Date }
  | { due: false; row: T; reason: string }

/** The plan fields a driver may fill in after the rows are read. */
export interface RetentionStockPlanExtras {
  held: Record<string, number>
  due: number
  /** Rows of a secondary kind the due rows carry (e.g. scan findings). */
  findings?: number
}

/** How one retention-stock category reads and processes its rows. */
export interface RetentionStockDriver<T extends { id: string }> {
  /** Stock rows, classified, page by page. */
  pages(now: Date): AsyncGenerator<RetentionStockClassified<T>[]>
  /** Process due rows (one batch). */
  process(
    rows: RetentionStockClassified<T>[],
    now: Date
  ): Promise<{ processed: number; findings?: number }>
  /** Extra plan fields (secondary counts, held remainder…). */
  finishPlan?(plan: RetentionStockPlanExtras, dueRows: T[]): Promise<void>
}

export interface RetentionContributor {
  key: string
  /**
   * A retention-stock category this plugin owns (`scripts/retention-stock`).
   * Without the plugin the category does not exist.
   */
  stock?: {
    category: string
    /** The apply result carries a `findings` count (starts at 0). */
    countsFindings?: boolean
    driver(
      opts: RetentionStockRunOptions
    ): Promise<RetentionStockDriver<{ id: string }>>
  }
  /**
   * Dispose of the customer code this plugin holds for a workspace (all of
   * it, or only `repos`) when GitHub access goes away. Must throw when it
   * could not scrub — the caller only narrows / unbinds after it succeeded.
   * Returns counts by noun for the log line (e.g. `{ scan: 2, finding: 5 }`).
   */
  scrubRepositoryCode?(input: {
    workspaceId: string
    repos?: string[] | undefined
  }): Promise<Record<string, number>>
}
