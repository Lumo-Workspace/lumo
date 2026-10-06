/**
 * Vercel OIDC token accessor (LUM-1022). Lives in lib/runtime so that
 * `@vercel/functions` stays confined to this directory. The module is loaded
 * lazily so it stays off the static import graph (jest, scripts, self-hosted
 * builds that always set an explicit API key).
 */
export async function getVercelOidcToken(): Promise<string> {
  const oidc = await import('@vercel/functions/oidc')
  return oidc.getVercelOidcToken()
}
