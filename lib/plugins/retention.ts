/**
 * LUM-1061 (RFC §3.4, `retention`) — the retention duties plugins own.
 *
 *  - Retention-stock categories (`scripts/retention-stock`): a plugin adds
 *    the categories of the data it stores. No plugin → only the core
 *    categories exist.
 *  - Repository-code disposal when GitHub access goes away: every plugin
 *    scrubs the customer code it holds. Fail-closed — a contributor that
 *    throws makes this throw, so the caller never narrows or unbinds before
 *    the code is gone. No plugin → nothing to scrub here.
 */
import { getPluginRegistry } from './registry'
import type { RetentionContributor } from './types'

type StockContribution = NonNullable<RetentionContributor['stock']>

/** Retention-stock categories contributed by plugins, in registration order. */
export function pluginRetentionStocks(): StockContribution[] {
  return getPluginRegistry()
    .retention.map(r => r.stock)
    .filter((s): s is StockContribution => s !== undefined)
}

/**
 * Scrub the customer code every plugin holds for the workspace (or only for
 * `repos`). Counts are summed by noun across plugins, in first-seen order.
 */
export async function scrubPluginRepositoryCode(input: {
  workspaceId: string
  repos?: string[] | undefined
}): Promise<Record<string, number>> {
  const totals: Record<string, number> = {}
  for (const r of getPluginRegistry().retention) {
    if (!r.scrubRepositoryCode) continue
    const counts = await r.scrubRepositoryCode(input)
    for (const [noun, n] of Object.entries(counts))
      totals[noun] = (totals[noun] ?? 0) + n
  }
  return totals
}
