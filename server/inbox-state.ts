// what the inbox remembers across devices, kept in bd's key-value store so it travels with
// `bd sync`. each board writes only keys carrying its own device name: two replicas setting
// one key to different values halt `bd sync` with a merge conflict, distinct keys merge.
//
//   beadside.seen.<device>.<bead id>   the agent_reply.at the bead was opened at
//   beadside.picks.<device>            {"day":"2026-10-13","ids":[...],"at":"<iso>"}

import { hostname } from 'node:os'
import { BdError, assertId } from './bd'

export const KV_PREFIX = 'beadside.'
const SEEN_PREFIX = 'beadside.seen.'
const PICKS_PREFIX = 'beadside.picks.'

/** stale beads picked per day; more than this in a write is a mistake */
export const MAX_PICKS = 10

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/

/** the stale beads picked for one day */
export interface StalePicks {
  day: string
  ids: string[]
}

/** what `/api/inbox-state` returns: markers merged over every device, and the day's picks */
export interface InboxState {
  device: string
  /** per bead, the newest reply any device opened it at */
  seen: Record<string, string>
  /** the day's picks from the device that drew first, null when none has */
  picks: StalePicks | null
}

/** this machine's name as a key segment: lowercase letters, digits and dashes */
export function deviceName(host = hostname()): string {
  const clean = host
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return clean || 'board'
}

export function seenKey(device: string, id: string): string {
  return `${SEEN_PREFIX}${device}.${assertId(id)}`
}

export function picksKey(device: string): string {
  return `${PICKS_PREFIX}${device}`
}

/** throws unless the value is a local calendar day, 2026-10-13 */
export function assertDay(day: unknown): string {
  if (typeof day !== 'string' || !DAY_PATTERN.test(day) || Number.isNaN(Date.parse(day))) {
    throw new BdError('day must be a date like 2026-10-13')
  }
  return day
}

/** throws unless the value is an ISO timestamp, as `agent_reply.at` is */
export function assertTimestamp(at: unknown): string {
  if (typeof at !== 'string' || !ISO_PATTERN.test(at) || Number.isNaN(Date.parse(at))) {
    throw new BdError('at must be an ISO timestamp')
  }
  return at
}

/** throws unless the ids are a short list of valid, distinct issue ids */
export function assertPickIds(ids: unknown): string[] {
  if (!Array.isArray(ids) || ids.length > MAX_PICKS) throw new BdError(`ids must be an array of at most ${MAX_PICKS}`)
  return [...new Set(ids.map(assertId))]
}

/** the value stored under a device's picks key */
export function picksValue(picks: StalePicks, at: Date): string {
  return JSON.stringify({ day: picks.day, ids: picks.ids, at: at.toISOString() })
}

const validId = (id: string) => {
  try {
    assertId(id)
    return true
  } catch {
    return false
  }
}

/**
 * merges every device's keys: a bead counts as seen at the newest reply any device opened it
 * at, and the day's picks are the ones the first device to draw that day stored, so both
 * boards settle on the same three once their syncs meet. malformed values are skipped.
 */
export function readInboxState(kv: Record<string, string>, day: string, device: string): InboxState {
  const seen: Record<string, string> = {}
  let first: { at: string; device: string; ids: string[] } | null = null
  for (const [key, value] of Object.entries(kv)) {
    if (key.startsWith(SEEN_PREFIX)) {
      const rest = key.slice(SEEN_PREFIX.length)
      const dot = rest.indexOf('.')
      const id = dot > 0 ? rest.slice(dot + 1) : ''
      const at = Date.parse(value)
      if (!validId(id) || Number.isNaN(at)) continue
      const known = seen[id]
      if (!known || Date.parse(known) < at) seen[id] = value
    } else if (key.startsWith(PICKS_PREFIX)) {
      const from = key.slice(PICKS_PREFIX.length)
      let parsed: { day?: unknown; ids?: unknown; at?: unknown }
      try {
        parsed = JSON.parse(value) as typeof parsed
      } catch {
        continue
      }
      if (parsed.day !== day || !Array.isArray(parsed.ids) || typeof parsed.at !== 'string') continue
      const ids = parsed.ids.filter((id): id is string => typeof id === 'string' && validId(id))
      const candidate = { at: parsed.at, device: from, ids }
      if (!first || candidate.at < first.at || (candidate.at === first.at && candidate.device < first.device)) {
        first = candidate
      }
    }
  }
  return { device, seen, picks: first ? { day, ids: first.ids } : null }
}
