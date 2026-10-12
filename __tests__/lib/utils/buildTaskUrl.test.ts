import {
  buildMyTasksUrl,
  buildTaskUrl,
  buildTaskIdentifier,
} from '@/lib/utils/buildTaskUrl'

describe('buildTaskUrl', () => {
  const original = process.env.NEXT_PUBLIC_APP_URL

  afterEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = original
  })

  it('builds the canonical project-scoped task URL (regression: bare /tasks/ 404)', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://www.uselumo.ai'
    expect(buildTaskUrl('lumo', 'Lumo', 'LUM', 324)).toBe(
      'https://www.uselumo.ai/workspace/lumo/projects/lumo/tasks/LUM-324'
    )
  })

  it('slugifies multi-word project names', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://www.uselumo.ai'
    expect(buildTaskUrl('acme', 'Mobile App', 'ENG', 7)).toBe(
      'https://www.uselumo.ai/workspace/acme/projects/mobile-app/tasks/ENG-7'
    )
  })

  it('falls back to localhost when NEXT_PUBLIC_APP_URL is unset', () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    expect(buildTaskUrl('lumo', 'Lumo', 'LUM', 1)).toBe(
      'http://localhost:3000/workspace/lumo/projects/lumo/tasks/LUM-1'
    )
  })
})

describe('buildTaskIdentifier', () => {
  it('joins team identifier and number', () => {
    expect(buildTaskIdentifier('LUM', 42)).toBe('LUM-42')
  })
})

describe('buildMyTasksUrl (LUM-1096)', () => {
  const original = process.env.NEXT_PUBLIC_APP_URL
  afterEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = original
  })

  it('links the My Tasks page', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://www.uselumo.ai'
    expect(buildMyTasksUrl('acme')).toBe(
      'https://www.uselumo.ai/workspace/acme/my-tasks'
    )
  })

  it('links one task under My Tasks without a project slug', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://www.uselumo.ai'
    expect(buildMyTasksUrl('acme', 'ENG-7')).toBe(
      'https://www.uselumo.ai/workspace/acme/my-tasks/ENG-7'
    )
  })
})
