/** `--scope` of init / skill update (LUM-1233 3g, Q6): user | project, or null. */
export function parseInstallScope(
  v: string | undefined
): 'user' | 'project' | null {
  const s = v?.trim().toLowerCase()
  return s === 'user' || s === 'project' ? s : null
}
