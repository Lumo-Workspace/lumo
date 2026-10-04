import { auth } from '@clerk/nextjs/server'
import { getUserWorkspace } from '@/lib/auth'
import { TaskTemplatesSettingsPage } from '../../components/pages/TaskTemplatesSettingsPage'

/** LUM-970: workspace task templates. Everyone reads; OWNERs edit. */
export default async function TaskTemplatesPage() {
  const { userId } = await auth()
  const ws = userId ? await getUserWorkspace(userId) : null
  return <TaskTemplatesSettingsPage canManage={ws?.member.role === 'OWNER'} />
}
