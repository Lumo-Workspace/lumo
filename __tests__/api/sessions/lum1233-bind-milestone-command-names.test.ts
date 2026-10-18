/**
 * @jest-environment node
 *
 * LUM-1233 3a — the steward attach route passes the caller's CLI command
 * names (from X-Lumo-Cli-Version) to the bind, so the injected test-case hint
 * uses the handle that CLI takes.
 */
jest.mock('@/lib/auth/bearer', () => ({
  verifyBearer: jest.fn().mockResolvedValue({ workspace: { id: 'w' } }),
}))
const bindMock = jest.fn().mockResolvedValue({ status: 'bound' })
jest.mock('@/lib/services/session.service', () => ({
  sessionService: {
    bindSessionToMilestone: (...a: unknown[]) => bindMock(...a),
  },
}))

import { POST } from '@/app/api/sessions/[sessionId]/bind-milestone/route'
import {
  CURRENT_CLI_COMMANDS,
  LEGACY_CLI_COMMANDS,
} from '@/lib/cli/command-names'

const call = (headers: Record<string, string>) =>
  POST(
    new Request('http://x/api/sessions/s1/bind-milestone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ milestoneRef: 'headless-web-cli' }),
    }),
    { params: Promise.resolve({ sessionId: 's1' }) }
  )

beforeEach(() => bindMock.mockClear())

it.each([
  ['an older CLI', { 'X-Lumo-Cli-Version': '1.125.4' }, LEGACY_CLI_COMMANDS],
  ['no header', {}, LEGACY_CLI_COMMANDS],
  ['a current CLI', { 'X-Lumo-Cli-Version': '1.125.5' }, CURRENT_CLI_COMMANDS],
])('%s', async (_l, headers, expected) => {
  await call(headers)
  expect(bindMock.mock.calls[0]![0].commands).toBe(expected)
})
