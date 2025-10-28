"use client"

import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react"
import { Maximize2, MessageCircle, Send, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { ChatRecommendationCard } from "@/components/ChatProductCard"
import { searchProducts } from "@/utils/api"
import { Message, ProductRecommendation } from "@/types"
import { useChatSessionStore, initializeChatSession } from "@/lib/chat-session-store"
import { useChatActions } from "@/lib/use-chat-actions"

interface ChatboxOverlayProps {
  onClose: () => void
  onMaximize: () => void
  isOpen: boolean
  onOpen: () => void
}

const quickPrompts = [
  "Show me trending smart home devices",
  "I need a laptop under $1,000",
  "Find eco-friendly kitchen essentials",
]

export function ChatboxOverlay({ onClose, onMaximize, isOpen, onOpen }: ChatboxOverlayProps) {
  const { input, isLoading, setInput, getCurrentMessages } = useChatSessionStore()
  const { sendMessage } = useChatActions()

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  // Initialize session on mount
  useEffect(() => {
    initializeChatSession()
  }, [])

  const messages = getCurrentMessages()

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, isLoading])

  const handleSend = async () => {
    await sendMessage(input)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    handleSend()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      handleSend()
    }
  }

  const renderLoading = () => (
    <div className="flex flex-col gap-3 items-start animate-slide-up" aria-live="polite">
      <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-border bg-background px-4 py-3">
        <Skeleton shimmer className="mb-2 h-3 w-20" />
        <Skeleton shimmer className="mb-2 h-4 w-full" />
        <Skeleton shimmer className="h-4 w-3/4" />
      </div>
      <div className="grid w-full gap-3">
        <div className="space-y-2 rounded-xl border bg-background p-3">
          <Skeleton className="h-16 w-16 rounded-lg" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      </div>
    </div>
  )

  if (!isOpen) {
    return (
      <Button
        className="fixed bottom-6 right-6 z-50 flex h-14 items-center gap-2 rounded-full px-6 shadow-2xl transition-all duration-300 hover:scale-105 hover:shadow-xl bg-secondary text-secondary-foreground hover:bg-secondary/90 animate-slide-up"
        onClick={onOpen}
        aria-label="Open AI shopping assistant"
      >
        <MessageCircle className="h-5 w-5" aria-hidden="true" />
        <span className="font-semibold">Chat with AI</span>
      </Button>
    )
  }

  return (
    <Card className="fixed bottom-6 right-6 z-50 flex h-[580px] w-full max-w-md flex-col overflow-hidden rounded-2xl border-border/50 bg-background/95 shadow-2xl backdrop-blur-sm animate-scale-in">
      <CardHeader className="flex flex-row items-center justify-between border-b bg-gradient-to-r from-secondary/5 to-primary/5 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary/10">
            <MessageCircle className="h-5 w-5 text-secondary" />
          </div>
          <div>
            <CardTitle className="text-base font-semibold">AI Shopping Assistant</CardTitle>
            <p className="text-xs text-muted-foreground">Always here to help</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={onMaximize} 
            className="h-8 w-8 hover:bg-muted transition-colors"
            aria-label="Open full chat"
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={onClose}
            className="h-8 w-8 hover:bg-muted transition-colors"
            aria-label="Close chat"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden bg-muted/20 px-0">
        <ScrollArea className="h-full px-6 py-4">
          <div
            ref={scrollRef}
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            className="space-y-4"
          >
            {messages.map((message) => {
              const isUser = message.sender === "user"
              return (
                <div key={message.id} className={`flex flex-col gap-3 animate-slide-up ${isUser ? "items-end" : "items-start"}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm transition-all ${
                      isUser
                        ? "bg-secondary text-secondary-foreground rounded-br-md"
                        : "bg-background border border-border rounded-bl-md"
                    }`}
                  >
                    {!isUser ? (
                      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Assistant
                      </span>
                    ) : null}
                    <p className="whitespace-pre-wrap">{message.text}</p>
                  </div>

                  {message.productRecommendations?.length ? (
                    <div className="grid w-full gap-3 sm:grid-cols-1 items-start">
                      {message.productRecommendations.map((product: ProductRecommendation) => (
                        <ChatRecommendationCard key={product.asin || product.product_title} product={product} />
                      ))}
                    </div>
                  ) : null}
                </div>
              )
            })}

            {isLoading ? renderLoading() : null}
          </div>
        </ScrollArea>
      </CardContent>
      <CardFooter className="border-t bg-background px-6 py-4">
        <form onSubmit={handleSubmit} className="flex w-full flex-col gap-3" aria-label="Send a message">
          {messages.length === 0 && (
            <div className="flex flex-wrap gap-2">
              {quickPrompts.map((prompt) => (
                <Badge
                  key={prompt}
                  variant="outline"
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setInput(prompt)
                    textareaRef.current?.focus()
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault()
                      setInput(prompt)
                      textareaRef.current?.focus()
                    }
                  }}
                  className="cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-all hover:bg-muted hover:border-primary/50"
                  aria-label={`Use suggestion ${prompt}`}
                >
                  {prompt}
                </Badge>
              ))}
            </div>
          )}

          <div className="relative rounded-xl border bg-background shadow-sm transition-all focus-within:ring-2 focus-within:ring-primary/20">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask for product ideas..."
              aria-label="Message the AI assistant"
              rows={2}
              className="min-h-[60px] resize-none border-0 bg-transparent px-4 py-3 text-sm focus-visible:ring-0"
              maxLength={400}
              disabled={isLoading}
            />
            <div className="flex items-center justify-between border-t px-4 py-2">
              <span className="text-xs text-muted-foreground">
                {input.length}/400
              </span>
              <Button
                type="submit"
                size="sm"
                disabled={isLoading || !input.trim()}
                className="h-8 gap-2 bg-secondary text-secondary-foreground hover:bg-secondary/90 transition-all"
              >
                <Send className="h-3.5 w-3.5" />
                Send
              </Button>
            </div>
          </div>
        </form>
      </CardFooter>
    </Card>
  )
}