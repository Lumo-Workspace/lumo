/**
 * LUM-740 — pure aggregation for the suggested-disposition precision report
 * (spec §12 R2): of the EXTERNAL_TOOL findings the falsifier suggested as
 * false positives, how many did a human confirm vs overrule. `report.ts`
 * reads the rows; this file only counts.
 */
export interface SuggestionRow {
  suggestedDisposition: string | null
  disposition: string | null
  suggestionOutcome: string | null
}

export interface SuggestionPrecisionStats {
  /** Rows with a suggestion. */
  suggested: number
  confirmed: number
  overruled: number
  /** Suggested rows no human has decided on yet. */
  pending: number
  /** confirmed / (confirmed + overruled); null until someone has decided. */
  precision: number | null
}

export function aggregateSuggestionPrecision(
  rows: SuggestionRow[]
): SuggestionPrecisionStats {
  let suggested = 0
  let confirmed = 0
  let overruled = 0
  for (const r of rows) {
    if (r.suggestedDisposition === null) continue
    suggested += 1
    if (r.suggestionOutcome === 'CONFIRMED') confirmed += 1
    else if (r.suggestionOutcome === 'OVERRULED') overruled += 1
  }
  const decided = confirmed + overruled
  return {
    suggested,
    confirmed,
    overruled,
    pending: suggested - decided,
    precision: decided === 0 ? null : confirmed / decided,
  }
}
