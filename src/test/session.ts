import type { SessionState } from '@/auth/session.atoms'

export const authenticatedSession = (customerId = 'cust-1', demo = false): SessionState => ({
  status: 'authenticated',
  customerId,
  csrfToken: 'A'.repeat(43),
  demo,
})

export const anonymousSession = (): SessionState => ({ status: 'anonymous' })
