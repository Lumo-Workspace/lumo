import { Session } from 'next-auth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'

interface UserProfileContentProps {
  session: Session | null
  className?: string
  showPreferences?: boolean
  showSettings?: boolean
}

export function UserProfileContent({
  session,
  className,
  showPreferences = false,
  showSettings = false,
}: UserProfileContentProps) {
  if (!session?.user) {
    return (
      <Card className={className}>
        <CardContent className='p-6'>
          <p className='text-muted-foreground'>Unable to load user profile.</p>
        </CardContent>
      </Card>
    )
  }

  const user = session.user
  const initials = user.name
    ? user.name
        .split(' ')
        .map(n => n[0])
        .join('')
        .toUpperCase()
    : user.email?.charAt(0).toUpperCase() || 'U'

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className='flex items-center space-x-3'>
          <Avatar className='h-12 w-12'>
            <AvatarImage
              src={user.image || undefined}
              alt={user.name || 'User'}
            />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div>
            <h3 className='text-lg font-semibold'>{user.name || 'User'}</h3>
            <p className='text-sm text-muted-foreground'>{user.email}</p>
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className='space-y-4'>
        <div className='grid grid-cols-2 gap-4'>
          <div>
            <p className='text-sm font-medium text-muted-foreground'>User ID</p>
            <p className='text-sm font-mono'>{(user as any).id || 'N/A'}</p>
          </div>
          <div>
            <p className='text-sm font-medium text-muted-foreground'>Status</p>
            <Badge variant='secondary' className='mt-1'>
              Active
            </Badge>
          </div>
        </div>

        {showPreferences && (
          <div>
            <h4 className='text-sm font-medium text-muted-foreground mb-2'>
              Preferences
            </h4>
            <div className='space-y-2'>
              <div className='flex justify-between text-sm'>
                <span>Theme</span>
                <span className='text-muted-foreground'>System</span>
              </div>
              <div className='flex justify-between text-sm'>
                <span>Notifications</span>
                <span className='text-muted-foreground'>Enabled</span>
              </div>
              <div className='flex justify-between text-sm'>
                <span>Language</span>
                <span className='text-muted-foreground'>English</span>
              </div>
            </div>
          </div>
        )}

        {showSettings && (
          <div>
            <h4 className='text-sm font-medium text-muted-foreground mb-2'>
              Settings
            </h4>
            <div className='space-y-2'>
              <div className='flex justify-between text-sm'>
                <span>Timezone</span>
                <span className='text-muted-foreground'>UTC</span>
              </div>
              <div className='flex justify-between text-sm'>
                <span>Date Format</span>
                <span className='text-muted-foreground'>MM/DD/YYYY</span>
              </div>
              <div className='flex justify-between text-sm'>
                <span>Time Format</span>
                <span className='text-muted-foreground'>12 Hour</span>
              </div>
            </div>
          </div>
        )}

        <div className='pt-4 border-t'>
          <div className='flex justify-between text-sm text-muted-foreground'>
            <span>Last Updated</span>
            <span>{new Date().toLocaleDateString()}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
