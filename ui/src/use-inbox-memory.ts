// what the inbox remembers per browser: replies already opened, and the day's stale picks

import { useCallback, useEffect, useState } from 'react'
import type { Issue } from './api'
import { dailyPicks, type StalePicks } from './inbox'

const SEEN_KEY = 'beadside:seen'
const PICKS_KEY = 'beadside:stale-picks'

function readJson(key: string): unknown {
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? 'null')
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage full or blocked: the state still holds for this page
  }
}

function readSeen(): Record<string, string> {
  const parsed = readJson(SEEN_KEY)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
  return Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

function readPicks(): StalePicks | null {
  const parsed = readJson(PICKS_KEY) as Partial<StalePicks> | null
  if (!parsed || typeof parsed.day !== 'string' || !Array.isArray(parsed.ids)) return null
  return { day: parsed.day, ids: parsed.ids.filter((id): id is string => typeof id === 'string') }
}

export interface Seen {
  /** per bead, the agent reply it was last opened at */
  seen: Record<string, string>
  markSeen: (id: string, at: string) => void
}

/** per-bead seen markers for agent replies, kept like folds */
export function useSeen(): Seen {
  const [seen, setSeen] = useState<Record<string, string>>(readSeen)
  const markSeen = useCallback((id: string, at: string) => {
    setSeen((prev) => {
      if (prev[id] === at) return prev
      const next = { ...prev, [id]: at }
      writeJson(SEEN_KEY, next)
      return next
    })
  }, [])
  return { seen, markSeen }
}

/** today's stale picks, drawn once a day and stored so they hold across reloads */
export function useStalePicks(stale: Issue[] | null, day: string): string[] {
  const [stored, setStored] = useState<StalePicks | null>(readPicks)
  // wait for the list before drawing, or an empty first render would store an empty pick
  const picks = stale ? dailyPicks(stale, day, stored) : stored?.day === day ? stored : null
  useEffect(() => {
    if (!picks || picks === stored) return
    writeJson(PICKS_KEY, picks)
    setStored(picks)
  }, [picks, stored])
  return picks?.ids ?? []
}
