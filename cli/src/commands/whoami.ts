import {
  loginKey,
  readLoginStore,
  resolveLogin,
  type Credentials,
  type LoginStore,
  type ResolvedLogin,
} from '../lib/config'
import { JSON_VERSION } from '../lib/json-output'
import { sanitizeField } from '../lib/sanitize'
import { serverLabel } from '../lib/api'

export interface WhoamiOptions {
  full?: boolean
  json?: boolean
}

/**
 * LUM-843: the default is one line — who, which workspace, which key. The
 * name/URL detail moved behind `--full`; `--json` is the machine form. The
 * token itself is never printed in any form.
 */
export function formatWhoami(
  creds: Credentials,
  opts: WhoamiOptions = {}
): string[] {
  if (opts.json) {
    return [
      JSON.stringify({
        version: JSON_VERSION,
        email: creds.email,
        workspace: { slug: creds.workspaceSlug, name: creds.workspaceName },
        apiKey: { name: creds.apiKeyName, prefix: creds.apiKeyPrefix },
        apiUrl: creds.apiUrl,
      }),
    ]
  }
  // LUM-1335: a login to a self-hosted Lumo says so.
  const server = serverLabel(creds.apiUrl)
  if (opts.full) {
    return [
      `Logged in as ${sanitizeField(creds.email)}`,
      `  Workspace: ${sanitizeField(creds.workspaceName)} (${sanitizeField(creds.workspaceSlug)})`,
      `  Key: ${sanitizeField(creds.apiKeyName)} (${sanitizeField(creds.apiKeyPrefix)})`,
      `  API: ${sanitizeField(creds.apiUrl)}`,
      ...(server ? [`  Server: ${sanitizeField(server)}`] : []),
    ]
  }
  return [
    `${sanitizeField(creds.email)} · workspace ${sanitizeField(creds.workspaceSlug)} · key ${sanitizeField(creds.apiKeyPrefix)}${server ? ` · ${sanitizeField(server)}` : ''}`,
  ]
}

/**
 * LUM-1337: every login, `*` marking the one this directory uses, each tagged
 * `default` and/or `this repo`. A single login prints exactly as before.
 * `--json` keeps the used login's fields at the top level and adds `logins`.
 */
export function formatWhoamiAll(
  store: LoginStore,
  used: ResolvedLogin,
  opts: WhoamiOptions = {}
): string[] {
  const usedKey = loginKey(used.creds.apiUrl)
  const keys = Object.keys(store.logins).sort()
  const tags = (key: string): string[] => [
    ...(key === store.default ? ['default'] : []),
    ...(key === usedKey && used.source === 'repo' ? ['this repo'] : []),
    ...(key === usedKey && used.source === 'env' ? ['LUMO_API_URL'] : []),
  ]
  if (opts.json) {
    const [line] = formatWhoami(used.creds, opts)
    const top = JSON.parse(line as string) as Record<string, unknown>
    top.logins = keys.map(key => {
      const c = store.logins[key] as Credentials
      return {
        apiUrl: c.apiUrl,
        email: c.email,
        workspace: { slug: c.workspaceSlug, name: c.workspaceName },
        apiKey: { name: c.apiKeyName, prefix: c.apiKeyPrefix },
        default: key === store.default,
        used: key === usedKey,
      }
    })
    return [JSON.stringify(top)]
  }
  if (keys.length <= 1) return formatWhoami(used.creds, opts)
  const out: string[] = []
  for (const key of keys) {
    const mark = key === usedKey ? '* ' : '  '
    const t = tags(key)
    const suffix = t.length ? ` (${t.join(', ')})` : ''
    const [first, ...rest] = formatWhoami(
      store.logins[key] as Credentials,
      opts
    )
    out.push(`${mark}${first ?? ''}${suffix}`)
    for (const r of rest) out.push(`  ${r}`)
  }
  if (opts.full && used.repo) {
    out.push(`This repository: ${sanitizeField(used.repo)} → ${usedKey ?? ''}`)
  }
  return out
}

export async function whoami(opts: WhoamiOptions = {}): Promise<number | void> {
  const store = readLoginStore()
  const used = resolveLogin(process.cwd(), store)
  if (!used) {
    console.log('Not logged in')
    console.log('Run `lumo auth login` to log in')
    return 1
  }
  if (used.note) console.error(`⚠ ${sanitizeField(used.note)}`)
  for (const line of formatWhoamiAll(store, used, opts)) console.log(line)
}
