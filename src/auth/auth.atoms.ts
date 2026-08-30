import { Code, ConnectError } from '@connectrpc/connect'
import { atom, type Getter, type Setter } from 'jotai'
import { toast } from 'sonner'
import { trackEvent } from '@/analytics/pug'
import type { GetMeResponse } from '@/api/genproto/dashboard/customers/v1/customers_pb'
import type { AuthProviderConfig } from '@/api/genproto/public/auth/v1/auth_pb'
import { authRPCAtom, customersRPCAtom, sessionAuthRPCAtom } from '@/api/rpc'
import { resetWorkspaceAtom } from '@/data/workspace.atoms'
import { browserTimezone } from '@/lib/timezone'
import { isDemoEnabled } from './demo'
import { mapOAuthConnectError } from './oauth'
import { applyGatewaySession, clearClientSession, customerIdAtom, publishSessionChange } from './session.atoms'

export { isAuthenticatedAtom } from './session.atoms'

// Result shape shared by every auth write atom: `error` is present iff the call failed.
export type AuthResult = { ok: true } | { ok: false; error: string }

// A ConnectError's own fields survive console serialization; the whole error doesn't.
const connectDetail = (err: unknown) => (err instanceof ConnectError ? { code: err.code, message: err.message } : err)

// Suspends the signed-out canvas briefly while the public config loads.
export const authProvidersAtom = atom(async get => {
  try {
    const response = await get(authRPCAtom).getAuthConfig({})
    return response.providers
  } catch (error) {
    // Swallowed so provider discovery can't take password or magic-link sign-in down with it.
    // null rather than []: an empty list means "none configured", and sign-in hides SSO on that.
    console.error('Could not load external auth providers', error)
    return null
  }
})

// Build-time gate for the sign-in page's "Explore the live demo" link — not the in-app banner,
// which follows the active demo session (see isDemoSessionAtom).
export const demoEnabledAtom = atom(() => isDemoEnabled())

export const signInAtom = atom(
  null,
  async (get, set, { email, password }: { email: string; password: string }): Promise<AuthResult> => {
    const authRPC = get(authRPCAtom)
    try {
      await authRPC.signInWithEmail({ email, password })
      await set(applySessionAtom, { method: 'password' })
      return { ok: true }
    } catch (error) {
      if (!(error instanceof ConnectError)) console.error('signIn unexpected error', error)
      const msg = error instanceof ConnectError ? error.message : 'Sign in failed'
      return { ok: false, error: msg }
    }
  },
)

export type Me = Pick<GetMeResponse, 'customerId' | 'email' | 'emailVerified'>
type MeStatus = 'idle' | 'loading' | 'ready' | 'error'

// Current signed-in customer. email is NOT in the JWT, so it must come from GetMe. Keyed by customer
// (the projectsOrgIdAtom pattern) so a switch invalidates both without anyone remembering to — a
// teardown back to the *same* customer still needs the explicit clear.
const meResultAtom = atom<Me | null>(null)
const meStatusRawAtom = atom<MeStatus>('idle')
const meCustomerAtom = atom<string | undefined>(undefined)

const meIsCurrent = (get: Getter) => get(meCustomerAtom) === get(customerIdAtom)

export const meAtom = atom(get => (meIsCurrent(get) ? get(meResultAtom) : null))
export const meStatusAtom = atom(get => (meIsCurrent(get) ? get(meStatusRawAtom) : 'idle'))

const clearMe = (set: Setter) => {
  set(meResultAtom, null)
  set(meStatusRawAtom, 'idle')
  set(meCustomerAtom, undefined)
}

// How the session was obtained. Threaded in rather than inferred so every path that mints a
// session has to say which it is — a new one is a type error until it answers.
export type SignInMethod = 'password' | 'magic_link' | 'oidc' | 'demo'

