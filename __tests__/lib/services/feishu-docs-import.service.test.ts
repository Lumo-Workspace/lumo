/**
 * @jest-environment node
 *
 * LUM-1343 — Feishu doc import and one-way re-sync: docx and wiki URLs each
 * create a doc from the fixture; every failure has its own code; a re-sync
 * failure is recorded on the doc and cleared by the next success; an
 * importer who left the workspace fails cleanly.
 */
jest.mock('@/lib/services/feishu-integration.service', () => ({
  getUserClientForMember: jest.fn(),
  isFeishuEnabled: jest.fn(() => true),
}))
jest.mock('@/lib/services/document.service', () => ({
  documentService: { createDocument: jest.fn(), updateDocument: jest.fn() },
}))
jest.mock('@/lib/repositories/document.repository', () => ({
  documentRepository: {
    findWithPermission: jest.fn(),
    findFeishuSourceMeta: jest.fn(),
    update: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: { findById: jest.fn() },
}))
jest.mock('@/lib/services/private-file.service', () => ({
  privateFileService: { storeImportedImage: jest.fn() },
}))
jest.mock('@/lib/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}))

import fixture from '../../fixtures/feishu-docx/blocks-all-types.json'
import {
  getUserClientForMember,
  isFeishuEnabled,
} from '@/lib/services/feishu-integration.service'
import { documentService } from '@/lib/services/document.service'
import { documentRepository } from '@/lib/repositories/document.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { privateFileService } from '@/lib/services/private-file.service'
import { FeishuNeedsReauthError } from '@/lib/integrations/feishu/client'
import { FeishuApiError } from '@/lib/integrations/feishu/http'
import {
  feishuDocsImportService,
  importedImageFileId,
  toFeishuDocError,
} from '@/lib/services/feishu-docs-import.service'

const DOCX = 'doxcnAbCdEfGh1234567890XYZ'
const WIKI = 'wikcnAbCdEfGh1234567890XYZ'
const ORIGIN = 'https://app.example'

const get = jest.fn()
const getBinary = jest.fn()

/** Route the fake member client by path, like the real endpoints. */
function serveDoc(over: { wikiNode?: Record<string, unknown> } = {}) {
  get.mockImplementation(async (path: string) => {
    if (path.startsWith('/open-apis/wiki/v2/spaces/get_node')) {
      return {
        code: 0,
        data: {
          node: over.wikiNode ?? {
            obj_type: 'docx',
            obj_token: DOCX,
            title: 'Wiki title',
          },
        },
      }
    }
    if (path.includes('/blocks')) return fixture
    if (path.startsWith('/open-apis/docx/v1/documents/')) {
      return {
        code: 0,
        data: { document: { document_id: DOCX, title: 'Spec' } },
      }
    }
    throw new Error(`unexpected ${path}`)
  })
  getBinary.mockResolvedValue({
    body: new Uint8Array([137, 80]).buffer,
    contentType: 'image/png',
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(isFeishuEnabled as jest.Mock).mockReturnValue(true)
  ;(getUserClientForMember as jest.Mock).mockResolvedValue({ get, getBinary })
  ;(privateFileService.storeImportedImage as jest.Mock).mockImplementation(
    async (ws: string, fileId: string, load: () => Promise<unknown>) => {
      await load()
      return `${ORIGIN}/api/files/workspaces/${ws}/images/${fileId}`
    }
  )
  ;(documentService.createDocument as jest.Mock).mockImplementation(
    async (_ws, _m, data) => ({ id: 'doc1', slug: 'spec-1', ...data })
  )
  serveDoc()
})

function importUrl(url: string) {
  return feishuDocsImportService.importFeishuDoc('ws1', 'm1', {
    url,
    origin: ORIGIN,
  })
}

describe('importFeishuDoc', () => {
  it('a docx URL creates a doc from the converted blocks, recording the importer', async () => {
    const out = await importUrl(`https://acme.feishu.cn/docx/${DOCX}`)
    const data = (documentService.createDocument as jest.Mock).mock.calls[0][2]
    expect(data).toMatchObject({
      title: 'Spec',
      visibility: 'PRIVATE',
      feishuDocToken: DOCX,
      feishuSourceUrl: `https://acme.feishu.cn/docx/${DOCX}`,
      feishuImporterId: 'm1',
    })
    expect(data.feishuSyncedAt).toBeInstanceOf(Date)
    expect(data.contentMarkdown).toContain('# Spec title')
    expect(data.contentMarkdown).toContain('| Name | Value |')
    expect(out.unsupported).toEqual(['sheet', 'board'])
    expect(out.missingImages).toBe(0)
  })

  it('images are copied under a stable per-workspace id', async () => {
    await importUrl(`https://acme.feishu.cn/docx/${DOCX}`)
    const fileId = importedImageFileId('ws1', 'boxcnIMAGE1')
    expect(fileId).toMatch(/^feishu-[0-9a-f]{40}$/)
    expect(privateFileService.storeImportedImage).toHaveBeenCalledWith(
      'ws1',
      fileId,
      expect.any(Function),
      ORIGIN
    )
    expect(getBinary).toHaveBeenCalledWith(
      '/open-apis/drive/v1/medias/boxcnIMAGE1/download'
    )
    const md = (documentService.createDocument as jest.Mock).mock.calls[0][2]
      .contentMarkdown
    expect(md).toContain(
      `![Architecture](${ORIGIN}/api/files/workspaces/ws1/images/${fileId})`
    )
  })

  it('an image that cannot be copied (SVG, or no media scope) becomes a link back', async () => {
    getBinary.mockResolvedValue({
      body: new ArrayBuffer(4),
      contentType: 'image/svg+xml',
    })
    const out = await importUrl(`https://acme.feishu.cn/docx/${DOCX}`)
    expect(out.missingImages).toBe(1)
    getBinary.mockRejectedValue(
      new FeishuApiError('/open-apis/drive/v1/medias', 400, 99991679, 'scope')
    )
    const again = await importUrl(`https://acme.feishu.cn/docx/${DOCX}`)
    expect(again.missingImages).toBe(1)
  })

  it('a wiki URL resolves the node to its docx first', async () => {
    await importUrl(`https://acme.feishu.cn/wiki/${WIKI}`)
    expect(get).toHaveBeenCalledWith(
      `/open-apis/wiki/v2/spaces/get_node?token=${WIKI}&obj_type=wiki`
    )
    expect(get).toHaveBeenCalledWith(`/open-apis/docx/v1/documents/${DOCX}`)
    expect(
      (documentService.createDocument as jest.Mock).mock.calls[0][2]
    ).toMatchObject({
      feishuDocToken: DOCX,
      feishuSourceUrl: `https://acme.feishu.cn/wiki/${WIKI}`,
    })
  })

  describe('distinct errors', () => {
    it('malformed URL → feishu_doc_url_invalid (400)', async () => {
      await expect(importUrl('https://example.com/x')).rejects.toMatchObject({
        code: 'feishu_doc_url_invalid',
        status: 400,
      })
      expect(getUserClientForMember).not.toHaveBeenCalled()
    })

    it('unsupported object type in the URL → feishu_doc_unsupported_type (422)', async () => {
      await expect(
        importUrl(`https://acme.feishu.cn/sheets/${DOCX}`)
      ).rejects.toMatchObject({
        code: 'feishu_doc_unsupported_type',
        status: 422,
        objectType: 'sheet',
      })
    })

    it('a wiki node that is not a docx → feishu_doc_unsupported_type (422)', async () => {
      serveDoc({
        wikiNode: { obj_type: 'bitable', obj_token: 'bascn1', title: 'T' },
      })
      await expect(
        importUrl(`https://acme.feishu.cn/wiki/${WIKI}`)
      ).rejects.toMatchObject({
        code: 'feishu_doc_unsupported_type',
        objectType: 'bitable',
      })
      expect(documentService.createDocument).not.toHaveBeenCalled()
    })

    it('member not connected → feishu_not_connected (403)', async () => {
      ;(getUserClientForMember as jest.Mock).mockRejectedValue(
        Object.assign(new Error('Feishu account not connected'), {
          status: 403,
          code: 'feishu_not_connected',
        })
      )
      await expect(
        importUrl(`https://acme.feishu.cn/docx/${DOCX}`)
      ).rejects.toMatchObject({ code: 'feishu_not_connected', status: 403 })
    })

    it('token needing reauth (stored flag) → feishu_needs_reauth (403)', async () => {
      ;(getUserClientForMember as jest.Mock).mockRejectedValue(
        Object.assign(new Error('Feishu account needs reauth'), {
          status: 403,
          code: 'feishu_needs_reauth',
        })
      )
      await expect(
        importUrl(`https://acme.feishu.cn/docx/${DOCX}`)
      ).rejects.toMatchObject({ code: 'feishu_needs_reauth', status: 403 })
    })

    it('token dying mid-import → feishu_needs_reauth (403)', async () => {
      get.mockRejectedValue(new FeishuNeedsReauthError())
      await expect(
        importUrl(`https://acme.feishu.cn/docx/${DOCX}`)
      ).rejects.toMatchObject({ code: 'feishu_needs_reauth', status: 403 })
    })

    it('no permission on the doc → feishu_doc_forbidden (403)', async () => {
      get.mockRejectedValue(
        new FeishuApiError('/open-apis/docx/v1/documents/x', 403, 1770032, '')
      )
      await expect(
        importUrl(`https://acme.feishu.cn/docx/${DOCX}`)
      ).rejects.toMatchObject({ code: 'feishu_doc_forbidden', status: 403 })
    })

    it('no permission on the wiki node → feishu_doc_forbidden (403)', async () => {
      get.mockRejectedValue(
        new FeishuApiError(
          '/open-apis/wiki/v2/spaces/get_node',
          400,
          131006,
          ''
        )
      )
      await expect(
        importUrl(`https://acme.feishu.cn/wiki/${WIKI}`)
      ).rejects.toMatchObject({ code: 'feishu_doc_forbidden' })
    })

    it('Feishu disabled for the workspace → 404', async () => {
      ;(isFeishuEnabled as jest.Mock).mockReturnValue(false)
      await expect(
        importUrl(`https://acme.feishu.cn/docx/${DOCX}`)
      ).rejects.toMatchObject({ status: 404 })
    })
  })
})

describe('toFeishuDocError', () => {
  it.each([
    [new FeishuApiError('e', 404, 1770002, ''), 'feishu_doc_not_found', 404],
    [new FeishuApiError('e', 400, 1770003, ''), 'feishu_doc_not_found', 404],
    [new FeishuApiError('e', 400, 131005, ''), 'feishu_doc_not_found', 404],
    [new FeishuApiError('e', 400, 99991672, ''), 'feishu_scope_missing', 403],
    [new FeishuApiError('e', 400, 99991400, ''), 'feishu_rate_limited', 429],
    [new FeishuApiError('e', 429, null, ''), 'feishu_rate_limited', 429],
    [new FeishuApiError('e', 500, 1771001, ''), 'feishu_sync_failed', 502],
    [new Error('boom'), 'feishu_sync_failed', 502],
    [
      Object.assign(new Error('x'), { status: 409, code: 'not_installed' }),
      'not_installed',
      409,
    ],
  ])('%p → %s', (error, code, status) => {
    expect(toFeishuDocError(error)).toMatchObject({ code, status })
  })
})

describe('resyncFeishuDoc', () => {
  const source = {
    id: 'doc1',
    feishuDocToken: DOCX,
    feishuSourceUrl: `https://acme.feishu.cn/docx/${DOCX}`,
    feishuImporterId: 'importer1',
  }

  beforeEach(() => {
    ;(documentRepository.findWithPermission as jest.Mock).mockResolvedValue({
      id: 'doc1',
    })
    ;(documentRepository.findFeishuSourceMeta as jest.Mock).mockResolvedValue(
      source
    )
    ;(memberRepository.findById as jest.Mock).mockResolvedValue({
      id: 'importer1',
      workspaceId: 'ws1',
      role: 'MEMBER',
    })
    ;(documentService.updateDocument as jest.Mock).mockResolvedValue({
      id: 'doc1',
    })
  })

  const resync = () =>
    feishuDocsImportService.resyncFeishuDoc('ws1', 'viewer1', 'doc1', ORIGIN)

  it('re-reads Feishu as the importer, overwrites the body and clears the error', async () => {
    await resync()
    expect(getUserClientForMember).toHaveBeenCalledWith('ws1', 'importer1')
    const [id, actor, ws, data] = (documentService.updateDocument as jest.Mock)
      .mock.calls[0]
    expect([id, actor, ws]).toEqual(['doc1', 'importer1', 'ws1'])
    expect(data).toMatchObject({
      allowShrink: true,
      feishuSyncError: null,
    })
    expect(data.feishuSyncedAt).toBeInstanceOf(Date)
    expect(data.contentMarkdown).toContain('# Spec title')
    expect(documentRepository.update).not.toHaveBeenCalled()
  })

  it('a failure records its code on the doc and rethrows', async () => {
    get.mockRejectedValue(
      new FeishuApiError('/open-apis/docx/v1/documents/x', 403, 1770032, '')
    )
    await expect(resync()).rejects.toMatchObject({
      code: 'feishu_doc_forbidden',
    })
    expect(documentRepository.update).toHaveBeenCalledWith('doc1', 'ws1', {
      feishuSyncError: 'feishu_doc_forbidden',
    })
    expect(documentService.updateDocument).not.toHaveBeenCalled()

    // The next success clears it.
    serveDoc()
    await resync()
    expect(
      (documentService.updateDocument as jest.Mock).mock.calls[0][3]
    ).toMatchObject({ feishuSyncError: null })
  })

  it('an importer who left the workspace fails with feishu_importer_left, recorded, no crash', async () => {
    ;(memberRepository.findById as jest.Mock).mockResolvedValue(null)
    await expect(resync()).rejects.toMatchObject({
      code: 'feishu_importer_left',
      status: 409,
      message: expect.stringMatching(/left the workspace/),
    })
    expect(getUserClientForMember).not.toHaveBeenCalled()
    expect(documentRepository.update).toHaveBeenCalledWith('doc1', 'ws1', {
      feishuSyncError: 'feishu_importer_left',
    })
  })

  it('an importer whose membership is another workspace counts as left', async () => {
    ;(memberRepository.findById as jest.Mock).mockResolvedValue({
      id: 'importer1',
      workspaceId: 'ws2',
      role: 'MEMBER',
    })
    await expect(resync()).rejects.toMatchObject({
      code: 'feishu_importer_left',
    })
  })

  it('the importer’s link needing reauth is recorded as feishu_needs_reauth', async () => {
    ;(getUserClientForMember as jest.Mock).mockRejectedValue(
      Object.assign(new Error('Feishu account needs reauth'), {
        status: 403,
        code: 'feishu_needs_reauth',
      })
    )
    await expect(resync()).rejects.toMatchObject({
      code: 'feishu_needs_reauth',
    })
    expect(documentRepository.update).toHaveBeenCalledWith('doc1', 'ws1', {
      feishuSyncError: 'feishu_needs_reauth',
    })
  })

  it('a doc not imported from Feishu → feishu_not_imported (400), nothing recorded', async () => {
    ;(documentRepository.findFeishuSourceMeta as jest.Mock).mockResolvedValue({
      ...source,
      feishuDocToken: null,
    })
    await expect(resync()).rejects.toMatchObject({
      code: 'feishu_not_imported',
      status: 400,
    })
    expect(documentRepository.update).not.toHaveBeenCalled()
  })

  it('a doc the acting member cannot see → 404', async () => {
    ;(documentRepository.findWithPermission as jest.Mock).mockResolvedValue(
      null
    )
    await expect(resync()).rejects.toMatchObject({ status: 404 })
  })
})
