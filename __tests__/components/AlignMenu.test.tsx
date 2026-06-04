/** @jest-environment jsdom */

const messages: Record<string, string> = {
  'editor.align': 'Alignment',
  'editor.alignLeft': 'Align left',
  'editor.alignCenter': 'Align center',
  'editor.alignRight': 'Align right',
}
jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => messages[id] ?? id }),
}))

import { fireEvent, render, screen } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { AlignMenu } from '@/app/workspace/[workspaceUrl]/components/bubble-menu/AlignMenu'

function makeEditor() {
  const chain: Record<string, jest.Mock> = {}
  for (const m of ['focus', 'setTextAlign', 'run']) {
    chain[m] = jest.fn(() => (m === 'run' ? true : chain))
  }
  const editor = { chain: () => chain } as unknown as Editor
  return { editor, chain }
}

describe('AlignMenu', () => {
  it('is collapsed until clicked, then lists the three alignments', () => {
    const { editor } = makeEditor()
    render(<AlignMenu editor={editor} alignLeft alignCenter={false} alignRight={false} />)
    expect(screen.queryByText('Align center')).not.toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole('button'))
    expect(screen.getByText('Align left')).toBeInTheDocument()
    expect(screen.getByText('Align center')).toBeInTheDocument()
    expect(screen.getByText('Align right')).toBeInTheDocument()
  })

  it('applies the chosen alignment and closes', () => {
    const { editor, chain } = makeEditor()
    render(<AlignMenu editor={editor} alignLeft alignCenter={false} alignRight={false} />)
    fireEvent.mouseDown(screen.getByRole('button'))
    fireEvent.mouseDown(screen.getByText('Align center'))
    expect(chain.setTextAlign).toHaveBeenCalledWith('center')
    expect(screen.queryByText('Align center')).not.toBeInTheDocument()
  })
})
