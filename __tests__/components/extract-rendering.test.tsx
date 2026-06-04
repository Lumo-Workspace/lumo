// The code-block node view (reachable via getBaseExtensions) imports react-intl,
// which ships untranspiled ESM; stub it. Mirrors other component suites.
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => id,
  }),
}))

import { render, waitFor } from '@testing-library/react'
import { EditorContent, useEditor } from '@tiptap/react'
import { getBaseExtensions } from '@/lib/editor/extensions'

function Editor({ content }: { content: string }) {
  const editor = useEditor({
    extensions: getBaseExtensions(),
    content,
    editable: false,
  })
  return <EditorContent editor={editor} />
}

describe('extracted taskItem rendering', () => {
  it('renders a checkbox row with data-task-id as a task badge link', async () => {
    const html = `<ul data-type="taskList">
      <li data-type="taskItem" data-checked="false" data-task-id="cm_a" data-task-identifier="LUM-1">
        <label><input type="checkbox"><span></span></label>
        <div><p><a data-task-link="cm_a" data-task-identifier="LUM-1" href="/workspace/lumo/my-tasks/LUM-1">first</a></p></div>
      </li>
    </ul>`
    const { container } = render(<Editor content={html} />)

    // TipTap's useEditor returns null on first render; wait for the editor to mount
    await waitFor(() => {
      const li = container.querySelector('li[data-task-id="cm_a"]')
      expect(li).not.toBeNull()
    })

    const li = container.querySelector('li[data-task-id="cm_a"]')
    expect(li).not.toBeNull()
    const anchor = li!.querySelector('a[data-task-link]')
    expect(anchor).not.toBeNull()
    expect(anchor!.getAttribute('href')).toBe('/workspace/lumo/my-tasks/LUM-1')
  })
})
