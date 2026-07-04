import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { openBrowser } from '../lib/browser'

export interface PlanOptions {
  /** Abandon the team's existing active run before starting a fresh one. */
  abandonActive?: boolean
}

interface PlanRunResponse {
  run: { id: string; stage: string }
}

/**
 * Web deep-link to a run's converter page: `/workspace/<slug>/plan/<runId>`.
 * The page routes to whichever gate is open on the run — so the same link is
 * "gate A" at start (run in CLUSTERING) and "the next gate" mid-run. Editing
 * and gate confirmation happen in the web UI; the CLI only carries the human
 * there.
 */
export function formatPlanDeepLink(
  base: string,
  workspaceSlug: string,
  runId: string
): string {
  return `${trimTrailingSlash(base)}/workspace/${workspaceSlug}/plan/${runId}`
}

/**
 * Human label for a run stage. The gates (`*_READY`) name the decision waiting
 * on the human; the working stages name the LLM segment in flight. Unknown /
 * future stages fall back to the raw enum so nothing is silently swallowed.
 */
export function stageLabel(stage: string): string {
  const LABELS: Record<string, string> = {
    CLUSTERING: '聚类中 (clustering)',
    CLUSTERS_READY: '闸门 A · 聚类待确认 (gate A — confirm clusters)',
    ALIGNING: '对齐中 (aligning)',
    ALIGNMENT_READY: '闸门 B · 对齐待确认 (gate B — confirm alignment)',
    GENERATING: '成计划中 (generating)',
    DRAFT_READY: '闸门 C · 草案待确认 (gate C — confirm draft)',
    FAILED: '失败 · 可重试 (failed — retryable)',
  }
  return LABELS[stage] ?? stage
}

/**
 * `lumo plan [--abandon-active]` — start a design-thinking 转换器 run.
 *
 * Starts a run and prints (and opens) the gate-A web deep-link. When a run is
 * already active the server refuses (409) — we point the user at
 * `lumo plan status` or `--abandon-active`. `--abandon-active` first abandons
 * the prior run, then starts a fresh one. All editing/confirmation is in web;
 * the CLI only triggers and hands off the deep-link.
 */
export async function plan(opts: PlanOptions = {}): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }

  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)

  const body: Record<string, unknown> = {}
  if (opts.abandonActive) body.abandonActive = true

  let res: Response
  try {
    res = await fetch(`${base}/api/plan-runs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return 1
  }

  if (res.status === 401) {
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }

  if (res.status === 409) {
    console.error(
      'Error: a plan run is already active for your team.\n' +
        '  Check it with `lumo plan status`, or start over with ' +
        '`lumo plan --abandon-active`.'
    )
    return 1
  }

  if (res.status === 201) {
    const { run } = (await res.json()) as PlanRunResponse
    const deepLink = formatPlanDeepLink(base, creds.workspaceSlug, run.id)
    process.stdout.write(
      `✓ 计划转换 run 已启动 (${run.id}) — 聚类进行中。\n` +
        '到闸门 A 在 web 端确认聚类结果:\n' +
        `  ${sanitizeField(deepLink)}\n`
    )
    openBrowser(deepLink)
    return
  }

  return reportServerError(res)
}

/**
 * `lumo plan status` — where the active run stands.
 *
 * Prints the active run's current stage and the deep-link to act on its next
 * gate. With no active run, prompts the user to run `lumo plan`.
 */
export async function planStatus(): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }

  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)

  let res: Response
  try {
    res = await fetch(`${base}/api/plan-runs/active`, {
      headers: { Authorization: `Bearer ${creds.token}` },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return 1
  }

  if (res.status === 401) {
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }

  if (!res.ok) {
    return reportServerError(res)
  }

  const { run } = (await res.json()) as {
    run: { id: string; stage: string } | null
  }
  if (!run) {
    process.stdout.write(
      '没有进行中的计划转换 run。运行 `lumo plan` 启动一个。\n'
    )
    return
  }

  const deepLink = formatPlanDeepLink(base, creds.workspaceSlug, run.id)
  process.stdout.write(
    `计划转换 run ${run.id}\n` +
      `  当前 stage: ${stageLabel(run.stage)}\n` +
      '  下一个闸门在 web 端处理:\n' +
      `  ${sanitizeField(deepLink)}\n`
  )
  return
}

/** Print a server error body (or status-only fallback) to stderr; returns 1. */
async function reportServerError(res: Response): Promise<number> {
  let serverMsg: string | null = null
  try {
    const errBody = (await res.json()) as { error?: string }
    if (typeof errBody.error === 'string') serverMsg = errBody.error
  } catch {
    // Body wasn't JSON; fall through to a status-only message.
  }
  if (serverMsg) {
    console.error(`Error: ${sanitizeField(serverMsg)}`)
  } else {
    console.error(`Error: plan command failed (HTTP ${res.status})`)
  }
  return 1
}
