import { createRegistry } from '@bufbuild/protobuf'
import { createValidator } from '@bufbuild/protovalidate'
import { Code, ConnectError, type Interceptor } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'
import { atom, getDefaultStore } from 'jotai'
import { toast } from 'sonner'
import { file_common_v1_filters } from '@/api/genproto/common/v1/filters_pb'
import { file_public_dashboards_v1_dashboards } from '@/api/genproto/public/dashboards/v1/dashboards_pb'
import { file_shared_insights_v1_insights } from '@/api/genproto/shared/insights/v1/insights_pb'
import { csrfTokenAtom, sessionStateAtom, syncSessionState } from '@/auth/session.atoms'

const validator = createValidator({
  registry: createRegistry(
    file_common_v1_filters,
    file_shared_insights_v1_insights,
    file_public_dashboards_v1_dashboards,
  ),
})

const protovalidate: Interceptor = next => async req => {
  if (!req.stream) {
    const result = validator.validate(req.method.input, req.message)
    if (result.kind === 'invalid') {
      throw new ConnectError(result.violations.map(v => `${v.field}: ${v.message}`).join('; '))
    }
    if (result.kind === 'error') {
      throw new ConnectError(`Proto validation error: ${result.error}`)
    }
  }
  return next(req)
}

const store = getDefaultStore()

const sessionCSRF: Interceptor = next => async req => {
  const csrfToken = store.get(csrfTokenAtom)
  if (csrfToken) req.header.set('x-pug-csrf-token', csrfToken)
  try {
    return await next(req)
  } catch (error) {
    if (!(error instanceof ConnectError) || error.code !== Code.Unauthenticated) throw error

    const before = store.get(sessionStateAtom)
    try {
      const after = await syncSessionState()
      if (before.status === 'authenticated' && after.status === 'anonymous') {
        toast.error('Session expired — please sign in again')
      }
    } catch (syncError) {
      // Keep the existing client state on infrastructure noise. The original
      // request error remains the one callers see.
      console.error('session status refresh failed', syncError)
    }
    throw error
  }
}

const credentialedFetch: typeof fetch = (input, init) =>
  fetch(input, {
    ...init,
    credentials: 'same-origin',
  })

const transport = (interceptors: Interceptor[]) =>
  createConnectTransport({
    baseUrl: window.location.origin,
    interceptors,
    defaultTimeoutMs: 60_000,
    fetch: credentialedFetch,
  })

export const transportAtom = atom(() => transport([sessionCSRF, protovalidate]))

// SignOut belongs to AuthService but requires the active session's CSRF token.
// Login, magic-link, OIDC and provider discovery use publicTransportAtom below.
export const sessionTransportAtom = atom(() => transport([sessionCSRF, protovalidate]))

// Public RPCs never receive a bearer or CSRF token. Cookies are still sent by
// the browser because the gateway needs to replace an existing session safely.
export const publicTransportAtom = atom(() => transport([protovalidate]))
