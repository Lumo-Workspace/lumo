/** LUM-1340 — the export list polls via react-query only while one is generating. */
jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}))
jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}))
jest.mock('@/lib/api-client', () => ({
  workspacesClient: { listExports: jest.fn(), startExport: jest.fn() },
}))
import { render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { toast } from 'sonner'
import { workspacesClient } from '@/lib/api-client'
import {
  WorkspaceExportCard,
  exportsPollInterval,
} from '@/app/workspace/[workspaceUrl]/components/settings/WorkspaceExportCard'
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

describe('WorkspaceExportCard load-failed toast', () => {
  it('does not replay a past failure toast when a remount reads fine', async () => {
    const list = workspacesClient.listExports as jest.Mock
    list.mockRejectedValueOnce(new Error('down'))
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const ui = (
      <QueryClientProvider client={client}>
        <WorkspaceExportCard />
      </QueryClientProvider>
    )
    const first = render(ui)
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    first.unmount()

    // The cached query still carries the error; the remount's refetch succeeds.
    list.mockResolvedValue({ exports: [] })
    render(ui)
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
    await new Promise(r => setTimeout(r, 20))
    expect(toast.error).toHaveBeenCalledTimes(1)
  })
})
