import { SettingsSprintsClient } from './SettingsSprintsClient'

export default function SprintsSettingsPage() {
  return (
    <div className='h-full overflow-y-auto'>
      <div className='max-w-2xl mx-auto px-8 py-10'>
        <SettingsSprintsClient />
      </div>
    </div>
  )
}
