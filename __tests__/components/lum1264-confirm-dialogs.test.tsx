/** @jest-environment jsdom */
/**
 * LUM-1264 — native confirm() prompts became in-app AlertDialogs. For each
 * converted confirmation: cancel (and Esc) does nothing, confirm runs the action.
 */
import '@testing-library/jest-dom'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

jest.mock('react-intl', () => {
  const messages = jest.requireActual('@/lib/i18n/en.json') as Record<
    string,
    string
  >
  return {
    useIntl: () => ({
      locale: 'en',
      formatMessage: (
        { id, defaultMessage }: { id: string; defaultMessage?: string },
        values?: Record<string, string | number>
      ) =>
        Object.entries(values ?? {}).reduce(
          (acc, [k, v]) => acc.split(`{${k}}`).join(String(v)),
          messages[id] ?? defaultMessage ?? id
        ),
    }),
  }
})

jest.mock('@/lib/datetime/relative', () => ({ formatRelativeAgo: () => '' }))

const mockExtractTasks = jest.fn()
jest.mock('@/lib/api-client/documents-extract', () => ({
  extractTasks: (...args: unknown[]) => mockExtractTasks(...args),
}))

const mockCtx = {
  documentId: 'doc-1',
  onApplied: jest.fn(),
  onError: jest.fn(),
}
jest.mock('@/lib/editor/doc-extract-context', () => ({
  useDocExtractContext: () => mockCtx,
}))

import { ConfirmActionDialog } from '@/app/workspace/[workspaceUrl]/components/ConfirmActionDialog'
import { WebLinkCard } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/WebLinkCard'
import { FigmaLinkCard } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/FigmaLinkCard'
import { BatchExtractButton } from '@/app/workspace/[workspaceUrl]/components/extract/BatchExtractButton'
import type { OptimisticWebLink } from '@/app/workspace/[workspaceUrl]/hooks/useWebLinks'
import type { OptimisticFigmaLink } from '@/app/workspace/[workspaceUrl]/hooks/useFigmaLinks'
import type { Editor } from '@tiptap/core'

beforeEach(() => jest.clearAllMocks())

describe('ConfirmActionDialog', () => {
  function setup(destructive = false) {
    const onConfirm = jest.fn()
    const onOpenChange = jest.fn()
    render(
      <ConfirmActionDialog
        open
        onOpenChange={onOpenChange}
        title='Delete this thing?'
        description='It cannot be undone.'
        confirmLabel='Delete'
        destructive={destructive}
        onConfirm={onConfirm}
      />
    )
    return { onConfirm, onOpenChange }
  }

  it('renders an alertdialog with the title, description and translated cancel', () => {
    setup()
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('Delete this thing?')
    expect(dialog).toHaveTextContent('It cannot be undone.')
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('uses the destructive button variant for destructive actions', () => {
    setup(true)
    expect(screen.getByRole('button', { name: 'Delete' }).className).toMatch(
      /bg-destructive/
    )
  })

  it('cancel closes without confirming', () => {
    const { onConfirm, onOpenChange } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('Esc closes without confirming', () => {
    const { onConfirm, onOpenChange } = setup()
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('confirm runs onConfirm and leaves closing to the caller', () => {
    const { onConfirm, onOpenChange } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})

const webLink = {
  id: 'wl-1',
  url: 'https://example.com/spec',
  domain: 'example.com',
  title: 'Spec',
  description: null,
  note: null,
  imageUrl: null,
  faviconUrl: null,
  contentSignals: null,
  createdAt: '2026-10-18T10:00:00Z',
} as unknown as OptimisticWebLink

describe('WebLinkCard delete confirmation', () => {
  function setup() {
    const onRemove = jest.fn().mockResolvedValue(undefined)
    render(
      <WebLinkCard
        link={webLink}
        onRefresh={jest.fn().mockResolvedValue(undefined)}
        onRemove={onRemove}
      />
    )
    fireEvent.click(screen.getByLabelText('Delete'))
    return { onRemove }
  }

  it('cancel keeps the link', () => {
    const { onRemove } = setup()
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Delete this link?'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onRemove).not.toHaveBeenCalled()
  })

  it('confirm deletes the link', async () => {
    const { onRemove } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(onRemove).toHaveBeenCalledWith('wl-1'))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})

const figmaLink = {
  id: 'fl-1',
  url: 'https://www.figma.com/design/abc/File',
  fileName: 'Onboarding',
  frameName: 'Step 1',
  thumbnailUrl: null,
  lastSyncError: null,
  lastSyncedAt: '2026-10-18T10:00:00Z',
} as unknown as OptimisticFigmaLink

describe('FigmaLinkCard remove confirmation', () => {
  function setup() {
    const onRemove = jest.fn().mockResolvedValue(undefined)
    render(<FigmaLinkCard link={figmaLink} onRemove={onRemove} />)
    fireEvent.click(screen.getByLabelText('Remove'))
    return { onRemove }
  }

  it('cancel keeps the design', () => {
    const { onRemove } = setup()
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Remove this Figma design?'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onRemove).not.toHaveBeenCalled()
  })

  it('confirm removes the design', async () => {
    const { onRemove } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(onRemove).toHaveBeenCalledWith('fl-1'))
  })
})

function fakeEditor(unchecked: number): Editor {
  const nodes = Array.from({ length: unchecked }, () => ({
    type: { name: 'taskItem' },
    attrs: { checked: false, taskId: null },
  }))
  return {
    state: {
      doc: {
        descendants: (fn: (node: unknown) => boolean) => nodes.forEach(fn),
      },
    },
    on: jest.fn(),
    off: jest.fn(),
    getHTML: () => '<ul></ul>',
  } as unknown as Editor
}

describe('BatchExtractButton confirmation', () => {
  function setup() {
    render(<BatchExtractButton editor={fakeEditor(3)} />)
    fireEvent.click(screen.getByRole('button', { name: /Extract 3/ }))
  }

  it('opens an AlertDialog (standard scrim, Esc closes) without extracting', () => {
    setup()
    expect(screen.getByRole('alertdialog')).toHaveTextContent('assigned to you')
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(mockExtractTasks).not.toHaveBeenCalled()
  })

  it('cancel does not extract', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(mockExtractTasks).not.toHaveBeenCalled()
  })

  it('confirm extracts every unchecked item and closes when done', async () => {
    mockExtractTasks.mockResolvedValue({ created: [] })
    setup()
    fireEvent.click(screen.getByRole('button', { name: /^Create/ }))
    await waitFor(() =>
      expect(mockExtractTasks).toHaveBeenCalledWith('doc-1', {
        content: '<ul></ul>',
        selector: { type: 'all_unchecked' },
      })
    )
    await waitFor(() => expect(mockCtx.onApplied).toHaveBeenCalled())
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    )
  })
})
