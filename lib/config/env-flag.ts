/** `true` / `1` / `yes` (any case, trimmed) count as an enabled env flag. */
export const isTruthyFlag = (raw: string | undefined): boolean => {
  const v = raw?.trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}
