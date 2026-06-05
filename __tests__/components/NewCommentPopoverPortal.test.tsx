/** @jest-environment jsdom */

// EditorSuggestionPopup portals to body + measures via layout; stub it to render
// children inline and expose the anchor it was handed.
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/EditorSuggestionPopup',
  () => ({
    EditorSuggestionPopup: ({
      anchorRect,
      children,
    }: {
      anchorRect: { top: number; left: number }
      children: React.ReactNode
    }) => (
      <div
        data-testid='popup'
        data-top={anchorRect.top}
        data-left={anchorRect.left}
      >
        {children}
      </div>
    ),
  })
)

jest.mock(
  '@/app/workspace/[workspaceUrl]/components/document/comments/NewCommentPopover',
  () => ({
    NewCommentPopover: ({ quotedText }: { quotedText: string }) => (
      <div data-testid='composer'>{quotedText}</div>
    ),
  })
)

import { render, screen } from '@testing-library/react'
import { NewCommentPopoverPortal } from '@/app/workspace/[workspaceUrl]/components/document/comments/NewCommentPopoverPortal'

const editor = {
  view: {
    coordsAtPos: (pos: number) =>
      pos === 5
        ? { top: 100, bottom: 116, left: 40, right: 60 }
        : { top: 140, bottom: 156, left: 200, right: 220 },
  },
} as never

it('renders the composer anchored to the selection start', () => {
  render(
    <NewCommentPopoverPortal
      editor={editor}
      from={5}
      to={9}
      quotedText='hello world'
      onCancel={() => {}}
      onSubmit={() => {}}
    />
  )
  expect(screen.getByTestId('composer')).toHaveTextContent('hello world')
  const popup = screen.getByTestId('popup')
  expect(popup).toHaveAttribute('data-top', '100')
  expect(popup).toHaveAttribute('data-left', '40')
})
