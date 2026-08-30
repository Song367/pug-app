import { useSetAtom } from 'jotai'
import { useEffect } from 'react'
import { bootstrapSessionAtom, refreshSessionAtom, subscribeToSessionChanges } from './session.atoms'

export const SessionSync = () => {
  const bootstrap = useSetAtom(bootstrapSessionAtom)
  const refresh = useSetAtom(refreshSessionAtom)

  useEffect(() => {
    void bootstrap()
    return subscribeToSessionChanges(() => {
      void refresh()
    })
  }, [bootstrap, refresh])

  return null
}
