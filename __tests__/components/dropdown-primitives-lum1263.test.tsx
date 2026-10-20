/** @jest-environment jsdom */
// LUM-1263: the five non-editor menus/pickers run on the shared Popover /
// Command / DropdownMenu primitives — Esc and outside click close them, arrow
// keys move the highlight, Enter picks the highlighted row.
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { TagPicker } from '@/app/workspace/[workspaceUrl]/components/document/TagPicker'
import { TagInput } from '@/app/workspace/[workspaceUrl]/components/document/TagInput'
import { ShareDialog } from '@/app/workspace/[workspaceUrl]/components/document/ShareDialog'
import { ProjectsPage } from '@/app/workspace/[workspaceUrl]/components/pages/ProjectsPage'
import { DocumentCommentThread } from '@/app/workspace/[workspaceUrl]/components/document/comments/DocumentCommentThread'
import type {
  ApiProject,
  ApiTag,
  WorkspaceMemberInfo,
} from '@/app/workspace/[workspaceUrl]/types'

jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}))
jest.mock('next/navigation', () => ({
  useParams: () => ({ workspaceUrl: 'acme' }),
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('@/app/workspace/[workspaceUrl]/components/PageBreadcrumb', () => ({
  PageBreadcrumb: ({ actions }: { actions?: ReactNode }) => (
    <div>{actions}</div>
  ),
}))
jest.mock('@/app/workspace/[workspaceUrl]/hooks/useFormatDate', () => ({
  useFormatDate: () => ({ fmtTimestamp: () => '2h ago' }),
}))
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/comments/CommentEditor',
  () => ({ CommentEditor: () => <div /> })
)
jest.mock(
  '@/app/workspace/[workspaceUrl]/components/comments/CommentEditMode',
  () => ({ CommentEditMode: () => <div data-testid='edit-mode' /> })
)
jest.mock('@/lib/api-client', () => ({
  documentsClient: {
    createShare: jest.fn(() => new Promise(() => {})),
    update: jest.fn(() => Promise.resolve()),
  },
  mentionSearchClient: { search: jest.fn() },
}))

// jsdom has no PointerEvent, so fireEvent.pointerDown would drop `button`
// and the Radix DropdownMenu trigger (which opens on pointerdown) ignores it.
if (typeof window.PointerEvent === 'undefined') {
  window.PointerEvent = class extends MouseEvent {} as typeof PointerEvent
}

beforeAll(() => {
  // cmdk scrolls the highlighted row into view; jsdom has no scrollIntoView.
  Element.prototype.scrollIntoView = jest.fn()
})

// Radix registers its outside-pointerdown listener on the next tick.
const tick = () => act(() => new Promise(r => setTimeout(r, 0)))
const options = () => screen.queryAllByRole('option')
const selectedText = () =>
  options().find(o => o.getAttribute('aria-selected') === 'true')?.textContent

const T = '2026-10-01T00:00:00Z'
const tag = (id: string, name: string): ApiTag => ({
  id,
  name,
  color: null,
  workspaceId: 'w',
  createdAt: T,
})
const TAGS = [tag('t1', 'design'), tag('t2', 'devops'), tag('t3', 'infra')]

describe('TagPicker', () => {
  function setup() {
    const onChange = jest.fn()
    const onCreateTag = jest.fn(async (name: string) => tag('new', name))
    render(
      <div>
        <button>outside</button>
        <TagPicker
          selectedTags={[]}
          allTags={TAGS}
          onChange={onChange}
          onCreateTag={onCreateTag}
        />
      </div>
    )
    const input = screen.getByPlaceholderText('documents.tagPlaceholder')
    return { onChange, onCreateTag, input }
  }

  it('keeps focus in the input; arrow keys move and Enter picks', async () => {
    const { onChange, input } = setup()
    input.focus()
    fireEvent.change(input, { target: { value: 'de' } })
    await tick()
    expect(document.activeElement).toBe(input)
    expect(options().map(o => o.textContent)).toEqual([
      'design',
      'devops',
      'tags.create',
    ])
    expect(selectedText()).toBe('design')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(selectedText()).toBe('devops')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith([TAGS[1]])
  })

  it('Enter on the create row creates the tag', async () => {
    const { onCreateTag, input } = setup()
    input.focus()
    fireEvent.change(input, { target: { value: 'newtag' } })
    await tick()
    expect(selectedText()).toBe('tags.create')
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    expect(onCreateTag).toHaveBeenCalledWith('newtag')
  })

  it('Esc and outside click close the suggestions', async () => {
    const { input } = setup()
    input.focus()
    fireEvent.change(input, { target: { value: 'd' } })
    await tick()
    expect(options().length).toBeGreaterThan(0)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(options()).toHaveLength(0)

    fireEvent.change(input, { target: { value: 'de' } })
    await tick()
    expect(options().length).toBeGreaterThan(0)
    fireEvent.pointerDown(screen.getByText('outside'))
    expect(options()).toHaveLength(0)
  })
})

describe('TagInput', () => {
  function setup() {
    const onChange = jest.fn()
    render(
      <div>
        <button>outside</button>
        <TagInput
          tags={['alpha']}
          onChange={onChange}
          suggestions={['alpha', 'beta', 'bravo']}
        />
      </div>
    )
    return { onChange, input: screen.getByRole('textbox') }
  }

  it('Enter adds the typed text until the user arrows onto a suggestion', async () => {
    const { onChange, input } = setup()
    input.focus()
    fireEvent.change(input, { target: { value: 'b' } })
    await tick()
    expect(options().map(o => o.textContent)).toEqual(['beta', 'bravo'])
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith(['alpha', 'b'])

    fireEvent.change(input, { target: { value: 'b' } })
    await tick()
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(selectedText()).toBe('bravo')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith(['alpha', 'bravo'])
  })

  it('Esc and outside click close the suggestions', async () => {
    const { input } = setup()
    input.focus()
    fireEvent.change(input, { target: { value: 'b' } })
    await tick()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(options()).toHaveLength(0)
    fireEvent.change(input, { target: { value: 'br' } })
    await tick()
    expect(options()).toHaveLength(1)
    fireEvent.pointerDown(screen.getByText('outside'))
    expect(options()).toHaveLength(0)
  })
})

const member = (id: string, name: string): WorkspaceMemberInfo => ({
  id,
  clerkId: id,
  role: 'MEMBER',
  name,
  email: `${id}@example.com`,
  imageUrl: null,
  joinedAt: T,
  actorId: null,
})

describe('ShareDialog member search', () => {
  function setup() {
    const onSharesChange = jest.fn()
    const onOpenChange = jest.fn()
    render(
      <ShareDialog
        open
        onOpenChange={onOpenChange}
        documentId='d1'
        documentTitle='Doc'
        documentEmoji={null}
        visibility='SHARED'
        publicToken={null}
        shares={[]}
        owner={{ id: 'm1', name: 'Owner', imageUrl: null }}
        members={[member('m2', 'Alice'), member('m3', 'Alan')]}
        currentMemberId='m1'
        onSharesChange={onSharesChange}
        onVisibilityChange={jest.fn()}
        onPublicTokenChange={jest.fn()}
      />
    )
    const input = screen.getByPlaceholderText('share.searchPlaceholder')
    return { onSharesChange, onOpenChange, input }
  }

  it('arrow keys + Enter invite the highlighted member', async () => {
    const { onSharesChange, input } = setup()
    input.focus()
    fireEvent.change(input, { target: { value: 'al' } })
    await tick()
    expect(options()).toHaveLength(2)
    expect(document.activeElement).toBe(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSharesChange).toHaveBeenCalledWith([
      expect.objectContaining({ memberId: 'm3' }),
    ])
  })

  it('Esc closes the results but not the dialog', async () => {
    const { onOpenChange, input } = setup()
    input.focus()
    fireEvent.change(input, { target: { value: 'al' } })
    await tick()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(options()).toHaveLength(0)
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('outside click closes the results', async () => {
    const { input } = setup()
    input.focus()
    fireEvent.change(input, { target: { value: 'al' } })
    await tick()
    fireEvent.pointerDown(screen.getByText('share.sharedWith'))
    expect(options()).toHaveLength(0)
  })
})

const project = (id: string, name: string): ApiProject => ({
  id,
  name,
  description: null,
  isIdea: false,
  ownerId: null,
  updatedAt: T,
  createdAt: T,
  _count: { tasks: 0 },
  todoCount: 0,
  inProgressCount: 0,
  inReviewCount: 0,
  doneCount: 0,
  owner: null,
})

describe('ProjectsPage search', () => {
  function setup() {
    const onSelectProject = jest.fn()
    const projects = [project('p1', 'Lumo web'), project('p2', 'Lumo CLI')]
    render(
      <ProjectsPage
        projects={projects}
        loading={false}
        error={null}
        onRetry={jest.fn()}
        onSelectProject={onSelectProject}
        onNewProject={jest.fn()}
        onBulkDelete={jest.fn()}
      />
    )
    const input = screen.getByPlaceholderText('projects.searchPlaceholder')
    return { onSelectProject, input, projects }
  }

  it('arrow keys + Enter open the highlighted project', async () => {
    const { onSelectProject, input, projects } = setup()
    input.focus()
    fireEvent.change(input, { target: { value: 'lumo' } })
    await tick()
    expect(options()).toHaveLength(2)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSelectProject).toHaveBeenCalledWith(projects[1])
  })

  it('Esc and outside click close the results', async () => {
    const { input } = setup()
    input.focus()
    fireEvent.change(input, { target: { value: 'lumo' } })
    await tick()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(options()).toHaveLength(0)
    fireEvent.change(input, { target: { value: 'lum' } })
    await tick()
    expect(options()).toHaveLength(2)
    fireEvent.pointerDown(document.body)
    expect(options()).toHaveLength(0)
  })
})

describe('DocumentCommentThread more menu', () => {
  const thread = {
    id: 'c1',
    documentId: 'd1',
    authorActorId: 'a1',
    body: '<p>top</p>',
    parentId: null,
    quotedText: 'q',
    anchorStart: 1,
    anchorEnd: 2,
    status: 'OPEN',
    isOrphaned: false,
    type: 'USER',
    createdAt: T,
    replies: [],
  }
  function setup() {
    render(
      <DocumentCommentThread
        thread={thread as never}
        members={[]}
        agentActors={[]}
        currentActorId='a1'
        onReply={jest.fn()}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        onSetStatus={jest.fn()}
        onSelect={jest.fn()}
      />
    )
    return screen.getByTestId('comment-menu-c1')
  }

  it('opens from the keyboard; arrows move; Enter selects', async () => {
    const trigger = setup()
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'Enter' })
    const items = screen.getAllByRole('menuitem')
    expect(items.map(i => i.textContent)).toEqual([
      'common.edit',
      'common.delete',
    ])
    await tick()
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(items[0]!, { key: 'ArrowDown' })
    await tick()
    expect(document.activeElement).toBe(items[1])
    fireEvent.keyDown(items[1]!, { key: 'Enter' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByTestId('confirm-delete-c1')).toBeInTheDocument()
  })

  it('delete keeps its destructive styling', () => {
    const trigger = setup()
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    expect(screen.getByTestId('delete-c1')).toHaveClass('text-danger-text')
  })

  it('Esc and outside click close the menu', async () => {
    const trigger = setup()
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await tick()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
