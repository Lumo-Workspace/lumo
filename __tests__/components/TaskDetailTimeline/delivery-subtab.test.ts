/** @jest-environment node */
import { resolveDefaultDeliverySubTab } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/delivery-subtab'

describe('resolveDefaultDeliverySubTab', () => {
  it('defaults to acceptance for an IN_REVIEW task that has criteria', () => {
    expect(
      resolveDefaultDeliverySubTab({
        status: 'IN_REVIEW',
        hasCriteria: true,
        hasOpenCrossings: false,
      })
    ).toBe('acceptance')
  })

  it('defaults to runs for an IN_REVIEW task with no criteria and no crossings', () => {
    expect(
      resolveDefaultDeliverySubTab({
        status: 'IN_REVIEW',
        hasCriteria: false,
        hasOpenCrossings: false,
      })
    ).toBe('runs')
  })

  it('open crossings default the delivery sub-tab to acceptance', () => {
    // No criteria and not IN_REVIEW — without the crossings nudge this would be
    // 'runs', so the user would never land on the panel showing the crossing.
    expect(
      resolveDefaultDeliverySubTab({
        status: 'IN_PROGRESS',
        hasCriteria: false,
        hasOpenCrossings: true,
      })
    ).toBe('acceptance')
  })

  it('defaults to runs when there are no criteria and no open crossings', () => {
    expect(
      resolveDefaultDeliverySubTab({
        status: 'TODO',
        hasCriteria: false,
        hasOpenCrossings: false,
      })
    ).toBe('runs')
  })

  it('treats an undefined status as not-yet-resolved (runs unless crossings nudge)', () => {
    expect(
      resolveDefaultDeliverySubTab({
        status: undefined,
        hasCriteria: false,
        hasOpenCrossings: false,
      })
    ).toBe('runs')
    expect(
      resolveDefaultDeliverySubTab({
        status: undefined,
        hasCriteria: false,
        hasOpenCrossings: true,
      })
    ).toBe('acceptance')
  })
})
