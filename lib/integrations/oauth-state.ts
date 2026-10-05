/**
 * OAuth `state` for the member-level integration flows (GitHub OAuth, Slack)
 * and the GitHub App install / reverify legs (LUM-991).
 *
 * The state is AES-256-GCM encrypted (so it can't be forged or edited) and
 * carries an issued-at time so a captured state stops working after
 * OAUTH_STATE_TTL_MS. It does NOT prove who completes the flow — callbacks must
 * still check that the signed-in member matches `memberId` (LUM-982).
 */
import { encrypt, decrypt } from '@/lib/crypto'

/** Long enough for a real consent screen, short enough to bound replay. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000

/** Tolerated clock skew between instances for an iat slightly in the future. */
const MAX_FUTURE_SKEW_MS = 60 * 1000

export interface OauthStatePayload {
  workspaceId: string
  memberId: string
  workspaceUrl: string
  /** GitHub App legs only: the installation the flow verifies (LUM-991). */
  installationId?: number
  /** GitHub App reverify leg only (LUM-881). */
  mode?: 'reverify'
}

export type DecodedOauthState =
  | { ok: true; payload: OauthStatePayload }
  | { ok: false; reason: 'invalid' | 'expired' }

export function encodeOauthState(
  payload: OauthStatePayload,
  now: number = Date.now()
): string {
  return encrypt(JSON.stringify({ ...payload, iat: now }))
}

/**
 * `invalid` — not ours (fails decrypt) or malformed.
 * `expired` — ours but older than the TTL, or minted before states carried an
 * `iat`; the user just clicks Connect again.
 */
export function decodeOauthState(
  state: string,
  now: number = Date.now()
): DecodedOauthState {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(decrypt(state)) as Record<string, unknown>
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof parsed.workspaceId !== 'string' ||
    typeof parsed.memberId !== 'string' ||
    typeof parsed.workspaceUrl !== 'string'
  ) {
    return { ok: false, reason: 'invalid' }
  }
  const { installationId, mode } = parsed
  if (
    (installationId !== undefined &&
      !(Number.isInteger(installationId) && (installationId as number) > 0)) ||
    (mode !== undefined && mode !== 'reverify')
  ) {
    return { ok: false, reason: 'invalid' }
  }
  const iat = parsed.iat
  if (typeof iat !== 'number' || !Number.isFinite(iat)) {
    return { ok: false, reason: 'expired' }
  }
  if (iat > now + MAX_FUTURE_SKEW_MS) return { ok: false, reason: 'invalid' }
  if (now - iat > OAUTH_STATE_TTL_MS) return { ok: false, reason: 'expired' }
  return {
    ok: true,
    payload: {
      workspaceId: parsed.workspaceId,
      memberId: parsed.memberId,
      workspaceUrl: parsed.workspaceUrl,
      ...(installationId !== undefined
        ? { installationId: installationId as number }
        : {}),
      ...(mode !== undefined ? { mode: 'reverify' as const } : {}),
    },
  }
}
