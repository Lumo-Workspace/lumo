/** @jest-environment jsdom */
const en: Record<string, string> = {
  'task.assignee': 'Assignee',
  'task.unassigned': 'Unassigned',
}

jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => en[id] ?? id,
  }),
}))

import { render, screen } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AssigneeSelect } from '@/app/workspace/[workspaceUrl]/components/fields/AssigneeSelect'
import type { WorkspaceMemberInfo } from '@/app/workspace/[workspaceUrl]/types'

const me: WorkspaceMemberInfo & { actorId: string } = {
  id: 'wm_1',
  clerkId: 'user_1',
  role: 'OWNER',
  name: 'Chao Li',
  email: 'chao@example.com',
  imageUrl: null,
  joinedAt: '2026-01-01T00:00:00Z',
  actorId: 'actor_me',
}

function renderSelect(
  props: Partial<React.ComponentProps<typeof AssigneeSelect>> = {}
) {
  return render(
    <TooltipProvider>
      <AssigneeSelect
        value={null}
        onChange={jest.fn()}
        members={[]}
        {...props}
      />
    </TooltipProvider>
  )
}

describe('AssigneeSelect', () => {
  it("renders the human assignee's name when the member is present in members", () => {
    renderSelect({ value: me.actorId, members: [me] })
    expect(screen.getByText('Chao Li')).toBeInTheDocument()
    expect(screen.queryByText('No assignee')).not.toBeInTheDocument()
  })

  // Regression guard for the my-tasks / project-detail bug: when the members
  // list hasn't loaded, a task that IS assigned to a human still renders as
  // "No assignee" because the human's display name lives only in the members
  // list. This documents WHY members must be fetched before the assignee column
  // renders (the fix: WorkspaceApp fetches members on mount).
  it('shows "No assignee" for a human assignee when members is empty', () => {
    renderSelect({ value: me.actorId, members: [] })
    expect(screen.getByText('No assignee')).toBeInTheDocument()
  })
})
