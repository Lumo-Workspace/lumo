import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * LUM-460 follow-up 1 (Option B): the heavy per-render server work — the task
 * fetch + timeline-presence fetch (`getPresence`) + `<TaskDetailPage>` render —
 * is hoisted into the shared `[identifier]/layout.tsx` of each task-detail
 * route tree, so switching tabs (a sibling `[[...tab]]` navigation) does not
 * re-run it. The per-tab `[[...tab]]/page.tsx` is thin.
 *
 * This guards the structural invariant. It reads the route files and asserts
 * the heavy work is absent from the per-tab page and present in the layout.
 */
const ROOT = process.cwd()
const MY_TASKS = 'app/workspace/[workspaceUrl]/my-tasks/[identifier]'
const PROJECT_TASKS =
  'app/workspace/[workspaceUrl]/projects/[projectSlug]/tasks/[identifier]'

const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

describe('task-detail route shape (LUM-460 Option B)', () => {
  describe.each([
    ['my-tasks', MY_TASKS],
    ['projects', PROJECT_TASKS],
  ])('%s tree', (_name, base) => {
    it('runs the timeline-presence fetch in the shared layout, not the per-tab page', () => {
      const layout = read(`${base}/layout.tsx`)
      const page = read(`${base}/[[...tab]]/page.tsx`)
      expect(layout).toMatch(/getPresence/)
      expect(page).not.toMatch(/getPresence/)
    })

    it('renders TaskDetailPage from the shared layout, not the per-tab page', () => {
      const layout = read(`${base}/layout.tsx`)
      const page = read(`${base}/[[...tab]]/page.tsx`)
      expect(layout).toMatch(/<TaskDetailPage/)
      expect(page).not.toMatch(/<TaskDetailPage/)
    })
  })

  it('keeps the tab-preserving canonical redirect at the my-tasks page level (where the tab segment is visible)', () => {
    const page = read(`${MY_TASKS}/[[...tab]]/page.tsx`)
    expect(page).toMatch(/buildMyTaskRedirectPath/)
  })

  it('renders the my-tasks layout with the my-tasks source for the breadcrumb', () => {
    const layout = read(`${MY_TASKS}/layout.tsx`)
    expect(layout).toMatch(/source=(['"]|\{['"])my-tasks/)
  })
})
