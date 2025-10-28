"use client"

import React, { useEffect } from "react"

import { useAuthStore } from "@/lib/auth-store"
import { useTimelineStore, type TimelineEvent } from "@/lib/timeline-store"
import type { SearchResultEnvelope } from "@/types"

export type { TimelineEvent }

type Props = {
  queryHash: string
  timelineUrl?: string
  resultUrl?: string
  className?: string
  onCompleted?: (result: SearchResultEnvelope) => void
  connectionId?: string
}

export default function Timeline({
  queryHash,
  timelineUrl,
  resultUrl,
  className,
  onCompleted,
  connectionId,
}: Props) {
  const accessToken = useAuthStore((state) => state.accessToken)
  
  const displayedEvents = useTimelineStore((state) => state.displayedEvents)
  const status = useTimelineStore((state) => state.status)
  const errorMsg = useTimelineStore((state) => state.errorMsg)
  const events = useTimelineStore((state) => state.events)
  const isDisplaying = useTimelineStore((state) => state.isDisplaying)
  
  const initializeTimeline = useTimelineStore((state) => state.initializeTimeline)
  const cleanup = useTimelineStore((state) => state.cleanup)
  const reset = useTimelineStore((state) => state.reset)

  // Initialize timeline when component mounts or queryHash changes
  useEffect(() => {
    if (!accessToken) {
      return
    }

    if (connectionId) {
      // Dependency-only branch: ensures repeated searches with identical hashes trigger fresh setup
    }

    initializeTimeline(queryHash, accessToken, timelineUrl, resultUrl, onCompleted, connectionId)

    return () => {
      cleanup()
    }
  }, [
    queryHash,
    accessToken,
    timelineUrl,
    resultUrl,
    onCompleted,
    initializeTimeline,
    cleanup,
    connectionId,
  ])

  const formatStepLabel = (step: string, payload?: unknown) => {
    // Convert step names to more readable format
    const stepLabels: Record<string, string> = {
      "search.started": "Initializing search",
      "search.embedding": "Analyzing query",
      "search.vector_search": "Finding relevant products",
      "search.reranking": "Ranking results",
      "rag.pipeline.completed": "Analysis complete",
      "response.completed": "Search completed",
    }
    
    // Handle response.cached differently based on whether it's from cache or being stored
    if (step === "response.cached") {
      const payloadObj = payload as Record<string, unknown> | undefined
      const source = payloadObj?.source as string | undefined
      
      // If source is present (precomputed, cache, etc.), it's a cache hit
      if (source) {
        return "Results ready (from cache)"
      }
      // If no source, it's storing the response to cache after RAG
      return "Response cached"
    }
    
    return stepLabels[step] || step.replace(/[._]/g, " ")
  }

  const handleReconnect = () => {
    if (!accessToken) {
      return
    }
    reset()
    initializeTimeline(queryHash, accessToken, timelineUrl, resultUrl, onCompleted, connectionId)
  }

  return (
    <div className={className} aria-live="polite">
      <div className="mb-4 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {status === "streaming" ? "Processing search..." : status === "closed" ? "Completed" : status === "error" ? "Error" : status === "connecting" ? "Connecting..." : "Idle"}
        </span>
        {errorMsg ? <span className="text-destructive text-xs">{errorMsg}</span> : null}
      </div>
      
      <div className="relative">
        {/* Vertical timeline line */}
        <div className="absolute left-[15px] top-6 bottom-6 w-[2px] bg-gradient-to-b from-primary/40 via-primary/20 to-transparent" />
        
        <div className="space-y-4">
          {displayedEvents.length === 0 && status === "connecting" && (
            <div className="flex items-center gap-3 pl-10 animate-pulse">
              <div className="relative">
                <div className="w-2 h-2 rounded-full bg-primary animate-ping" />
                <div className="absolute inset-0 w-2 h-2 rounded-full bg-primary" />
              </div>
              <span className="text-sm text-muted-foreground">Connecting to search engine...</span>
            </div>
          )}
          
          {displayedEvents.map((event, index) => {
            const isLast = index === displayedEvents.length - 1
            const isCompleted = index < displayedEvents.length - 1
            
            return (
              <div 
                key={event.event_id} 
                className="relative flex items-start gap-4 animate-in fade-in slide-in-from-left-4 duration-700"
                style={{ animationDelay: '0ms' }}
              >
                {/* Timeline dot */}
                <div className="relative z-10 flex-shrink-0">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-500 ${
                    isCompleted 
                      ? 'bg-primary/20 border-2 border-primary' 
                      : isLast 
                      ? 'bg-primary border-2 border-primary shadow-lg shadow-primary/50 animate-pulse' 
                      : 'bg-muted border-2 border-border'
                  }`}>
                    {isCompleted ? (
                      <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : isLast ? (
                      <div className="w-3 h-3 rounded-full bg-white animate-pulse" />
                    ) : null}
                  </div>
                </div>

                {/* Event content */}
                <div className="flex-1 pb-2">
                  <div className="rounded-lg bg-card/50 border border-border/50 p-3 transition-all duration-300 hover:border-primary/30 hover:bg-card/80">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <h4 className="text-sm font-semibold text-foreground capitalize">
                        {formatStepLabel(event.step, event.payload)}
                      </h4>
                      <span className="text-xs text-muted-foreground">
                        {new Date(event.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    
                    {event.payload !== undefined && event.payload !== null && (
                      <div className="mt-2 text-xs text-muted-foreground">
                        <details className="cursor-pointer">
                          <summary className="hover:text-foreground transition-colors">View details</summary>
                          <pre className="mt-2 p-2 bg-muted/50 rounded text-xs overflow-auto max-h-32 border border-border/30">
                            {JSON.stringify(event.payload as Record<string, unknown>, null, 2)}
                          </pre>
                        </details>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
          
          {/* Loading indicator for next event */}
          {(status === "streaming" || isDisplaying) && events.length > displayedEvents.length && (
            <div className="relative flex items-start gap-4 animate-in fade-in duration-500">
              <div className="relative z-10 flex-shrink-0">
                <div className="w-8 h-8 rounded-full flex items-center justify-center bg-muted/50 border-2 border-dashed border-muted-foreground/30">
                  <div className="w-3 h-3 rounded-full bg-muted-foreground/30 animate-pulse" />
                </div>
              </div>
              <div className="flex-1 pb-2">
                <div className="rounded-lg bg-muted/20 border border-dashed border-border/30 p-3">
                  <div className="h-4 w-32 bg-muted/50 rounded animate-pulse" />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      
      {status === "error" && (
        <div className="mt-4">
          <button
            className="px-4 py-2 bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 transition-colors text-sm font-medium"
            onClick={handleReconnect}
          >
            Reconnect
          </button>
        </div>
      )}
    </div>
  )
}
