import { prisma } from '../lib/db/prisma'
async function main() {
  const t = await prisma.task.update({
    where: { id: 'cmn3rtrac000a92jp9bhfafn6' },
    data: {
      title: 'Add a hello world utility function',
      agentStatus: null,
      spec: `## Requirements
Create a utility function called greet(name: string): string
- Located in src/utils/greet.ts
- Returns "Hello, {name}!"
- If name is empty, returns "Hello, World!"

## Tests
Write tests in __tests__/greet.test.ts
Cover:
- Normal case: greet("Lumo") returns "Hello, Lumo!"
- Empty case: greet("") returns "Hello, World!"

## Acceptance criteria
- TypeScript strict mode
- All tests pass`,
    },
    select: { title: true, spec: true, agentStatus: true },
  })
  console.log('Updated:', JSON.stringify(t, null, 2))
}
main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
