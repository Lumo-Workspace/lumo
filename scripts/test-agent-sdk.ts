import { query } from '@anthropic-ai/claude-agent-sdk'

async function main() {
  console.log('Starting agent...')

  for await (const message of query({
    prompt:
      'What files are in the current directory? Use the Bash tool to run ls.',
    options: {
      allowedTools: ['Bash(ls *)'],
      maxTurns: 3,
    },
  })) {
    console.log('Message type:', message.type)
    if (message.type === 'assistant') {
      console.log('Agent says:', JSON.stringify(message.content, null, 2))
    }
    if (message.type === 'result') {
      console.log('Result:', message.result)
    }
  }

  console.log('Done.')
}

main().catch(console.error)
