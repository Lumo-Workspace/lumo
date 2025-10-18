import { Suspense } from 'react'
import ServerLandingPage from './components/server-landing-page'
import { AuroraBackground } from '@/components/ui/shadcn-io/aurora-background'

// Server Component that conditionally renders based on URL or state
export default function HomePage() {
  // For now, we'll always show the landing page
  // In a real app, you might check authentication state or URL params
  return (
    <AuroraBackground>
      <Suspense fallback={<LandingPageSkeleton />}>
        <ServerLandingPage />
      </Suspense>
    </AuroraBackground>
  )
}

// Server Component skeleton for loading state
function LandingPageSkeleton() {
  return (
    <div className='min-h-screen relative overflow-hidden bg-white'>
      <div className='relative z-20 min-h-[90vh] flex flex-col justify-center px-6 pt-16'>
        <div className='max-w-6xl mx-auto text-center'>
          <div className='inline-flex items-center px-3 py-1.5 bg-gray-200 rounded-full text-md font-large mb-8 animate-pulse'>
            <div className='w-24 h-4 bg-gray-300 rounded'></div>
          </div>
          <div className='text-6xl md:text-7xl lg:text-8xl font-extrabold mb-12 leading-[1.05] tracking-tight text-gray-300 animate-pulse'>
            <div className='w-full h-16 bg-gray-300 rounded mb-4'></div>
            <div className='w-3/4 h-16 bg-gray-300 rounded mx-auto'></div>
          </div>
          <div className='max-w-2xl mx-auto mb-16'>
            <div className='rounded-[14px] p-8 bg-gray-100 animate-pulse'>
              <div className='w-full h-6 bg-gray-300 rounded mb-2'></div>
              <div className='w-5/6 h-6 bg-gray-300 rounded mb-2'></div>
              <div className='w-4/5 h-6 bg-gray-300 rounded'></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
