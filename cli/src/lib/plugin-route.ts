/**
 * LUM-1062 (RFC LUM-1058 §3.4 API route) — a server without a plugin has no
 * such route files at all, so a request to one gets the framework's own 404
 * page (HTML), never our handlers' JSON 404 ("PR not found", …). Seeing
 * that, the command says the feature is not on this server instead of
 * blaming the resource the user asked for.
 */
export function isMissingPluginRoute(res: Response): boolean {
  if (res.status !== 404) return false
  // Only the framework's HTML page counts; anything else keeps the old
  // reading of a 404 (the resource asked for does not exist).
  const type = res.headers?.get?.('content-type') ?? ''
  return type.includes('text/html')
}

/** The degradation line, e.g. for `lumo pr show` on an OSS server. */
export function missingPluginMessage(command: string, plugin: string): string {
  return `Error: \`lumo ${command}\` is not available on this Lumo server — the ${plugin} plugin is not installed there.`
}
