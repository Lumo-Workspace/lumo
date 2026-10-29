/**
 * @jest-environment node
 *
 * LUM-1335 — a login to a self-hosted Lumo is named, the hosted one is not.
 */
import { serverLabel } from '@/cli/src/lib/api'

describe('serverLabel', () => {
  it.each([
    'https://www.uselumo.ai',
    'https://www.uselumo.ai/',
    'https://uselumo.ai',
  ])('%s (hosted) has no label', url => expect(serverLabel(url)).toBeNull())

  it.each([
    ['http://localhost:3000/', 'local · http://localhost:3000'],
    ['http://127.0.0.1:3000', 'local · http://127.0.0.1:3000'],
    ['http://lumo.localhost', 'local · http://lumo.localhost'],
    ['https://lumo.example.com', 'self-hosted · https://lumo.example.com'],
    [
      'https://www.uselumo.ai.evil.example',
      'self-hosted · https://www.uselumo.ai.evil.example',
    ],
    // The hosted host on another scheme or port is not the hosted service.
    ['http://uselumo.ai:8080', 'self-hosted · http://uselumo.ai:8080'],
    [
      'https://www.uselumo.ai:8443',
      'self-hosted · https://www.uselumo.ai:8443',
    ],
  ])('%s → %s', (url, label) => expect(serverLabel(url)).toBe(label))

  it('an unparsable URL has no label', () => {
    expect(serverLabel('not a url')).toBeNull()
  })
})