// Applies the non-secret session state returned by the same-origin gateway. Raw
// access/refresh tokens never enter this process. Password, magic link, OIDC and
// demo all funnel here after the gateway has set its HttpOnly cookie.
//
// Does NOT reset the workspace when the new token names a different account: WorkspaceBootstrap
// watches customerIdAtom and does it for every switch, in-tab and cross-tab alike (see App.tsx).
// Doing it here too only moved the same reset one render earlier, and nothing is mounted in that
// render to care — every path that can reach here with a live session is on /magic-link or /demo,
// which render standalone, and AnalyticsIdentity already resets its own identity on the switch.
const applySessionAtom = atom(null, async (_get, set, { method }: { method: SignInMethod }) => {
  await applyGatewaySession(set)
  clearMe(set)
  publishSessionChange()
  trackEvent('signin', { method })
})

// Connect applies no deadline of its own, so without this a hung call parks the status on 'loading'
// for the life of the page. Surfaces as DeadlineExceeded through the catch below.
const GET_ME_DEADLINE_MS = 10_000

export const fetchMeAtom = atom(null, async (get, set) => {
  const customerId = get(customerIdAtom)
  const customersRPC = get(customersRPCAtom)
  // Or the previous account's address stays readable under the new key while the request runs.
  if (get(meCustomerAtom) !== customerId) set(meResultAtom, null)
  set(meCustomerAtom, customerId)
  set(meStatusRawAtom, 'loading')
  // A response outlives its request: switch account mid-flight and committing it would key one
  // customer's email to another.
  const stale = () => get(customerIdAtom) !== customerId

  // Abandoning has to release the key, not just decline to write. 'loading' left standing under a
  // customer nobody is fetching for is invisible — the reads below mask it — right up until the
  // session returns to that customer, and then it unmasks as a state no one owns: too far along to
  // trigger a refetch, never far enough to open the identify gate. Only release what we still hold;
  // a newer call for another customer has its own 'loading' in there.
  const abandon = () => {
    if (get(meCustomerAtom) === customerId) clearMe(set)
    return null
  }

  try {
    const resp = await customersRPC.getMe({}, { timeoutMs: GET_ME_DEADLINE_MS })
    if (stale()) return abandon()
    const me = { customerId: resp.customerId, email: resp.email, emailVerified: resp.emailVerified }
    set(meResultAtom, me)
    set(meStatusRawAtom, 'ready')
    return me
  } catch (err) {
    // Logged whatever the type, unlike the sign-in atoms above: both callers discard the return, so
    // a ConnectError (Unauthenticated from a transient refresh) would otherwise leave no trace.
    console.error('fetchMe failed', connectDetail(err))
    if (stale()) return abandon()
    // Result left as-is: a failed refresh of the same customer keeps the address it already had.
    set(meStatusRawAtom, 'error')
    return null
  }
})

export const requestMagicLinkAtom = atom(null, async (get, _set, { email }: { email: string }): Promise<AuthResult> => {
  const authRPC = get(authRPCAtom)
  try {
    await authRPC.requestMagicLink({ email })
    return { ok: true }
  } catch (error) {
    if (!(error instanceof ConnectError)) console.error('requestMagicLink unexpected error', error)
    const msg = error instanceof ConnectError ? error.message : 'Could not send the sign-in link'
    return { ok: false, error: msg }
  }
})

// Magic-link sign-in or sign-up; session handling (gateway state, me state reset, demo marker) is
// delegated to applySessionAtom. The workspace reset is not its job — WorkspaceBootstrap watches
// customerIdAtom and rebuilds on a switch (see App.tsx).
export const completeMagicLinkAtom = atom(null, async (get, set, { token }: { token: string }): Promise<AuthResult> => {
  const authRPC = get(authRPCAtom)
  try {
    // Seed the auto-created default project's reporting zone from the browser.
    // Malformed/empty values are coerced to UTC server-side; correct later in settings.
    await authRPC.completeMagicLink({ token, timezone: browserTimezone() })
    await set(applySessionAtom, { method: 'magic_link' })
    return { ok: true }
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.InvalidArgument) {
      return { ok: false, error: 'This link is invalid or has expired. Request a new one.' }
    }
    if (!(error instanceof ConnectError)) console.error('completeMagicLink unexpected error', error)
    return { ok: false, error: error instanceof ConnectError ? error.message : 'Could not sign you in.' }
  }
})

