import { figmaIntegrationRepository } from '@/lib/repositories/figma-integration.repository'
import { getDecryptedTokens } from '@/lib/services/figma-integration.service'
import {
  createFigmaClient,
  FigmaNeedsReauthError,
  type FigmaClient,
} from '@/lib/integrations/figma/client'
import { encrypt } from '@/lib/crypto'

function err(message: string, status: number, code?: string) {
  return Object.assign(new Error(message), { status, code })
}

/**
 * Wrap the raw Figma client so every call:
 *  - converts a FigmaNeedsReauthError into a service-contract error
 *    `{ status: 403, code: 'figma_needs_reauth' }` AND marks the integration
 *    row's `needsReauth = true` so subsequent calls fail fast at
 *    `getDecryptedTokens` instead of re-attempting the dead refresh loop.
 *  - converts an upstream 404 from `getFile` / `getNode` into
 *    `{ status: 422, code: 'figma_file_not_accessible' }` per spec §4.
 */
export function wrapFigmaClient(
  raw: FigmaClient,
  integrationId: string
): FigmaClient {
  async function guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      if (e instanceof FigmaNeedsReauthError) {
        await figmaIntegrationRepository
          .markNeedsReauth(integrationId)
          .catch(() => null)
        throw err('Figma needs reauth', 403, 'figma_needs_reauth')
      }
      if ((e as { status?: number }).status === 404) {
        throw err('File not accessible', 422, 'figma_file_not_accessible')
      }
      throw e
    }
  }
  return {
    getFile: fk => guard(() => raw.getFile(fk)),
    getNode: (fk, id) => guard(() => raw.getNode(fk, id)),
    getImage: (fk, id) => guard(() => raw.getImage(fk, id)),
  }
}

export async function buildFigmaClient(workspaceId: string, memberId: string) {
  // getDecryptedTokens throws { status: 403, code: 'figma_not_connected' | 'figma_needs_reauth' }
  // if the integration is missing or invalidated; let it propagate.
  const tokens = await getDecryptedTokens(workspaceId, memberId)
  const raw = createFigmaClient({
    tokens,
    onTokensRefreshed: async next => {
      await figmaIntegrationRepository.updateTokens(tokens.integrationId, {
        accessToken: encrypt(next.accessToken),
        refreshToken: encrypt(next.refreshToken),
        expiresAt: next.expiresAt,
      })
    },
  })
  return {
    client: wrapFigmaClient(raw, tokens.integrationId),
    integrationId: tokens.integrationId,
  }
}

export function pickRepresentativeFrame(fileResp: {
  document: {
    children: Array<{
      type: string
      children?: Array<{ id: string; name: string; type: string }>
    }>
  }
}): { id: string; name: string } | null {
  for (const canvas of fileResp.document.children) {
    if (canvas.type !== 'CANVAS') continue
    const frame = (canvas.children ?? []).find(c => c.type === 'FRAME')
    if (frame) return { id: frame.id, name: frame.name }
  }
  return null
}
