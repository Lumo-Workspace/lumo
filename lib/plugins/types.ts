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
 * This file holds the server extension points: DONE gate, agent context,
 * core events, retention (PR2) and workspace settings (PR3, LUM-1062). The
 * crossing detector / explainer / policy rule source (PR4, LUM-1063) are
 * declared in `./crossing-types`. The client UI slots live apart in
 * `lib/plugins/client.tsx`, so no server code reaches the browser bundle.
 */
import type { ZodType } from 'zod'
import type { AuditedWorkspaceSettings } from '@/lib/audit/workspace-settings'
import type {
  CrossingDetector,
  CrossingExplainer,
  PolicyRuleSource,
} from './crossing-types'

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
  /** Workspace setting columns the plugin owns (LUM-1062). */
  workspaceSettings(s: WorkspaceSettingsContributor): void
  // LUM-1063 (PR4) — boundary crossings, see ./crossing-types.
  /** Extra hook detectors run by the core detection pipeline. */
  crossingDetector(d: CrossingDetector): void
  /** The SYSTEM explanation of a crossing (first registered answers). */
  crossingExplainer(e: CrossingExplainer): void
  /** A project's compiled policy rules. */
  policyRuleSource(s: PolicyRuleSource): void
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
  /**
   * A pull_request webhook event, after the PR row is stored. LUM-1133: every
   * PR of a confirmed repository — `taskId` is null when no task is linked
   * (the plugin decides whether such a PR is reviewed).
   */
  'github.pullRequest': {
    workspaceId: string
    taskId: string | null
    pullRequestId: string
    action: string
    /** Derived from the payload: 'open' | 'closed' | 'merged'. */
    state: string
    /** `owner/name` as the payload spells it. */
    repo: string
    prNumber: number
    isDraft: boolean
  }
  /** A branch push (not a tag, not a deletion). */
  'github.push': {
    workspaceId: string
    repo: string
    branch: string
    isDefaultBranch: boolean
    headSha: string
  }
  /**
   * LUM-1127: a review thread on a known PR was resolved or unresolved on
   * GitHub (`pull_request_review_thread`). `sender` is who did it — Lumo's
   * own bot included, so a consumer can drop its own echo.
   */
  'github.reviewThread': {
    workspaceId: string
    pullRequestId: string
    action: string
    threadNodeId: string | null
    comments: Array<{
      id: number
      body: string
      user: { type?: string; login?: string } | null
      in_reply_to_id?: number | null
    }>
    sender: { login?: string; type?: string } | null
  }
  /**
   * LUM-1129: a conversation comment on a PR Lumo holds (any PR row, task
   * or not) was created / edited / deleted (`issue_comment`). The security
   * plugin reads `@<app> review|full review|pause|resume|resolve` commands
   * off it; `prAuthorLogin` is the PR's author.
   */
  'github.issueComment': {
    workspaceId: string
    pullRequestId: string
    repo: string
    prNumber: number
    action: string
    comment: {
      id: number
      body: string
      createdAt: string | null
      user: { login?: string; type?: string } | null
    }
    prAuthorLogin: string | null
  }
  /**
   * LUM-1131: a review-line comment on a known PR (`pull_request_review_comment`),
   * any author — Lumo's own bot included, so a consumer drops its own echo.
   * `inReplyToId` is the thread's first comment when this is a reply.
   */
  'github.reviewComment': {
    workspaceId: string
    pullRequestId: string
    taskId: string | null
    repo: string
    prNumber: number
    action: string
    comment: {
      id: number
      body: string
      inReplyToId: number | null
      user: { login?: string; type?: string } | null
      /** GitHub `author_association`, raw; null when absent. */
      authorAssociation: string | null
    }
  }
  /** A PR was linked to a task by hand (`lumo pr link`, the web UI). */
  'task.prLinked': { taskId: string; pullRequestId: string }
  /** LUM-1063: a task's status changed (after the update committed). */
  'task.statusChanged': { taskId: string; status: string }
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
  /**
   * LUM-1062 — the public retention copy for this plugin's data (the
   * /security page): one paragraph `security.retention.<paragraph>`, placed
   * right after the core paragraph `after`, with the ICU figures it quotes
   * (a list is joined in the locale's "or" style). Without the plugin the
   * paragraph is not shown.
   */
  figures?: RetentionFigureContribution
}

export interface RetentionFigureContribution {
  paragraph: string
  after: string
  values: Record<string, number | readonly number[]>
}

// ── workspace settings (LUM-1062) ────────────────────────────────────────────

/**
 * Workspace settings a plugin owns (RFC §3.4 设置页, §4 option A): the
 * columns stay in the core `Workspace` model, but the core serves and writes
 * them only through this contributor. Without the plugin they are left out
 * of `GET /api/workspaces/me`, and `PATCH /api/workspaces/me` answers 400 for
 * them.
 */
export interface WorkspaceSettingsContributor {
  key: string
  /**
   * Owned `Workspace` columns → the validator `PATCH /api/workspaces/me`
   * applies to each (optional fields; absent = unchanged). Accepted values
   * are written in the same update, with the same OWNER check and audit
   * events, as the core settings.
   */
  columns: Record<string, ZodType>
  /**
   * LUM-1065: owned columns a settings change audits (LUM-907), per audit
   * action; merged with the core's in the same events.
   */
  audit?: AuditedWorkspaceSettings
  /**
   * LUM-1065: the value Prisma writes for an accepted column value, when it
   * is not the value itself — e.g. `Prisma.DbNull` to clear a nullable Json
   * column. The audit diff still sees the validated value.
   */
  toColumnWrite?(column: string, value: unknown): unknown
  /** Extra top-level fields of `GET /api/workspaces/me`. */
  meFields?(): Record<string, unknown>
  /**
   * Whether the workspace lets AI review send its code to a model (the claim
   * faithfulness judge asks). Every contributor must agree; with none the
   * answer is yes, the column default.
   */
  aiReviewEnabled?(workspaceId: string): Promise<boolean>
}
