/**
 * @jest-environment jsdom
 *
 * LUM-1343 — the Feishu import dialog shows a distinct message per error
 * code; the source bar on an imported doc shows the last sync failure and
 * runs Resync; the import button only appears for a linked account.
 */
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: (
      { id }: { id: string },
      values?: Record<string, unknown>
    ) => (values ? `${id}(${Object.values(values).join(',')})` : id),
  }),
}))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
jest.mock('@/lib/api-client/feishu-docs', () => ({
  feishuDocsApi: { importDoc: jest.fn(), resyncDoc: jest.fn() },
}))
let available = true
jest.mock(
  '@/app/workspace/[workspaceUrl]/hooks/useFeishuImportAvailable',
  () => ({ useFeishuImportAvailable: () => available })
)

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { ApiClientError } from '@/lib/api-client'
import { feishuDocsApi } from '@/lib/api-client/feishu-docs'
import { FeishuImportDialog } from '@/app/workspace/[workspaceUrl]/components/document/FeishuImportDialog'
import { FeishuImportAction } from '@/app/workspace/[workspaceUrl]/components/document/FeishuImportAction'
import { FeishuSourceBar } from '@/app/workspace/[workspaceUrl]/components/document/FeishuSourceBar'
import { feishuDocErrorMessageId } from '@/app/workspace/[workspaceUrl]/components/document/feishu-doc-errors'

beforeEach(() => {
  jest.clearAllMocks()
  available = true
})

describe('feishuDocErrorMessageId', () => {
  it('maps known codes and falls back for unknown ones', () => {
    expect(feishuDocErrorMessageId('feishu_doc_forbidden')).toBe(
      'feishuDocs.error.feishu_doc_forbidden'
    )
    expect(feishuDocErrorMessageId('feishu_importer_left')).toBe(
      'feishuDocs.error.feishu_importer_left'
    )
    expect(feishuDocErrorMessageId('something_new')).toBe(
      'feishuDocs.error.feishu_sync_failed'
    )
    expect(feishuDocErrorMessageId(null)).toBe(
      'feishuDocs.error.feishu_sync_failed'
    )
  })
})

function typeUrl(value: string) {
  fireEvent.change(screen.getByLabelText('feishuDocs.urlLabel'), {
    target: { value },
  })
  fireEvent.click(screen.getByText('feishuDocs.importButton'))
}

describe('FeishuImportDialog', () => {
  it('imports and hands back the new slug', async () => {
    ;(feishuDocsApi.importDoc as jest.Mock).mockResolvedValue({
      document: { id: 'd1', slug: 'spec-7', title: 'Spec' },
      unsupported: ['sheet'],
      missingImages: 0,
    })
    const onImported = jest.fn()
    render(
      <FeishuImportDialog
        open
        onOpenChange={jest.fn()}
        onImported={onImported}
      />
    )
    typeUrl('https://acme.feishu.cn/docx/doxcnAbCdEfGh1234567890XYZ')
    await waitFor(() => expect(onImported).toHaveBeenCalledWith('spec-7'))
    expect(feishuDocsApi.importDoc).toHaveBeenCalledWith(
      'https://acme.feishu.cn/docx/doxcnAbCdEfGh1234567890XYZ'
    )
    expect(toast.success).toHaveBeenCalledWith('feishuDocs.importedPartial')
  })

  it.each([
    'feishu_doc_url_invalid',
    'feishu_doc_unsupported_type',
    'feishu_not_connected',
    'feishu_needs_reauth',
    'feishu_doc_forbidden',
  ])('shows the %s message', async code => {
    ;(feishuDocsApi.importDoc as jest.Mock).mockRejectedValue(
      new ApiClientError('x', 400, code)
    )
    render(
      <FeishuImportDialog
        open
        onOpenChange={jest.fn()}
        onImported={jest.fn()}
      />
    )
    typeUrl('https://acme.feishu.cn/sheets/x')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      `feishuDocs.error.${code}`
    )
  })
})

describe('FeishuImportAction', () => {
  it('renders nothing unless the account is linked', () => {
    available = false
    const { container } = render(<FeishuImportAction onImported={jest.fn()} />)
    expect(container).toBeEmptyDOMElement()
    available = true
    render(<FeishuImportAction onImported={jest.fn()} />)
    expect(screen.getByText('documents.importFromFeishu')).toBeInTheDocument()
  })
})

describe('FeishuSourceBar', () => {
  const props = {
    documentId: 'd1',
    sourceUrl: 'https://acme.feishu.cn/docx/doxcn1',
    syncedAt: '2026-10-29T10:00:00.000Z',
    syncError: null as string | null,
    onBeforeResync: jest.fn(async () => undefined),
    onAfterResync: jest.fn(async () => undefined),
  }

  it('links back to Feishu and shows no error when the last sync worked', () => {
    render(<FeishuSourceBar {...props} />)
    expect(
      screen.getByText('feishuDocs.openInFeishu').closest('a')
    ).toHaveAttribute('href', props.sourceUrl)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows the stored sync error with its own message', () => {
    render(<FeishuSourceBar {...props} syncError='feishu_importer_left' />)
    expect(screen.getByRole('status')).toHaveTextContent(
      'feishuDocs.lastSyncFailed(feishuDocs.error.feishu_importer_left)'
    )
  })

  it('never renders a non-https source as a link', () => {
    render(<FeishuSourceBar {...props} sourceUrl='javascript:alert(1)' />)
    expect(screen.queryByText('feishuDocs.openInFeishu')).toBeNull()
  })

  it('Resync flushes, calls the API and reloads; a failure reloads to show the error', async () => {
    jest.spyOn(window, 'confirm').mockReturnValue(true)
    ;(feishuDocsApi.resyncDoc as jest.Mock).mockResolvedValueOnce({
      document: { id: 'd1' },
    })
    render(<FeishuSourceBar {...props} />)
    fireEvent.click(screen.getByText('feishuDocs.resync'))
    await waitFor(() => expect(props.onAfterResync).toHaveBeenCalledWith(true))
    expect(props.onBeforeResync).toHaveBeenCalled()
    expect(feishuDocsApi.resyncDoc).toHaveBeenCalledWith('d1')
    ;(feishuDocsApi.resyncDoc as jest.Mock).mockRejectedValueOnce(
      new ApiClientError('x', 403, 'feishu_doc_forbidden')
    )
    fireEvent.click(screen.getByText('feishuDocs.resync'))
    await waitFor(() => expect(props.onAfterResync).toHaveBeenCalledWith(false))
    expect(toast.error).toHaveBeenCalledWith(
      'feishuDocs.error.feishu_doc_forbidden'
    )
  })

  it('Resync does nothing when the warning is dismissed', () => {
    jest.spyOn(window, 'confirm').mockReturnValue(false)
    render(<FeishuSourceBar {...props} />)
    fireEvent.click(screen.getByText('feishuDocs.resync'))
    expect(feishuDocsApi.resyncDoc).not.toHaveBeenCalled()
  })
})
