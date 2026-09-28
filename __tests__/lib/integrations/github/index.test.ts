/**
 * @jest-environment node
 *
 * Barrel export verification for @/lib/integrations/github.
 * Ensures all public functions and types are accessible from the index.
 */

// Mock ESM dependencies that cannot be parsed by Jest's CommonJS transformer
jest.mock('@octokit/auth-app', () => ({
  createAppAuth: jest.fn(),
}))

// Mock Prisma to avoid DB connection requirements
jest.mock('@/lib/db/prisma', () => ({
  prisma: {},
}))

import * as githubModule from '@/lib/integrations/github'

describe('lib/integrations/github barrel exports', () => {
  it('exports getRepoToken as a function', () => {
    expect(typeof githubModule.getRepoToken).toBe('function')
  })

  it('exports parseBranchIdentifier as a function', () => {
    expect(typeof githubModule.parseBranchIdentifier).toBe('function')
  })

  it('exports splitIdentifier as a function', () => {
    expect(typeof githubModule.splitIdentifier).toBe('function')
  })

  it('exports generateBranchName as a function', () => {
    expect(typeof githubModule.generateBranchName).toBe('function')
  })

  it('exports createRepoWebhook as a function', () => {
    expect(typeof githubModule.createRepoWebhook).toBe('function')
  })

  it('exports deleteRepoWebhook as a function', () => {
    expect(typeof githubModule.deleteRepoWebhook).toBe('function')
  })

  it('exports verifyGitHubSignature as a function', () => {
    expect(typeof githubModule.verifyGitHubSignature).toBe('function')
  })

  it('exports syncRepoPRs as a function', () => {
    expect(typeof githubModule.syncRepoPRs).toBe('function')
  })

  it('exports all expected public functions', () => {
    const expectedExports = [
      'getRepoToken',
      'parseBranchIdentifier',
      'splitIdentifier',
      'generateBranchName',
      'createRepoWebhook',
      'deleteRepoWebhook',
      'verifyGitHubSignature',
      'syncRepoPRs',
    ]
    const actualExports = Object.keys(githubModule)
    for (const name of expectedExports) {
      expect(actualExports).toContain(name)
    }
  })
})
