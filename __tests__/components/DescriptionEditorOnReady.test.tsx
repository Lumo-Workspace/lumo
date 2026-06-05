/** @jest-environment jsdom */

// Stub heavy ESM/server-only deps so DescriptionEditor can be imported in jsdom.
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => id,
  }),
}))

jest.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: () => null,
  DropdownMenuTrigger: () => null,
  DropdownMenuContent: () => null,
  DropdownMenuItem: () => null,
}))

jest.mock('@/lib/editor/doc-extract-context', () => ({
  DocExtractProvider: ({ children }: { children: React.ReactNode }) => children,
  buildStampPending: () => () => '',
}))

jest.mock('@/lib/editor/slash-command', () => ({
  SlashCommandExtension: {
    configure: () => ({ name: 'slashCommand', addExtensions: () => [] }),
  },
  buildSlashCommandSuggestion: () => ({}),
}))

jest.mock('@/lib/editor/slash-command-list', () => ({
  SlashCommandList: () => null,
}))

jest.mock('@/lib/editor/nodes/mention-with-type', () => ({
  MentionWithType: {
    configure: () => ({ name: 'mentionWithType', addExtensions: () => [] }),
  },
}))

jest.mock(
  '@/app/workspace/[workspaceUrl]/components/mention-suggestion',
  () => ({
    buildMentionSuggestion: () => ({}),
  })
)

jest.mock('@/app/workspace/[workspaceUrl]/components/MentionList', () => ({
  MentionList: () => null,
}))

jest.mock(
  '@/app/workspace/[workspaceUrl]/components/EditorSuggestionPopup',
  () => ({
    EditorSuggestionPopup: () => null,
  })
)

jest.mock('@/app/workspace/[workspaceUrl]/components/BubbleMenuBar', () => ({
  BubbleMenuBar: () => null,
}))

jest.mock(
  '@/app/workspace/[workspaceUrl]/components/table/TableInsertHandles',
  () => ({
    TableInsertHandles: () => null,
  })
)

jest.mock(
  '@/app/workspace/[workspaceUrl]/components/extract/BatchExtractButton',
  () => ({
    BatchExtractButton: () => null,
  })
)

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useTocSync', () => ({
  useTocSync: () => {},
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useEditorStats', () => ({
  useEditorStats: () => {},
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useImageUploads', () => ({
  useImageUploads: () => ({
    enqueueImageUpload: () => {},
    runOrDeferCommit: (fn: () => void) => fn(),
  }),
}))

jest.mock('sonner', () => ({
  toast: { info: () => {}, success: () => {}, error: () => {} },
}))

// Mock Tiptap react/core so we control the editor instance returned
import type { Editor } from '@tiptap/core'

const fakeEditor = {
  chain: jest.fn(() => ({ focus: jest.fn(() => ({ run: jest.fn() })) })),
  isEmpty: false,
  isEditable: false,
  isDestroyed: false,
  getHTML: jest.fn(() => ''),
  commands: { setContent: jest.fn() },
  view: { dispatch: jest.fn() },
  state: { tr: {} },
  destroy: jest.fn(),
} as unknown as Editor

jest.mock('@tiptap/react', () => ({
  useEditor: (_opts: unknown) => {
    // Simulate the editor becoming available
    return fakeEditor
  },
  EditorContent: () => null,
}))

jest.mock('@tiptap/extension-placeholder', () => ({
  __esModule: true,
  default: { configure: () => ({ name: 'placeholder' }) },
}))

jest.mock('@tiptap/extension-bubble-menu', () => ({
  BubbleMenu: { configure: () => ({ name: 'bubbleMenu' }) },
}))

jest.mock('@tiptap/extension-table-of-contents', () => ({
  TableOfContents: { configure: () => ({ name: 'tableOfContents' }) },
}))

jest.mock('@/lib/editor/extensions', () => ({
  getBaseExtensions: () => [],
}))

jest.mock('@/lib/editor/debounced-serializer', () => ({
  createDebouncedSerializer: () => ({
    schedule: jest.fn(),
    cancel: jest.fn(),
  }),
}))

jest.mock('@/lib/utils/keyboard', () => ({ isMac: false }))
jest.mock('@/lib/api-client/documents-extract', () => ({
  ExtractTasksError: class ExtractTasksError extends Error {},
}))

import React from 'react'
import { render, waitFor } from '@testing-library/react'
import { DescriptionEditor } from '@/app/workspace/[workspaceUrl]/components/DescriptionEditor'

it('calls onEditorReady with the editor instance', async () => {
  const onReady = jest.fn()
  render(
    <DescriptionEditor value='' onCommit={() => {}} onEditorReady={onReady} />
  )
  await waitFor(() => expect(onReady).toHaveBeenCalled())
  const ed = onReady.mock.calls[0]![0]
  expect(typeof ed.chain).toBe('function')
})
