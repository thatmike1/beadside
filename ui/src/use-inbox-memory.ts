// what the inbox remembers: replies already opened, and the day's stale picks. both live in
// bd's key-value store through the server, so a reply read on the phone board counts as read
// on the desktop once their syncs meet

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from './api'
import type { InboxState, Issue } from './api'
import { dailyPicks } from './inbox'

// the browser-local keys this replaced; cleared so a stale copy never comes back
try {
  window.localStorage.removeItem('beadside:seen')
  window.localStorage.removeItem('beadside:stale-picks')
} catch {
  // storage blocked: nothing to clear
}

/** how long a read of the shared state serves before a focus refetches it */
const STATE_STALE_MS = 30_000

const EMPTY: InboxState = { device: '', seen: {}, picks: null }

export interface InboxMemory {
  /** false until the first read answered or failed, so unread rows never flash */
  ready: boolean
  /** per bead, the agent reply it was last opened at, on any device */
  seen: Record<string, string>
  markSeen: (id: string, at: string) => void
  /** today's stale picks, drawn by the first device to open the board today */
  picks: string[]
}

const newer = (a: string | undefined, b: string) => !a || Date.parse(a) < Date.parse(b)

/** the shared inbox state for one day; `stale` is null until the issue list has loaded */
export function useInboxMemory(day: string, stale: Issue[] | null, onError: (message: string) => void): InboxMemory {
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: ['inbox-state', day],
    queryFn: () => api.getInboxState(day),
    staleTime: STATE_STALE_MS,
    refetchOnWindowFocus: true,
    retry: 1,
  })
  const state = query.data ?? EMPTY
  // marks sent this page, laid over the server's answer so a refetch racing a write keeps them
  const [local, setLocal] = useState<Record<string, string>>({})
  const seen = useMemo(() => {
    const merged = { ...state.seen }
    for (const [id, at] of Object.entries(local)) if (newer(merged[id], at)) merged[id] = at
    return merged
  }, [state.seen, local])

  const errorRef = useRef(onError)
  errorRef.current = onError
  const markSeen = useCallback(
    (id: string, at: string) => {
      setLocal((prev) => (newer(prev[id], at) ? { ...prev, [id]: at } : prev))
      api.markSeen(id, at).catch((error: unknown) => {
        errorRef.current(`could not store ${id} as read: ${error instanceof Error ? error.message : 'write failed'}`)
      })
    },
    [],
  )

  // a day nobody has drawn for yet: draw once the stale list is in, store it, and take whatever
  // the server says holds (another device's three when it drew first)
  const drawn = useRef<string | null>(null)
  const [ownDraw, setOwnDraw] = useState<{ day: string; ids: string[] } | null>(null)
  const needDraw = query.isSuccess && !state.picks && stale !== null
  useEffect(() => {
    if (!needDraw || drawn.current === day) return
    drawn.current = day
    const picks = dailyPicks(stale, day, null)
    setOwnDraw(picks)
    api
      .setStalePicks(picks)
      .then((next) => qc.setQueryData(['inbox-state', day], next))
      .catch((error: unknown) => {
        errorRef.current(`could not store the stale picks: ${error instanceof Error ? error.message : 'write failed'}`)
      })
  }, [needDraw, stale, day, qc])

  // with the store unreachable the day still gets its three, held only by the date seed
  const fallback = useMemo(
    () => (query.isError && stale ? dailyPicks(stale, day, null).ids : null),
    [query.isError, stale, day],
  )
  const picks = state.picks?.ids ?? (ownDraw?.day === day ? ownDraw.ids : (fallback ?? []))
  return { ready: query.isSuccess || query.isError, seen, markSeen, picks }
}
