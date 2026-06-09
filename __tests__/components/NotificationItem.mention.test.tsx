/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import en from '@/lib/i18n/en.json'
import { NotificationItem } from '@/app/workspace/[workspaceUrl]/components/pages/inbox/NotificationItem'
import type { ApiNotification } from '@/app/workspace/[workspaceUrl]/types'

// react-intl ships untransformed ESM that jest can't parse, and the inbox
// components are tested elsewhere via a useIntl mock reading from en.json.
// Mirror that harness so we exercise the real verb keys.
jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({
      id,
      defaultMessage,
    }: {
      id: string
      defaultMessage?: string
    }) => {
      const messages = jest.requireActual('@/lib/i18n/en.json') as Record<
        string,
        string
      >
      return messages[id] ?? defaultMessage ?? id
    },
  }),
}))

// ── Fixture ──────────────────────────────────────────────────────────────────

function makeNotification(
  overrides: Partial<ApiNotification> = {}
): ApiNotification {
  return {
    id: 'notif-1',
    type: 'PROJECT_MENTIONED',
    read: false,
    requiresAction: false,
    actionTakenAt: null,
    createdAt: new Date().toISOString(),
    taskId: null,
    commentId: null,
    clarifyId: null,
    sprintId: null,
    triggerActorId: 'actor-1',
    actor: { name: 'Ada Lovelace', imageUrl: null },
    task: null,
    sprint: null,
    projectId: null,
    milestoneId: null,
    documentId: null,
    project: null,
    milestone: null,
    document: null,
    commentPreview: null,
    clarifyQuestion: null,
    clarifyContext: null,
    ...overrides,
  }
}

function renderItem(notification: ApiNotification) {
  return render(
    <NotificationItem
      notification={notification}
      isSelected={false}
      onSelect={jest.fn()}
      onMarkRead={jest.fn()}
      onMarkUnread={jest.fn()}
      onDelete={jest.fn()}
      onTaskAction={jest.fn()}
    />
  )
}

describe('NotificationItem — mention types', () => {
  it('renders a PROJECT_MENTIONED notification with the project name and mention verb', () => {
    renderItem(
      makeNotification({
        type: 'PROJECT_MENTIONED',
        projectId: 'proj-1',
        project: {
          id: 'proj-1',
          name: 'Apollo',
          url: '/workspace/ws/projects/apollo',
        },
      })
    )

    expect(screen.getByText('Apollo')).toBeInTheDocument()
    expect(screen.getByText(en['notification.verb.projectMentioned'])).toBeInTheDocument()
    expect(screen.queryByText(en['notification.unspecifiedTask'])).not.toBeInTheDocument()
  })

  it('navigates to the project url when clicked', () => {
    renderItem(
      makeNotification({
        type: 'PROJECT_MENTIONED',
        projectId: 'proj-1',
        project: {
          id: 'proj-1',
          name: 'Apollo',
          url: '/workspace/ws/projects/apollo',
        },
      })
    )
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/workspace/ws/projects/apollo')
  })

  it('renders a MILESTONE_MENTIONED notification with the milestone name', () => {
    renderItem(
      makeNotification({
        type: 'MILESTONE_MENTIONED',
        milestoneId: 'mile-1',
        milestone: {
          id: 'mile-1',
          name: 'Launch GA',
          url: '/workspace/ws/milestones/launch-ga',
        },
      })
    )

    expect(screen.getByText('Launch GA')).toBeInTheDocument()
    expect(screen.getByText(en['notification.verb.milestoneMentioned'])).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      '/workspace/ws/milestones/launch-ga'
    )
  })

  it('renders a DOCUMENT_MENTIONED notification with the document title', () => {
    renderItem(
      makeNotification({
        type: 'DOCUMENT_MENTIONED',
        documentId: 'doc-1',
        document: {
          id: 'doc-1',
          title: 'Design Spec',
          url: '/workspace/ws/documents/design-spec-3',
        },
      })
    )

    expect(screen.getByText('Design Spec')).toBeInTheDocument()
    expect(screen.getByText(en['notification.verb.documentMentioned'])).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      '/workspace/ws/documents/design-spec-3'
    )
  })

  it('renders a DOCUMENT_COMMENT_MENTIONED notification with the document title and comment verb', () => {
    renderItem(
      makeNotification({
        type: 'DOCUMENT_COMMENT_MENTIONED',
        documentId: 'doc-1',
        document: {
          id: 'doc-1',
          title: 'Design Spec',
          url: '/workspace/ws/documents/design-spec-3',
        },
      })
    )

    expect(screen.getByText('Design Spec')).toBeInTheDocument()
    expect(
      screen.getByText(en['notification.verb.documentCommentMentioned'])
    ).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      '/workspace/ws/documents/design-spec-3'
    )
  })
})
