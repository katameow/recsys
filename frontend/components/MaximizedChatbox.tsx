"use client"

import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Minimize2, MessageSquare, Send, Plus, Trash2, MessageCircle } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { ChatRecommendationCard } from "@/components/ChatProductCard"
import Timeline from "@/components/Timeline"
import type { Message, ProductRecommendation, SearchResultEnvelope } from "@/types"
import { useChatSessionStore, initializeChatSession, type ActiveSearch } from "@/lib/chat-session-store"
import { useChatActions } from "@/lib/use-chat-actions"

interface MaximizedChatboxProps {
  onMinimize: () => void
}

const promptExamples = [
  "Find me a gift for a coffee lover",
  "What are the best noise-canceling headphones?",
  "Compare these two products: iPhone 13 vs Samsung Galaxy S21",
]

export function MaximizedChatbox({ onMinimize }: MaximizedChatboxProps) {
  const {
    input,
    isLoading,
    setInput,
    getCurrentMessages,
    sessions,
    currentSessionId,
    getActiveSearchForSession,
    clearActiveSearch,
  } = useChatSessionStore()
  const { sendMessage, startNewConversation, switchToChat, deleteChat } = useChatActions()
  const [activeTab, setActiveTab] = useState("chat")
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null)

  // Initialize session on mount
  useEffect(() => {
    initializeChatSession()
  }, [])

  const messages = getCurrentMessages()
  const activeSearch = getActiveSearchForSession(currentSessionId)

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

  const handleTimelineCompleted = useCallback((envelope: SearchResultEnvelope) => {
    const state = useChatSessionStore.getState()
    
    // Find the session with matching queryHash that is still pending
    // Prioritize the current session if it matches
    let match: [string, ActiveSearch] | undefined
    
    // First check if current session has this queryHash
    if (state.currentSessionId) {
      const currentSearch = state.activeSearches[state.currentSessionId]
      if (currentSearch?.queryHash === envelope.query_hash && currentSearch.status === "pending") {
        match = [state.currentSessionId, currentSearch]
      }
    }
    
    // If current session doesn't match, search all sessions
    if (!match) {
      const allMatches = Object.entries(state.activeSearches).filter(
        ([, search]) => search?.queryHash === envelope.query_hash && search.status === "pending"
      )
      match = allMatches[0] as [string, ActiveSearch] | undefined
    }

    if (!match) {
      console.warn('Timeline completed but no pending search found for queryHash:', envelope.query_hash)
      return
    }

    const [sessionId, search] = match

    const timestamp = new Date().toISOString()

    if (envelope.status === "completed" && envelope.result) {
      state.updateActiveSearch(sessionId, {
        status: "completed",
        result: envelope.result,
        completedAt: timestamp,
        error: undefined,
      })

      const recommendations: ProductRecommendation[] = envelope.result.results?.map((item) => ({ ...item })) ?? []

      state.addMessageToSession(sessionId, {
        sender: "ai",
        text: `Here's what I found for "${envelope.result.query}":`,
        productRecommendations: recommendations,
        meta: {
          query: envelope.result.query,
          queryHash: envelope.query_hash,
        },
      })

      state.setIsLoading(false)
    } else if (envelope.status === "failed") {
      state.updateActiveSearch(sessionId, {
        status: "failed",
        error: envelope.error ?? "Search failed",
        completedAt: timestamp,
      })

      state.addMessageToSession(sessionId, {
        sender: "ai",
        text: "I couldn't complete that search. Please try again shortly.",
        error: envelope.error ?? "Search failed",
      })

      state.setIsLoading(false)
    } else {
      state.updateActiveSearch(sessionId, {
        status: envelope.status,
      })
    }
  }, [])

  const renderMessageBubble = (message: Message) => {
    const isUser = message.sender === "user"
    return (
      <div
        key={message.id}
        className={`flex flex-col gap-4 animate-slide-up ${isUser ? "items-end" : "items-start"}`}
        role="group"
        aria-label={isUser ? "User message" : "Assistant message"}
      >
        <div
          className={`max-w-2xl rounded-2xl px-5 py-4 text-sm leading-relaxed shadow-sm transition-all ${
            isUser
              ? "bg-secondary text-secondary-foreground rounded-br-md"
              : "bg-background border border-border rounded-bl-md ml-0"
          }`}
          style={{ marginLeft: isUser ? undefined : 0 }}
        >
          {!isUser ? (
            <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Assistant
            </span>
          ) : null}
          <p className="whitespace-pre-wrap">{message.text}</p>
        </div>
        {message.productRecommendations && message.productRecommendations.length > 0 ? (
          <div className="grid w-full grid-cols-1 lg:grid-cols-2 gap-12 items-start" aria-label="Recommended products">
            {message.productRecommendations.map((product: ProductRecommendation) => (
              <div key={product.asin || product.product_title} className="w-full">
                <ChatRecommendationCard product={product} />
              </div>
            ))}
          </div>
        ) : null}
      </div>
    )
  }

  const renderLoadingState = () => (
    <div className="flex flex-col gap-4 items-start animate-slide-up" aria-live="polite">
      <div className="max-w-2xl rounded-2xl rounded-bl-md border border-border bg-background px-5 py-4">
        <Skeleton shimmer className="mb-2 h-3 w-24" />
        <Skeleton shimmer className="mb-2 h-4 w-full" />
        <Skeleton shimmer className="h-4 w-4/5" />
      </div>
      <div className="grid w-full gap-6 sm:grid-cols-1 md:grid-cols-2 items-start">
        {Array.from({ length: 2 }).map((_, index) => (
          <div
            key={`loading-card-${index}`}
            className="flex flex-col gap-3 rounded-xl border bg-background p-4 shadow-sm"
          >
            <div className="flex items-start gap-3">
              <Skeleton shimmer className="h-16 w-16 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
            <div className="flex gap-2">
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
            <Skeleton className="h-9 w-full rounded-lg" />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="relative h-2 w-2">
          <span className="absolute inset-0 animate-ping rounded-full bg-secondary/60" aria-hidden="true" />
          <span className="relative block h-2 w-2 rounded-full bg-secondary" aria-hidden="true" />
        </span>
        Gathering matches for you…
      </div>
    </div>
  )

  const quickActions = useMemo(
    () => promptExamples.map((example) => ({ label: example, value: example })),
    []
  )

  const handleNewChat = () => {
    startNewConversation()
  }

  const handleSwitchToSession = (sessionId: string) => {
    switchToChat(sessionId)
  }

  const handleDeleteSession = (sessionId: string, event: React.MouseEvent) => {
    event.stopPropagation()
    setSessionToDelete(sessionId)
  }

  const confirmDeleteSession = () => {
    if (sessionToDelete) {
      deleteChat(sessionToDelete)
      setSessionToDelete(null)
    }
  }

  const getSessionToDeleteTitle = () => {
    if (!sessionToDelete) return ""
    const session = sessions.find(s => s.id === sessionToDelete)
    return session?.title || "Untitled Chat"
  }

  const cancelDeleteSession = () => {
    setSessionToDelete(null)
  }



  return (
    <div className="fixed inset-0 z-50 flex bg-background animate-fade-in">
      <Tabs defaultValue="chat" className="flex-1">
        <div className="flex h-full">
          <aside className="flex w-72 flex-col border-r bg-muted/30 p-4">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary/10">
                  <MessageCircle className="h-5 w-5 text-secondary" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold">AI Assistant</h2>
                  <p className="text-xs text-muted-foreground">Shopping helper</p>
                </div>
              </div>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={onMinimize} 
                className="h-8 w-8 hover:bg-muted"
                aria-label="Minimize chat"
              >
                <Minimize2 className="h-4 w-4" />
              </Button>
            </div>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="chat" onClick={() => setActiveTab("chat")}>
                Chat
              </TabsTrigger>
              <TabsTrigger value="settings" onClick={() => setActiveTab("settings")}>
                Settings
              </TabsTrigger>
            </TabsList>

            {activeTab === "chat" ? (
              <ScrollArea className="mt-3 flex-1">
                <div className="space-y-3">
                  {/* New Chat Button */}
                  <div className="space-y-2 mx-1">
                    <Button
                      variant="outline"
                      className="w-56 justify-start text-left h-9 px-3 rounded-md max-w-full"
                      type="button"
                      onClick={handleNewChat}
                    >
                      <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                      New Chat
                    </Button>
                  </div>

                  {/* Recent Chats */}
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">
                      Recent Chats
                    </h3>
                    <div className="space-y-0.5">
                      {sessions.length > 0 ? (
                        sessions.slice(0, 8).map((session) => (
                          <div
                            key={session.id}
                            className={`group flex items-center gap-1 rounded-md px-2 py-1 mx-1 hover:bg-muted/50 ${
                              session.id === currentSessionId ? 'bg-muted' : ''
                            }`}
                          >
                            <Button
                              variant="ghost"
                              className="w-48 justify-start px-1 text-left text-xs h-8 min-w-0 max-w-full"
                              type="button"
                              onClick={() => handleSwitchToSession(session.id)}
                            >
                              <MessageSquare className="mr-2 h-3 w-3 text-primary flex-shrink-0" aria-hidden="true" />
                              <span className="truncate text-xs leading-tight">{session.title}</span>
                            </Button>
                            {sessions.length > 1 && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 opacity-60 hover:opacity-100 hover:bg-destructive/10 hover:text-destructive transition-all flex-shrink-0"
                                onClick={(e) => handleDeleteSession(session.id, e)}
                                title="Delete chat"
                              >
                                <Trash2 className="h-2.5 w-2.5" />
                              </Button>
                            )}
                          </div>
                        ))
                      ) : (
                        <div className="text-muted-foreground text-xs px-2 py-2">
                          No chats yet
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Example Prompts */}
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">
                      Example Prompts
                    </h3>
                    <div className="space-y-0.5">
                      {quickActions.map((action) => (
                        <div key={action.value} className="mx-1">
                          <Button
                            variant="ghost"
                            className="w-56 justify-start px-2 text-left text-xs h-8 min-w-0 rounded-md max-w-full"
                            type="button"
                            onClick={() => {
                              setInput(action.value)
                              textAreaRef.current?.focus()
                            }}
                          >
                            <MessageSquare className="mr-2 h-2.5 w-2.5 text-muted-foreground flex-shrink-0" aria-hidden="true" />
                            <span className="truncate text-xs leading-tight">{action.label}</span>
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </ScrollArea>
            ) : (
              <div className="mt-6 space-y-4 text-sm">
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">
                    Chat Management
                  </h3>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleNewChat}
                    className="w-full justify-start text-left"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Start New Chat
                  </Button>
                </div>
                <div className="space-y-2 text-muted-foreground">
                  <p>Chat history is stored in your current browser session and will be cleared when you close the tab.</p>
                  <p>More settings coming soon. We&apos;ll let you tailor tone, filters, and notifications.</p>
                </div>
              </div>
            )}
          </aside>

          <div className="flex flex-1 flex-col bg-muted/20 p-6">
            <ScrollArea className="flex-1 pr-4">
              <div
                ref={scrollRef}
                role="log"
                aria-live="polite"
                aria-relevant="additions text"
                className="space-y-8 pr-4"
              >
                {messages.map((message, index) => {
                  const shouldShowTimelineBefore =
                    activeSearch && message.meta?.queryHash === activeSearch.queryHash
                  
                  // Show timeline after the last user message if there's an active search and no AI response yet
                  const isLastUserMessage = message.sender === "user" && index === messages.length - 1
                  const shouldShowTimelineAfterUser = 
                    isLastUserMessage && 
                    activeSearch && 
                    !messages.some(m => m.meta?.queryHash === activeSearch.queryHash)

                  return (
                    <div key={`wrapper-${message.id}`} className="space-y-6 w-full">
                      {shouldShowTimelineBefore ? (
                        <div className="w-full max-w-4xl rounded-xl border border-border bg-card/80 p-4 shadow-sm">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-foreground">Search timeline</p>
                              <p className="max-w-md truncate text-xs text-muted-foreground">{activeSearch?.query}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge
                                variant={
                                  activeSearch?.status === "failed"
                                    ? "destructive"
                                    : activeSearch?.status === "completed"
                                    ? "outline"
                                    : "secondary"
                                }
                              >
                                {activeSearch?.status === "pending"
                                  ? "In progress"
                                  : activeSearch?.status === "completed"
                                  ? "Completed"
                                  : "Failed"}
                              </Badge>
                              {currentSessionId && activeSearch?.status !== "pending" ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7"
                                  onClick={() => clearActiveSearch(currentSessionId)}
                                >
                                  Dismiss
                                </Button>
                              ) : null}
                            </div>
                          </div>
                          <Timeline
                            key={`${activeSearch?.queryHash}-${activeSearch?.startedAt}`}
                            queryHash={activeSearch!.queryHash}
                            timelineUrl={activeSearch!.timelineUrl}
                            resultUrl={activeSearch!.resultUrl}
                            onCompleted={handleTimelineCompleted}
                            connectionId={activeSearch!.startedAt}
                            className="mt-4"
                          />
                          {activeSearch?.status === "failed" && activeSearch?.error ? (
                            <p className="mt-3 text-sm text-destructive">{activeSearch.error}</p>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="w-full">
                        {renderMessageBubble(message)}
                      </div>

                      {/* Show timeline after user message if waiting for AI response */}
                      {shouldShowTimelineAfterUser ? (
                        <div className="w-full max-w-4xl rounded-xl border border-border bg-card/80 p-4 shadow-sm mt-6">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-foreground">Search timeline</p>
                              <p className="max-w-md truncate text-xs text-muted-foreground">{activeSearch.query}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge
                                variant={
                                  activeSearch.status === "failed"
                                    ? "destructive"
                                    : activeSearch.status === "completed"
                                    ? "outline"
                                    : "secondary"
                                }
                              >
                                {activeSearch.status === "pending"
                                  ? "In progress"
                                  : activeSearch.status === "completed"
                                  ? "Completed"
                                  : "Failed"}
                              </Badge>
                              {currentSessionId && activeSearch.status !== "pending" ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7"
                                  onClick={() => clearActiveSearch(currentSessionId)}
                                >
                                  Dismiss
                                </Button>
                              ) : null}
                            </div>
                          </div>
                          <Timeline
                            key={`${activeSearch.queryHash}-${activeSearch.startedAt}`}
                            queryHash={activeSearch.queryHash}
                            timelineUrl={activeSearch.timelineUrl}
                            resultUrl={activeSearch.resultUrl}
                            onCompleted={handleTimelineCompleted}
                            connectionId={activeSearch.startedAt}
                            className="mt-4"
                          />
                          {activeSearch.status === "failed" && activeSearch.error ? (
                            <p className="mt-3 text-sm text-destructive">{activeSearch.error}</p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
                {isLoading ? renderLoadingState() : null}
                {messages.length === 1 && !isLoading ? (
                  <div className="rounded-xl border border-dashed border-border/70 bg-card/80 p-5 text-sm text-muted-foreground">
                    <p className="font-medium text-foreground">Try asking:</p>
                    <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                      {promptExamples.map((example) => (
                        <li key={example}>
                          <Button
                            variant="outline"
                            className="w-full justify-start whitespace-normal text-left text-sm"
                            type="button"
                            onClick={() => {
                              setInput(example)
                              textAreaRef.current?.focus()
                            }}
                          >
                            {example}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </ScrollArea>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4" aria-label="Send a message">
              <div className="flex flex-wrap gap-2">
                {quickActions.map((action) => (
                  <Badge
                    key={`chip-${action.value}`}
                    variant="outline"
                    className="cursor-pointer rounded-full border-border/60 px-3 py-1 text-xs font-medium transition hover:border-primary/40 hover:bg-primary/10"
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setInput(action.value)
                      textAreaRef.current?.focus()
                    }}
                    onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        setInput(action.value)
                        textAreaRef.current?.focus()
                      }
                    }}
                    aria-label={`Use prompt ${action.label}`}
                  >
                    {action.label}
                  </Badge>
                ))}
              </div>
              <div className="flex flex-col gap-3 rounded-3xl border border-border/80 bg-card/90 p-5 shadow-lg">
                <Textarea
                  ref={textAreaRef}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask for product ideas, comparisons, or shopping guidance..."
                  aria-label="Message the AI assistant"
                  rows={3}
                  maxLength={600}
                  disabled={isLoading}
                  className="min-h-[96px] resize-none border-0 bg-transparent text-sm leading-relaxed shadow-none focus-visible:ring-0"
                />
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>Press Enter to send · Shift + Enter for a new line</span>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={isLoading || !input.trim()}
                    className="shadow-sm bg-indigo-600 text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    <Send className="mr-2 h-4 w-4" />
                    Send
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </div>

        <TabsContent value="settings" className="hidden" />
      </Tabs>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!sessionToDelete} onOpenChange={() => setSessionToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Chat</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>&ldquo;{getSessionToDeleteTitle()}&rdquo;</strong>? This action cannot be undone and all messages in this conversation will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelDeleteSession}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmDeleteSession}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Chat
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}