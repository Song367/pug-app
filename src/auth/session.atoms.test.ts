import { createStore } from 'jotai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticatedSession } from '@/test/session'
import { bootstrapSessionAtom, refreshSessionAtom, sessionStateAtom } from './session.atoms'

const response = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const authenticatedBody = {
  authenticated: true,
  customerId: 'cust-1',
  csrfToken: 'A'.repeat(43),
  demo: false,
}

describe('secure gateway session state', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('purges legacy browser tokens and keeps only non-secret session state', async () => {
    localStorage.setItem('pug:jwt', JSON.stringify('access-secret'))
    localStorage.setItem('pug:refresh', JSON.stringify('refresh-secret'))
    vi.mocked(fetch).mockResolvedValue(response(authenticatedBody))
    const store = createStore()

    await store.set(bootstrapSessionAtom)

    expect(localStorage.getItem('pug:jwt')).toBeNull()
    expect(localStorage.getItem('pug:refresh')).toBeNull()
    expect(store.get(sessionStateAtom)).toEqual({
      status: 'authenticated',
      customerId: 'cust-1',
      csrfToken: 'A'.repeat(43),
      demo: false,
    })
    expect(fetch).toHaveBeenCalledWith(
      new URL('/_pug/session', window.location.origin),
      expect.objectContaining({ method: 'GET', credentials: 'same-origin', cache: 'no-store' }),
    )
  })

  it('fails closed when authenticated state omits a valid opaque CSRF token', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(fetch).mockResolvedValue(response({ ...authenticatedBody, csrfToken: 'too-short' }))
    const store = createStore()

    await store.set(bootstrapSessionAtom)

    expect(store.get(sessionStateAtom)).toEqual({
      status: 'error',
      error: 'The secure session service is unavailable.',
    })
  })

  it('maps an explicit anonymous response to a signed-out state', async () => {
    vi.mocked(fetch).mockResolvedValue(response({ authenticated: false }))
    const store = createStore()

    await store.set(bootstrapSessionAtom)

    expect(store.get(sessionStateAtom)).toEqual({ status: 'anonymous' })
  })

  it('keeps a valid session on transient cross-tab status failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(fetch).mockRejectedValue(new Error('gateway unavailable'))
    const store = createStore()
    store.set(sessionStateAtom, authenticatedSession())

    await expect(store.set(refreshSessionAtom)).resolves.toBeNull()

    expect(store.get(sessionStateAtom)).toEqual(authenticatedSession())
  })

  it('deduplicates simultaneous status requests', async () => {
    let land!: (value: Response) => void
    vi.mocked(fetch).mockReturnValue(
      new Promise(resolve => {
        land = resolve
      }),
    )
    const first = createStore()
    const second = createStore()

    const firstLoad = first.set(bootstrapSessionAtom)
    const secondLoad = second.set(bootstrapSessionAtom)
    expect(fetch).toHaveBeenCalledTimes(1)

    land(response(authenticatedBody))
    await Promise.all([firstLoad, secondLoad])

    expect(first.get(sessionStateAtom)).toEqual(authenticatedSession())
    expect(second.get(sessionStateAtom)).toEqual(authenticatedSession())
  })
})
