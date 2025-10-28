import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { ChatSession, Message, SearchResponse, SearchStatus } from '@/types'

export interface ActiveSearch {
  query: string
  queryHash: string
  timelineUrl: string
  resultUrl: string
  status: SearchStatus
  error?: string
  result?: SearchResponse
  startedAt: string
  completedAt?: string
}

interface ChatSessionState {
  currentSessionId: string | null
  sessions: ChatSession[]
  input: string
  isLoading: boolean
  messageCounter: number
  activeSearches: Record<string, ActiveSearch | null>
  
  // Actions
  createNewSession: () => string
  switchToSession: (sessionId: string) => void
  getCurrentSession: () => ChatSession | null
  addMessageToSession: (sessionId: string, message: Omit<Message, 'id'>) => void
  addMessageToCurrentSession: (message: Omit<Message, 'id'>) => void
  setInput: (input: string) => void
  setIsLoading: (isLoading: boolean) => void
  deleteSession: (sessionId: string) => void
  getCurrentMessages: () => Message[]
  getActiveSearchForSession: (sessionId: string | null) => ActiveSearch | null
  setActiveSearch: (sessionId: string, search: ActiveSearch) => void
  updateActiveSearch: (sessionId: string, partial: Partial<ActiveSearch>) => void
  clearActiveSearch: (sessionId: string) => void
}

const initialMessage: Message = {
  id: 1,
  text: "Hello! How can I assist you with your shopping today?",
  sender: "ai"
}

const generateSessionId = () => `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

const createInitialSession = (): ChatSession => {
  const now = new Date().toISOString()
  return {
    id: generateSessionId(),
    title: "New Chat",
    messages: [initialMessage],
    createdAt: now,
    lastMessageAt: now
  }
}

const generateSessionTitle = (messages: Message[]): string => {
  // Find the first user message to use as title
  const firstUserMessage = messages.find(msg => msg.sender === 'user')
  if (firstUserMessage) {
    // Take first 40 characters and add ellipsis if longer
    const title = firstUserMessage.text.trim()
    return title.length > 40 ? title.substring(0, 40) + '...' : title
  }
  return "New Chat"
}

export const useChatSessionStore = create<ChatSessionState>()(
  persist(
    (set, get) => ({
      currentSessionId: null,
      sessions: [],
      input: '',
      isLoading: false,
      messageCounter: 2,
      activeSearches: {},

      createNewSession: () => {
        const newSession = createInitialSession()
        const state = get()
        
        // Preserve isLoading state if the current session has an active search
        const currentHasActiveSearch = state.currentSessionId 
          ? state.activeSearches[state.currentSessionId]?.status === 'pending'
          : false
        
        set({
          sessions: [newSession, ...state.sessions],
          currentSessionId: newSession.id,
          messageCounter: 2,
          input: '',
          // Only set isLoading to false if we're not switching away from an active search
          isLoading: currentHasActiveSearch ? state.isLoading : false,
          activeSearches: {
            ...state.activeSearches,
            [newSession.id]: null,
          }
        })
        return newSession.id
      },

      switchToSession: (sessionId) => {
        const session = get().sessions.find(s => s.id === sessionId)
        if (session) {
          set({
            currentSessionId: sessionId,
            messageCounter: Math.max(...session.messages.map(m => m.id)) + 1,
            input: '',
            isLoading: false,
            activeSearches: {
              ...get().activeSearches,
              [sessionId]: get().activeSearches[sessionId] ?? null,
            }
          })
        }
      },

      getCurrentSession: () => {
        const { currentSessionId, sessions } = get()
        if (!currentSessionId) return null
        return sessions.find(s => s.id === currentSessionId) || null
      },

      getCurrentMessages: () => {
        const currentSession = get().getCurrentSession()
        return currentSession?.messages || []
      },

      addMessageToSession: (sessionId, message) => {
        const { messageCounter, sessions } = get()
        if (!sessionId) return

        const newMessage: Message = {
          id: messageCounter,
          ...message
        }

        const now = new Date().toISOString()
        
        set((state) => ({
          sessions: state.sessions.map(session => 
            session.id === sessionId 
              ? {
                  ...session,
                  messages: [...session.messages, newMessage],
                  lastMessageAt: now,
                  title: session.messages.length === 1 && message.sender === 'user' 
                    ? generateSessionTitle([...session.messages, newMessage])
                    : session.title
                }
              : session
          ),
          messageCounter: messageCounter + 1
        }))
      },

      addMessageToCurrentSession: (message) => {
        const { currentSessionId } = get()
        if (!currentSessionId) return
        get().addMessageToSession(currentSessionId, message)
      },

      setInput: (input) => set({ input }),

      setIsLoading: (isLoading) => set({ isLoading }),

      deleteSession: (sessionId) => {
        const { currentSessionId, sessions } = get()
        const updatedSessions = sessions.filter(s => s.id !== sessionId)

        set((state) => {
          let nextSessions = updatedSessions
          let nextCurrentId = state.currentSessionId
          let nextMessageCounter = state.messageCounter
          const nextActiveSearches = { ...state.activeSearches }
          delete nextActiveSearches[sessionId]

          if (currentSessionId === sessionId) {
            if (updatedSessions.length > 0) {
              const fallback = updatedSessions[0]
              nextCurrentId = fallback.id
              nextMessageCounter = Math.max(...fallback.messages.map(m => m.id)) + 1
              nextActiveSearches[fallback.id] = nextActiveSearches[fallback.id] ?? null
            } else {
              const newSession = createInitialSession()
              nextSessions = [newSession]
              nextCurrentId = newSession.id
              nextMessageCounter = 2
              nextActiveSearches[newSession.id] = null
            }
          }

          return {
            ...state,
            sessions: nextSessions,
            currentSessionId: nextCurrentId,
            messageCounter: nextMessageCounter,
            activeSearches: nextActiveSearches,
          }
        })
      },

      getActiveSearchForSession: (sessionId) => {
        if (!sessionId) return null
        return get().activeSearches[sessionId] ?? null
      },

      setActiveSearch: (sessionId, search) => {
        set((state) => ({
          activeSearches: {
            ...state.activeSearches,
            [sessionId]: search,
          },
        }))
      },

      updateActiveSearch: (sessionId, partial) => {
        set((state) => {
          const current = state.activeSearches[sessionId]
          if (!current) {
            return state
          }
          return {
            ...state,
            activeSearches: {
              ...state.activeSearches,
              [sessionId]: {
                ...current,
                ...partial,
              },
            },
          }
        })
      },

      clearActiveSearch: (sessionId) => {
        set((state) => ({
          activeSearches: {
            ...state.activeSearches,
            [sessionId]: null,
          },
        }))
      }
    }),
    {
      name: 'chat-session-storage',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        currentSessionId: state.currentSessionId,
        sessions: state.sessions,
        messageCounter: state.messageCounter,
        activeSearches: state.activeSearches
      })
    }
  )
)

// Initialize with a session if none exists
export const initializeChatSession = () => {
  const store = useChatSessionStore.getState()
  if (store.sessions.length === 0 || !store.currentSessionId) {
    store.createNewSession()
  }
}