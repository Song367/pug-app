import { atom, getDefaultStore, type Setter } from 'jotai'

const sessionStatusPath = '/_pug/session'
const legacyTokenKeys = ['pug:jwt', 'pug:refresh'] as const
const sessionEventKey = 'pug:session-event'
const sessionChannelName = 'pug:session'
const opaqueTokenPattern = /^[A-Za-z0-9_-]{43}$/

export type SessionState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'error'; error: string }
  | { status: 'authenticated'; customerId: string; csrfToken: string; demo: boolean }

interface GatewaySessionResponse {
  authenticated: boolean
  customerId?: string
  csrfToken?: string
  demo?: boolean
}

export const sessionStateAtom = atom<SessionState>({ status: 'loading' })
export const isAuthenticatedAtom = atom(get => get(sessionStateAtom).status === 'authenticated')
export const customerIdAtom = atom(get => {
  const session = get(sessionStateAtom)
  return session.status === 'authenticated' ? session.customerId : undefined
})
export const csrfTokenAtom = atom(get => {
  const session = get(sessionStateAtom)
  return session.status === 'authenticated' ? session.csrfToken : ''
})
export const isDemoSessionAtom = atom(get => {
  const session = get(sessionStateAtom)
  return session.status === 'authenticated' && session.demo
})

const purgeLegacyBrowserTokens = () => {
  for (const key of legacyTokenKeys) {
    try {
      localStorage.removeItem(key)
    } catch {
      // The app's storage guard owns the unsupported-browser message. Session
      // bootstrap still fails closed if a browser revokes storage afterwards.
    }
  }
}

let sessionRequest: Promise<SessionState> | null = null

const requestGatewaySession = (): Promise<SessionState> => {
  if (sessionRequest) return sessionRequest
  const request = (async (): Promise<SessionState> => {
    purgeLegacyBrowserTokens()
    const response = await fetch(new URL(sessionStatusPath, window.location.origin), {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`session gateway returned ${response.status}`)
    const raw = (await response.json()) as GatewaySessionResponse
    if (raw.authenticated !== true) return { status: 'anonymous' }
    if (
      typeof raw.customerId !== 'string' ||
      raw.customerId.length === 0 ||
      typeof raw.csrfToken !== 'string' ||
      !opaqueTokenPattern.test(raw.csrfToken) ||
      typeof raw.demo !== 'boolean'
    ) {
      throw new Error('session gateway returned an invalid authenticated state')
    }
    return {
      status: 'authenticated',
      customerId: raw.customerId,
      csrfToken: raw.csrfToken,
      demo: raw.demo,
    }
  })()
  sessionRequest = request.finally(() => {
    sessionRequest = null
  })
  return sessionRequest
}

export const syncSessionState = async (): Promise<SessionState> => {
  const next = await requestGatewaySession()
  getDefaultStore().set(sessionStateAtom, next)
  return next
}

export const bootstrapSessionAtom = atom(null, async (_get, set) => {
  set(sessionStateAtom, { status: 'loading' })
  try {
    const next = await requestGatewaySession()
    set(sessionStateAtom, next)
    return next
  } catch (error) {
    console.error('secure session bootstrap failed', error)
    const failed: SessionState = { status: 'error', error: 'The secure session service is unavailable.' }
    set(sessionStateAtom, failed)
    return failed
  }
})

// Cross-tab refresh is deliberately non-destructive on transport errors. A
// failed status request is not evidence that the server-side session ended.
export const refreshSessionAtom = atom(null, async (_get, set) => {
  try {
    const next = await requestGatewaySession()
    set(sessionStateAtom, next)
    return next
  } catch (error) {
    console.error('cross-tab session sync failed', error)
    return null
  }
})

export const applyGatewaySession = async (set: Setter): Promise<Extract<SessionState, { status: 'authenticated' }>> => {
  const next = await requestGatewaySession()
  if (next.status !== 'authenticated') throw new Error('gateway did not establish an authenticated session')
  set(sessionStateAtom, next)
  return next
}

export const clearClientSession = (set: Setter) => {
  purgeLegacyBrowserTokens()
  set(sessionStateAtom, { status: 'anonymous' })
}

export const publishSessionChange = () => {
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(sessionChannelName)
    channel.postMessage('changed')
    channel.close()
  }
  try {
    localStorage.setItem(sessionEventKey, crypto.randomUUID())
  } catch {
    // BroadcastChannel already handled modern browsers; the storage fallback
    // is best-effort and contains no identity or credential data.
  }
}

export const subscribeToSessionChanges = (onChange: () => void) => {
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(sessionChannelName)
  const onMessage = () => onChange()
  channel?.addEventListener('message', onMessage)
  const onStorage = (event: StorageEvent) => {
    if (event.key === sessionEventKey) onChange()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    channel?.removeEventListener('message', onMessage)
    channel?.close()
    window.removeEventListener('storage', onStorage)
  }
}
