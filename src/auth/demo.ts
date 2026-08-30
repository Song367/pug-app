export { isDemoSessionAtom } from './session.atoms'

// Build-time gate for the sign-in page's "Explore the live demo" link, driven by VITE_DEMO_ENABLED.
// It does NOT gate the /demo route itself (which always runs and surfaces the backend's Unavailable
// response when the demo is off), nor the in-app demo banner (that follows the active demo session —
// see isDemoSessionAtom). The real switch is the server's PUG_DEMO_ENABLED; this flag only decides
// whether to advertise the demo from sign-in in this build.
export function isDemoEnabled() {
  return (import.meta.env.VITE_DEMO_ENABLED ?? '').trim() === 'true'
}
