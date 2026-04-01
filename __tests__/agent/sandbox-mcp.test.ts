import { installMcpServer, MCP_CONFIG_PATH } from '@/lib/agent/sandbox-mcp'

describe('sandbox-mcp', () => {
  describe('installMcpServer', () => {
    it('writes mcp-server.mjs and mcp-config.json to sandbox', async () => {
      const written: Record<string, string> = {}
      const fakeSandbox = {
        files: {
          write: jest.fn(async (path: string, content: string) => {
            written[path] = content
          }),
        },
      } as any

      await installMcpServer(fakeSandbox, {
        taskId: 'task-123',
        callbackUrl: 'https://app.uselumo.ai',
      })

      expect(fakeSandbox.files.write).toHaveBeenCalledTimes(2)
      expect(written['/home/user/mcp-server.mjs']).toBeDefined()
      expect(written['/home/user/mcp-config.json']).toBeDefined()
    })

    it('injects taskId and callbackUrl into the server source', async () => {
      const written: Record<string, string> = {}
      const fakeSandbox = {
        files: {
          write: jest.fn(async (path: string, content: string) => {
            written[path] = content
          }),
        },
      } as any

      await installMcpServer(fakeSandbox, {
        taskId: 'task-456',
        callbackUrl: 'https://example.com',
      })

      const source = written['/home/user/mcp-server.mjs']!
      expect(source).toContain("'task-456'")
      expect(source).toContain("'https://example.com'")
    })

    it('injects callbackToken when provided', async () => {
      const written: Record<string, string> = {}
      const fakeSandbox = {
        files: {
          write: jest.fn(async (path: string, content: string) => {
            written[path] = content
          }),
        },
      } as any

      await installMcpServer(fakeSandbox, {
        taskId: 'task-789',
        callbackUrl: 'https://example.com',
        callbackToken: 'secret-token-abc',
      })

      const source = written['/home/user/mcp-server.mjs']!
      expect(source).toContain("'secret-token-abc'")
    })

    it('produces valid JSON mcp-config', async () => {
      const written: Record<string, string> = {}
      const fakeSandbox = {
        files: {
          write: jest.fn(async (path: string, content: string) => {
            written[path] = content
          }),
        },
      } as any

      await installMcpServer(fakeSandbox, {
        taskId: 'task-1',
        callbackUrl: 'https://example.com',
      })

      const config = JSON.parse(written['/home/user/mcp-config.json']!)
      expect(config.mcpServers['lumo-sandbox'].command).toBe('node')
      expect(config.mcpServers['lumo-sandbox'].args).toEqual([
        '/home/user/mcp-server.mjs',
      ])
    })

    it('server source contains ask_user and report_progress tools', async () => {
      const written: Record<string, string> = {}
      const fakeSandbox = {
        files: {
          write: jest.fn(async (path: string, content: string) => {
            written[path] = content
          }),
        },
      } as any

      await installMcpServer(fakeSandbox, {
        taskId: 'task-1',
        callbackUrl: 'https://example.com',
      })

      const source = written['/home/user/mcp-server.mjs']!
      expect(source).toContain("name: 'ask_user'")
      expect(source).toContain("name: 'report_progress'")
    })

    it('server source uses HTTP API instead of file I/O', async () => {
      const written: Record<string, string> = {}
      const fakeSandbox = {
        files: {
          write: jest.fn(async (path: string, content: string) => {
            written[path] = content
          }),
        },
      } as any

      await installMcpServer(fakeSandbox, {
        taskId: 'task-1',
        callbackUrl: 'https://example.com',
      })

      const source = written['/home/user/mcp-server.mjs']!
      // Should use HTTP polling, not file polling
      expect(source).toContain('/api/agent/mcp-clarify')
      expect(source).toContain('httpGet')
      expect(source).toContain('httpPost')
      // Should NOT have file I/O for clarify
      expect(source).not.toContain('clarify-question.txt')
      expect(source).not.toContain('clarify-reply.txt')
    })
  })

  describe('MCP_CONFIG_PATH', () => {
    it('points to the correct sandbox path', () => {
      expect(MCP_CONFIG_PATH).toBe('/home/user/mcp-config.json')
    })
  })
})
