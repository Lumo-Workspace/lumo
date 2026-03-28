import { executeAgent } from '../lib/agent/execute'

async function main() {
  console.log('Starting executeAgent...')
  await executeAgent({
    taskId: 'cmn3rtrac000a92jp9bhfafn6',
    actorClerkId: 'test',
  })
  console.log('Done!')
}

main().catch(err => {
  console.error('FAILED:', err.message)
  process.exit(1)
})
