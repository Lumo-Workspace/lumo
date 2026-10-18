/**
 * LUM-1234 — the web evidence view of a REWARD_HACK finding: the one-line
 * summary, an excerpt of the task requirement, and the cited session events
 * (the user prompts that opened the cited turns, and the agent's steps).
 *
 * Access, in this order:
 *  - only a member of the finding's workspace gets a view (else null → 404);
 *  - the requirement is the task's own text — any member who can see the
 *    task sees it;
 *  - a cited session contributes steps and prompts only when the viewer may
 *    open it (`canViewSessionDetail`: its own member, or a workspace OWNER;
 *    for a subagent session the parent is checked too). Otherwise its events
 *    are never read and the view is `restricted`.
 *
 * The judge's explanation (`detail`, model prose) follows the session rule
 * too: a restricted viewer gets the fixed title only.
 *
 * Pruned payloads are left out, and every text is redacted for display and
 * clipped. The PR comment and the finding's title / detail never carry any
 * of this (P8); `evidence` holds only event ids.
 */
import { memberRepository } from '@/lib/repositories/member.repository'
import { canViewSessionDetail } from '@/lib/services/session-detail.service'
import { isPrunedPayload } from '@/lib/hook-event/retention'
import { redactForStorage } from '@/lib/security-scan/scan-secrets'
import {
  rhEventFilePaths,
  rhEventIsShellWrite,
  type RhEvent,
} from '@/ee/security/security-scan/reward-hack-input'
import {
  rewardHackEvidenceRepository,
  type RhEvidenceSessionScope,
} from '@/ee/security/repositories/reward-hack-evidence.repository'
import { rewardHackInputRepository } from '@/ee/security/repositories/reward-hack-input.repository'

export const RH_EVIDENCE_REQUIREMENT_MAX_CHARS = 1_500
export const RH_EVIDENCE_PROMPT_MAX_CHARS = 1_000
export const RH_EVIDENCE_DETAIL_MAX_CHARS = 500
export const RH_EVIDENCE_LABEL_MAX_CHARS = 160
/** Cited ids read from one finding — the judge cites a handful. */
const RH_EVIDENCE_MAX_IDS = 100
/**
 * Text is redacted before it is clipped (a clip could cut a secret into a
 * fragment the patterns no longer match). Only this much is scanned; it is
 * far past every clip, so a cut at the window edge never reaches the output.
 */
const REDACT_WINDOW_CHARS = 20_000

export interface RhEvidenceStep {
  eventId: string
  sessionId: string
  /** `tool` = a tool call; `stop` = the agent's final message of a turn. */
  kind: 'tool' | 'stop'
  /** Tool + file path or command head; '' for `stop`. */
  label: string
  detail: string
}

export interface RhEvidencePrompt {
  eventId: string
  sessionId: string
  text: string
}

