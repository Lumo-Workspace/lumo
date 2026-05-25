import { findExtractionCandidates } from '@/lib/services/document-task-extraction.service'

describe('findExtractionCandidates', () => {
  const taskListHtml = `
    <ul data-type="taskList">
      <li data-type="taskItem" data-checked="false"><div><p>first</p></div></li>
      <li data-type="taskItem" data-checked="true"><div><p>done</p></div></li>
      <li data-type="taskItem" data-checked="false"><div><p>second</p></div></li>
    </ul>
  `

  it('all_unchecked selector picks only unchecked items', () => {
    const cs = findExtractionCandidates(taskListHtml, { type: 'all_unchecked' })
    expect(cs.map(c => c.text)).toEqual(['first', 'second'])
  })

  it('all_unchecked skips items already linked', () => {
    const html = `
      <ul data-type="taskList">
        <li data-type="taskItem" data-checked="false">
          <div><p><a data-task-link="cm_x">already</a></p></div>
        </li>
        <li data-type="taskItem" data-checked="false"><div><p>fresh</p></div></li>
      </ul>
    `
    const cs = findExtractionCandidates(html, { type: 'all_unchecked' })
    expect(cs.map(c => c.text)).toEqual(['fresh'])
  })

  it('marked selector picks data-extract-pending nodes', () => {
    const html = `
      <p>before <span data-extract-pending="true">hello</span> after</p>
      <ul data-type="taskList">
        <li data-type="taskItem" data-checked="false" data-extract-pending="true">
          <div><p>checkbox item</p></div>
        </li>
      </ul>
    `
    const cs = findExtractionCandidates(html, { type: 'marked' })
    expect(cs.map(c => c.text)).toEqual(['hello', 'checkbox item'])
  })

  it('returns empty array when nothing matches', () => {
    const cs = findExtractionCandidates('<p>plain</p>', { type: 'marked' })
    expect(cs).toEqual([])
  })
})
