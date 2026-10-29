/**
 * LUM-911 / LUM-933 — plugin half of
 * __tests__/components/settings/DataRetentionSection.test.tsx (split in
 * LUM-1065): with the security plugin installed, Settings → Data retention
 * also shows the scan evidence row (the plugin's `settings.retention.row`
 * slot) with its tiers, and it saves only its own field.
 */
import { render, screen, within } from '@testing-library/react'
import { DataRetentionSection } from '@/app/workspace/[workspaceUrl]/components/settings/DataRetentionSection'
import { workspacesClient } from '@/lib/api-client'

// react-intl ships ESM only; resolve messages from the real en.json so a
// missing key fails the test instead of rendering its id.
// LUM-1265: this suite is about the form's logic, not the dropdown — drive
// the shadcn Select as a native <select> (see the helper for why).
jest.mock('@/components/ui/select', () =>
  require('../../../../helpers/native-select-mock').nativeSelectMock()
)
jest.mock('react-intl', () => {
  const messages = jest.requireActual('@/lib/i18n/en.json') as Record<
    string,
    string
  >
  return {
    useIntl: () => ({
      formatMessage: (
        { id }: { id: string },
        values?: Record<string, unknown>
      ) => {
        const text = messages[id]
        if (text === undefined) throw new Error(`missing message ${id}`)
        return text.replace(/\{(\w+)\}/g, (_m: string, k: string) =>
          String(values?.[k] ?? '')
        )
      },
    }),
  }
})
jest.mock('@/lib/api-client', () => ({
  workspacesClient: {
    updateMe: jest.fn(),
    getAiDerivedContent: jest.fn().mockResolvedValue({
      enabled: true,
      counts: {
        memories: 0,
        sessionSummaries: 0,
        runSummaries: 0,
        claimSnapshots: 0,
        verdictTexts: 0,
      },
    }),
  },
}))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))

const updateMe = workspacesClient.updateMe as jest.Mock

const DEFAULTS = {
  // An existing workspace after the migration: nothing chosen yet.
  hookEventRetentionMode: 'RETAIN',
  hookEventRetentionDays: null,
  scanEvidenceRetentionDays: 7,
  crossingRawRetentionDays: 7,
  deadLetterRetentionDays: 7,
  aiDerivedContentEnabled: true,
}

function renderSection(settings = DEFAULTS) {
  return render(
    <DataRetentionSection
      label='Data retention'
      settings={settings}
      // LUM-1062: the plugin rows (scan evidence) read the workspace row.
      workspace={settings}
    />
  )
}

function select(rowId: string) {
  return within(screen.getByTestId(`retention-row-${rowId}`)).getByRole(
    'combobox'
  ) as HTMLSelectElement
}

beforeEach(() => {
  jest.clearAllMocks()
  updateMe.mockResolvedValue({})
})

describe('DataRetentionSection with the security plugin', () => {
  it('shows the scan evidence row with its default and tiers, after the core rows', async () => {
    renderSection()
    expect(
      await screen.findByTestId('retention-row-scan-evidence')
    ).toBeInTheDocument()
    expect(select('scan-evidence').value).toBe('7')
    expect(
      Array.from(select('scan-evidence').options).map(o => o.value)
    ).toEqual(['0', '7', '14', '30'])
    for (const row of ['session-record', 'crossing-raw', 'dead-letter'])
      expect(screen.getByTestId(`retention-row-${row}`)).toBeInTheDocument()
  })
})
