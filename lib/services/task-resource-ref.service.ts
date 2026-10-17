import {
  taskResourceRefRepository,
  type TaskResourceKind,
} from '@/lib/repositories/task-resource-ref.repository'
import {
  isFullCuid,
  matchRef,
  MIN_REF_LENGTH,
  normaliseRef,
  refMatchError,
} from '@/shared/src/short-ref'

const NOUN: Record<TaskResourceKind, string> = {
  artifact: 'artifact',
  webLink: 'web link',
  slackContext: 'Slack context',
  figmaLink: 'Figma link',
}

/**
 * LUM-1230: turn what a person typed for a task's artifact / web link / Slack
 * context / Figma link — the 8-char short ref `lumo task context` and the
 * listings print, a unique id prefix (≥6) or the full cuid — into the
 * resource's id, among that task's resources only.
 *
 * A full cuid passes through untouched so the routes keep their existing
 * semantics (their own lookup still 404s a foreign id). Otherwise: no match
 * is 404, too short is 400, several matches is 409 listing every candidate —
 * never a silent pick.
 */
export async function resolveTaskResourceRef(
  kind: TaskResourceKind,
  taskId: string,
  ref: string
): Promise<string> {
  const needle = normaliseRef(ref)
  if (isFullCuid(needle)) return needle
  if (needle.length < MIN_REF_LENGTH) {
    throw Object.assign(
      new Error(
        refMatchError(NOUN[kind], ref, { kind: 'too-short' }, () => '')
      ),
      { status: 400 }
    )
  }
  const ids = await taskResourceRefRepository.listIds(kind, taskId)
  const match = matchRef(needle, ids, id => id)
  if (match.kind === 'found') return match.item
  const status =
    match.kind === 'ambiguous' ? 409 : match.kind === 'too-short' ? 400 : 404
  throw Object.assign(
    new Error(refMatchError(NOUN[kind], ref, match, id => id)),
    { status }
  )
}
