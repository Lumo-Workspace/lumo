/**
 * Test script for the agent API routes.
 * Requires the dev server to be running: npm run dev
 *
 * Usage:
 *   npx tsx scripts/test-api-route.ts
 *
 * Set these env vars (or add to .env.local):
 *   TEST_BASE_URL   — defaults to http://localhost:3000
 *   TEST_TASK_ID    — a real task ID from your database
 *   TEST_WORKSPACE_ID — the workspace that task belongs to
 *   TEST_CLERK_TOKEN  — a Clerk session token (from browser DevTools)
 */

const BASE_URL = process.env.TEST_BASE_URL ?? 'http://localhost:3000'
const TASK_ID = process.env.TEST_TASK_ID ?? ''
const WORKSPACE_ID = process.env.TEST_WORKSPACE_ID ?? ''
const CLERK_TOKEN = process.env.TEST_CLERK_TOKEN ?? ''

if (!TASK_ID || !WORKSPACE_ID) {
  console.error('Set TEST_TASK_ID and TEST_WORKSPACE_ID env vars')
  process.exit(1)
}

const headers: Record<string, string> = {
  'Content-Type': 'application/json',
}
if (CLERK_TOKEN) {
  headers['Authorization'] = `Bearer ${CLERK_TOKEN}`
}

async function testExecute() {
  console.log('\n--- POST /api/agent/execute ---')
  const res = await fetch(`${BASE_URL}/api/agent/execute`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ taskId: TASK_ID, workspaceId: WORKSPACE_ID }),
  })
  const data = await res.json()
  console.log(`Status: ${res.status}`)
  console.log('Body:', JSON.stringify(data, null, 2))
  return res.status
}

async function testStatus() {
  console.log('\n--- GET /api/agent/status/[taskId] ---')
  const res = await fetch(
    `${BASE_URL}/api/agent/status/${TASK_ID}?workspaceId=${WORKSPACE_ID}`,
    { headers }
  )
  const data = await res.json()
  console.log(`Status: ${res.status}`)
  console.log('Body:', JSON.stringify(data, null, 2))
}

async function main() {
  console.log('Testing Agent API Routes')
  console.log('Base URL:', BASE_URL)
  console.log('Task ID:', TASK_ID)
  console.log('Workspace ID:', WORKSPACE_ID)

  await testStatus()
  await testExecute()

  // Poll status a few times
  for (let i = 0; i < 3; i++) {
    await new Promise(r => setTimeout(r, 2000))
    await testStatus()
  }
}

main().catch(console.error)
