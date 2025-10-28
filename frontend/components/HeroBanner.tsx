"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight } from "lucide-react"

const banners = [
  {
    title: "Best Deal Online on smart watches",
    subtitle: "SMART WEARABLE.",
    description: "UP to 80% OFF",
    image: "/placeholder.svg",
    bgGradient: "from-primary-800 via-primary-900 to-primary-900",
  },
  {
    title: "NEW ARRIVALS",
    subtitle: "Spring Collection",
    description: "UP to 50% OFF",
    image: "/placeholder.svg",
    bgGradient: "from-secondary-600 via-secondary-700 to-secondary-800",
  },
  {
    title: "FLASH SALE",
    subtitle: "24 Hours Only",
    description: "UP to 70% OFF",
    image: "/placeholder.svg",
    bgGradient: "from-accent-500 via-accent-600 to-accent-700",
  },
]

export function HeroBanner() {
  const [currentSlide, setCurrentSlide] = useState(0)
  const [isAnimating, setIsAnimating] = useState(false)

  const changeSlide = (newIndex: number) => {
    if (isAnimating) return
    setIsAnimating(true)
    setCurrentSlide(newIndex)
    setTimeout(() => setIsAnimating(false), 500)
  }

  const nextSlide = () => {
    changeSlide((currentSlide + 1) % banners.length)
  }

  const prevSlide = () => {
    changeSlide((currentSlide - 1 + banners.length) % banners.length)
  }

  // Auto-advance slides
  useEffect(() => {
    const timer = setInterval(nextSlide, 5000)
    return () => clearInterval(timer)
  }, [currentSlide])

  return (
    <section className="relative w-full overflow-hidden">
      {/* Background with gradient */}
      <div 
        className={`absolute inset-0 bg-gradient-to-br ${banners[currentSlide].bgGradient} transition-all duration-700 ease-in-out`}
      />
      
      {/* Decorative overlay pattern */}
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAxMCAwIEwgMCAwIDAgMTAiIGZpbGw9Im5vbmUiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS1vcGFjaXR5PSIwLjAzIiBzdHJva2Utd2lkdGg9IjEiLz48L3BhdHRlcm4+PC9kZWZzPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InVybCgjZ3JpZCkiLz48L3N2Zz4=')] opacity-50" />

      <div className="container relative mx-auto">
        <div className="flex min-h-[400px] lg:min-h-[500px] items-center justify-between px-4 py-12 lg:px-6 lg:py-16">
          {/* Content */}
          <div className="relative z-10 max-w-2xl space-y-6 animate-fade-in">
            <div className="space-y-2">
              <p className="text-sm font-medium uppercase tracking-wider text-white/80 lg:text-base">
                {banners[currentSlide].title}
              </p>
              <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl lg:text-6xl">
                {banners[currentSlide].subtitle}
              </h1>
              <p className="text-2xl font-semibold text-white/90 lg:text-3xl">
                {banners[currentSlide].description}
              </p>
            </div>
            <Button 
              size="lg" 
              className="bg-white text-primary hover:bg-white/90 hover:scale-105 transition-all duration-200 shadow-lg hover:shadow-xl font-semibold px-8 h-12"
            >
              Shop Now
            </Button>
          </div>

          {/* Image - Hidden on mobile, shown on larger screens */}
          <div className="hidden lg:flex relative z-10 items-center justify-center">
            <div className="relative h-[350px] w-[350px] animate-scale-in">
              <div className="absolute inset-0 rounded-2xl bg-white/10 backdrop-blur-sm" />
              <img
                src={banners[currentSlide].image || "/placeholder.svg"}
                alt="Featured Product"
                className="relative h-full w-full object-contain p-12 drop-shadow-2xl"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Arrows */}
      <button
        onClick={prevSlide}
        disabled={isAnimating}
        className="absolute left-4 top-1/2 z-20 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white/30 bg-white/10 backdrop-blur-sm transition-all hover:bg-white/20 hover:border-white/50 disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label="Previous slide"
      >
        <ChevronLeft className="h-6 w-6 text-white" />
      </button>
      <button
        onClick={nextSlide}
        disabled={isAnimating}
        className="absolute right-4 top-1/2 z-20 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white/30 bg-white/10 backdrop-blur-sm transition-all hover:bg-white/20 hover:border-white/50 disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label="Next slide"
      >
        <ChevronRight className="h-6 w-6 text-white" />
      </button>

      {/* Pagination Dots */}
      <div className="absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 gap-2">
        {banners.map((_, index) => (
          <button
            key={index}
            onClick={() => changeSlide(index)}
            disabled={isAnimating}
            className={`h-2 rounded-full transition-all duration-300 ${
              index === currentSlide 
                ? "w-8 bg-white" 
                : "w-2 bg-white/40 hover:bg-white/60"
            }`}
            aria-label={`Go to slide ${index + 1}`}
          />
        ))}
      </div>
    </section>
  )
}

