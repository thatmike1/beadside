// follows the server's /api/events stream; while it reports live, polling stands down

import { useEffect, useState } from 'react'
import type { QueryClient } from '@tanstack/react-query'

/** true while the server pushes ledger changes; false means poll */
export function useLive(qc: QueryClient): boolean {
  const [live, setLive] = useState(false)

  useEffect(() => {
    if (typeof EventSource === 'undefined') return
    const source = new EventSource('/api/events')
    const refetch = () => {
      void qc.invalidateQueries({ queryKey: ['issues'] })
      void qc.invalidateQueries({ queryKey: ['search'] })
      void qc.invalidateQueries({ queryKey: ['issue'] })
    }
    source.addEventListener('state', (event) => {
      try {
        const { live: next } = JSON.parse((event as MessageEvent<string>).data) as { live?: unknown }
        setLive(next === true)
      } catch {
        setLive(false)
      }
      // a connect or reconnect may have missed changes
      refetch()
    })
    source.addEventListener('changed', refetch)
    // EventSource reconnects on its own; poll until the next `state` says otherwise
    source.onerror = () => setLive(false)
    return () => source.close()
  }, [qc])

  return live
}
