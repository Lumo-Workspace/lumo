// LUM-1234 Task 11: the REWARD_HACK evidence block — restricted viewers get
// the access note and no session text; others get prompts and steps, each
// linked to /sessions/<id>#<eventId>.
import { render, screen } from '@testing-library/react'

jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => id,
  }),
}))
const useRewardHackEvidence = jest.fn()
jest.mock('@/ee/security/hooks/useRewardHackEvidence', () => ({
  useRewardHackEvidence: (taskId: string, findingId: string) =>
    useRewardHackEvidence(taskId, findingId),
}))

import { RewardHackEvidence } from '@/ee/security/components/TaskDetailTimeline/RewardHackEvidence'

const view = {
  summary: 'Weakened the failing assertion',
  requirementExcerpt: '# Fix login\n\nLogin must return 200.',
  restricted: false,
  prompts: [
    { eventId: 'ev-p', sessionId: 'p1:agent1', text: 'Make the test pass' },
  ],
  steps: [
    {
      eventId: 'ev-e',
      sessionId: 'p1:agent1',
      kind: 'tool',
      label: 'Edit /repo/src/login.test.ts',
      detail: 'expect(res.status).toBeDefined()',
    },
    {
      eventId: 'ev-s',
      sessionId: 'p1:agent1',
      kind: 'stop',
      label: '',
      detail: 'All tests pass now.',
    },
  ],
}

function renderWith(data: unknown, state: Record<string, boolean> = {}) {
  useRewardHackEvidence.mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    ...state,
  })
  render(<RewardHackEvidence taskId='t1' findingId='f1' />)
}

beforeEach(() => jest.clearAllMocks())

describe('RewardHackEvidence', () => {
  it('reads the finding of its own task', () => {
    renderWith(view)
    expect(useRewardHackEvidence).toHaveBeenCalledWith('t1', 'f1')
  })

  it('shows prompts and steps, each linked to its event on the session page', () => {
    renderWith(view)
    expect(screen.getByText('Make the test pass')).toBeInTheDocument()
    expect(screen.getByText('Edit /repo/src/login.test.ts')).toBeInTheDocument()
    expect(
      screen.getByText('securityScan.rewardHack.finalMessage')
    ).toBeInTheDocument()
    const hrefs = screen.getAllByRole('link').map(a => a.getAttribute('href'))
    expect(hrefs).toEqual([
      '/sessions/p1%3Aagent1#ev-p',
      '/sessions/p1%3Aagent1#ev-e',
      '/sessions/p1%3Aagent1#ev-s',
    ])
    expect(
      screen.queryByTestId('reward-hack-evidence-restricted')
    ).not.toBeInTheDocument()
  })

  it('a restricted view shows the access note and the requirement, no session text', () => {
    renderWith({ ...view, restricted: true, prompts: [], steps: [] })
    expect(
      screen.getByTestId('reward-hack-evidence-restricted')
    ).toHaveTextContent('securityScan.rewardHack.restricted')
    expect(
      screen.getByTestId('reward-hack-evidence-requirement')
    ).toHaveTextContent('Login must return 200.')
    expect(
      screen.queryByTestId('reward-hack-evidence-prompts')
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('reward-hack-evidence-empty')
    ).not.toBeInTheDocument()
  })

  it('says so when every cited event is gone', () => {
    renderWith({ ...view, prompts: [], steps: [] })
    expect(screen.getByTestId('reward-hack-evidence-empty')).toBeInTheDocument()
  })

  it('a failed read says it could not load', () => {
    renderWith(undefined, { isError: true })
    expect(screen.getByTestId('reward-hack-evidence-error')).toBeInTheDocument()
  })
})
