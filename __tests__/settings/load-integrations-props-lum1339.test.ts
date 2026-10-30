/**
 * LUM-1339 — the server-side props both integrations pages (Workspace →
 * Integrations, Personal → Connected accounts) share: the viewer's role in
 * the page's own workspace (LUM-987), the configured map (LUM-1025) and the
 * Codeup rollout flag (LUM-1315).
 */
import { loadIntegrationsProps } from '@/app/workspace/[workspaceUrl]/settings/integrations/load-integrations-props'
import { getCurrentUserId, getUserWorkspace } from '@/lib/auth'
import { isFeatureEnabled } from '@/lib/features/is-enabled'

jest.mock('@/lib/auth', () => ({
  getCurrentUserId: jest.fn(),
  getUserWorkspace: jest.fn(),
}))
jest.mock('@/lib/integrations/configured', () => ({
  configuredRegistryIntegrations: () => ({ slack: true, figma: false }),
}))
jest.mock('@/lib/features/is-enabled', () => ({ isFeatureEnabled: jest.fn() }))

const userId = getCurrentUserId as jest.Mock
const userWorkspace = getUserWorkspace as jest.Mock
const flag = isFeatureEnabled as jest.Mock

beforeEach(() => jest.clearAllMocks())

it('reads the role in the page’s own workspace and gates Codeup on its flag', async () => {
  userId.mockResolvedValue('u1')
  userWorkspace.mockResolvedValue({
    workspaceId: 'w2',
    member: { role: 'OWNER' },
  })
  flag.mockReturnValue(false)

  await expect(loadIntegrationsProps('bravo')).resolves.toEqual({
    isOwner: true,
    configured: { slack: true, figma: false },
    unreleased: ['codeup', 'feishu', 'feishuAccount'],
  })
  expect(userWorkspace).toHaveBeenCalledWith('u1', 'bravo')
  expect(flag).toHaveBeenCalledWith('codeup-integration', 'w2')
  expect(flag).toHaveBeenCalledWith('feishu-integration', 'w2')
})

it('LUM-1341: Feishu cards follow their own flag, apart from Codeup', async () => {
  userId.mockResolvedValue('u1')
  userWorkspace.mockResolvedValue({
    workspaceId: 'w3',
    member: { role: 'OWNER' },
  })
  flag.mockImplementation((key: string) => key === 'feishu-integration')

  const props = await loadIntegrationsProps('charlie')
  expect(props.unreleased).toEqual(['codeup'])
})

it('a member, Codeup released', async () => {
  userId.mockResolvedValue('u1')
  userWorkspace.mockResolvedValue({
    workspaceId: 'w1',
    member: { role: 'MEMBER' },
  })
  flag.mockReturnValue(true)

  const props = await loadIntegrationsProps('alpha')
  expect(props.isOwner).toBe(false)
  expect(props.unreleased).toEqual([])
})

it('signed out: not an owner, flag checked without a workspace', async () => {
  userId.mockResolvedValue(null)
  flag.mockReturnValue(false)

  const props = await loadIntegrationsProps('alpha')
  expect(props.isOwner).toBe(false)
  expect(userWorkspace).not.toHaveBeenCalled()
  expect(flag).toHaveBeenCalledWith('codeup-integration', null)
})
