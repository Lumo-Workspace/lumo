import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { reportPull } from '../lib/report-pull'

interface FigmaMetadata {
  id: string
  url: string
  fileKey: string | null
  nodeId: string | null
  fileName: string | null
  frameName: string | null
  thumbnailUrl: string | null
  thumbnailFetchedAt: string | null
  lastSyncedAt: string | null
  lastSyncError: string | null
}

interface FigmaContextResponse {
  metadata: FigmaMetadata
  designContextAvailable?: boolean
  note?: string
}

/**
 * `lumo task figma context <LUM-N> <link-id>`
 *
 * Tier-2 retrieval for the cheap inline Figma card. Reads the cached design
 * metadata (file/frame name, url, thumbnail, last sync) from
 * `/api/tasks/:id/figma-links/:linkId/context`. Live design context (layers,
 * variables, code connect) needs the Figma MCP server, so the route degrades to
 * metadata + a `note`; we print the note when present.
 */
export async function taskFigmaContext(
  identifier: string | undefined,
  linkId: string | undefined
): Promise<number | void> {
  if (!identifier || !linkId) {
    console.error('Error: usage: lumo task figma context <LUM-42> <link-id>')
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }

  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)

  let res: Response
  try {
    res = await fetch(
      `${base}/api/tasks/${encodeURIComponent(identifier)}/figma-links/${encodeURIComponent(linkId)}/context`,
      { headers: { Authorization: `Bearer ${creds.token}` } }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return 1
  }

  if (res.status === 401) {
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }
  if (res.status === 404) {
    console.error(
      `Error: task ${identifier} or figma link ${linkId} not found in workspace ${creds.workspaceSlug}`
    )
    return 1
  }
  if (!res.ok) {
    console.error(`Error: figma context failed (HTTP ${res.status})`)
    return 1
  }

  const { metadata, note } = (await res.json()) as FigmaContextResponse
  if (metadata.fileName)
    console.log(`file:  ${sanitizeField(metadata.fileName)}`)
  if (metadata.frameName)
    console.log(`frame: ${sanitizeField(metadata.frameName)}`)
  console.log(`url:   ${metadata.url}`)
  if (metadata.lastSyncedAt) console.log(`synced: ${metadata.lastSyncedAt}`)
  if (metadata.lastSyncError)
    console.log(`syncError: ${sanitizeField(metadata.lastSyncError)}`)
  if (note) console.log(`\nnote: ${sanitizeField(note)}`)

  // LUM-500: stamp the disclosure funnel. The linkId arg == lineage FIGMA
  // fragmentId. Fire-and-forget — never blocks output, swallows failures.
  await reportPull({ fragmentType: 'FIGMA', fragmentId: linkId })
}
