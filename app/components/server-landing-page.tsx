import { Suspense } from 'react'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { ArrowRight } from 'lucide-react'
import {
  ClientSoundWaveAnimation,
  ClientGetStartedButton,
  ClientTryDemoButton,
} from './client-landing-page'

// Server Component - handles static content and metadata
export default function ServerLandingPage() {
  return (
    <div className='min-h-screen relative overflow-hidden bg-white'>
      {/* Gradient Background - Server Component */}
      <GradientBackground />

      {/* Refined Animated Wave Layers with Glow Effects */}
      <div className='absolute inset-0 pointer-events-none overflow-hidden'>
        {/* Soft purple radial glow behind title */}
        <div
          className='absolute top-1/3 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[900px] h-[500px] opacity-25'
          style={{
            background:
              'radial-gradient(circle at 50% 30%, rgba(180,100,255,0.05), transparent 60%)',
          }}
        ></div>

        {/* Sound Wave Animation - Client Component */}
        <Suspense
          fallback={
            <div className='absolute bottom-1/4 transform translate-y-1/2 w-full h-[200px]' />
          }
        >
          <ClientSoundWaveAnimation className='bottom-1/4 transform translate-y-1/2' />
        </Suspense>
      </div>

      {/* Header - Server Component */}
      <header className='relative z-20 px-6 py-4'>
        <nav className='max-w-7xl mx-auto flex items-center justify-between'>
          {/* Logo */}
          <div className='flex items-center gap-3'>
            <Image
              src='/logo-light.svg'
              alt='Lumo Logo'
              width={32}
              height={32}
              className='w-8 h-8'
            />
            <span className='text-2xl font-bold text-gray-800'>Lumo</span>
          </div>

          {/* Navigation */}
          <div className='hidden md:flex items-center gap-8'>
            <a
              href='#features'
              className='text-gray-700 hover:text-purple-600 transition-colors font-medium'
            >
              Features
            </a>
            <a
              href='#demo'
              className='text-gray-700 hover:text-purple-600 transition-colors font-medium'
            >
              Demo
            </a>
            <a
              href='#pricing'
              className='text-gray-700 hover:text-purple-600 transition-colors font-medium'
            >
              Pricing
            </a>
          </div>

          {/* Auth buttons */}
          <div className='flex items-center gap-3'>
            <Button
              variant='outline'
              className='border-gray-300 text-gray-700 hover:bg-gray-50 hover:text-gray-700'
              asChild
            >
              <a href='/login'>Sign In</a>
            </Button>
            <ClientGetStartedButton />
          </div>
        </nav>
      </header>

      {/* Refined Hero Section - Server Component */}
      <main className='relative z-20 min-h-[90vh] flex flex-col justify-center px-6 pt-16'>
        <div className='max-w-6xl mx-auto text-center'>
          {/* Refined Badge */}
          <div className='inline-flex items-center px-3 py-1.5 bg-[#E9D5FF] text-[#7C3AED] rounded-full text-md font-large mb-8 animate-fade-in-up'>
            Introducing Lumo
          </div>

          {/* Refined Main Headline */}
          <h1
            className='text-6xl md:text-7xl lg:text-8xl font-extrabold mb-12 leading-[1.05] tracking-tight text-[#9A4DFF] animate-fade-in-up'
            style={{ animationDelay: '0.2s' }}
          >
            AI-Powered Document & Project Management
          </h1>

          {/* Enhanced Subtitle Box */}
          <div
            className='max-w-2xl mx-auto mb-16 animate-fade-in-up'
            style={{ animationDelay: '0.4s' }}
          >
            <div
              className='rounded-[14px] p-8'
              style={{
                background: 'rgba(255,255,255,0.7)',
                backdropFilter: 'blur(12px)',
                boxShadow: '0 4px 40px rgba(0,0,0,0.06)',
              }}
            >
              <p className='text-xl text-gray-700 leading-relaxed'>
                Streamline your workflow with intelligent document editing,
                collaborative project management, and AI-driven insights that
                help your team stay organized and productive.
              </p>
            </div>
          </div>

          {/* Refined CTA Buttons */}
          <div
            className='flex flex-col sm:flex-row items-center justify-center gap-2 mb-20 animate-fade-in-up'
            style={{ animationDelay: '0.6s' }}
          >
            <ClientTryDemoButton />
            <Button
              size='lg'
              variant='outline'
              className='bg-white border-2 border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-700 px-8 py-4 text-lg font-semibold rounded-xl shadow-md hover:shadow-lg transition-all duration-300 transform hover:scale-[1.03]'
            >
              Learn More
              <ArrowRight className='ml-3 w-5 h-5' />
            </Button>
          </div>

          {/* Enhanced Features Grid - Server Component */}
          <div
            className='grid md:grid-cols-3 gap-8 max-w-6xl mx-auto animate-fade-in-up'
            style={{ animationDelay: '0.8s' }}
          >
            <FeatureCard
              icon={
                <svg
                  className='w-8 h-8 text-white'
                  fill='none'
                  stroke='currentColor'
                  viewBox='0 0 24 24'
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z'
                  />
                </svg>
              }
              title='Smart Documents'
              description='AI-powered editing with real-time collaboration and intelligent suggestions that adapt to your writing style.'
            />
            <FeatureCard
              icon={
                <svg
                  className='w-8 h-8 text-white'
                  fill='none'
                  stroke='currentColor'
                  viewBox='0 0 24 24'
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z'
                  />
                </svg>
              }
              title='Project Management'
              description='Kanban boards, task tracking, and team collaboration in one unified workspace.'
            />
            <FeatureCard
              icon={
                <svg
                  className='w-8 h-8 text-white'
                  fill='none'
                  stroke='currentColor'
                  viewBox='0 0 24 24'
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M13 10V3L4 14h7v7l9-11h-7z'
                  />
                </svg>
              }
              title='AI Insights'
              description='Get intelligent recommendations and automated progress tracking powered by advanced AI.'
            />
          </div>
        </div>
      </main>
    </div>
  )
}

// Server Component for gradient background
function GradientBackground() {
  return (
    <div
      className='fixed inset-0 w-screen h-screen -z-10 opacity-40'
      style={{
        background: `
          radial-gradient(circle at 20% 50%, rgba(147, 51, 234, 0.03) 0%, transparent 50%),
          radial-gradient(circle at 80% 20%, rgba(168, 85, 255, 0.02) 0%, transparent 50%),
          radial-gradient(circle at 40% 80%, rgba(196, 132, 252, 0.015) 0%, transparent 50%),
          radial-gradient(circle at 0% 100%, rgba(233, 213, 255, 0.01) 0%, transparent 50%)
        `,
      }}
      aria-hidden='true'
    />
  )
}

// Server Component for feature cards
function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <div className='group relative bg-white/90 backdrop-blur-sm rounded-2xl p-8 shadow-xl border border-white/50 hover:shadow-2xl transition-all duration-500 transform hover:scale-105 hover:-translate-y-2'>
      <div className='absolute inset-0 bg-gradient-to-br from-purple-500/5 to-pink-500/5 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500'></div>
      <div className='relative'>
        <div className='w-16 h-16 bg-gradient-to-br from-purple-600 to-purple-700 rounded-2xl flex items-center justify-center mb-6 mx-auto shadow-lg group-hover:shadow-purple-500/25 transition-all duration-300'>
          {icon}
        </div>
        <h3 className='text-xl font-bold text-gray-900 mb-3 group-hover:text-purple-700 transition-colors duration-300'>
          {title}
        </h3>
        <p className='text-gray-600 leading-relaxed'>{description}</p>
      </div>
    </div>
  )
}
