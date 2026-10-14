/**
 * LUM-1061 — server entry of the security plugin (RFC
 * docs/rfc/2026-10-10-LUM-1058-plugin-boundary.md §3, decision Q8:
 * `ee/security/`). Registers the existing implementations on the core's
 * extension points; the implementation files themselves still live under
 * lib/ and move here in PR6.
 *
 * Everything heavier than the scan dispatcher is loaded with a dynamic
 * `import()` on first use, so the core modules that read the registry
 * (done-verdict, task-status, the hook routes…) do not pull the scan graph
 * into their own static graph. The dispatcher stays static on purpose: it
 * only needs the logger, and the PR events must start it synchronously. The
 * settings validators, the platform ceiling and the retention figures are
 * pure and static too (LUM-1062): the settings schema is built synchronously.
 * LUM-1063: so do the policy-check dispatcher (logger only) and the crossing
 * detectors (pure; the hook pipeline calls them synchronously — the LLM
 * confirmation and the policy compiler inside them load lazily).
 */
import type {
  LumoServerPlugin,
  RetentionStockDriver,
} from '@/lib/plugins/types'
import { logger } from '@/lib/logger'
import { waitUntil } from '@/lib/runtime/wait-until'
import {
  dispatchPrSecurityScan,
  shouldScanOnPrEvent,
} from '@/ee/security/services/pr-security-scan-dispatch'
import {
  DEFAULT_SCAN_EVIDENCE_RETENTION_DAYS,
  SCAN_EVIDENCE_HARD_CAP_DAYS,
  SCAN_EVIDENCE_RETENTION_DAYS,
} from '@/lib/retention/scan-evidence'
import { securityTaskStatusSection } from './task-status'
import { securityWorkspaceSettings } from './workspace-settings'
import { dispatchPolicyCheck } from '@/ee/security/services/policy/policy-check-dispatch'
import {
  advancedCommandDetector,
  policyRuleDetector,
} from './crossing-detectors'
import { compiledPolicyRuleSource } from './policy-rules'
import {
  parsePrCommand,
  prCommandHandle,
} from '@/ee/security/services/pr-command-parse'

