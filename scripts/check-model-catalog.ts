/**
 * LUM-1084 — is every model id Lumo calls still on the AI Gateway?
 *
 * `alibaba/qwen3-coder-plus` (HUNT_MODEL) left the gateway catalog and every
 * production hunt failed with "Model not exist." for a day before anyone
 * looked. This compares each model id exported from `lib/ai/models.ts` (plus
 * `EMBEDDING_MODEL`) with the gateway's PUBLIC catalog and lists the ones that
 * are gone; for a model in `MODEL_PROVIDER_PINS` it also checks that at least
 * one pinned host still serves it. Run it before and after touching a model
 * id; it exits 1 when anything is missing.
 *
 *   npm run ai:check-models            # human read-out
 *   npm run ai:check-models -- --json  # machine read-out
 *
 * Needs no credentials: the catalog endpoints are public. The comparison
 * itself is pure (`checkModels`) and unit-tested without the network.
 */
import * as models from '../lib/ai/models'

const CATALOG_URL = 'https://ai-gateway.vercel.sh/v1/models'

export interface ModelRef {
  /** The exported constant(s) carrying this id, e.g. `HUNT_MODEL`. */
  constants: string[]
  id: string
}

export interface ModelCheck extends ModelRef {
  inCatalog: boolean
  /** Pinned hosts, when the model is pinned. */
  pins?: readonly string[]
  /** Hosts serving it now; only fetched for pinned models. */
  hosts?: string[]
  /** Pinned but no pinned host serves it. */
  pinUnserved?: boolean
}

/** Every `*_MODEL` string export, grouped by id. */
export function collectModelRefs(
  exportsByName: Record<string, unknown>
): ModelRef[] {
  const byId = new Map<string, string[]>()
  for (const [name, value] of Object.entries(exportsByName)) {
    if (!name.endsWith('_MODEL') || typeof value !== 'string') continue
    byId.set(value, [...(byId.get(value) ?? []), name])
  }
  return [...byId.entries()]
    .map(([id, constants]) => ({ id, constants: constants.sort() }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

/** Pure: which refs are missing from `catalogIds`, and are pins still served. */
export function checkModels(
  refs: readonly ModelRef[],
  catalogIds: ReadonlySet<string>,
  pins: Readonly<Record<string, readonly string[]>>,
  hostsById: ReadonlyMap<string, readonly string[]> = new Map()
): ModelCheck[] {
  return refs.map(ref => {
    const inCatalog = catalogIds.has(ref.id)
    const pin = pins[ref.id]
    if (!pin) return { ...ref, inCatalog }
    const hosts = [...(hostsById.get(ref.id) ?? [])]
    return {
      ...ref,
      inCatalog,
      pins: pin,
      hosts,
      pinUnserved: !hosts.some(h => pin.includes(h)),
    }
  })
}

export function hasProblems(checks: readonly ModelCheck[]): boolean {
  return checks.some(c => !c.inCatalog || c.pinUnserved === true)
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  return res.json()
}

async function main(): Promise<void> {
  const json = process.argv.includes('--json')
  // Imported here, not at the top: it pulls the gateway runtime, which the
  // pure functions above (and their test) do not need.
  const { EMBEDDING_MODEL } = await import('../lib/ai/embedding')
  const refs = collectModelRefs({
    ...(models as Record<string, unknown>),
    EMBEDDING_MODEL,
  })
  const catalog = (await fetchJson(CATALOG_URL)) as {
    data?: Array<{ id: string }>
  } | null
  const catalogIds = new Set((catalog?.data ?? []).map(m => m.id))
  if (catalogIds.size === 0) throw new Error('empty gateway catalog')
  const hostsById = new Map<string, string[]>()
  for (const id of Object.keys(models.MODEL_PROVIDER_PINS)) {
    if (!catalogIds.has(id)) continue
    const ep = (await fetchJson(`${CATALOG_URL}/${id}/endpoints`)) as {
      data?: { endpoints?: Array<{ provider_name?: string }> }
    } | null
    hostsById.set(
      id,
      (ep?.data?.endpoints ?? [])
        .map(e => e.provider_name)
        .filter((p): p is string => typeof p === 'string')
    )
  }
  const checks = checkModels(
    refs,
    catalogIds,
    models.MODEL_PROVIDER_PINS,
    hostsById
  )
  if (json) {
    process.stdout.write(`${JSON.stringify(checks, null, 2)}\n`)
  } else {
    for (const c of checks) {
      const state = !c.inCatalog
        ? 'MISSING from the gateway catalog'
        : c.pinUnserved
          ? `pinned to ${c.pins!.join(', ')} but served only by ${c.hosts!.join(', ') || 'nobody'}`
          : 'ok'
      process.stdout.write(`${c.id}  (${c.constants.join(', ')})  ${state}\n`)
    }
  }
  if (hasProblems(checks)) process.exitCode = 1
}

if (process.argv[1] && process.argv[1].endsWith('check-model-catalog.ts')) {
  main().catch(error => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    )
    process.exitCode = 1
  })
}