export interface RhEvidenceView {
  /** The finding's title — our fixed copy (kind + PR file). */
  summary: string
  /**
   * The judge's own explanation (model prose: it may describe what the
   * session shows) — '' for a `restricted` viewer.
   */
  explanation: string
  requirementExcerpt: string
  steps: RhEvidenceStep[]
  prompts: RhEvidencePrompt[]
  /** A cited session the viewer may not open was left out. */
  restricted: boolean
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

/** Redacted for display, then clipped. */
function displayText(raw: string, max: number): string {
  return clip(redactForStorage(raw.slice(0, REDACT_WINDOW_CHARS)).text, max)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function idList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const ids = value.filter(
    (v): v is string => typeof v === 'string' && v.length > 0
  )
  return [...new Set(ids)].slice(0, RH_EVIDENCE_MAX_IDS)
}

/** `{ eventIds, sessionIds }`; a malformed column reads as nothing cited. */
function parseEvidence(json: string): {
  eventIds: string[]
  sessionIds: string[]
} {
  try {
    const parsed = asRecord(JSON.parse(json))
    return {
      eventIds: idList(parsed?.eventIds),
      sessionIds: idList(parsed?.sessionIds),
    }
  } catch {
    return { eventIds: [], sessionIds: [] }
  }
}

/** What a tool call wrote or ran — the part a reviewer reads. */
function toolDetail(input: Record<string, unknown>): string {
  const edits = input.edits
  if (Array.isArray(edits)) {
    return edits
      .map(e => str(asRecord(e)?.new_string))
      .filter((s): s is string => s !== null)
      .join('\n…\n')
  }
  const direct =
    str(input.new_string) ??
    str(input.content) ??
    str(input.new_source) ??
    str(input.command)
  if (direct !== null) return direct
  const json = JSON.stringify(input)
  return json === '{}' ? '' : json
}

function toStep(ev: RhEvent): RhEvidenceStep {
  const payload = asRecord(ev.payload)
  if (ev.type === 'STOP') {
    return {
      eventId: ev.id,
      sessionId: ev.sessionId,
      kind: 'stop',
      label: '',
      detail: displayText(
        str(payload?.last_assistant_message) ?? '',
        RH_EVIDENCE_DETAIL_MAX_CHARS
      ),
    }
  }
  const tool = ev.toolName ?? str(payload?.tool_name) ?? 'Tool'
  const input = asRecord(payload?.tool_input) ?? {}
  // A Codex apply_patch may touch several files: the first, plus a count.
  const paths = rhEventFilePaths(ev)
  const command = str(input.command)
  const files = paths.length
    ? `${paths[0]}${paths.length > 1 ? ` (+${paths.length - 1} more)` : ''}`
    : ''
  // A shell write keeps its command: the file alone hides how it was written.
  const label =
    files && !rhEventIsShellWrite(ev)
      ? `${tool} ${files}`
      : command
        ? `${tool}${files ? ` ${files}` : ''}: ${command.split('\n')[0] ?? ''}`
        : tool
  return {
    eventId: ev.id,
    sessionId: ev.sessionId,
    kind: 'tool',
    label: displayText(label, RH_EVIDENCE_LABEL_MAX_CHARS),
    detail: displayText(toolDetail(input), RH_EVIDENCE_DETAIL_MAX_CHARS),
  }
}

function toPrompt(ev: RhEvent): RhEvidencePrompt {
  return {
    eventId: ev.id,
    sessionId: ev.sessionId,
    text: displayText(
      str(asRecord(ev.payload)?.prompt) ?? '',
      RH_EVIDENCE_PROMPT_MAX_CHARS
    ),
  }
}

function byTime(a: RhEvent, b: RhEvent): number {
  const d = a.createdAt.getTime() - b.createdAt.getTime()
  return d !== 0 ? d : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** The cited sessions the viewer may open; `restricted` if any is not. */
async function viewableSessions(
  workspaceId: string,
  sessionIds: string[],
  viewer: { id: string; workspaceId: string; role: string }
): Promise<{ ids: string[]; restricted: boolean }> {
  const scopes = await rewardHackEvidenceRepository.findSessionScopes(
    workspaceId,
    sessionIds
  )
  const known = new Map<string, RhEvidenceSessionScope>(
    scopes.map(s => [s.id, s])
  )
  const parentIds = [
    ...new Set(
      scopes
        .map(s => s.parentSessionId)
        .filter((id): id is string => !!id && !known.has(id))
    ),
  ]
  for (const parent of await rewardHackEvidenceRepository.findSessionScopes(
    workspaceId,
    parentIds
  )) {
    known.set(parent.id, parent)
  }

  const ids: string[] = []
  let restricted = false
  for (const id of sessionIds) {
    const session = known.get(id)
    // Gone, or not in this workspace: nothing of it exists to show.
    if (!session) continue
    const parent = session.parentSessionId
      ? known.get(session.parentSessionId)
      : undefined
    const allowed =
      canViewSessionDetail(session, viewer) &&
      (!parent || canViewSessionDetail(parent, viewer))
    if (allowed) ids.push(id)
    else restricted = true
  }
  return { ids, restricted }
}

/** Cited prompts plus, per cited step, the prompt that opened its turn. */
async function collectPrompts(
  workspaceId: string,
  citedPrompts: RhEvent[],
  steps: RhEvent[]
): Promise<RhEvidencePrompt[]> {
  const chosen = new Map<string, RhEvent>(citedPrompts.map(e => [e.id, e]))
  if (steps.length > 0) {
    const latest = steps.reduce((a, b) => (byTime(a, b) >= 0 ? a : b))
    const candidates = (
      await rewardHackEvidenceRepository.findPromptsUpTo(
        workspaceId,
        [...new Set(steps.map(s => s.sessionId))],
        latest.createdAt
      )
    )
      .filter(e => !isPrunedPayload(e.payload))
      .sort((a, b) => byTime(b, a))
    for (const step of steps) {
      const opener = candidates.find(
        c => c.sessionId === step.sessionId && byTime(c, step) < 0
      )
      if (opener) chosen.set(opener.id, opener)
    }
  }
  return [...chosen.values()].sort(byTime).map(toPrompt)
}

export const rewardHackEvidenceService = {
  /**
   * The evidence view of `findingId` for the signed-in user `viewerUserId`,
   * or null when the finding does not exist, is not REWARD_HACK, is not on
   * `opts.taskId` (when given), or the viewer is not a member of its
   * workspace — the route answers all of them with 404.
   */
  async getForViewer(
    findingId: string,
    viewerUserId: string,
    opts: { taskId?: string } = {}
  ): Promise<RhEvidenceView | null> {
    const finding = await rewardHackEvidenceRepository.findFinding(findingId)
    if (!finding || finding.kind !== 'REWARD_HACK') return null
    const { taskId, workspaceId } = finding.scan
    if (opts.taskId !== undefined && taskId !== opts.taskId) return null

    const viewer = await memberRepository.findRoleInWorkspace(
      workspaceId,
      viewerUserId
    )
    if (!viewer) return null

    const { eventIds, sessionIds } = parseEvidence(finding.evidence)
    const [requirement, sessions] = await Promise.all([
      taskId
        ? rewardHackInputRepository.loadRequirement(workspaceId, taskId)
        : Promise.resolve(''),
      viewableSessions(workspaceId, sessionIds, viewer),
    ])

    const events = (
      await rewardHackEvidenceRepository.findEvents(
        workspaceId,
        sessions.ids,
        eventIds
      )
    )
      .filter(e => !isPrunedPayload(e.payload))
      .sort(byTime)
    const citedPrompts = events.filter(e => e.type === 'USER_PROMPT_SUBMIT')
    const steps = events.filter(
      e => e.type === 'POST_TOOL_USE' || e.type === 'STOP'
    )

    return {
      summary: displayText(finding.title, RH_EVIDENCE_PROMPT_MAX_CHARS),
      explanation: sessions.restricted
        ? ''
        : displayText(finding.detail, RH_EVIDENCE_PROMPT_MAX_CHARS),
      requirementExcerpt: displayText(
        requirement,
        RH_EVIDENCE_REQUIREMENT_MAX_CHARS
      ),
      steps: steps.map(toStep),
      prompts: await collectPrompts(workspaceId, citedPrompts, steps),
      restricted: sessions.restricted,
    }
  },
}
