import { create } from "zustand";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import type { SearchResultEnvelope } from "@/types";
import { fetchSearchResult } from "@/utils/api";

export type TimelineEvent = {
  event_id: string;
  query_hash: string;
  step: string;
  timestamp: string;
  sequence?: number;
  payload?: unknown;
};

type TimelineStatus = "idle" | "connecting" | "streaming" | "error" | "closed";

interface TimelineState {
  // State
  queryHash?: string;
  connectionId?: string;
  events: TimelineEvent[];
  displayedEvents: TimelineEvent[];
  status: TimelineStatus;
  errorMsg: string | null;
  isDisplaying: boolean;
  pendingCompletion: SearchResultEnvelope | null;

  // Internal refs
  seenEventIds: Set<string>;
  reconnectAttempts: number;
  displayTimerId: number | null;
  controllerRef: AbortController | null;
  closedRef: boolean;
  onCompletedCallback?: (result: SearchResultEnvelope) => void;

  // Actions
  initializeTimeline: (
    queryHash: string,
    accessToken: string,
    timelineUrl?: string,
    resultUrl?: string,
    onCompleted?: (result: SearchResultEnvelope) => void,
    connectionId?: string
  ) => Promise<void>;
  cleanup: () => void;
  reconnect: () => void;
  appendEvent: (event: TimelineEvent) => void;
  startIterativeDisplay: () => void;
  checkAndCompleteIfReady: () => void;
  reset: () => void;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

const buildTimelineUrl = (queryHash: string, override?: string) => {
  if (override && override.length > 0) {
    return override;
  }

  const trimmedBase = API_BASE_URL.replace(/\/$/, "");
  return `${trimmedBase}/timeline/${encodeURIComponent(queryHash)}`;
};

export const useTimelineStore = create<TimelineState>((set, get) => ({
  // Initial state
  queryHash: undefined,
  connectionId: undefined,
  events: [],
  displayedEvents: [],
  status: "idle",
  errorMsg: null,
  isDisplaying: false,
  pendingCompletion: null,
  seenEventIds: new Set(),
  reconnectAttempts: 0,
  displayTimerId: null,
  controllerRef: null,
  closedRef: false,
  onCompletedCallback: undefined,

  reset: () => {
    const state = get();
    
    // Clear display timer
    if (state.displayTimerId) {
      clearTimeout(state.displayTimerId);
    }

    // Abort any ongoing connection
    if (state.controllerRef) {
      state.controllerRef.abort();
    }

    set({
      queryHash: undefined,
      connectionId: undefined,
      events: [],
      displayedEvents: [],
      status: "idle",
      errorMsg: null,
      isDisplaying: false,
      pendingCompletion: null,
      seenEventIds: new Set(),
      reconnectAttempts: 0,
      displayTimerId: null,
      controllerRef: null,
      closedRef: false,
      onCompletedCallback: undefined,
    });
  },

  checkAndCompleteIfReady: () => {
    const state = get();
    
    // If we have a pending completion and all events are displayed, call the callback
    if (
      state.pendingCompletion &&
      !state.isDisplaying &&
      state.displayedEvents.length === state.events.length
    ) {
      state.onCompletedCallback?.(state.pendingCompletion);
      set({ pendingCompletion: null });
    }
  },

  appendEvent: (event: TimelineEvent) => {
    const state = get();

    if (!event?.event_id || state.seenEventIds.has(event.event_id)) {
      return;
    }

    const newSeenIds = new Set(state.seenEventIds);
    newSeenIds.add(event.event_id);

    set({
      events: [...state.events, event],
      seenEventIds: newSeenIds,
    });

    // Start iterative display if not already displaying
    if (!state.isDisplaying) {
      get().startIterativeDisplay();
    }
  },

  startIterativeDisplay: () => {
    const state = get();

    if (state.isDisplaying) {
      return;
    }

    set({ isDisplaying: true });

    const displayNextEvent = () => {
      const currentState = get();
      const { events, displayedEvents } = currentState;

      if (displayedEvents.length >= events.length) {
        // All events displayed
        set({ isDisplaying: false });
        // Check if we can complete now
        get().checkAndCompleteIfReady();
        return;
      }

      // Display next event
      const nextEvent = events[displayedEvents.length];
      set({
        displayedEvents: [...displayedEvents, nextEvent],
      });

      // Check if there are more events to display
      if (displayedEvents.length + 1 < events.length) {
        // Schedule next display with 2 second delay
        const timerId = window.setTimeout(() => {
          displayNextEvent();
        }, 2000);

        set({ displayTimerId: timerId });
      } else {
        // No more events to display right now
        set({ isDisplaying: false });
        // Check if we can complete now
        get().checkAndCompleteIfReady();
      }
    };

    // Start displaying events
    if (state.events.length > 0 && state.displayedEvents.length < state.events.length) {
      displayNextEvent();
    }
  },

  initializeTimeline: async (
    queryHash: string,
    accessToken: string,
    timelineUrl?: string,
    resultUrl?: string,
    onCompleted?: (result: SearchResultEnvelope) => void,
    connectionId?: string
  ) => {
    const state = get();

    if (
      connectionId &&
      state.queryHash === queryHash &&
      state.connectionId === connectionId &&
      state.status === "closed" &&
      state.events.length > 0 &&
      state.displayedEvents.length === state.events.length
    ) {
      set({ onCompletedCallback: onCompleted });
      return;
    }

    // Always cleanup previous connection to ensure fresh state
    if (state.controllerRef) {
      state.controllerRef.abort();
    }
    if (state.displayTimerId) {
      clearTimeout(state.displayTimerId);
    }

    // Always reset state for new query (even if same queryHash - could be cache hit test)
    set({
      queryHash,
      connectionId,
      events: [],
      displayedEvents: [],
      seenEventIds: new Set(),
      reconnectAttempts: 0,
      status: "connecting",
      errorMsg: null,
      closedRef: false,
      isDisplaying: false,
      pendingCompletion: null,
      onCompletedCallback: onCompleted,
      controllerRef: null,
      displayTimerId: null,
    });

    if (!accessToken) {
      set({
        status: "error",
        errorMsg: "Authentication required to stream timeline updates",
      });
      return;
    }

    const timelineTarget = buildTimelineUrl(queryHash, timelineUrl);
    const controller = new AbortController();
    set({ controllerRef: controller });

    const fetchFinal = async () => {
      try {
        const envelope = await fetchSearchResult(queryHash);

        if (envelope.status === "completed" && envelope.result) {
          // Don't add extra timeline events - the backend already sent them via SSE
          set({ 
            status: "closed",
            pendingCompletion: envelope,
          });
          // Check if we can complete now (all events displayed)
          get().checkAndCompleteIfReady();
        } else if (envelope.status === "failed") {
          set({
            errorMsg: envelope.error ?? "Search failed",
            status: "error",
          });
          // For failed searches, call callback immediately
          onCompleted?.(envelope);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        set({
          errorMsg: `Failed to fetch final result: ${message}`,
          status: "error",
        });
      }
    };

    const connect = async () => {
      const currentState = get();
      if (currentState.closedRef) {
        return;
      }

      set({
        status: "connecting",
        errorMsg: null,
      });

      try {
        await fetchEventSource(timelineTarget, {
          method: "GET",
          signal: controller.signal,
          headers: {
            Accept: "text/event-stream",
            Authorization: `Bearer ${accessToken}`,
          },
          credentials: "include",
          openWhenHidden: true,
          onopen: async (response) => {
            const contentType = response.headers.get("content-type") || "";
            if (!response.ok || !contentType.includes("text/event-stream")) {
              throw new Error(`Unexpected response: ${response.status}`);
            }
            set({
              reconnectAttempts: 0,
              status: "streaming",
            });
          },
          onmessage(message) {
            if (!message.data) return;
            try {
              const data = JSON.parse(message.data);
              get().appendEvent(data);
              
              // Close the SSE connection when we receive response.completed
              // This is a single-run result stream, no need to keep it open
              if (data.step === "response.completed") {
                // Mark as closed to prevent reconnection attempts
                set({ closedRef: true });
                
                // Abort the connection
                controller.abort();
                
                // Fetch final results
                fetchFinal();
              }
            } catch (err) {
              console.error("Failed to parse timeline event", err);
            }
          },
          onclose() {
            const currentState = get();
            if (!currentState.closedRef) {
              throw new Error("Timeline connection closed");
            }
          },
          onerror(err) {
            throw err;
          },
        });
      } catch (err) {
        const currentState = get();
        if (controller.signal.aborted || currentState.closedRef) {
          return;
        }

        console.warn("Timeline stream error", err);
        set({
          status: "error",
          errorMsg: "Connection lost, attempting to reconnect",
        });

        const attempt = currentState.reconnectAttempts;
        const delay = Math.min(30000, 500 * Math.pow(2, attempt));
        
        set({ reconnectAttempts: attempt + 1 });

        setTimeout(() => {
          const state = get();
          if (!state.closedRef) {
            connect();
          }
        }, delay);
      }
    };

    connect();
  },

  cleanup: () => {
    const state = get();

    set({ closedRef: true });

    if (state.controllerRef) {
      state.controllerRef.abort();
    }

    if (state.displayTimerId) {
      clearTimeout(state.displayTimerId);
    }
  },

  reconnect: () => {
    const state = get();
    
    if (!state.queryHash) {
      return;
    }

    set({
      reconnectAttempts: 0,
      errorMsg: null,
      status: "connecting",
      closedRef: false,
    });

    // Re-initialize with existing query hash
    // Note: This requires storing the original parameters
    // For now, we'll just reset the connection state
  },
}));
