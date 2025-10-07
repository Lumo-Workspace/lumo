'use client'

import { use, Suspense } from 'react'
import ErrorBoundary from '@/components/error-boundary'
import { Skeleton } from '@/components/ui/skeleton'

// Types for our data
interface Post {
  id: number
  title: string
  body: string
  userId: number
}

interface User {
  id: number
  name: string
  email: string
  username: string
}

// Promise-based data fetchers (simulating API calls)
async function fetchPosts(): Promise<Post[]> {
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 1000))

  return [
    {
      id: 1,
      title: 'React 19 is Amazing',
      body: 'The new use() hook and Actions make data fetching so much easier!',
      userId: 1,
    },
    {
      id: 2,
      title: 'Server Components Rock',
      body: 'Server Components provide better performance and SEO out of the box.',
      userId: 2,
    },
    {
      id: 3,
      title: 'TypeScript + React 19',
      body: 'TypeScript support in React 19 is even better with improved type inference.',
      userId: 1,
    },
  ]
}

async function fetchUser(userId: number): Promise<User> {
  await new Promise(resolve => setTimeout(resolve, 800))

  const users: Record<number, User> = {
    1: {
      id: 1,
      name: 'John Doe',
      email: 'john@example.com',
      username: 'johndoe',
    },
    2: {
      id: 2,
      name: 'Jane Smith',
      email: 'jane@example.com',
      username: 'janesmith',
    },
  }

  return (
    users[userId] || {
      id: userId,
      name: 'Unknown User',
      email: 'unknown@example.com',
      username: 'unknown',
    }
  )
}

// Component using use() hook for posts
function PostsList() {
  // The use() hook can be called conditionally and handles promises
  const posts = use(fetchPosts())

  return (
    <div className='space-y-4'>
      <h2 className='text-2xl font-bold text-gray-900'>Posts</h2>
      {posts.map(post => (
        <PostCard key={post.id} post={post} />
      ))}
    </div>
  )
}

// Component using use() hook for user data
function PostCard({ post }: { post: Post }) {
  // This will suspend until the user data is loaded
  const user = use(fetchUser(post.userId))

  return (
    <div className='bg-white rounded-lg shadow-md p-6 border border-gray-200'>
      <div className='flex items-start justify-between mb-3'>
        <h3 className='text-lg font-semibold text-gray-900'>{post.title}</h3>
        <div className='text-sm text-gray-500'>
          by {user.name} (@{user.username})
        </div>
      </div>
      <p className='text-gray-700 leading-relaxed'>{post.body}</p>
      <div className='mt-3 text-xs text-gray-500'>
        User ID: {post.userId} | Post ID: {post.id}
      </div>
    </div>
  )
}

// Loading component for Suspense
function PostsLoading() {
  return (
    <div className='space-y-4'>
      <Skeleton className='h-8 w-full' />
      {[1, 2, 3].map(i => (
        <div
          key={i}
          className='bg-white rounded-lg shadow-md p-6 border border-gray-200'
        >
          <div className='flex items-start justify-between mb-3'>
            <Skeleton className='h-6 w-3/4' />
            <Skeleton className='h-4 w-1/4' />
          </div>
          <div className='space-y-2'>
            <Skeleton className='h-4 w-full' />
            <Skeleton className='h-4 w-5/6' />
          </div>
          <Skeleton className='mt-3 h-3 w-1/3' />
        </div>
      ))}
    </div>
  )
}

// Error boundary for use() hook errors
function PostsError({ error }: { error: Error }) {
  console.error('PostsError:', error)
  return (
    <div className='bg-red-50 border border-red-200 rounded-lg p-6'>
      <h2 className='text-lg font-semibold text-red-800 mb-2'>
        Error Loading Posts
      </h2>
      <p className='text-red-700'>{error.message}</p>
    </div>
  )
}

// Main component demonstrating use() hook
export default function UseHookDemo() {
  return (
    <div className='min-h-screen bg-gray-50 py-8'>
      <div className='max-w-4xl mx-auto px-4'>
        <div className='text-center mb-8'>
          <h1 className='text-3xl font-bold text-gray-900 mb-2'>
            React 19 use() Hook Demo
          </h1>
          <p className='text-gray-600'>
            Demonstrating the new use() hook for data fetching with Suspense
          </p>
        </div>

        <div className='bg-white rounded-lg shadow-lg p-8'>
          <ErrorBoundary
            fallback={<PostsError error={new Error('Failed to load posts')} />}
          >
            <Suspense fallback={<PostsLoading />}>
              <PostsList />
            </Suspense>
          </ErrorBoundary>
        </div>

        <div className='mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6'>
          <h3 className='text-lg font-semibold text-blue-800 mb-2'>
            Key Features of use() Hook:
          </h3>
          <ul className='text-blue-700 space-y-1'>
            <li>• Can be called conditionally (unlike other hooks)</li>
            <li>• Works with Promises and Context</li>
            <li>• Integrates seamlessly with Suspense</li>
            <li>• Provides better error handling</li>
            <li>• Enables more flexible data fetching patterns</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
