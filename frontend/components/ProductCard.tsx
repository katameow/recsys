"use client"

import { Card, CardContent, CardFooter } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Heart, ShoppingCart, Star } from "lucide-react"
import { useState } from "react"

interface ProductCardProps {
  title: string
  price: number
  originalPrice: number
  image: string
  discount: number
  rating?: number
}

export function ProductCard({ title, price, originalPrice, image, discount, rating = 4.0 }: ProductCardProps) {
  const [isWishlisted, setIsWishlisted] = useState(false)

  return (
    <Card className="group relative overflow-hidden border-muted transition-all duration-300 hover:border-primary/20 hover:shadow-xl">
      {/* Product Image */}
      <CardContent className="relative aspect-square overflow-hidden bg-muted/30 p-0">
        <img
          src={image || "/placeholder.svg"}
          alt={title}
          className="h-full w-full object-contain p-4 transition-transform duration-500 group-hover:scale-110"
        />
        
        {/* Discount Badge */}
        {discount > 0 && (
          <Badge className="absolute left-3 top-3 bg-secondary hover:bg-secondary font-semibold shadow-lg">
            {discount}% OFF
          </Badge>
        )}
        
        {/* Wishlist Button */}
        <Button
          size="icon"
          variant="ghost"
          className={`absolute right-3 top-3 h-9 w-9 rounded-full bg-background/80 backdrop-blur-sm opacity-0 transition-all duration-300 group-hover:opacity-100 hover:bg-background ${
            isWishlisted ? "text-red-500" : ""
          }`}
          onClick={(e) => {
            e.preventDefault()
            setIsWishlisted(!isWishlisted)
          }}
        >
          <Heart className={`h-4 w-4 ${isWishlisted ? "fill-current" : ""}`} />
        </Button>

        {/* Quick Add to Cart - Shows on hover */}
        <div className="absolute inset-x-0 bottom-0 translate-y-full bg-gradient-to-t from-black/60 to-transparent p-4 transition-transform duration-300 group-hover:translate-y-0">
          <Button 
            size="sm" 
            className="w-full gap-2 bg-white text-primary hover:bg-white/90 font-semibold shadow-lg"
            onClick={(e) => e.preventDefault()}
          >
            <ShoppingCart className="h-4 w-4" />
            Add to Cart
          </Button>
        </div>
      </CardContent>

      {/* Product Info */}
      <CardFooter className="flex flex-col items-start gap-2 p-4">
        <h3 className="line-clamp-2 text-sm font-semibold leading-tight group-hover:text-primary transition-colors">
          {title}
        </h3>
        
        {/* Rating */}
        <div className="flex items-center gap-1">
          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
          <span className="text-xs font-medium text-muted-foreground">{rating}</span>
        </div>

        {/* Pricing */}
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-bold text-foreground">
            ${price.toFixed(2)}
          </span>
          {originalPrice > price && (
            <span className="text-sm text-muted-foreground line-through">
              ${originalPrice.toFixed(2)}
            </span>
          )}
        </div>
      </CardFooter>
    </Card>
  )
}

