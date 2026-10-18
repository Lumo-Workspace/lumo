import { EXIT_USAGE } from '../lib/exit-codes'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { lookupDocId } from '../lib/resolve-doc-id'
import { errHttp, errNotLoggedIn } from '../lib/errors'
import { docHandle } from '../lib/doc-handle'

export interface BindFormatArgs {
  docId: string
  identifier: string
  alreadyBound: boolean
  upgradedFromContent: boolean
}

export function formatBindOutput(args: BindFormatArgs): string {
  if (args.alreadyBound)
    return `Already bound ${docHandle(args.docId)} ↔ ${args.identifier}`
  const upgrade = args.upgradedFromContent ? ' (upgraded from content)' : ''
  return `Bound ${docHandle(args.docId)} ↔ ${args.identifier}${upgrade}`
}

export async function docBind(
  docRef: string | undefined,
  task: string | undefined
): Promise<number | void> {
  if (!docRef || !task) {
    console.error('Error: usage: lumo doc update <doc> --add-task <task>')
    return EXIT_USAGE
  }
  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)

  const docId = await lookupDocId(apiUrl, creds.token, docRef)
  if (!docId) {
    console.error(`Error: Document not found: ${docRef}`)
    return 1
  }

  const url = `${trimTrailingSlash(apiUrl)}/api/documents/${docId}/mentions`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ taskIdentifier: task }),
  })
  if (!res.ok) {
    const text = await res.text()
    console.error(errHttp('doc bind', res.status, text))
    return 1
  }
  const { mention } = (await res.json()) as {
    mention: {
      taskIdentifier: string
      alreadyBound: boolean
      upgradedFromContent: boolean
    }
  }
  console.log(
    formatBindOutput({
      docId,
      identifier: mention.taskIdentifier,
      alreadyBound: mention.alreadyBound,
      upgradedFromContent: mention.upgradedFromContent,
    })
  )
}
