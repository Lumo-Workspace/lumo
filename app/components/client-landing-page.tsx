'use client'

import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Play } from 'lucide-react'

// Client Component for interactive sound wave animation
interface ClientSoundWaveAnimationProps {
  className?: string
}

export function ClientSoundWaveAnimation({
  className,
}: ClientSoundWaveAnimationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set canvas dimensions
    const setCanvasDimensions = () => {
      canvas.width = window.innerWidth
      canvas.height = 200
    }

    setCanvasDimensions()
    window.addEventListener('resize', setCanvasDimensions)

    // Wave parameters for horizontal flowing waves with lower opacity
    const waves = [
      {
        amplitude: 25,
        frequency: 0.008,
        speed: 0.015,
        color: 'rgba(124, 58, 237, 0.03)',
        strokeColor: 'rgba(124, 58, 237, 0.06)',
        offset: 0,
        yOffset: 0,
      },
      {
        amplitude: 18,
        frequency: 0.012,
        speed: 0.012,
        color: 'rgba(109, 40, 217, 0.025)',
        strokeColor: 'rgba(109, 40, 217, 0.05)',
        offset: 150,
        yOffset: 15,
      },
      {
        amplitude: 12,
        frequency: 0.016,
        speed: 0.008,
        color: 'rgba(91, 33, 182, 0.02)',
        strokeColor: 'rgba(91, 33, 182, 0.04)',
        offset: 300,
        yOffset: 30,
      },
      {
        amplitude: 20,
        frequency: 0.01,
        speed: 0.01,
        color: 'rgba(124, 58, 237, 0.025)',
        strokeColor: 'rgba(124, 58, 237, 0.05)',
        offset: 450,
        yOffset: -10,
      },
      {
        amplitude: 15,
        frequency: 0.014,
        speed: 0.009,
        color: 'rgba(109, 40, 217, 0.02)',
        strokeColor: 'rgba(109, 40, 217, 0.04)',
        offset: 600,
        yOffset: 25,
      },
    ]

    let animationFrameId: number
    let time = 0

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      waves.forEach(wave => {
        drawWave(ctx, wave, time, canvas.width, canvas.height)
      })

      time += 0.03
      animationFrameId = requestAnimationFrame(animate)
    }

    const drawWave = (
      ctx: CanvasRenderingContext2D,
      wave: {
        amplitude: number
        frequency: number
        speed: number
        color: string
        strokeColor: string
        offset: number
        yOffset: number
      },
      time: number,
      width: number,
      height: number
    ) => {
      const { amplitude, frequency, speed, strokeColor, offset, yOffset } = wave
      const y = height / 2 + yOffset

      // Draw smooth horizontal wave lines
      ctx.beginPath()

      for (let x = 0; x < width; x++) {
        // Create a smooth sine wave pattern
        const dx = x * frequency
        const sine = Math.sin(dx + time * speed + offset)
        const dy = sine * amplitude

        const pointX = x
        const pointY = y + dy

        if (x === 0) {
          ctx.moveTo(pointX, pointY)
        } else {
          ctx.lineTo(pointX, pointY)
        }
      }

      // Set stroke style for the wave line
      ctx.strokeStyle = strokeColor
      ctx.lineWidth = 1.5
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.stroke()
    }

    animate()

    return () => {
      window.removeEventListener('resize', setCanvasDimensions)
      cancelAnimationFrame(animationFrameId)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className={`absolute w-full h-[200px] opacity-20 ${className}`}
      aria-hidden='true'
    />
  )
}

// Client Component for Get Started button with state
export function ClientGetStartedButton() {
  const handleGetStarted = () => {
    // This will be handled by the parent component
    window.location.href = '/app'
  }

  return (
    <Button
      onClick={handleGetStarted}
      className='bg-purple-600 hover:bg-purple-700 text-white border-0 shadow-md hover:shadow-lg transition-all duration-300'
    >
      Get Started
    </Button>
  )
}

// Client Component for Try Demo button with state
export function ClientTryDemoButton() {
  const handleTryDemo = () => {
    // This will be handled by the parent component
    window.location.href = '/app'
  }

  return (
    <Button
      size='lg'
      onClick={handleTryDemo}
      className='group bg-gradient-to-r from-[#A020F0] to-[#C874FF] hover:from-[#8B1FA8] hover:to-[#B85CF0] text-white px-8 py-4 text-lg font-semibold rounded-xl shadow-lg hover:shadow-xl transition-transform duration-300 hover:scale-[1.03]'
    >
      <Play className='mr-3 w-5 h-5' />
      Try Interactive Demo
    </Button>
  )
}
