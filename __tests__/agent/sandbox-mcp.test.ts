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

      // Should write two files
      expect(fakeSandbox.files.write).toHaveBeenCalledTimes(2)
      expect(written['/home/user/mcp-server.mjs']).toBeDefined()
      expect(written['/home/user/mcp-config.json']).toBeDefined()
    })

    it('injects taskId into the server source', async () => {
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

      await installMcpServer(fakeSandbox, { taskId: 'task-1' })

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

      await installMcpServer(fakeSandbox, { taskId: 'task-1' })

      const source = written['/home/user/mcp-server.mjs']!
      expect(source).toContain("name: 'ask_user'")
      expect(source).toContain("name: 'report_progress'")
      expect(source).toContain('/tmp/clarify-question.txt')
      expect(source).toContain('/tmp/clarify-reply.txt')
    })
  })

  describe('MCP_CONFIG_PATH', () => {
    it('points to the correct sandbox path', () => {
      expect(MCP_CONFIG_PATH).toBe('/home/user/mcp-config.json')
    })
  })
})
