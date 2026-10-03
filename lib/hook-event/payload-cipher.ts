/**
 * LUM-863 — transparent encryption of HookEvent.payload (server-only).
 *
 * Repositories write through `sealHookPayload` and read through
 * `openHookPayloads`; nothing above the repository layer sees ciphertext.
 *
 * Storage: with a KEK configured, a new row keeps `payload` NULL and stores
 * the body in `payloadEncrypted`, sealed with its workspace's data key. Rows
 * recorded earlier (or while no KEK was configured) keep the plaintext
 * `payload` and are read as before — the backward-compatible path.
 */
import { Prisma } from '@prisma/client'
import { logger } from '@/lib/logger'
import {
  openEnvelope,
  parseEnvelope,
  sealString,
} from '@/lib/envelope-crypto/cipher'
import { workspaceKeyring } from '@/lib/envelope-crypto/workspace-keyring'

/** AAD for a HookEvent payload: purpose + the sealing key's workspace. */
export function hookPayloadAad(workspaceId: string): string {
  return `lumo:hook_events.payload:${workspaceId}`
}

/** Prisma `data` fields for writing a payload. */
export interface SealedHookPayload {
  payload: Prisma.InputJsonValue | Prisma.NullTypes.DbNull
  payloadEncrypted: string | null
}

let warnedDisabled = false

/** True when new payloads are stored encrypted (a KEK is configured). */
export function isHookPayloadEncryptionEnabled(): boolean {
  return workspaceKeyring.isEnabled()
}

/**
 * The column values to store `payload` under `workspaceId`: ciphertext when a
 * KEK is configured, else the plaintext (logged once per process, so a missing
 * WORKSPACE_KEKS in production is visible in the logs).
 */
export async function sealHookPayload(
  workspaceId: string,
  payload: Prisma.InputJsonValue
): Promise<SealedHookPayload> {
  if (!workspaceKeyring.isEnabled()) {
    if (!warnedDisabled) {
      warnedDisabled = true
      logger.warn(
        '[hook-payload] WORKSPACE_KEKS not set — hook event payloads are stored unencrypted'
      )
    }
    return { payload, payloadEncrypted: null }
  }
  const dataKey = await workspaceKeyring.getSealingKey(workspaceId)
  return {
    payload: Prisma.DbNull,
    payloadEncrypted: sealString(
      dataKey.id,
      dataKey.key,
      JSON.stringify(payload),
      hookPayloadAad(dataKey.workspaceId)
    ),
  }
}

type PayloadRow = {
  /** The row's own workspace — a ciphertext only opens under its data key. */
  workspaceId: string
  payload: Prisma.JsonValue | null
  payloadEncrypted: string | null
}

export type OpenedRow<T extends PayloadRow> = Omit<T, 'payloadEncrypted'>

/**
 * Replace each row's `payload` with its decrypted body (plaintext rows pass
 * through) and drop `payloadEncrypted`. Keys are fetched once per distinct
 * data key. Fail-soft per row: a row reads as `payload: null` (and is logged)
 * when its data key no longer exists (its workspace was deleted) or cannot be
 * unwrapped (its KEK is missing from the ring), when the data key belongs to
 * a different workspace than the row (a ciphertext moved between rows), or
 * when the ciphertext fails authentication — one bad row never fails a read.
 */
export async function openHookPayloads<T extends PayloadRow>(
  rows: T[]
): Promise<OpenedRow<T>[]> {
  const envelopes = new Map<number, ReturnType<typeof parseEnvelope>>()
  rows.forEach((row, i) => {
    if (row.payloadEncrypted != null) {
      envelopes.set(i, parseEnvelope(row.payloadEncrypted))
    }
  })
  const keyIds = [...envelopes.values()].flatMap(e => (e ? [e.dataKeyId] : []))
  const keys =
    keyIds.length > 0
      ? await workspaceKeyring.getKeysByIds(keyIds)
      : new Map<string, never>()

  return rows.map((row, i) => {
    const { payloadEncrypted, ...rest } = row
    if (payloadEncrypted == null) return rest
    const envelope = envelopes.get(i)
    const dataKey = envelope ? keys.get(envelope.dataKeyId) : undefined
    if (!envelope || !dataKey) {
      logger.warn(
        '[hook-payload] payload not decryptable (key missing or unusable)',
        {
          dataKeyId: envelope?.dataKeyId ?? null,
        }
      )
      return { ...rest, payload: null }
    }
    if (dataKey.workspaceId !== row.workspaceId) {
      logger.warn(
        '[hook-payload] payload not decryptable (workspace mismatch)',
        {
          dataKeyId: envelope.dataKeyId,
        }
      )
      return { ...rest, payload: null }
    }
    try {
      const text = openEnvelope(
        envelope,
        dataKey.key,
        hookPayloadAad(dataKey.workspaceId)
      )
      return { ...rest, payload: JSON.parse(text) as Prisma.JsonValue }
    } catch {
      logger.error('[hook-payload] payload failed authentication', {
        dataKeyId: envelope.dataKeyId,
      })
      return { ...rest, payload: null }
    }
  })
}

/** Single-row convenience over `openHookPayloads`. */
export async function openHookPayload<T extends PayloadRow>(
  row: T
): Promise<OpenedRow<T>> {
  const [opened] = await openHookPayloads([row])
  return opened!
}
