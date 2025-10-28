export interface ProductReview {
  content: string
  rating?: number | null
  similarity?: number | null
  verified_purchase?: boolean | null
  user_id?: string | null
  timestamp?: string | null
  has_rating?: number | null
}

export interface ReviewHighlightItem {
  summary?: string | null
  explanation?: string | null
  quote?: string | null
}

export interface ReviewHighlights {
  overall_sentiment?: string | null
  positive?: ReviewHighlightItem[]
  negative?: ReviewHighlightItem[]
}

export interface MainSellingPoint {
  title?: string | null
  description?: string | null
}

export interface KeySpec {
  feature?: string | null
  detail?: string | null
}

export interface ProductAnalysis {
  asin?: string
  main_selling_points?: MainSellingPoint[]
  best_for?: string | null
  review_highlights?: ReviewHighlights
  confidence?: number | null
  warnings?: string[] | null
  notes?: string | null
  key_specs?: KeySpec[]
}

export interface ProductRecommendation {
  asin: string
  product_title?: string
  cleaned_item_description?: string | null
  product_categories?: string | string[]
  product_image_url?: string | null
  image_url?: string | null
  image?: string | null
  thumbnail_url?: string | null
  similarity?: number
  avg_rating?: number | null
  rating_count?: number | null
  displayed_rating?: string | number | null
  combined_score?: number
  reviews?: ProductReview[]
  analysis?: ProductAnalysis
}

export interface SearchResponse {
  query: string
  count: number
  results: ProductRecommendation[]
}

export type SearchStatus = "pending" | "completed" | "failed"

export interface SearchResultEnvelope {
  query_hash: string
  status: SearchStatus
  result?: SearchResponse
  error?: string
  updated_at?: string | null
}

export interface SearchAcceptedResponse {
  query_hash: string
  result_url: string
  timeline_url: string
  status: "pending"
}

export interface Message {
  id: number
  text: string
  sender: "user" | "ai"
  productRecommendations?: ProductRecommendation[]
  error?: string
  meta?: Record<string, unknown>
}

export interface ChatSession {
  id: string
  title: string
  messages: Message[]
  createdAt: string
  lastMessageAt: string
}

export default {} as {};
