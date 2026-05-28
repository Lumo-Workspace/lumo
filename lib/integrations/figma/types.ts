export interface FigmaTokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number // seconds
  user_id: string
}

export interface FigmaUserInfo {
  id: string
  email: string
  handle: string
  img_url: string
}

export interface FigmaFileResponse {
  name: string
  document: {
    children: Array<{
      type: 'CANVAS'
      children?: Array<{ id: string; name: string; type: string }>
    }>
  }
}

export interface FigmaNodesResponse {
  nodes: Record<string, { document: { name: string; type: string } } | null>
}

export interface FigmaImagesResponse {
  err: string | null
  images: Record<string, string | null> // nodeId → URL
}
