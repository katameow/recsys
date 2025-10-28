"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Smartphone, Tv, Sofa, Watch, Flower, Headphones, Sparkles } from "lucide-react"

const categories = [
  { name: "Mobile", icon: Smartphone, color: "from-blue-500/10 to-blue-600/10 hover:from-blue-500/20 hover:to-blue-600/20", iconColor: "text-blue-600" },
  { name: "Cosmetics", icon: Sparkles, color: "from-pink-500/10 to-pink-600/10 hover:from-pink-500/20 hover:to-pink-600/20", iconColor: "text-pink-600" },
  { name: "Electronics", icon: Tv, color: "from-purple-500/10 to-purple-600/10 hover:from-purple-500/20 hover:to-purple-600/20", iconColor: "text-purple-600" },
  { name: "Furniture", icon: Sofa, color: "from-amber-500/10 to-amber-600/10 hover:from-amber-500/20 hover:to-amber-600/20", iconColor: "text-amber-600" },
  { name: "Watches", icon: Watch, color: "from-emerald-500/10 to-emerald-600/10 hover:from-emerald-500/20 hover:to-emerald-600/20", iconColor: "text-emerald-600" },
  { name: "Decor", icon: Flower, color: "from-rose-500/10 to-rose-600/10 hover:from-rose-500/20 hover:to-rose-600/20", iconColor: "text-rose-600" },
  { name: "Accessories", icon: Headphones, color: "from-indigo-500/10 to-indigo-600/10 hover:from-indigo-500/20 hover:to-indigo-600/20", iconColor: "text-indigo-600" },
]

export function CategoryGrid() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 lg:gap-4">
      {categories.map((category) => (
        <Card 
          key={category.name} 
          className="group relative overflow-hidden border-muted cursor-pointer transition-all duration-300 hover:border-primary/20 hover:shadow-lg hover:-translate-y-1"
        >
          <div className={`absolute inset-0 bg-gradient-to-br ${category.color} transition-all duration-300`} />
          <CardContent className="relative flex flex-col items-center justify-center gap-3 p-6 lg:p-8">
            <div className="rounded-full bg-background/50 p-3 ring-1 ring-border/50 transition-all duration-300 group-hover:scale-110 group-hover:bg-background/80">
              <category.icon className={`h-6 w-6 lg:h-7 lg:w-7 ${category.iconColor} transition-transform duration-300 group-hover:scale-110`} />
            </div>
            <span className="text-center text-xs font-semibold lg:text-sm text-foreground/90 group-hover:text-foreground">
              {category.name}
            </span>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

