/** @jest-environment jsdom */
/**
 * LUM-1062 — the core UI with no client plugin installed (the OSS snapshot's
 * `installed.client.ts`): the task dossier, the PR list, the crossings
 * annotation and the retention settings render without any security block,
 * and never read the security scans.
 */
import { render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'

jest.mock('@/lib/plugins/installed.client', () => ({
  INSTALLED_CLIENT_PLUGINS: [],
}))
jest.mock('react-intl', () => {
  const messages = jest.requireActual('@/lib/i18n/en.json') as Record<
    string,
    string
  >
  return {
    useIntl: () => ({
      locale: 'en',
      formatMessage: (
        { id, defaultMessage }: { id: string; defaultMessage?: string },
        values?: Record<string, unknown>
      ) =>
        (messages[id] ?? defaultMessage ?? id).replace(
          /\{(\w+)\}/g,
          (_m: string, k: string) => String(values?.[k] ?? '')
        ),
    }),
  }
})

// Any read of the security scans would be a plugin call on a core path.
const useSecurityScans = jest.fn()
jest.mock('@/ee/security/hooks/useSecurityScans', () => ({
  useSecurityScans: (id: string) => useSecurityScans(id),
}))

// ── TaskDossier: capture what it hands RecordTab ─────────────────────────────
const recordTabProps = jest.fn()
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/RecordTab',
  () => ({
    RecordTab: (props: Record<string, unknown>) => {
      recordTabProps(props)
      return (
        <div data-testid='record-tab'>
          {props.securityRecordSlot as ReactNode}
        </div>
      )
    },
  })
)
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useAgentRuns', () => ({
  useAgentRuns: () => ({ data: { runs: [] } }),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useTestCases', () => ({
  useTestCases: () => ({ testCases: [] }),
}))
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/AgentRunsSection',
  () => ({ AgentRunsSection: () => null })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/LineageTab',
  () => ({ LineageTab: () => null })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/TestCasesSection',
  () => ({ TestCasesSection: () => null })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/BlockingTestDefects',
  () => ({ BlockingTestDefects: () => null })
)
jest.mock('@/app/workspace/[workspaceUrl]/components/memory/MemoryTab', () => ({
  MemoryTab: () => null,
}))

// ── PullRequestsSection ──────────────────────────────────────────────────────
jest.mock('@/app/workspace/[workspaceUrl]/components/LinkPrPopover', () => ({
  LinkPrPopover: () => null,
}))

// ── DataRetentionSection rows ────────────────────────────────────────────────
jest.mock('@/lib/api-client', () => ({
  workspacesClient: {
    updateMe: jest.fn(),
    getAiDerivedContent: jest.fn(() => new Promise(() => {})),
  },
}))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))

import { TaskDossier } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/TaskDossier'
import { RecordDoneGate } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/RecordDoneGate'
import { deriveDoneGate } from '@/lib/acceptance/done-gate'
import { deriveRecordGaps } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/record-gaps'
import { PullRequestsSection } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/sections/PullRequestsSection'
import { DataRetentionSection } from '@/app/workspace/[workspaceUrl]/components/settings/DataRetentionSection'
import { PluginSlot } from '@/lib/plugins/client'
import { Accordion } from '@/components/landing/ui/accordion'

beforeEach(() => jest.clearAllMocks())

describe('LUM-1062 core UI without client plugins', () => {
  it('the task dossier has no security gate row, blocker or Records row', () => {
    render(
      <TaskDossier
        taskId='t1'
        taskIdentifier='LUM-1'
        taskStatus='IN_PROGRESS'
        workspaceUrl='acme'
        members={[]}
        agentActors={[]}
        enabled
        memberNames={new Map()}
        hasLineage={false}
        hasMemories={false}
        targetSection={null}
      />
    )
    expect(recordTabProps).toHaveBeenCalled()
    const props =
      recordTabProps.mock.calls[recordTabProps.mock.calls.length - 1]![0]
    expect(props).toMatchObject({
      showSecurityGate: false,
      securityBlocking: 0,
      securityScanned: false,
      blockingSecuritySlot: null,
      securityRecordSlot: null,
    })
    expect(screen.getByTestId('record-tab')).toBeEmptyDOMElement()
    expect(useSecurityScans).not.toHaveBeenCalled()
  })

  it('the Done gate leaves the security row out', () => {
    const gaps = deriveRecordGaps({
      taskStatus: 'IN_PROGRESS',
      crossings: [],
      gateEnabled: true,
      securityBlocking: 0,
      testsBlocking: 0,
    })
    const gate = deriveDoneGate(gaps, {
      securityScanned: false,
      showSecurity: false,
    })
    expect(gate.security).toBeNull()
    render(<RecordDoneGate gate={gate} queueAnchor={null} />)
    expect(screen.queryByTestId('gate-security')).toBeNull()
    expect(screen.getByTestId('gate-crossings')).toBeInTheDocument()
    expect(screen.getByTestId('gate-tests')).toBeInTheDocument()
  })

  it('a linked PR shows no scan badge', () => {
    render(
      <Accordion type='multiple' defaultValue={['pullRequests']}>
        <PullRequestsSection
          taskId='t1'
          workspaceId='w1'
          onLinkPr={jest.fn()}
          onUnlinkPr={jest.fn()}
          pullRequests={[
            {
              id: 'pr1',
              number: 42,
              title: 'Add stuff',
              url: 'https://github.com/x/y/pull/42',
              state: 'open',
              ciStatus: 'success',
            },
          ]}
        />
      </Accordion>
    )
    expect(screen.getByText('#42 Add stuff')).toBeInTheDocument()
    expect(screen.queryByTestId('security-scan-badge')).toBeNull()
    expect(useSecurityScans).not.toHaveBeenCalled()
  })

  it('Data retention has no scan evidence row', () => {
    const settings = {
      hookEventRetentionMode: 'RETAIN',
      hookEventRetentionDays: null,
      crossingRawRetentionDays: 7,
      deadLetterRetentionDays: 7,
      aiDerivedContentEnabled: true,
    }
    render(
      <DataRetentionSection
        settings={settings}
        workspace={{ id: 'w1', ...settings, scanEvidenceRetentionDays: 7 }}
        workspaceName='Acme'
      />
    )
    const section = screen.getByTestId('data-retention-section')
    expect(
      within(section).getByTestId('retention-row-session-record')
    ).toBeInTheDocument()
    expect(
      within(section).queryByTestId('retention-row-scan-evidence')
    ).toBeNull()
    expect(
      within(section).getByTestId('retention-row-crossing-raw')
    ).toBeInTheDocument()
  })

  it('the settings section and the crossing annotation render nothing', () => {
    const { container } = render(
      <>
        <PluginSlot
          name='settings.workspace.section'
          props={{
            workspace: { id: 'w1' },
            me: {
              securityPlatform: {
                managedScan: true,
                hunt: true,
                sandbox: true,
              },
            },
          }}
        />
        <PluginSlot
          name='task.crossing.annotation'
          props={{
            crossingId: 'c1',
            triageProbability: 0.9,
            disposition: null,
          }}
        />
      </>
    )
    expect(container).toBeEmptyDOMElement()
  })
})
