/**
 * LUM-1343 — the Feishu OpenAPI calls doc import needs, as one member
 * (user_access_token). Verified 2026-10-29 against the open-platform docs:
 *
 * - Wiki node → object: GET /open-apis/wiki/v2/spaces/get_node?token=&obj_type=wiki
 *   (scope wiki:wiki:readonly) → data.node.{obj_type, obj_token, title}
 *   https://open.feishu.cn/document/server-docs/docs/wiki-v2/space-node/get_node
 * - Document meta: GET /open-apis/docx/v1/documents/:document_id
 *   (scope docx:document:readonly) → data.document.{document_id, revision_id, title}
 *   https://open.feishu.cn/document/ukTMukTMukTM/uUDN04SN0QjL1QDN/document-docx/docx-v1/document/get
 * - Blocks: GET /open-apis/docx/v1/documents/:document_id/blocks?page_size=500&page_token=
 *   → data.{items, has_more, page_token}
 *   https://open.feishu.cn/document/ukTMukTMukTM/uUDN04SN0QjL1QDN/document-docx/docx-v1/document-block/list
 * - Image bytes: GET /open-apis/drive/v1/medias/:file_token/download
 *   (scope docs:document.media:download — NOT in the LUM-1341 member scopes)
 *   https://open.feishu.cn/document/server-docs/docs/drive-v1/media/download
 */
import type { FeishuUserClient } from './client'
import type { FeishuBinary } from './http'
import type { FeishuBlock } from './docx-to-markdown'

export interface FeishuWikiNode {
  objType: string
  objToken: string
  title: string
}

export interface FeishuDocxMeta {
  documentId: string
  title: string
}

/** Never page forever: 200 × 500 blocks is far past any real document. */
const MAX_BLOCK_PAGES = 200

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

export async function getWikiNode(
  client: FeishuUserClient,
  token: string
): Promise<FeishuWikiNode> {
  const body = await client.get(
    `/open-apis/wiki/v2/spaces/get_node?token=${encodeURIComponent(token)}&obj_type=wiki`
  )
  const node = obj(obj(body.data).node)
  return {
    objType: str(node.obj_type),
    objToken: str(node.obj_token),
    title: str(node.title),
  }
}

export async function getDocxMeta(
  client: FeishuUserClient,
  documentId: string
): Promise<FeishuDocxMeta> {
  const body = await client.get(
    `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}`
  )
  const doc = obj(obj(body.data).document)
  return {
    documentId: str(doc.document_id) || documentId,
    title: str(doc.title),
  }
}

/** Every block of the latest revision, in API order (page block first). */
export async function listDocxBlocks(
  client: FeishuUserClient,
  documentId: string
): Promise<FeishuBlock[]> {
  const out: FeishuBlock[] = []
  let pageToken = ''
  for (let page = 0; page < MAX_BLOCK_PAGES; page++) {
    const qs = new URLSearchParams({ page_size: '500' })
    if (pageToken) qs.set('page_token', pageToken)
    const body = await client.get(
      `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/blocks?${qs.toString()}`
    )
    const data = obj(body.data)
    const items = Array.isArray(data.items) ? data.items : []
    for (const item of items) {
      const block = obj(item)
      if (typeof block.block_id === 'string') {
        out.push(block as unknown as FeishuBlock)
      }
    }
    pageToken = str(data.page_token)
    if (data.has_more !== true || !pageToken) return out
  }
  throw Object.assign(new Error('Feishu document has too many blocks'), {
    status: 422,
    code: 'feishu_doc_too_large',
  })
}

export async function downloadDocMedia(
  client: FeishuUserClient,
  fileToken: string
): Promise<FeishuBinary> {
  return client.getBinary(
    `/open-apis/drive/v1/medias/${encodeURIComponent(fileToken)}/download`
  )
}
