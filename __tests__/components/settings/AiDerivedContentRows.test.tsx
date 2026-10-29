/**
 * LUM-917 — Settings → Data retention carries the AI-derived content switch
 * (on by default, explains what turning it off does); the OWNER's delete
 * (in the danger zone since LUM-1327)
 * which needs the workspace name re-typed and runs batched passes until done.
 */
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import { renderWithQueryClient as render } from '../../helpers/query-client'
import { AiDerivedContentRow } from '@/app/workspace/[workspaceUrl]/components/settings/AiDerivedContentRow'
import { AiDerivedContentDeleteRow } from '@/app/workspace/[workspaceUrl]/components/settings/AiDerivedContentDeleteRow'
import { workspacesClient } from '@/lib/api-client'
import { toast } from 'sonner'

// LUM-1265: this suite is about the form's logic, not the dropdown — drive
// the shadcn Select as a native <select> (see the helper for why).
jest.mock('@/components/ui/select', () =>
  require('../../helpers/native-select-mock').nativeSelectMock()
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
    getAiDerivedContent: jest.fn(),
    purgeAiDerivedContent: jest.fn(),
  },
}))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))

const client = workspacesClient as unknown as Record<string, jest.Mock>

const SETTINGS = {
  hookEventRetentionMode: 'RETAIN',
  hookEventRetentionDays: null,
  scanEvidenceRetentionDays: 7,
  crossingRawRetentionDays: 7,
  deadLetterRetentionDays: 7,
  aiDerivedContentEnabled: true as boolean | null,
}

function renderSection(settings = SETTINGS) {
  // LUM-1339: the switch and its delete share the AI page; render both.
  return render(
    <>
      <AiDerivedContentRow initialEnabled={settings.aiDerivedContentEnabled} />
      <AiDerivedContentDeleteRow workspaceName='Acme' />
    </>
  )
}

function switchSelect() {
  return within(screen.getByTestId('retention-row-ai-derived')).getByRole(
    'combobox'
  ) as HTMLSelectElement
}

beforeEach(() => {
  jest.clearAllMocks()
  client.updateMe!.mockResolvedValue({})
  client.getAiDerivedContent!.mockResolvedValue({
    enabled: true,
    counts: {
      memories: 1200,
      sessionSummaries: 3,
      runSummaries: 40,
      claimSnapshots: 5,
      verdictTexts: 2,
    },
  })
})

describe('AI-derived content switch (LUM-917)', () => {
  it('defaults to on, explains the impact of off, and saves the boolean', async () => {
    renderSection()
    await screen.findByTestId('ai-derived-counts')
    expect(switchSelect().value).toBe('on')
    expect(screen.getByTestId('retention-hint-ai-derived')).toHaveTextContent(
      /no new memories, summaries/
    )
    expect(screen.getByTestId('retention-hint-ai-derived')).toHaveTextContent(
      /AI-generated task claims are created/
    )
    expect(
      screen.queryByTestId('retention-warning-ai-derived')
    ).not.toBeInTheDocument()

    fireEvent.change(switchSelect(), { target: { value: 'off' } })
    expect(
      screen.getByTestId('retention-warning-ai-derived')
    ).toHaveTextContent(/does not delete content that is already stored/)

    fireEvent.click(
      within(screen.getByTestId('retention-row-ai-derived')).getByRole('button')
    )
    await waitFor(() =>
      expect(client.updateMe).toHaveBeenCalledWith({
        aiDerivedContentEnabled: false,
      })
    )
  })

  it('shows off for a workspace that turned it off', async () => {
    renderSection({ ...SETTINGS, aiDerivedContentEnabled: false })
    await screen.findByTestId('ai-derived-counts')
    expect(switchSelect().value).toBe('off')
  })
})

describe('AI-derived content delete (LUM-917)', () => {
  it('needs the workspace name, then loops batched passes until done', async () => {
    client
      .purgeAiDerivedContent!.mockResolvedValueOnce({
        deleted: {
          memories: 1000,
          sessionSummaries: 0,
          runSummaries: 0,
          claimSnapshots: 0,
          verdictTexts: 0,
        },
        done: false,
      })
      .mockResolvedValueOnce({
        deleted: {
          memories: 200,
          sessionSummaries: 3,
          runSummaries: 40,
          claimSnapshots: 5,
          verdictTexts: 2,
        },
        done: true,
      })
    renderSection()
    expect(await screen.findByTestId('ai-derived-counts')).toHaveTextContent(
      'Stored now: 1200 memories · 3 session summaries · 40 run summaries · 5 generated task claims · 2 faithfulness check explanations'
    )

    fireEvent.click(
      within(screen.getByTestId('retention-row-ai-derived-delete')).getByRole(
        'button',
        { name: 'Delete content…' }
      )
    )
    const dialog = await screen.findByRole('alertdialog')
    const confirm = within(dialog).getByRole('button', {
      name: 'Delete content',
    })
    expect(confirm).toBeDisabled()

    fireEvent.change(within(dialog).getByLabelText('Type Acme to confirm'), {
      target: { value: 'Acm' },
    })
    expect(confirm).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText('Type Acme to confirm'), {
      target: { value: 'Acme' },
    })
    expect(confirm).toBeEnabled()

    client.getAiDerivedContent!.mockResolvedValue({
      enabled: true,
      counts: {
        memories: 0,
        sessionSummaries: 0,
        runSummaries: 0,
        claimSnapshots: 0,
        verdictTexts: 0,
      },
    })
    fireEvent.click(confirm)

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        'Deleted 1200 memories and cleared 3 session summaries, 40 run summaries, 5 task claims and 2 faithfulness check explanations'
      )
    )
    expect(client.purgeAiDerivedContent).toHaveBeenCalledTimes(2)
    expect(client.purgeAiDerivedContent).toHaveBeenNthCalledWith(1, 'Acme')
    await waitFor(() =>
      expect(screen.getByTestId('ai-derived-counts')).toHaveTextContent(
        'Stored now: 0 memories'
      )
    )
    // Nothing left: the delete button is disabled.
    expect(
      within(screen.getByTestId('retention-row-ai-derived-delete')).getByRole(
        'button',
        { name: 'Delete content…' }
      )
    ).toBeDisabled()
  })

  it('reports a failed pass without claiming success', async () => {
    client.purgeAiDerivedContent!.mockRejectedValue(new Error('boom'))
    renderSection()
    await screen.findByTestId('ai-derived-counts')
    fireEvent.click(
      within(screen.getByTestId('retention-row-ai-derived-delete')).getByRole(
        'button',
        { name: 'Delete content…' }
      )
    )
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.change(within(dialog).getByLabelText('Type Acme to confirm'), {
      target: { value: 'Acme' },
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Delete content' })
    )
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(toast.success).not.toHaveBeenCalled()
  })
})
