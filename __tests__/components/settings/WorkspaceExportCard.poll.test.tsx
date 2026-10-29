/** LUM-1340 — the export list polls via react-query only while one is generating. */
jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}))
jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}))
import { exportsPollInterval } from '@/app/workspace/[workspaceUrl]/components/settings/WorkspaceExportCard'
import type { WorkspaceExportView } from '@/lib/services/workspace-export.service'

const exp = (status: WorkspaceExportView['status']) =>
  ({ id: status, status }) as WorkspaceExportView

describe('exportsPollInterval', () => {
  it('polls every 5s while an export is pending or running', () => {
    expect(exportsPollInterval([exp('READY'), exp('PENDING')])).toBe(5000)
    expect(exportsPollInterval([exp('RUNNING')])).toBe(5000)
  })

  it('stops once nothing is in progress or before the first read', () => {
    expect(exportsPollInterval([exp('READY'), exp('FAILED')])).toBe(false)
    expect(exportsPollInterval([])).toBe(false)
    expect(exportsPollInterval(undefined)).toBe(false)
  })
})
