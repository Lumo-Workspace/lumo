"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { ArrowRight, Play, CheckCircle } from "lucide-react"

// Gradient Background Component
function GradientBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    // Set canvas dimensions
    const setCanvasDimensions = () => {
      const rect = canvas.getBoundingClientRect()
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }

    setCanvasDimensions()
    window.addEventListener("resize", setCanvasDimensions)

    // Create gradient blobs
    const blobs = Array.from({ length: 5 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      radius: Math.random() * 300 + 100,
      dx: Math.random() * 0.2 - 0.1,
      dy: Math.random() * 0.2 - 0.1,
      hue: Math.random() * 60 + 220, // Blue to purple range
    }))

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // Draw blobs
      blobs.forEach((blob) => {
        const gradient = ctx.createRadialGradient(blob.x, blob.y, 0, blob.x, blob.y, blob.radius)
        gradient.addColorStop(0, `hsla(${blob.hue}, 80%, 60%, 0.4)`)
        gradient.addColorStop(1, `hsla(${blob.hue}, 80%, 60%, 0)`)

        ctx.fillStyle = gradient
        ctx.beginPath()
        ctx.arc(blob.x, blob.y, blob.radius, 0, Math.PI * 2)
        ctx.fill()

        // Move blobs
        blob.x += blob.dx
        blob.y += blob.dy

        // Bounce off edges
        if (blob.x < 0 || blob.x > canvas.width) blob.dx *= -1
        if (blob.y < 0 || blob.y > canvas.height) blob.dy *= -1
      })

      requestAnimationFrame(animate)
    }

    animate()

    return () => {
      window.removeEventListener("resize", setCanvasDimensions)
    }
  }, [])

  return <canvas ref={canvasRef} className="fixed inset-0 w-screen h-screen -z-10 opacity-70" aria-hidden="true" />
}

// Sound Wave Animation Component
interface SoundWaveAnimationProps {
  className?: string
}

function SoundWaveAnimation({ className }: SoundWaveAnimationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    // Set canvas dimensions
    const setCanvasDimensions = () => {
      canvas.width = window.innerWidth
      canvas.height = 400
    }

    setCanvasDimensions()
    window.addEventListener("resize", setCanvasDimensions)

    // Wave parameters with refined purple color scheme and slower animation
    const waves = [
      {
        amplitude: 40,
        frequency: 0.005,
        speed: 0.02,
        color: "rgba(168, 85, 255, 0.4)",
        strokeColor: "rgba(168, 85, 255, 0.5)",
        offset: 0,
      },
      {
        amplitude: 25,
        frequency: 0.015,
        speed: 0.015,
        color: "rgba(192, 132, 252, 0.35)",
        strokeColor: "rgba(192, 132, 252, 0.5)",
        offset: 100,
      },
      {
        amplitude: 15,
        frequency: 0.025,
        speed: 0.01,
        color: "rgba(139, 92, 246, 0.3)",
        strokeColor: "rgba(139, 92, 246, 0.45)",
        offset: 200,
      },
      {
        amplitude: 30,
        frequency: 0.01,
        speed: 0.012,
        color: "rgba(124, 58, 237, 0.35)",
        strokeColor: "rgba(124, 58, 237, 0.5)",
        offset: 300,
      },
    ]

    let animationFrameId: number
    let time = 0

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      waves.forEach((wave) => {
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
      },
      time: number,
      width: number,
      height: number,
    ) => {
      const { amplitude, frequency, speed, color, strokeColor, offset } = wave
      const y = height / 2

      // First draw the filled wave
      ctx.beginPath()

      // Store the wave points to reuse for stroke
      const points: [number, number][] = []

      // Draw the top curve of the wave
      for (let x = 0; x < width; x++) {
        // Create a sine wave pattern
        const dx = x * frequency
        const sine = Math.sin(dx + time * speed + offset)
        const dy = sine * amplitude

        const point: [number, number] = [x, y + dy]
        points.push(point)

        if (x === 0) {
          ctx.moveTo(x, y + dy)
        } else {
          ctx.lineTo(x, y + dy)
        }
      }

      // Complete the path by drawing to the bottom right and back to start
      ctx.lineTo(width, height)
      ctx.lineTo(0, height)
      ctx.closePath()

      // Fill with gradient
      const gradient = ctx.createLinearGradient(0, 0, 0, height)
      gradient.addColorStop(0, color)
      gradient.addColorStop(1, "rgba(255, 255, 255, 0)")
      ctx.fillStyle = gradient
      ctx.fill()

      // Now draw just the top curve with a stroke for more visibility
      ctx.beginPath()
      points.forEach((point, index) => {
        if (index === 0) {
          ctx.moveTo(point[0], point[1])
        } else {
          ctx.lineTo(point[0], point[1])
        }
      })

      ctx.strokeStyle = strokeColor
      ctx.lineWidth = 2
      ctx.stroke()
    }

    animate()

    return () => {
      window.removeEventListener("resize", setCanvasDimensions)
      cancelAnimationFrame(animationFrameId)
    }
  }, [])

  return <canvas ref={canvasRef} className={`absolute w-full h-[400px] opacity-80 ${className}`} aria-hidden="true" />
}

