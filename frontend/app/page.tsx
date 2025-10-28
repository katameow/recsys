"use client"

import { useState } from "react"
import { Header } from "@/components/Header"
import { Sidebar } from "@/components/Sidebar"
import { HeroBanner } from "@/components/HeroBanner"
import { CategoryGrid } from "@/components/CategoryGrid"
import { ProductGrid } from "@/components/ProductGrid"
import { ChatboxOverlay } from "@/components/ChatboxOverlay"
import { MaximizedChatbox } from "@/components/MaximizedChatbox"
import { MarketingBanner } from "@/components/MarketingBanner"
import { redirect } from "next/navigation"

export default function Home() {
  // Redirect to login page for now
  // redirect("/login")
  const [isChatboxOpen, setIsChatboxOpen] = useState(false)
  const [isChatboxMaximized, setIsChatboxMaximized] = useState(false)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  // Handler when opening the small overlay chatbox (used by the overlay itself)
  const handleOpenOverlayChatbox = () => {
    setIsChatboxOpen(true)
  }

  // Handler for the Header button: open the maximized chatbox directly
  const handleOpenMaximizedFromHeader = () => {
    setIsChatboxMaximized(true)
  }

  return (
    <div className="min-h-screen bg-background">
      <Header onOpenChatbox={handleOpenMaximizedFromHeader} onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)} />
      <Sidebar isOpen={isSidebarOpen} />
      
      <main className={`transition-all duration-300 ${isSidebarOpen ? "lg:ml-72" : ""}`}>
        {/* Hero Section */}
        <HeroBanner />

        {/* Main Content Container */}
        <div className="container mx-auto space-y-16 px-4 py-12 lg:space-y-20 lg:py-16">
          {/* Categories Section */}
          <section className="animate-slide-up">
            <div className="mb-6 space-y-2">
              <h2 className="text-2xl font-bold tracking-tight lg:text-3xl">
                Shop From Top Categories
              </h2>
              <p className="text-muted-foreground">
                Browse our curated selection of product categories
              </p>
            </div>
            <CategoryGrid />
          </section>

          {/* Featured Products Section */}
          <section className="animate-slide-up animation-delay-200">
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-2">
                <h2 className="text-2xl font-bold tracking-tight lg:text-3xl">
                  Grab the best deal on Smartphones
                </h2>
                <p className="text-muted-foreground">
                  Top-rated phones at unbeatable prices
                </p>
              </div>
              <a 
                href="#" 
                className="group inline-flex items-center gap-2 text-sm font-semibold text-secondary transition-colors hover:text-secondary/80"
              >
                View All
                <svg 
                  className="h-4 w-4 transition-transform group-hover:translate-x-1" 
                  fill="none" 
                  viewBox="0 0 24 24" 
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </a>
            </div>
            <ProductGrid />
          </section>

          {/* Marketing Banner Section */}
          <section className="animate-slide-up animation-delay-400">
            <MarketingBanner />
          </section>

          {/* Additional Featured Section (placeholder for future content) */}
          <section className="animate-slide-up animation-delay-600">
            <div className="rounded-2xl border bg-gradient-to-br from-muted/50 to-muted/30 p-8 text-center lg:p-12">
              <h3 className="mb-4 text-2xl font-bold lg:text-3xl">
                Discover More Amazing Products
              </h3>
              <p className="mx-auto mb-6 max-w-2xl text-muted-foreground lg:text-lg">
                Explore thousands of products across all categories. Find exactly what you&apos;re looking for with our AI-powered shopping assistant.
              </p>
              <button 
                onClick={handleOpenMaximizedFromHeader}
                className="inline-flex items-center gap-2 rounded-full bg-secondary px-6 py-3 font-semibold text-secondary-foreground transition-all hover:scale-105 hover:bg-secondary/90 hover:shadow-lg"
              >
                Chat with AI Assistant
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </button>
            </div>
          </section>
        </div>

        {/* Footer spacer */}
        <div className="h-20" />
      </main>

      {/* Chat Components */}
      <ChatboxOverlay
        onClose={() => setIsChatboxOpen(false)}
        onMaximize={() => setIsChatboxMaximized(true)}
        isOpen={isChatboxOpen}
        onOpen={handleOpenOverlayChatbox}
      />
      {isChatboxMaximized && <MaximizedChatbox onMinimize={() => setIsChatboxMaximized(false)} />}
    </div>
  )
}

