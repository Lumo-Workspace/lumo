import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registerWorkspaceTools } from './tools/workspace.js'
import { registerProjectTools } from './tools/projects.js'
import { registerTaskTools } from './tools/tasks.js'
import { registerCommentTools } from './tools/comments.js'
import { registerAgentCommTools } from './tools/agent-comm.js'

const server = new McpServer({
  name: 'lumo',
  version: '1.0.0',
})

registerWorkspaceTools(server)
registerProjectTools(server)
registerTaskTools(server)
registerCommentTools(server)
registerAgentCommTools(server)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch(err => {
  console.error('[lumo-mcp] Fatal error:', err)
  process.exit(1)
})