export const securityPlugin: LumoServerPlugin = {
  id: 'security',
  register(api) {
    // DONE gate (LUM-732 / LUM-740): an undispositioned finding the
    // workspace policy marks blocking refuses DONE. Fail-closed.
    api.doneGate({
      id: 'security',
      async openBlockers(taskId) {
        const { listOpenBlockingFindings } =
          await import('@/ee/security/services/pr-security-scan-gate')
        return listOpenBlockingFindings(taskId)
      },
    })

    // Agent context (LUM-737): session-start / attach section, the
    // `lumo task status` read-out and the one-shot PreToolUse reminder
    // (served as `securityReminder`).
    api.agentContext({
      id: 'security',
      async sessionStart({ taskId, taskIdentifier }) {
        const { prSecurityReminderService } =
          await import('@/ee/security/services/pr-security-reminder.service')
        return prSecurityReminderService.buildSessionStartSection(
          taskId,
          taskIdentifier
        )
      },
      taskStatus: securityTaskStatusSection,
      async preToolUseReminder({ taskId }) {
        const { prSecurityReminderService } =
          await import('@/ee/security/services/pr-security-reminder.service')
        return prSecurityReminderService.buildAgentReminder(taskId)
      },
    })

    // LUM-732: every push to a task-linked open PR gets a scan of its
    // current head. The worker dedups on (pr, headSha), so redelivery is
    // harmless. Registered with waitUntil so the runtime keeps the function
    // alive until the dispatch settles.
    api.on(
      'github.pullRequest',
      ({ action, state, pullRequestId, workspaceId }) => {
        if (shouldScanOnPrEvent(action, state))
          waitUntil(dispatchPrSecurityScan(pullRequestId, 'PR_EVENT'))
        // LUM-1131: a merged PR's thread learnings become repository-wide.
        // Idempotent; a missed event is covered at read time (the review
        // also treats a merged source PR as repository-wide).
        if (state === 'merged')
          waitUntil(
            (async () => {
              try {
                const { promoteLearningsOnMerge } =
                  await import('@/ee/security/services/review-learnings.service')
                await promoteLearningsOnMerge(workspaceId, pullRequestId)
              } catch (error) {
                logger.warn(
                  `[security] learning promotion failed pr=${pullRequestId}: ${error instanceof Error ? error.message : String(error)}`
                )
              }
            })()
          )
      }
    )

    // LUM-732: a manually linked PR (any state — merged history included)
    // gets one scan of its current head. A dropped promise here would read
    // as "clean" at the DONE gate, hence waitUntil, not a bare `void`.
    api.on('task.prLinked', ({ pullRequestId }) => {
      waitUntil(dispatchPrSecurityScan(pullRequestId, 'PR_LINK'))
    })

    // LUM-1127: a human resolving / unresolving one of Lumo's finding
    // threads on GitHub. Dynamic import keeps the thread service (and its
    // GitHub clients) off the webhook's static graph.
    api.on('github.reviewThread', event => {
      waitUntil(
        (async () => {
          try {
            const { applyReviewThreadEvent } =
              await import('@/ee/security/services/pr-finding-thread.service')
            await applyReviewThreadEvent(event)
          } catch (error) {
            logger.warn(
              `[security] review thread event failed pr=${event.pullRequestId}: ${error instanceof Error ? error.message : String(error)}`
            )
          }
        })()
      )
    })

    // LUM-1129: `@<app> review | full review | pause | resume | resolve` in a
    // PR conversation comment. The ordinary comment is dropped here,
    // synchronously; a command loads the service (GitHub clients) lazily.
    api.on('github.issueComment', event => {
      if (event.action !== 'created') return
      const handle = prCommandHandle()
      if (!handle || !parsePrCommand(event.comment.body, handle)) return
      waitUntil(
        (async () => {
          try {
            const { applyPrCommentCommand } =
              await import('@/ee/security/services/pr-command.service')
            await applyPrCommentCommand(event)
          } catch (error) {
            logger.warn(
              `[security] PR command failed pr=${event.pullRequestId}: ${error instanceof Error ? error.message : String(error)}`
            )
          }
        })()
      )
    })

    // LUM-1131: a human reply in one of Lumo's finding threads — answered,
    // and when it says the finding is intentional / not applicable, the
    // thread is closed for this PR and a learning stored for later reviews.
    // Dynamic import: the reply service reaches the model client.
    api.on('github.reviewComment', event => {
      if (event.action !== 'created' || event.comment.inReplyToId === null)
        return
      waitUntil(
        (async () => {
          try {
            const { applyThreadReply } =
              await import('@/ee/security/services/pr-thread-reply.service')
            await applyThreadReply(event)
          } catch (error) {
            logger.warn(
              `[security] thread reply failed pr=${event.pullRequestId}: ${error instanceof Error ? error.message : String(error)}`
            )
          }
        })()
      )
    })

    // LUM-738: a push to the default branch moves the repository security
    // baseline (the default-branch fingerprint set that decides whether a
    // PR's dependency finding is new). Detached + fail-soft. Dynamic import:
    // the baseline service reaches github/contents → auth (octokit, ESM) and
    // the workflow start, which the webhook handlers must stay loadable
    // without.
    api.on('github.push', ({ isDefaultBranch, workspaceId, repo, headSha }) => {
      if (!isDefaultBranch) return
      waitUntil(requestBaseline({ workspaceId, repo, sha: headSha }))
    })

    // LUM-1063 (PR4): boundary crossings. The advanced detectors and the
    // LUM-466 prose confirmation (LLM), the compiled project policy rules
    // (LUM-590, LLM compiler) and the system explanation of a crossing (LLM).
    api.crossingDetector(advancedCommandDetector)
    api.crossingDetector(policyRuleDetector)
    api.policyRuleSource(compiledPolicyRuleSource)
    api.crossingExplainer({
      id: 'security',
      async explain(input) {
        // Dynamic import — keeps the LLM client off the detect/hot path.
        const { explainCrossing } =
          await import('@/ee/security/llm/crossing-explain-client')
        return explainCrossing(input)
      },
    })

    // LUM-590: on IN_REVIEW, dispatch the code-rule pipeline to the foreground
    // worker (/api/internal/policy-check, 300s). Runs the deterministic
    // diff-regex pass + the semantic LLM judge against the PR diff and
    // persists findings as advisory boundary crossings. Must NOT run inline in
    // the task route's ~15s waitUntil budget (same pattern as run-summary
    // LUM-576 and fold LUM-555). Best-effort: the dispatcher never throws.
    api.on('task.statusChanged', ({ taskId, status }) => {
      if (status === 'IN_REVIEW') void dispatchPolicyCheck(taskId)
    })

    api.retention({
      key: 'scanEvidence',
      // LUM-914: pre-LUM-911 scans still holding code.
      stock: {
        category: 'scan-evidence',
        countsFindings: true,
        async driver() {
          const { scanEvidenceStockDriver } = await import('./retention-stock')
          return scanEvidenceStockDriver() as unknown as RetentionStockDriver<{
            id: string
          }>
        },
      },
      // LUM-855: losing GitHub access disposes of the scan evidence, call
      // chains, hunt audit/job and PR summaries of those repositories. Scan
      // and finding rows stay so DONE gating and history survive.
      async scrubRepositoryCode({ workspaceId, repos }) {
        const { prSecurityScanRepository } =
          await import('@/ee/security/repositories/pr-security-scan.repository')
        const counts = await prSecurityScanRepository.scrubCodeForWorkspace(
          workspaceId,
          repos
        )
        return { scan: counts.scans, finding: counts.findings }
      },
      // LUM-915: the /security page's scan evidence paragraph quotes the
      // same constants the settings row and the sweep use.
      figures: {
        paragraph: 'scan',
        after: 'tighten',
        values: {
          scanDefault: DEFAULT_SCAN_EVIDENCE_RETENTION_DAYS,
          scanTiers: SCAN_EVIDENCE_RETENTION_DAYS,
          openCap: SCAN_EVIDENCE_HARD_CAP_DAYS,
        },
      },
    })

    // LUM-1062: the policy, evidence retention and scan switches columns.
    api.workspaceSettings(securityWorkspaceSettings)
  },
}

async function requestBaseline(input: {
  workspaceId: string
  repo: string
  sha: string
}): Promise<void> {
  try {
    const { securityBaselineService } =
      await import('@/ee/security/services/security-baseline.service')
    await securityBaselineService.requestFromPush(input)
  } catch (err) {
    logger.warn(
      '[webhook] security baseline request failed:',
      err instanceof Error ? err.message : String(err)
    )
  }
}