export const completeOIDCAtom = atom(
  null,
  async (
    get,
    set,
    {
      provider,
      code,
      codeVerifier,
      redirectURI,
      nonce,
    }: {
      provider: AuthProviderConfig
      code: string
      codeVerifier: string
      redirectURI: string
      nonce: string
    },
  ): Promise<AuthResult> => {
    const authRPC = get(authRPCAtom)
    try {
      // timezone seeds the auto-created project's reporting zone (parity with completeMagicLink).
      await authRPC.completeOIDCSignIn({
        providerId: provider.id,
        code,
        codeVerifier,
        redirectUri: redirectURI,
        nonce,
        timezone: browserTimezone(),
      })
      await set(applySessionAtom, { method: 'oidc' })
      return { ok: true }
    } catch (error) {
      return { ok: false, error: mapOAuthConnectError(error, provider.displayName) }
    }
  },
)

// Credential-less sign-in for the public read-only demo viewer (snoop@pug.sh). The gateway stores
// the resulting token pair server-side; viewer mode follows from the
// account's ORG_ROLE_VIEWER membership, which WorkspaceBootstrap loads into activeOrgAtom and
// currentRoleAtom reads, flipping useCan() read-only. We deliberately ignore the response's
// projectId rather than pinning it as x-project-id: correctness instead relies on the demo account
// being seeded with exactly one project, so WorkspaceBootstrap's default pick (projects[0]) is it.
// The frontend does no ordering of its own — revisit (pin projectId) if the demo account ever gains
// a second project, or it could scope the demo to the wrong data.
export const demoSignInAtom = atom(null, async (get, set): Promise<AuthResult> => {
  const authRPC = get(authRPCAtom)
  try {
    await authRPC.demoSignIn({})
    await set(applySessionAtom, { method: 'demo' })
    return { ok: true }
  } catch (error) {
    // Unavailable = PUG_DEMO_ENABLED off or the demo account isn't seeded — expected, not a bug, so
    // don't log it. Anything else (Internal, PermissionDenied, ResourceExhausted, or a non-Connect
    // JS error) is unexpected; log it before the generic copy, or a "demo is down" incident leaves
    // no frontend trace at all.
    if (error instanceof ConnectError && error.code === Code.Unavailable) {
      return { ok: false, error: "The live demo isn't available right now." }
    }
    console.error('demoSignIn failed', connectDetail(error))
    return { ok: false, error: 'Could not start the demo. Please try again.' }
  }
})

export const signOutAtom = atom(null, async (get, set) => {
  // Ahead of the clear, and of the reset() the identity sync fires once the session is gone: track()
  // stamps the distinct ID at call time, so this is the last moment the event can be attributed to
  // the user who is leaving rather than to a fresh anonymous ID.
  trackEvent('signout')

  try {
    // The gateway reads its server-side refresh token, revokes that family and
    // expires the HttpOnly cookie. The browser deliberately sends no token.
    await get(sessionAuthRPCAtom).signOut({})
  } catch (err) {
    console.error('secure sign-out failed', err)
    if (err instanceof ConnectError && err.code === Code.Unauthenticated) {
      clearClientSession(set)
      clearMe(set)
      set(resetWorkspaceAtom)
      publishSessionChange()
      return
    }
    toast.error('Could not sign out securely. Please try again.')
    return
  }
  clearClientSession(set)
  clearMe(set)
  set(resetWorkspaceAtom)
  publishSessionChange()
})
