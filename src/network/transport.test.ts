import type { Interceptor } from '@connectrpc/connect'
import { createStore, getDefaultStore } from 'jotai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticatedSession } from '@/test/session'

const createConnectTransport = vi.hoisted(() => vi.fn((options: unknown) => options))

vi.mock('@connectrpc/connect-web', () => ({ createConnectTransport }))

const { publicTransportAtom, transportAtom } = await import('./transport')
const { sessionStateAtom } = await import('@/auth/session.atoms')

interface CapturedTransportOptions {
  baseUrl: string
  interceptors: Interceptor[]
  fetch: typeof fetch
}

const lastOptions = () => createConnectTransport.mock.calls.at(-1)?.[0] as CapturedTransportOptions

describe('same-origin gateway transport', () => {
  beforeEach(() => {
    createConnectTransport.mockClear()
    getDefaultStore().set(sessionStateAtom, { status: 'anonymous' })
  })

  it('targets the page origin and sends cookies with every request', async () => {
    const browserFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', browserFetch)

    createStore().get(transportAtom)
    const options = lastOptions()
    await options.fetch(`${window.location.origin}/dashboard`, { method: 'POST' })

    expect(options.baseUrl).toBe(window.location.origin)
    expect(browserFetch).toHaveBeenCalledWith(
      `${window.location.origin}/dashboard`,
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' }),
    )
  })

  it('adds only the in-memory CSRF token to authenticated RPCs', async () => {
    getDefaultStore().set(sessionStateAtom, authenticatedSession())
    createStore().get(transportAtom)
    const csrfInterceptor = lastOptions().interceptors[0]
    let observed = ''
    const next = vi.fn(async (request: { header: Headers }) => {
      observed = request.header.get('x-pug-csrf-token') ?? ''
      return {}
    }) as unknown as Parameters<Interceptor>[0]
    const run = csrfInterceptor(next)

    await run({ header: new Headers() } as unknown as Parameters<typeof run>[0])

    expect(observed).toBe('A'.repeat(43))
  })

  it('keeps public RPCs outside the authenticated interceptor', () => {
    createStore().get(publicTransportAtom)

    expect(lastOptions().baseUrl).toBe(window.location.origin)
    expect(lastOptions().interceptors).toHaveLength(1)
  })
})