interface LandingPageProps {
  onGetStarted: () => void
}

export default function LandingPage({ onGetStarted }: LandingPageProps) {
  const [isHovered, setIsHovered] = useState(false)

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Gradient Background */}
      <GradientBackground />
      
      {/* Refined Animated Wave Layers with Glow Effects */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {/* Soft purple radial glow behind title */}
        <div 
          className="absolute top-1/3 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[900px] h-[500px] opacity-50"
          style={{
            background: 'radial-gradient(circle at 50% 30%, rgba(180,100,255,0.2), transparent 60%)'
          }}
        ></div>
        
        {/* Sound Wave Animation */}
        <SoundWaveAnimation className="top-1/3 transform -translate-y-1/2" />
      </div>

      {/* Header */}
      <header className="relative z-20 px-6 py-4">
        <nav className="max-w-7xl mx-auto flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gray-800 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
              </svg>
            </div>
            <span className="text-2xl font-bold text-gray-800">Lumo</span>
          </div>

          {/* Navigation */}
          <div className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-gray-700 hover:text-purple-600 transition-colors font-medium">Features</a>
            <a href="#demo" className="text-gray-700 hover:text-purple-600 transition-colors font-medium">Demo</a>
            <a href="#pricing" className="text-gray-700 hover:text-purple-600 transition-colors font-medium">Pricing</a>
          </div>

          {/* Auth buttons */}
          <div className="flex items-center gap-3">
            <Button variant="outline" className="border-gray-300 text-gray-700 hover:bg-gray-50">
              Sign In
            </Button>
            <Button 
              onClick={onGetStarted}
              className="bg-purple-600 hover:bg-purple-700 text-white border-0 shadow-md hover:shadow-lg transition-all duration-300"
            >
              Get Started
            </Button>
          </div>
        </nav>
      </header>

      {/* Refined Hero Section */}
      <main className="relative z-20 min-h-[90vh] flex flex-col justify-center px-6 pt-16">
        <div className="max-w-6xl mx-auto text-center">
          {/* Refined Badge */}
          <div className="inline-flex items-center px-3 py-1.5 bg-[#E9D5FF] text-[#7C3AED] rounded-full text-xs font-medium mb-8 animate-fade-in-up">
            • Introducing Lumo
          </div>

          {/* Refined Main Headline */}
          <h1 className="text-6xl md:text-7xl lg:text-8xl font-extrabold mb-12 leading-[1.05] tracking-tight text-[#9A4DFF] animate-fade-in-up" style={{animationDelay: '0.2s'}}>
            AI-Powered Document & Project Management
          </h1>

          {/* Enhanced Subtitle Box */}
          <div className="max-w-2xl mx-auto mb-16 animate-fade-in-up" style={{animationDelay: '0.4s'}}>
            <div 
              className="rounded-[14px] p-8"
              style={{
                background: 'rgba(255,255,255,0.7)',
                backdropFilter: 'blur(12px)',
                boxShadow: '0 4px 40px rgba(0,0,0,0.06)'
              }}
            >
              <p className="text-xl text-gray-700 leading-relaxed">
                Streamline your workflow with intelligent document editing, collaborative project management, and AI-driven insights that help your team stay organized and productive.
              </p>
            </div>
          </div>

          {/* Refined CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2 mb-20 animate-fade-in-up" style={{animationDelay: '0.6s'}}>
            <Button 
              size="lg"
              onClick={onGetStarted}
              className="group bg-gradient-to-r from-[#A020F0] to-[#C874FF] hover:from-[#8B1FA8] hover:to-[#B85CF0] text-white px-8 py-4 text-lg font-semibold rounded-xl shadow-lg hover:shadow-xl transition-transform duration-300 hover:scale-[1.03]"
              onMouseEnter={() => setIsHovered(true)}
              onMouseLeave={() => setIsHovered(false)}
            >
              <Play className="mr-3 w-5 h-5" />
              Try Interactive Demo
            </Button>
            <Button 
              size="lg" 
              variant="outline" 
              className="bg-white border-2 border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300 px-8 py-4 text-lg font-semibold rounded-xl shadow-md hover:shadow-lg transition-all duration-300 transform hover:scale-[1.03]"
            >
              Learn More
              <ArrowRight className="ml-3 w-5 h-5" />
            </Button>
          </div>

          {/* Enhanced Features Grid */}
          <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto animate-fade-in-up" style={{animationDelay: '0.8s'}}>
            <div className="group relative bg-white/90 backdrop-blur-sm rounded-2xl p-8 shadow-xl border border-white/50 hover:shadow-2xl transition-all duration-500 transform hover:scale-105 hover:-translate-y-2">
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-pink-500/5 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
              <div className="relative">
                <div className="w-16 h-16 bg-gradient-to-br from-purple-600 to-purple-700 rounded-2xl flex items-center justify-center mb-6 mx-auto shadow-lg group-hover:shadow-purple-500/25 transition-all duration-300">
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-3 group-hover:text-purple-700 transition-colors duration-300">Smart Documents</h3>
                <p className="text-gray-600 leading-relaxed">AI-powered editing with real-time collaboration and intelligent suggestions that adapt to your writing style.</p>
              </div>
            </div>

            <div className="group relative bg-white/90 backdrop-blur-sm rounded-2xl p-8 shadow-xl border border-white/50 hover:shadow-2xl transition-all duration-500 transform hover:scale-105 hover:-translate-y-2">
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-pink-500/5 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
              <div className="relative">
                <div className="w-16 h-16 bg-gradient-to-br from-purple-600 to-purple-700 rounded-2xl flex items-center justify-center mb-6 mx-auto shadow-lg group-hover:shadow-purple-500/25 transition-all duration-300">
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-3 group-hover:text-purple-700 transition-colors duration-300">Project Management</h3>
                <p className="text-gray-600 leading-relaxed">Kanban boards, task tracking, and team collaboration in one unified workspace.</p>
              </div>
            </div>

            <div className="group relative bg-white/90 backdrop-blur-sm rounded-2xl p-8 shadow-xl border border-white/50 hover:shadow-2xl transition-all duration-500 transform hover:scale-105 hover:-translate-y-2">
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-pink-500/5 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
              <div className="relative">
                <div className="w-16 h-16 bg-gradient-to-br from-purple-600 to-purple-700 rounded-2xl flex items-center justify-center mb-6 mx-auto shadow-lg group-hover:shadow-purple-500/25 transition-all duration-300">
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-3 group-hover:text-purple-700 transition-colors duration-300">AI Insights</h3>
                <p className="text-gray-600 leading-relaxed">Get intelligent recommendations and automated progress tracking powered by advanced AI.</p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
