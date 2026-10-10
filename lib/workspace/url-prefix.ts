/**
 * The display prefix shown before the workspace slug input during onboarding,
 * e.g. `uselumo.ai/workspace/` or `localhost:3000/workspace/`.
 *
 * Derived from the deployment's own base URL so a self-hosted instance shows
 * its own address instead of the hosted one (LUM-1028). The protocol, query
 * and hash are dropped; host[:port] and any base path are kept, matching how
 * the link builders (`buildTaskUrl` etc.) concatenate `${appUrl}/workspace/…`.
 * A leading `www.` is dropped so the hosted `https://www.uselumo.ai` keeps
 * reading `uselumo.ai/workspace/`.
 *
 * Returns null when the value is empty or not an http(s) URL, so the caller
 * can fall back to the browser's own host.
 */
export function workspaceUrlPrefixFromAppUrl(
  appUrl: string | null | undefined
): string | null {
  const raw = appUrl?.trim()
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!url.hostname) return null
  const path = url.pathname.replace(/\/+$/, '')
  return `${displayHost(url.host)}${path}/workspace/`
}

/**
 * Prefix built from a bare browser host (`window.location.host`), used when
 * the app URL is not configured.
 */
export function workspaceUrlPrefixFromHost(host: string): string | null {
  const h = host.trim()
  return h ? `${displayHost(h)}/workspace/` : null
}

function displayHost(host: string): string {
  return host.replace(/^www\./i, '')
}
