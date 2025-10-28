"use client"

import { Button } from "@/components/ui/button"
import { ArrowRight, Sparkles } from "lucide-react"

export function MarketingBanner() {
  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-secondary via-secondary-600 to-primary">
      {/* Background Pattern */}
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAxMCAwIEwgMCAwIDAgMTAiIGZpbGw9Im5vbmUiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS1vcGFjaXR5PSIwLjA1IiBzdHJva2Utd2lkdGg9IjEiLz48L3BhdHRlcm4+PC9kZWZzPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InVybCgjZ3JpZCkiLz48L3N2Zz4=')] opacity-50" />
      
      {/* Decorative Elements */}
      <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
      <div className="absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
      
      <div className="container relative mx-auto px-6 py-16 lg:px-8 lg:py-20">
        <div className="flex flex-col items-start gap-8 lg:flex-row lg:items-center lg:justify-between">
          {/* Content */}
          <div className="max-w-2xl space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/20 px-4 py-2 text-sm font-medium text-white backdrop-blur-sm">
              <Sparkles className="h-4 w-4" />
              <span>Exclusive Collection</span>
            </div>
            
            <h2 className="text-4xl font-bold tracking-tight text-white lg:text-5xl">
              Looking for the one?<br />
              <span className="text-white/90">It&apos;s here.</span>
            </h2>
            
            <p className="text-lg text-white/80 lg:text-xl">
              Welcome to the largest online marketplace for collectibles, gadgets, and everything you love.
            </p>
            
            <div className="flex flex-wrap gap-4">
              <Button 
                size="lg" 
                className="h-12 gap-2 bg-white text-primary hover:bg-white/90 hover:scale-105 transition-all shadow-lg hover:shadow-xl font-semibold"
              >
                Explore Collection
                <ArrowRight className="h-4 w-4" />
              </Button>
              <Button 
                size="lg" 
                variant="outline"
                className="h-12 border-white/30 bg-white/10 text-white backdrop-blur-sm hover:bg-white/20 hover:border-white/50 transition-all"
              >
                Learn More
              </Button>
            </div>
          </div>

          {/* Stats or Image Area */}
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-1">
            <div className="rounded-2xl bg-white/10 p-6 backdrop-blur-sm">
              <div className="text-3xl font-bold text-white">50K+</div>
              <div className="text-sm text-white/80">Products Available</div>
            </div>
            <div className="rounded-2xl bg-white/10 p-6 backdrop-blur-sm">
              <div className="text-3xl font-bold text-white">10K+</div>
              <div className="text-sm text-white/80">Happy Customers</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

