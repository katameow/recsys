"use client"

import { useState } from "react"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Checkbox } from "@/components/ui/checkbox"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Shirt, Tv, Home, Smile, Dumbbell, Star } from "lucide-react"

const categories = [
  { name: "Fashion", icon: Shirt },
  { name: "Electronics", icon: Tv },
  { name: "Home & Kitchen", icon: Home },
  { name: "Beauty", icon: Smile },
  { name: "Sports & Outdoors", icon: Dumbbell },
]

const brands = ["Brand A", "Brand B", "Brand C", "Brand D"]
const features = ["Feature 1", "Feature 2", "Feature 3", "Feature 4"]

interface SidebarProps {
  isOpen: boolean
}

export function Sidebar({ isOpen }: SidebarProps) {
  const [priceRange, setPriceRange] = useState([0, 1000])
  const [openSections, setOpenSections] = useState<string[]>(["categories", "price"])

  const toggleSection = (section: string) => {
    setOpenSections((prev) => (prev.includes(section) ? prev.filter((s) => s !== section) : [...prev, section]))
  }

  return (
    <aside
      className={`fixed left-0 top-0 z-40 h-screen w-72 border-r bg-background shadow-lg transition-transform duration-300 ease-in-out ${isOpen ? "translate-x-0" : "-translate-x-full"}`}
    >
      <div className="flex h-full flex-col">
        <div className="border-b bg-muted/30 px-6 py-4">
          <h2 className="text-lg font-semibold">Filter Products</h2>
          <p className="text-xs text-muted-foreground mt-1">Refine your search</p>
        </div>
        
        <div className="flex-1 overflow-y-auto px-4 py-4">{/* Scrollable content area */}

      <Accordion type="multiple" value={openSections} className="w-full space-y-2">
        <AccordionItem value="categories" className="rounded-lg border bg-background px-4">
          <AccordionTrigger 
            onClick={() => toggleSection("categories")}
            className="hover:no-underline py-4"
          >
            <span className="font-semibold">Categories</span>
          </AccordionTrigger>
          <AccordionContent className="pb-4">
            <div className="space-y-3">
              {categories.map((category) => (
                <div key={category.name} className="flex items-center space-x-3 rounded-md px-2 py-2 hover:bg-muted/50 transition-colors">
                  <Checkbox id={`category-${category.name}`} />
                  <Label 
                    htmlFor={`category-${category.name}`} 
                    className="flex flex-1 items-center cursor-pointer text-sm"
                  >
                    <category.icon className="h-4 w-4 mr-2 text-primary" />
                    {category.name}
                  </Label>
                </div>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="price" className="rounded-lg border bg-background px-4">
          <AccordionTrigger 
            onClick={() => toggleSection("price")}
            className="hover:no-underline py-4"
          >
            <span className="font-semibold">Price Range</span>
          </AccordionTrigger>
          <AccordionContent className="pb-4">
            <div className="space-y-4 px-2">
              <Slider 
                min={0} 
                max={1000} 
                step={10} 
                value={priceRange} 
                onValueChange={setPriceRange}
                className="py-4"
              />
              <div className="flex justify-between rounded-lg bg-muted/50 px-4 py-2">
                <span className="text-sm font-semibold">${priceRange[0]}</span>
                <span className="text-xs text-muted-foreground">to</span>
                <span className="text-sm font-semibold">${priceRange[1]}</span>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="brand" className="rounded-lg border bg-background px-4">
          <AccordionTrigger 
            onClick={() => toggleSection("brand")}
            className="hover:no-underline py-4"
          >
            <span className="font-semibold">Brand</span>
          </AccordionTrigger>
          <AccordionContent className="pb-4">
            <div className="space-y-3">
              {brands.map((brand) => (
                <div key={brand} className="flex items-center space-x-3 rounded-md px-2 py-2 hover:bg-muted/50 transition-colors">
                  <Checkbox id={brand} />
                  <Label htmlFor={brand} className="flex-1 cursor-pointer text-sm">{brand}</Label>
                </div>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="features" className="rounded-lg border bg-background px-4">
          <AccordionTrigger 
            onClick={() => toggleSection("features")}
            className="hover:no-underline py-4"
          >
            <span className="font-semibold">Features</span>
          </AccordionTrigger>
          <AccordionContent className="pb-4">
            <div className="space-y-3">
              {features.map((feature) => (
                <div key={feature} className="flex items-center space-x-3 rounded-md px-2 py-2 hover:bg-muted/50 transition-colors">
                  <Checkbox id={feature} />
                  <Label htmlFor={feature} className="flex-1 cursor-pointer text-sm">{feature}</Label>
                </div>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="rating" className="rounded-lg border bg-background px-4">
          <AccordionTrigger 
            onClick={() => toggleSection("rating")}
            className="hover:no-underline py-4"
          >
            <span className="font-semibold">User Rating</span>
          </AccordionTrigger>
          <AccordionContent className="pb-4">
            <div className="space-y-3">
              {[4, 3, 2, 1].map((rating) => (
                <div key={rating} className="flex items-center space-x-3 rounded-md px-2 py-2 hover:bg-muted/50 transition-colors">
                  <Checkbox id={`rating-${rating}`} />
                  <Label htmlFor={`rating-${rating}`} className="flex flex-1 items-center cursor-pointer text-sm">
                    <div className="flex items-center gap-1">
                      {Array(rating)
                        .fill(0)
                        .map((_, i) => (
                          <Star key={i} className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                        ))}
                      {Array(5 - rating)
                        .fill(0)
                        .map((_, i) => (
                          <Star key={i} className="h-3.5 w-3.5 text-muted-foreground/30" />
                        ))}
                    </div>
                    <span className="ml-2">& Up</span>
                  </Label>
                </div>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
        </div>
      </div>
    </aside>
  )
}

