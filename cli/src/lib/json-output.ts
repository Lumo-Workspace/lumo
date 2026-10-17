/**
 * LUM-1232 batch C — the one `--json` envelope (docs/cli-output-conventions.md
 * J-1–J-5, decision Q3):
 *
 * - the top level is always an object and carries `version` (an integer that
 *   changes only on a breaking change);
 * - a list puts its items under a plural noun and adds `total` (number, or
 *   null when unknown) and `nextCursor` (string, or null on the last page);
 * - a detail view puts the resource under a singular noun, related blocks as
 *   siblings.
 *
 * Existing JSON outputs only GAIN these keys (Q3: add in place); nothing is
 * renamed or removed. A failure under `--json` is printed by
 * `lib/error-output.ts` (batch E), not here.
 */

/** The envelope version every command starts at. */
export const JSON_VERSION = 1

/** Pretty-printed JSON plus a trailing newline — the one stdout shape. */
export function stringifyJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n'
}

/** Write a JSON document to stdout (default) or the given sink. */
export function emitJson(
  value: unknown,
  out: { write(s: string): unknown } = process.stdout
): void {
  out.write(stringifyJson(value))
}

export interface ListPage {
  /** Size of the whole (filtered) result, or null when unknown. */
  total?: number | null
  /** Cursor for the next page, or null on the last page. */
  nextCursor?: string | null
}

/**
 * `{ version, <noun>: items, total, nextCursor, ...extra }`. `total`
 * defaults to the item count and `nextCursor` to null (a complete list).
 */
export function listEnvelope<T>(
  noun: string,
  items: readonly T[],
  page: ListPage = {},
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    version: JSON_VERSION,
    [noun]: items,
    total: page.total === undefined ? items.length : page.total,
    nextCursor: page.nextCursor ?? null,
    ...extra,
  }
}

/** `{ version, <noun>: resource, ...related }`. */
export function detailEnvelope(
  noun: string,
  resource: unknown,
  related: Record<string, unknown> = {}
): Record<string, unknown> {
  return { version: JSON_VERSION, [noun]: resource, ...related }
}

/**
 * Add `version` (first) to an existing JSON object without touching any of
 * its keys; an object that already carries its own `version` keeps it.
 */
export function withVersion<T extends object>(
  body: T
): Record<string, unknown> {
  if (Object.prototype.hasOwnProperty.call(body, 'version')) {
    return body as Record<string, unknown>
  }
  return { version: JSON_VERSION, ...body }
}

/**
 * Internal-only columns a command that adds `--json` from now on never
 * starts exposing (J-3). Commands that already emitted them keep doing so
 * until the versioned removal process runs.
 */
export const INTERNAL_FIELDS: readonly string[] = [
  'workspaceId',
  'order',
  'viewOrder',
  'deletedAt',
  'deletedByClerkId',
  'trashRootId',
  'claimSnapshot',
  'claimSnapshotAt',
  'claimSnapshotSessionId',
  'claimSnapshotSource',
]

/**
 * A deep copy of `value` without the INTERNAL_FIELDS keys, at any depth.
 * Arrays and plain objects are walked; everything else is returned as is.
 */
export function stripInternalFields<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(v => stripInternalFields(v)) as unknown as T
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (INTERNAL_FIELDS.includes(k)) continue
      out[k] = stripInternalFields(v)
    }
    return out as T
  }
  return value
}

/**
 * Keep only `fields` (in that order) of each row — the `--fields` selection.
 * A field a row lacks comes out as null (J-3: absent is null, not omitted).
 */
export function pickFields(
  row: Record<string, unknown>,
  fields: readonly string[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) out[f] = row[f] === undefined ? null : row[f]
  return out
}

export type FieldListResult =
  | { ok: true; fields: string[] }
  | { ok: false; error: string }

/**
 * Parse a `--fields a,b,c` value against the command's declared fields.
 * Empty entries are ignored; an unknown name or an empty list is an error.
 */
export function parseFieldList(
  raw: string,
  allowed: readonly string[]
): FieldListResult {
  const fields = raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  if (fields.length === 0) {
    return {
      ok: false,
      error: `--fields needs at least one field. Available: ${allowed.join(', ')}`,
    }
  }
  const unknown = fields.filter(f => !allowed.includes(f))
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `unknown field${unknown.length === 1 ? '' : 's'} ${unknown.map(f => `"${f}"`).join(', ')} for --fields. Available: ${allowed.join(', ')}`,
    }
  }
  return { ok: true, fields: [...new Set(fields)] }
}
