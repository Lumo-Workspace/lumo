/** @jest-environment jsdom */

// react-intl ships ESM jest can't load; repo convention is to mock it.
jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}))

import { useRef, useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { FormDialog } from '@/app/workspace/[workspaceUrl]/components/FormDialog'
import { NewProjectModal } from '@/app/workspace/[workspaceUrl]/components/modals/NewProjectModal'

function Host({ initialValue = '' }: { initialValue?: string }) {
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <>
      <button onClick={() => setOpen(true)}>trigger</button>
      <span data-testid='state'>{open ? 'open' : 'closed'}</span>
      {/* Mounted only while open, like WorkspaceModals does. */}
      {open && (
        <FormDialog
          isOpen
          onClose={() => setOpen(false)}
          title='New thing'
          initialFocusRef={inputRef}
          footer={<button>Create</button>}
        >
          <input aria-label='name' ref={inputRef} defaultValue={initialValue} />
        </FormDialog>
      )}
    </>
  )
}

function openFromTrigger() {
  const trigger = screen.getByText('trigger')
  trigger.focus()
  fireEvent.click(trigger)
  return trigger
}

// Radix restores focus on a timer after unmount.
async function flushFocusTimers() {
  await act(async () => {
    await new Promise(r => setTimeout(r, 0))
  })
}

describe('FormDialog (LUM-1248)', () => {
  it('renders the title as the dialog name with its own close button', () => {
    render(<Host />)
    openFromTrigger()
    expect(screen.getByRole('dialog', { name: 'New thing' })).toBeTruthy()
    // Only the header close — DialogContent's built-in one is turned off.
    expect(
      screen.getAllByRole('button', { name: 'common.close' })
    ).toHaveLength(1)
    expect(screen.getByLabelText('formDialog.expand')).toBeTruthy()
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    render(<Host />)
    const trigger = openFromTrigger()
    expect(screen.getByTestId('state').textContent).toBe('open')
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
    })
    expect(screen.getByTestId('state').textContent).toBe('closed')
    expect(screen.queryByRole('dialog')).toBeNull()
    await flushFocusTimers()
    expect(document.activeElement).toBe(trigger)
  })

  it('closes from the header close button', () => {
    render(<Host />)
    openFromTrigger()
    fireEvent.click(screen.getByRole('button', { name: 'common.close' }))
    expect(screen.getByTestId('state').textContent).toBe('closed')
  })

  it('focuses the initial field with the caret at the end, not selected', () => {
    render(<Host initialValue='Prefilled title' />)
    openFromTrigger()
    const input = screen.getByLabelText('name') as HTMLInputElement
    expect(document.activeElement).toBe(input)
    expect(input.selectionStart).toBe('Prefilled title'.length)
    expect(input.selectionEnd).toBe('Prefilled title'.length)
  })

  it('keeps the dialog open on Escape while an editor suggestion popup is open', () => {
    render(<Host />)
    openFromTrigger()
    const popup = document.createElement('div')
    popup.setAttribute('data-editor-suggestion-popup', '')
    document.body.appendChild(popup)
    const input = screen.getByLabelText('name')
    const seen: { bubbles: boolean }[] = []
    input.addEventListener('keydown', e => seen.push({ bubbles: e.bubbles }))
    try {
      fireEvent.keyDown(input, { key: 'Escape' })
      expect(screen.getByTestId('state').textContent).toBe('open')
      // The key is re-sent to the focused element as a non-bubbling event
      // so the editor (ProseMirror) can close its popup. The re-send happens
      // in the dialog's capture-phase listener, so it lands first.
      expect(seen).toEqual([{ bubbles: false }, { bubbles: true }])
    } finally {
      popup.remove()
    }
  })
})

describe('NewProjectModal on FormDialog (LUM-1248)', () => {
  it('autofocuses the name field and closes on Escape', () => {
    const onClose = jest.fn()
    render(
      <NewProjectModal
        isOpen
        onClose={onClose}
        onSubmit={jest.fn().mockResolvedValue(undefined)}
        preFill={{ name: 'Roadmap', description: '' }}
      />
    )
    const name = screen.getByPlaceholderText(
      'newProject.namePlaceholder'
    ) as HTMLInputElement
    expect(document.activeElement).toBe(name)
    expect(name.selectionStart).toBe('Roadmap'.length)
    fireEvent.keyDown(name, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
