export interface ParsedFigmaUrl {
  fileKey: string
  nodeId: string | null
}

const FIGMA_HOSTS = ['www.figma.com', 'figma.com']
const PATH_PATTERN = /^\/(file|design|proto)\/([^/?#]+)/

export function parseFigmaUrl(input: string): ParsedFigmaUrl | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (!FIGMA_HOSTS.includes(url.hostname.toLowerCase())) return null

  const match = url.pathname.match(PATH_PATTERN)
  if (!match || !match[2]) return null
  const fileKey = match[2]

  const raw = url.searchParams.get('node-id')
  const nodeId = raw ? raw.replace(/-/g, ':').replace(/%3A/gi, ':') : null
  return { fileKey, nodeId }
}
