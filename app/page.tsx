"use client"

import { useState } from "react"
import LandingPage from "@/components/landing-page"
import ClientMarkdownEditor from "@/components/client-markdown-editor"

export default function HomePage() {
  const [showApp, setShowApp] = useState(false)

  if (showApp) {
    return <ClientMarkdownEditor />
  }

  return <LandingPage onGetStarted={() => setShowApp(true)} />
}
