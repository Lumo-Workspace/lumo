/**
 * LUM-918 — `lumo task delete` / `lumo doc delete` move to the trash now, so
 * their confirmation envelopes must say so (restorable for 30 days from
 * Settings → Trash) and must no longer promise a permanent, undo-less delete.
 */
import { describeTaskDelete, TRASH_HINT } from '../../src/commands/task-delete'
import {
  describeDocDelete,
  DOC_TRASH_HINT,
} from '../../src/commands/doc-delete'

// The pre-trash envelope: "Will PERMANENTLY delete … there is no undo".
const PERMANENT_PROMISE = /PERMANENTLY delete|no undo|cannot be undone/

describe('delete envelopes describe the trash (LUM-918)', () => {
  it('task delete: moves the task and its subtasks to the trash for 30 days', () => {
    const lines = describeTaskDelete({
      identifier: 'LUM-9',
      title: 'Old spike',
      status: 'TODO',
      subtasks: [{ identifier: 'LUM-10' }, { identifier: 'LUM-11' }],
    })
    const text = lines.join('\n')
    expect(lines[0]).toBe(
      `Will move LUM-9 "Old spike" (TODO) to the trash — ${TRASH_HINT}, then permanently deleted`
    )
    expect(TRASH_HINT).toBe('restorable for 30 days from Settings → Trash')
    expect(text).toContain('2 subtasks go to the trash with it: LUM-10, LUM-11')
    expect(text).toContain('delete it permanently from Settings → Trash')
    expect(text).not.toMatch(PERMANENT_PROMISE)
  })

  it('doc delete: moves the document and its sub-pages to the trash for 30 days', () => {
    const lines = describeDocDelete('cmdoc1', 'Design "notes"')
    const text = lines.join('\n')
    expect(lines[0]).toBe(
      `Will move document cmdoc1 "Design \\"notes\\"" to the trash — ${DOC_TRASH_HINT}, then permanently deleted`
    )
    expect(DOC_TRASH_HINT).toBe('restorable for 30 days from Settings → Trash')
    expect(text).toMatch(/nested under it goes to the trash with it/)
    expect(text).not.toMatch(PERMANENT_PROMISE)
  })
})
