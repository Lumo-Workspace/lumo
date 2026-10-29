/**
 * LUM-1318 — which scan layers a PR's Git platform can run. A layer that
 * needs a capability the platform's adapter does not declare
 * (`GitProvider.capabilities`) is not started, and is recorded as
 * unsupported on this platform — `NOT_CONFIGURED`, the existing "a platform
 * limit" state: shown as off, never read as checked (spec P9). The scan
 * never branches on the platform's name; only on what it can do.
 *
 * PURE.
 */
import {
  supportsAll,
  type GitProviderCapabilities,
  type GitProviderCapability,
} from '@/lib/integrations/git-provider'
import type { ScanStageKey, ScanStages, ScanStageState } from './types'

/** What each layer needs from the platform beyond the core (diff, head, comments). */
export const SCAN_LAYER_REQUIREMENTS: Readonly<
  Partial<Record<ScanStageKey, readonly GitProviderCapability[]>>
> = {
  // The managed scan (code scan + dependencies) clones the head in a sandbox.
  external: ['repoClone'],
  supplyChain: ['repoClone'],
  // The exploit-path hunt runs in the same kind of sandbox.
  hunt: ['repoClone'],
  // The agent-behavior layer reads the PR's per-file list.
  rewardHack: ['prFileList'],
}

/** The agentic verifier of the AI review boots a sandbox with a clone too. */
export const REVIEW_VERIFIER_REQUIREMENTS: readonly GitProviderCapability[] = [
  'repoClone',
]

/** The state an unsupported layer is recorded in. */
export const PLATFORM_UNSUPPORTED_STAGE: ScanStageState = 'NOT_CONFIGURED'

/** The layers `capabilities` cannot run. */
export function unsupportedScanLayers(
  capabilities: GitProviderCapabilities
): ReadonlySet<ScanStageKey> {
  const out = new Set<ScanStageKey>()
  for (const [key, required] of Object.entries(
    SCAN_LAYER_REQUIREMENTS
  ) as Array<[ScanStageKey, readonly GitProviderCapability[]]>)
    if (!supportsAll(capabilities, required)) out.add(key)
  return out
}

/**
 * `stages` with every layer in `unsupported` that the scan has (a key is
 * present) recorded as unsupported. A layer with no key — not offered to
 * the workspace — stays absent, so it does not read as unfinished.
 */
export function markUnsupportedLayers(
  stages: ScanStages,
  unsupported: ReadonlySet<ScanStageKey>
): ScanStages {
  const out: ScanStages = { ...stages }
  for (const key of unsupported)
    if (out[key] !== undefined) out[key] = PLATFORM_UNSUPPORTED_STAGE
  return out
}
