/** @jest-environment jsdom */
const msgs: Record<string, string> = {
  'common.cancel': 'Cancel',
  'editor.comment': 'Comment',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => msgs[id] ?? id,
  }),
}))

// Mock CommentEditor to immediately commit a body so we can test submit wiring.
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/comments/CommentEditor',
  () => ({
    CommentEditor: ({ onCommit }: { onCommit: (h: string) => void }) => {
      onCommit('looks good')
      return <div data-testid='comment-editor' />
    },
  })
)

import { render, screen, fireEvent } from '@testing-library/react'
import { NewCommentPopover } from '@/app/workspace/[workspaceUrl]/components/document/comments/NewCommentPopover'

it('returns null when closed', () => {
  const { container } = render(
    <NewCommentPopover
      open={false}
      quotedText='x'
      onCancel={() => {}}
      onSubmit={() => {}}
    />
  )
  expect(container.firstChild).toBeNull()
})

it('submits the committed body', () => {
  const onSubmit = jest.fn()
  render(
    <NewCommentPopover
      open
      quotedText='the intro'
      onCancel={() => {}}
      onSubmit={onSubmit}
    />
  )
  expect(screen.getByText(/the intro/)).toBeInTheDocument()
  fireEvent.click(screen.getByTestId('submit-comment'))
  expect(onSubmit).toHaveBeenCalledWith('looks good')
})
