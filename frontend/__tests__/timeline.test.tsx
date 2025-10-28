import React from 'react'
import { render, screen, waitFor, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock, MockInstance } from 'vitest'

import Timeline from '../components/Timeline'

import { useAuthStore } from '@/lib/auth-store'
import { fetchEventSource } from '@microsoft/fetch-event-source'
import { fetchSearchResult } from '@/utils/api'

vi.mock('@microsoft/fetch-event-source', () => ({
  fetchEventSource: vi.fn(),
}))

vi.mock('@/utils/api', () => ({
  fetchSearchResult: vi.fn(),
}))

const fetchEventSourceMock = fetchEventSource as unknown as Mock
const fetchSearchResultMock = fetchSearchResult as unknown as Mock

type HandlerBundle = {
  onopen?: (response: Response) => Promise<void> | void
  onmessage?: (message: { data: string }) => void
  onclose?: () => void
  onerror?: (error: unknown) => void
}

describe('Timeline', () => {
  const handlers: HandlerBundle = {}
  let consoleErrorSpy: MockInstance | null = null

  beforeEach(() => {
    useAuthStore.setState({
      status: 'authenticated',
      accessToken: 'test-token',
      expiresAt: Date.now() + 60_000,
      user: { role: 'user' },
    } as any)

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    fetchEventSourceMock.mockImplementation((_url: string, options: any) => {
      handlers.onopen = options.onopen
      handlers.onmessage = options.onmessage
      handlers.onclose = options.onclose
      handlers.onerror = options.onerror

      const response = new Response(null, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
      return act(async () => {
        await options.onopen?.(response)
      }).then(() => new Promise<void>(() => {}))
    })

    fetchSearchResultMock.mockResolvedValue({
      query_hash: 'test-hash-1',
      status: 'completed',
      result: {
        query: 'test',
        count: 1,
        results: [],
      },
    })
  })

  afterEach(() => {
    useAuthStore.setState({
      status: 'unauthenticated',
      accessToken: undefined,
      expiresAt: undefined,
      user: undefined,
    })
    fetchEventSourceMock.mockReset()
    fetchSearchResultMock.mockReset()
    handlers.onopen = undefined
    handlers.onmessage = undefined
    handlers.onclose = undefined
    handlers.onerror = undefined
    consoleErrorSpy?.mockRestore()
    consoleErrorSpy = null
  })

  it('renders and receives events and final result', async () => {
    const q = 'test-hash-1'
    const onCompleted = vi.fn()
    await act(async () => {
      render(<Timeline queryHash={q} onCompleted={onCompleted} />)
    })

    await waitFor(() => expect(fetchEventSourceMock).toHaveBeenCalled())

    expect(fetchEventSourceMock.mock.calls[0][0]).toContain(`/timeline/${q}`)
    const options = fetchEventSourceMock.mock.calls[0][1]
    expect(options.headers.Authorization).toBe('Bearer test-token')

    await act(async () => {
      handlers.onmessage?.({
        data: JSON.stringify({
          event_id: 'e1',
          query_hash: q,
          step: 'search.requested',
          timestamp: new Date().toISOString(),
          payload: { q },
        }),
      })
      handlers.onmessage?.({
        data: JSON.stringify({
          event_id: 'e2',
          query_hash: q,
          step: 'search.engine.started',
          timestamp: new Date().toISOString(),
          payload: { info: 1 },
        }),
      })
    })

  await waitFor(() => expect(screen.getByText(/search requested/i)).toBeInTheDocument())
  expect(screen.getByText(/search engine started/i)).toBeInTheDocument()

    await act(async () => {
      handlers.onmessage?.({
        data: JSON.stringify({
          event_id: 'e3',
          query_hash: q,
          step: 'response.completed',
          timestamp: new Date().toISOString(),
          payload: {},
        }),
      })
      await Promise.resolve()
    })

    await waitFor(() => expect(onCompleted).toHaveBeenCalled())
  expect(screen.getByText(/search completed/i)).toBeInTheDocument()
  })
})
