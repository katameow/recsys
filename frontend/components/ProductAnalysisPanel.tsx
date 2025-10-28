"use client"

import { Fragment, type HTMLAttributes } from "react"
import { AlertTriangle, MessageCircleWarning, Quote, Smile, ThumbsDown } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
// removed key-spec extraction and table display from Insights panel (handled in product card)
import { ProductAnalysis, ProductReview, ReviewHighlightItem } from "@/types"

interface ProductAnalysisPanelProps extends HTMLAttributes<HTMLDivElement> {
  analysis?: ProductAnalysis | null
  reviews?: ProductReview[] | null
  description?: string | null
}

const take = <T,>(items: T[] | undefined | null, count: number): T[] => {
  if (!items || items.length === 0) {
    return []
  }

  return items.slice(0, count)
}

const highlightContent = (items?: ReviewHighlightItem[] | null): ReviewHighlightItem[] | null => {
  if (!items || items.length === 0) {
    return null
  }

  // Keep the original items but filter out any that don't have any text to show.
  return items.filter((item) => {
    return Boolean(item && ((item.summary && item.summary.trim()) || (item.explanation && item.explanation.trim()) || (item.quote && item.quote.trim())))
  })
}

const formatConfidence = (value?: number | null) => {
  if (typeof value !== "number") {
    return null
  }

  if (value <= 1) {
    return `${Math.round(value * 100)}%`
  }

  if (value <= 100) {
    return `${Math.round(value)}%`
  }

  return `${Math.round(value)}%`
}

export function ProductAnalysisPanel({ analysis, reviews, description, className, ...props }: ProductAnalysisPanelProps) {
  if (!analysis && (!reviews || reviews.length === 0)) {
    return null
  }

  // key specs and selling points removed from Insights panel — these are shown on the product card

  const positiveHighlights = highlightContent(analysis?.review_highlights?.positive)
  const negativeHighlights = highlightContent(analysis?.review_highlights?.negative)
  const confidence = formatConfidence(analysis?.confidence ?? null)

  const sampleReviews = take(reviews, 2)

  return (
    <section
      className={cn(
        "mt-4 space-y-5 rounded-2xl border border-border/70 bg-background/80 p-5 shadow-sm backdrop-blur",
        className
      )}
      aria-label="Product analysis details"
      {...props}
    >
      {/* key specs and selling points intentionally omitted here */}

      {(positiveHighlights?.length || negativeHighlights?.length) && (
        <Fragment>
          <Separator className="border-border/60" />
          <div className="grid gap-4 md:grid-cols-2">
            {positiveHighlights?.length ? (
              <div className="rounded-xl border border-success/20 bg-success/5 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-success">
                  <Smile className="h-4 w-4" aria-hidden="true" />
                  What people love
                </div>
                <ul className="mt-3 space-y-4 text-sm leading-relaxed">
                  {positiveHighlights.map((item, index) => (
                    <li key={`positive-${index}`} className="flex flex-col gap-2">
                      <div className="flex items-start gap-2">
                        <span className="mt-1 inline-flex h-1.5 w-1.5 flex-shrink-0 rounded-full bg-success" aria-hidden="true" />
                        <div className="flex-1 space-y-2">
                          {item.summary ? (
                            <div className="font-semibold text-foreground">{item.summary}</div>
                          ) : null}
                          {item.explanation ? (
                            <div className="rounded-lg border border-success/15 bg-success/[0.03] px-3 py-2 text-[0.92rem] leading-relaxed text-success/95">
                              {item.explanation}
                            </div>
                          ) : null}
                          {item.quote ? (
                            <div className="relative rounded-lg border-l-2 border-success/30 bg-background/50 py-2 pl-4 pr-3">
                              <Quote className="absolute left-1 top-2 h-3 w-3 text-success/40" aria-hidden="true" />
                              <div className="text-[0.88rem] italic leading-relaxed text-foreground/80">
                                {item.quote}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {negativeHighlights?.length ? (
              <div className="rounded-xl border border-warning/25 bg-warning/10 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-warning">
                  <ThumbsDown className="h-4 w-4" aria-hidden="true" />
                  Things to consider
                </div>
                <ul className="mt-3 space-y-4 text-sm leading-relaxed">
                  {negativeHighlights.map((item, index) => (
                    <li key={`negative-${index}`} className="flex flex-col gap-2">
                      <div className="flex items-start gap-2">
                        <span className="mt-1 inline-flex h-1.5 w-1.5 flex-shrink-0 rounded-full bg-warning" aria-hidden="true" />
                        <div className="flex-1 space-y-2">
                          {item.summary ? (
                            <div className="font-semibold text-foreground">{item.summary}</div>
                          ) : null}
                          {item.explanation ? (
                            <div className="rounded-lg border border-warning/20 bg-warning/[0.05] px-3 py-2 text-[0.92rem] leading-relaxed text-warning/95">
                              {item.explanation}
                            </div>
                          ) : null}
                          {item.quote ? (
                            <div className="relative rounded-lg border-l-2 border-warning/40 bg-background/50 py-2 pl-4 pr-3">
                              <Quote className="absolute left-1 top-2 h-3 w-3 text-warning/40" aria-hidden="true" />
                              <div className="text-[0.88rem] italic leading-relaxed text-foreground/80">
                                {item.quote}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </Fragment>
      )}

      {analysis?.best_for && (
        <Fragment>
          <Separator className="border-border/60" />
          <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm text-primary">
            <MessageCircleWarning className="mt-0.5 h-4 w-4" aria-hidden="true" />
            <div>
              <span className="font-semibold">Best for:</span> {analysis.best_for}
            </div>
          </div>
        </Fragment>
      )}

      {sampleReviews.length > 0 && (
        <Fragment>
          <Separator className="border-border/60" />
          <div>
            <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Quote className="h-4 w-4 text-secondary" aria-hidden="true" />
              Snapshot from reviews
            </h4>
            <div className="mt-3 space-y-3 text-sm text-muted-foreground">
              {sampleReviews.map((review, index) => (
                <blockquote
                  key={`review-${index}`}
                  className="rounded-xl border border-border/70 bg-background/90 p-4 shadow-inner"
                >
                  <p className="leading-relaxed">{review.content}</p>
                  <footer className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground/80">
                    <span className="font-medium">Rating: {review.rating ?? "NA"}</span>
                    {review.timestamp ? (
                      <time dateTime={review.timestamp}>
                        {new Date(review.timestamp).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </time>
                    ) : null}
                  </footer>
                </blockquote>
              ))}
            </div>
          </div>
        </Fragment>
      )}

      {(analysis?.warnings?.length || confidence) && (
        <Fragment>
          <Separator className="border-border/60" />
          <div className="flex flex-col gap-3">
            {analysis?.warnings?.length ? (
              <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4" aria-hidden="true" />
                <ul className="space-y-1">
                  {analysis.warnings.map((warning, index) => (
                    <li key={`warning-${index}`}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {confidence ? (
              <div className="text-xs text-muted-foreground">
                Confidence score: <span className="font-semibold text-foreground">{confidence}</span>
              </div>
            ) : null}
          </div>
        </Fragment>
      )}
    </section>
  )
}
