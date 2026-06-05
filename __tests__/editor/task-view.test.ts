// react-intl, next/*, and workspace hooks ship untranspiled ESM or need a
// browser environment; stub them so the task-view-block import chain doesn't
// blow up in jsdom. Mirrors the pattern used in callout.test.ts.
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => id,
  }),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}))

jest.mock('next/navigation', () => ({
  useParams: () => ({ workspaceUrl: 'test' }),
}))

jest.mock(
  '@/app/workspace/[workspaceUrl]/hooks/useWorkspaceTasks',
  () => ({
    useWorkspaceTasks: () => ({ tasks: [], loading: false, error: null }),
  })
)

import { TaskView } from '@/lib/editor/nodes/task-view'
import {
  DEFAULT_TASK_VIEW_CONFIG,
  parseTaskViewConfig,
} from '@/lib/editor/nodes/task-view-config'

describe('TaskView node', () => {
  it('is a leaf atom block named taskView', () => {
    expect(TaskView.name).toBe('taskView')
    expect(TaskView.config.atom).toBe(true)
    expect(TaskView.config.group).toBe('block')
  })

  it('serializes config to JSON and parses it back (round-trip contract)', () => {
    const config = {
      version: 1 as const,
      view: 'list' as const,
      groupBy: 'none' as const,
      filters: { statuses: ['IN_PROGRESS'] },
    }
    expect(parseTaskViewConfig(JSON.stringify(config))).toEqual(config)
    expect(parseTaskViewConfig(null)).toEqual(DEFAULT_TASK_VIEW_CONFIG)
  })
})
