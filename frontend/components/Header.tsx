"use client"

import Link from "next/link"
import Image from "next/image"
import { Suspense } from "react"
import { Search, ShoppingCart, MessageCircle, ChevronDown, Loader2, ShieldCheck, Menu } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { AuthButton } from "@/components/auth/AuthButton"
import { useAuthStore } from "@/lib/auth-store"

// Import icons for categories
import { Shirt, Home, Tv, Smile, Dumbbell } from "lucide-react"

const categories = [
  { name: "Fashion", icon: Shirt },
  { name: "Home & Kitchen", icon: Home },
  { name: "Electronics", icon: Tv },
  { name: "Beauty", icon: Smile },
  { name: "Sports", icon: Dumbbell },
]

interface HeaderProps {
  onOpenChatbox: () => void
  onToggleSidebar: () => void
}

export function Header({ onOpenChatbox, onToggleSidebar }: HeaderProps) {
  const role = useAuthStore((state) => state.user?.role)

  return (
    <header className="w-full border-b bg-background shadow-sm">
      <div className="container mx-auto">
        {/* Top Bar */}
        <div className="flex h-16 items-center justify-between gap-4 px-4 lg:px-6">
          {/* Left Section - Menu & Logo */}
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={onToggleSidebar} 
              className="lg:mr-2 hover:bg-muted transition-colors"
              aria-label="Toggle sidebar"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <Link href="/" className="flex items-center gap-2 transition-opacity hover:opacity-80">
              <Image 
                src="/favicon.ico" 
                alt="MegaMart Logo" 
                width={32} 
                height={32} 
                className="h-8 w-8" 
              />
              <span className="hidden font-bold text-xl sm:inline-block bg-gradient-to-r from-primary to-primary/80 bg-clip-text text-transparent">
                MegaMart
              </span>
            </Link>
          </div>

          {/* Center Section - Search Bar */}
          <div className="hidden md:flex flex-1 max-w-2xl">
            <div className="relative w-full group">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground transition-colors group-focus-within:text-primary" />
              <Input 
                type="search" 
                placeholder="Search essentials, groceries and more..." 
                className="w-full pl-10 pr-4 h-10 bg-muted/50 border-muted-foreground/20 focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-primary/20 transition-all"
              />
            </div>
          </div>

          {/* Right Section - Actions */}
          <div className="flex items-center gap-1 lg:gap-2">
            <Suspense
              fallback={
                <Button variant="ghost" size="sm" className="gap-2" disabled>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="hidden lg:inline">Loading</span>
                </Button>
              }
            >
              <AuthButton />
            </Suspense>
            
            {role === "admin" && (
              <Button
                asChild
                variant="outline"
                size="sm"
                className="gap-2 hover:bg-muted transition-colors"
                data-testid="admin-console-button"
              >
                <Link href="/admin" className="flex items-center">
                  <ShieldCheck className="h-4 w-4" />
                  <span className="hidden lg:inline">Admin</span>
                </Link>
              </Button>
            )}
            
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={onOpenChatbox}
              className="relative hover:bg-muted transition-colors"
              aria-label="Open chat assistant"
            >
              <MessageCircle className="h-5 w-5" />
            </Button>
            
            <Button 
              variant="ghost" 
              size="icon"
              className="relative hover:bg-muted transition-colors"
              aria-label="Shopping cart"
            >
              <ShoppingCart className="h-5 w-5" />
              <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-secondary text-[10px] font-bold text-secondary-foreground flex items-center justify-center">
                0
              </span>
            </Button>
          </div>
        </div>

        {/* Mobile Search */}
        <div className="md:hidden px-4 pb-3">
          <div className="relative w-full group">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              type="search" 
              placeholder="Search products..." 
              className="w-full pl-10 pr-4 h-9 bg-muted/50 border-muted-foreground/20"
            />
          </div>
        </div>

        {/* Categories Navigation */}
        <nav className="border-t bg-muted/30">
          <div className="flex items-center gap-2 px-4 lg:px-6 py-2 overflow-x-auto scrollbar-hide">
            {categories.map((category) => (
              <DropdownMenu key={category.name}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-2 rounded-full hover:bg-background hover:shadow-sm transition-all whitespace-nowrap"
                  >
                    <category.icon className="h-4 w-4" />
                    <span className="text-sm">{category.name}</span>
                    <ChevronDown className="h-3.5 w-3.5 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48">
                  <DropdownMenuItem className="cursor-pointer">Sub-category 1</DropdownMenuItem>
                  <DropdownMenuItem className="cursor-pointer">Sub-category 2</DropdownMenuItem>
                  <DropdownMenuItem className="cursor-pointer">Sub-category 3</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ))}
          </div>
        </nav>
      </div>
    </header>
  )
}

