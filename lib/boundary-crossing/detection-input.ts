/**
 * LUM-1063 — reading a hook event for the boundary detector, and the stored
 * form of a crossing's `detail` / `target`. Pure; shared by the core pipeline
 * (`lib/services/boundary-detector.service.ts`) and the detectors a plugin
 * registers, so both read the same command and clip the same way. Moved
 * verbatim out of the detector service.
 */
import {
  APPLY_PATCH_TOOL,
  applyPatchDeletedPaths,
} from '../../shared/src/apply-patch'
import { redactForStorage } from '@/lib/security-scan/scan-secrets'

const DETAIL_MAX = 200

/**
 * The stored form of a crossing's `detail` / `target`. LUM-900: both are built
 * from the raw command, so credentials in it are redacted (storage form,
 * `ghp_…(len 40)`) BEFORE the cap — clipping first could cut a secret into a
 * fragment no registry rule recognises any more.
 */
export function clip(s: string): string {
  const t = redactForStorage(s).text.trim().replace(/\s+/g, ' ')
  return t.length > DETAIL_MAX ? `${t.slice(0, DETAIL_MAX)}…` : t
}

/** Was this stored `detail` produced by `clip` truncating the command? A
 *  clipped detail is not the whole command, so nothing may be re-judged from
 *  it alone (LUM-772 backfill). LUM-904: judged on the trailing `…` alone —
 *  the LUM-898 re-redaction shortens a clipped detail that quoted a credential
 *  (201 → 174), so its length says nothing any more. A whole command that
 *  happens to end in `…` reads as clipped too and stays open for a human, the
 *  safe side. */
export function isClippedDetail(detail: string): boolean {
  return detail.endsWith('…')
}

/** Codex `apply_patch` event (LUM-1051): `tool_input.command` is patch text. */
export function isApplyPatch(payload: unknown): boolean {
  return (
    !!payload &&
    typeof payload === 'object' &&
    (payload as Record<string, unknown>).tool_name === APPLY_PATCH_TOOL
  )
}

/**
 * Pull the Bash command text out of a PostToolUse payload (unindexed JSON).
 * LUM-1051: an `apply_patch` command is patch text, not shell — matching it
 * against the shell rules would flag any patch that merely mentions
 * `git push`. Its file deletions are what a shell `rm` would be, so they are
 * read as a synthetic `rm -- <paths>` (TEST_FILE_DELETED, migration deletes,
 * project action rules); a patch without deletions has no command.
 */
export function readCommand(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const input = (payload as Record<string, unknown>).tool_input
  if (!input || typeof input !== 'object') return null
  if (isApplyPatch(payload)) {
    const deleted = applyPatchDeletedPaths(input)
    return deleted.length > 0 ? `rm -- ${deleted.join(' ')}` : null
  }
  const cmd = (input as Record<string, unknown>).command
  return typeof cmd === 'string' ? cmd : null
}
