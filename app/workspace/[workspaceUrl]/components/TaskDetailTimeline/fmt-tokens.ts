// Mirror the CLI's compact token formatter (notation:'compact',
// maximumFractionDigits:1) so the same number reads identically in both
// surfaces. Used by the Record tab's Cost tile (`RunReportTiles`).
const TOKEN_FMT = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

export function fmtTokens(n: number): string {
  return TOKEN_FMT.format(n)
}
