import { submitSearchJob } from '@/utils/api'
import { useChatSessionStore } from './chat-session-store'

export const useChatActions = () => {
  const { 
    addMessageToCurrentSession, 
    setInput, 
    setIsLoading, 
    createNewSession,
    switchToSession,
    deleteSession,
    getCurrentSession,
    setActiveSearch,
    clearActiveSearch
  } = useChatSessionStore()

  const sendMessage = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return

    let session = getCurrentSession()
    if (!session) {
      const newSessionId = createNewSession()
      session = useChatSessionStore.getState().sessions.find((s) => s.id === newSessionId) ?? null
    }

    const sessionId = session?.id

    addMessageToCurrentSession({ sender: "user", text: trimmed })
    setInput("")
    setIsLoading(true)

    try {
      const accepted = await submitSearchJob(trimmed)
      if (sessionId) {
        setActiveSearch(sessionId, {
          query: trimmed,
          queryHash: accepted.query_hash,
          timelineUrl: accepted.timeline_url,
          resultUrl: accepted.result_url,
          status: "pending",
          startedAt: new Date().toISOString(),
        })
      }
    } catch (error) {
      console.error("Error submitting search", error)
      addMessageToCurrentSession({
        sender: "ai",
        text: "Something went wrong while searching. Please try again shortly.",
      })
      if (sessionId) {
        clearActiveSearch(sessionId)
      }
      setIsLoading(false)
    }
  }

  const startNewConversation = () => {
    createNewSession()
  }

  const switchToChat = (sessionId: string) => {
    switchToSession(sessionId)
  }

  const deleteChat = (sessionId: string) => {
    deleteSession(sessionId)
  }

  return {
    sendMessage,
    startNewConversation,
    switchToChat,  
    deleteChat,
  }
}