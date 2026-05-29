import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'

interface RmOptions { yes?: boolean }

export async function memoryRm(memoryId: string | undefined, options: RmOptions): Promise<number | void> {
  if (!memoryId) { console.error('Error: missing <memoryId>. Usage: lumo memory rm <memoryId> --yes'); return 1 }
  if (!options.yes) { console.error('Error: refusing to delete without --yes. Re-run with --yes to confirm.'); return 1 }
  const creds = readCredentials()
  if (!creds) { console.error('Error: not logged in. Run `lumo auth login` first.'); return 1 }
  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl
  const base = trimTrailingSlash(apiUrl)

  let res: Response
  try {
    res = await fetch(`${base}/api/memories/${encodeURIComponent(memoryId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${creds.token}` },
    })
  } catch (err) {
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${err instanceof Error ? err.message : String(err)})`)
    return 1
  }
  if (res.status === 404) { console.error(`Error: memory ${memoryId} not found`); return 1 }
  if (res.status !== 204) { console.error(`Error: delete failed (HTTP ${res.status})`); return 1 }
  process.stdout.write(`Deleted memory ${memoryId}\n`)
}
