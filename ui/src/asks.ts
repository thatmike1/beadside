// the question an agent stored on a bead (asks.key in .beadside.json), read from the issue's
// metadata as the list carries it. the same lenient reading as server/asks.ts

import type { BoardConfig, Issue } from './api'

export interface AskOption {
  k: string
  sub: string | null
}

export interface AskAnswer {
  at: string
  by: string
  via: string | null
  text: string
}

export interface Ask {
  title: string | null
  question: string
  options: AskOption[]
  lean: string | null
  why: string | null
  due: string | null
  first_raised: string | null
  last_raised: string | null
  days_raised: number | null
  answered: AskAnswer | null
}

const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null)

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** the stored question under `key`, or null when there is none the board can read */
export function parseAsk(metadata: unknown, key: string): Ask | null {
  const meta = record(metadata)
  const r = meta ? record(meta[key]) : null
  if (!r) return null
  const question = str(r['question']) ?? str(r['ask']) ?? str(r['title'])
  if (!question) return null
  const options: AskOption[] = []
  for (const item of Array.isArray(r['options']) ? r['options'] : []) {
    if (typeof item === 'string' && item.trim()) options.push({ k: item, sub: null })
    else {
      const o = record(item)
      const k = o ? str(o['k']) : null
      if (o && k) options.push({ k, sub: str(o['sub']) })
    }
  }
  const a = record(r['answered'])
  const at = a ? str(a['at']) : null
  const days = r['days_raised']
  return {
    title: str(r['title']),
    question,
    options,
    lean: str(r['lean']),
    why: str(r['why']),
    due: str(r['due']),
    first_raised: str(r['first_raised']),
    last_raised: str(r['last_raised']),
    days_raised: typeof days === 'number' && Number.isFinite(days) ? days : null,
    answered:
      a && at ? { at, by: str(a['by']) ?? 'unknown', via: str(a['via']), text: typeof a['text'] === 'string' ? a['text'] : '' } : null,
  }
}

/** the bead's question when the board has asks on and the bead is not closed */
export function askOf(issue: Issue, config: BoardConfig): Ask | null {
  if (!config.asks || issue.status === 'closed') return null
  return parseAsk(issue.metadata, config.asks.key)
}

/** "raised 3 days, first 26 Oct" style count, empty when the question carries no count */
export function raisedText(ask: Ask): string {
  const days = ask.days_raised
  if (!days || days < 1) return ''
  return days === 1 ? 'raised once' : `raised ${days} days`
}
