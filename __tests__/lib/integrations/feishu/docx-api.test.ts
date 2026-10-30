/**
 * @jest-environment node
 *
 * LUM-1343 — the docx / wiki / media endpoints as one member: paths and
 * query strings, block paging, and the shapes read from each response.
 */
import {
  downloadDocMedia,
  getDocxMeta,
  getWikiNode,
  listDocxBlocks,
} from '@/lib/integrations/feishu/docx-api'
import type { FeishuUserClient } from '@/lib/integrations/feishu/client'

function fakeClient(pages: Record<string, unknown>[]) {
  const get = jest.fn(async () => pages.shift() ?? {})
  const getBinary = jest.fn(async () => ({
    body: new ArrayBuffer(3),
    contentType: 'image/png',
  }))
  return { client: { get, getBinary } as FeishuUserClient, get, getBinary }
}

it('getWikiNode resolves a node to its object type and token', async () => {
  const { client, get } = fakeClient([
    {
      code: 0,
      data: { node: { obj_type: 'docx', obj_token: 'doxcn1', title: 'Spec' } },
    },
  ])
  await expect(getWikiNode(client, 'wikcnX')).resolves.toEqual({
    objType: 'docx',
    objToken: 'doxcn1',
    title: 'Spec',
  })
  expect(get).toHaveBeenCalledWith(
    '/open-apis/wiki/v2/spaces/get_node?token=wikcnX&obj_type=wiki'
  )
})

it('getDocxMeta reads the title', async () => {
  const { client, get } = fakeClient([
    { code: 0, data: { document: { document_id: 'doxcn1', title: 'Spec' } } },
  ])
  await expect(getDocxMeta(client, 'doxcn1')).resolves.toEqual({
    documentId: 'doxcn1',
    title: 'Spec',
  })
  expect(get).toHaveBeenCalledWith('/open-apis/docx/v1/documents/doxcn1')
})

it('listDocxBlocks follows page_token until has_more is false', async () => {
  const { client, get } = fakeClient([
    {
      data: {
        items: [{ block_id: 'a', block_type: 1 }],
        has_more: true,
        page_token: 'P2',
      },
    },
    {
      data: {
        items: [{ block_id: 'b', block_type: 2 }, { nope: true }],
        has_more: false,
      },
    },
  ])
  const blocks = await listDocxBlocks(client, 'doxcn1')
  expect(blocks.map(b => b.block_id)).toEqual(['a', 'b'])
  expect(get).toHaveBeenNthCalledWith(
    1,
    '/open-apis/docx/v1/documents/doxcn1/blocks?page_size=500'
  )
  expect(get).toHaveBeenNthCalledWith(
    2,
    '/open-apis/docx/v1/documents/doxcn1/blocks?page_size=500&page_token=P2'
  )
})

it('listDocxBlocks refuses a document that never stops paging', async () => {
  const get = jest.fn(async () => ({
    data: { items: [], has_more: true, page_token: 'again' },
  }))
  await expect(
    listDocxBlocks({ get, getBinary: jest.fn() }, 'doxcn1')
  ).rejects.toMatchObject({ code: 'feishu_doc_too_large', status: 422 })
})

it('downloadDocMedia GETs the media download path', async () => {
  const { client, getBinary } = fakeClient([])
  await downloadDocMedia(client, 'boxcn1')
  expect(getBinary).toHaveBeenCalledWith(
    '/open-apis/drive/v1/medias/boxcn1/download'
  )
})
