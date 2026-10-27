// questions stored on beads: an agent writes one under a metadata key (asks.key in .beadside.json),
// the human answers it from the board, and the agent that acts on the answer removes the key.
// the board reads the shape leniently, since agents write it by hand or from a script
import { BdError, type Issue, type IssueWithComments } from './bd'

export interface AskOption {
  k: string
  sub: string | null
}

export interface AskAnswer {
  at: string
  by: string
  /** where the answer came from: beadside, or a page that posted through it */
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
  /** null while the question is open */
  answered: AskAnswer | null
}

/** one bead's question as `/api/asks` lists it */
export interface AskEntry {
  id: string
  title: string
  status: Issue['status']
  closed_at: string | null
  /** null when the bead has no question stored, or one the board cannot read */
  ask: Ask | null
}

/** the stored answer text is cut here; the comment carries the whole of it */
export const MAX_ANSWER_TEXT = 500
const VIAS = ['beadside', 'hub'] as const
export type AnswerVia = (typeof VIAS)[number]

const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null)

function parseOptions(value: unknown): AskOption[] {
  if (!Array.isArray(value)) return []
  const out: AskOption[] = []
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) out.push({ k: item, sub: null })
    else if (item && typeof item === 'object' && str((item as Record<string, unknown>)['k'])) {
      const o = item as Record<string, unknown>
      out.push({ k: o['k'] as string, sub: str(o['sub']) })
    }
  }
  return out
}

function parseAnswer(value: unknown): AskAnswer | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const a = value as Record<string, unknown>
  const at = str(a['at'])
  if (!at) return null
  return { at, by: str(a['by']) ?? 'unknown', via: str(a['via']), text: typeof a['text'] === 'string' ? a['text'] : '' }
}

/** the question stored under `key` in a bead's metadata, or null when there is none it can read */
export function parseAsk(metadata: unknown, key: string): Ask | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  let raw = (metadata as Record<string, unknown>)[key]
  // a value written with `--set-metadata key=<json>` lands as a string
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const question = str(r['question']) ?? str(r['ask']) ?? str(r['title'])
  if (!question) return null
  const days = r['days_raised']
  return {
    title: str(r['title']),
    question,
    options: parseOptions(r['options']),
    lean: str(r['lean']),
    why: str(r['why']),
    due: str(r['due']),
    first_raised: str(r['first_raised']),
    last_raised: str(r['last_raised']),
    days_raised: typeof days === 'number' && Number.isFinite(days) ? days : null,
    answered: parseAnswer(r['answered']),
  }
}

/** the raw stored value under `key`, as an object to merge an answer into */
export function rawAsk(metadata: unknown, key: string): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  let raw = (metadata as Record<string, unknown>)[key]
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch {
      return null
    }
  }
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
}

/** throws unless `via` is one the board records */
export function assertVia(value: unknown): AnswerVia {
  if (value === undefined || value === null) return 'beadside'
  if (typeof value !== 'string' || !(VIAS as readonly string[]).includes(value)) {
    throw new BdError(`via must be one of ${VIAS.join(', ')}`)
  }
  return value as AnswerVia
}

/** the stored question with its answer filled in; every other field is kept as written */
export function answeredAsk(
  raw: Record<string, unknown>,
  answer: { text: string; by: string; via: AnswerVia; at: Date },
): Record<string, unknown> {
  const text = answer.text.trim()
  return {
    ...raw,
    answered: {
      at: answer.at.toISOString(),
      by: answer.by,
      via: answer.via,
      text: text.length > MAX_ANSWER_TEXT ? `${text.slice(0, MAX_ANSWER_TEXT - 1)}…` : text,
    },
  }
}

/**
 * what `/api/asks` lists: every bead that is not closed and carries a question, plus each wanted
 * id whatever its state, so a page that raised a question can tell it closed. a wanted id may be
 * short (`76w7`) when `repoName` is the ids' prefix
 */
export function askEntries(
  corpus: IssueWithComments[],
  key: string,
  repoName: string,
  wanted: string[] = [],
): AskEntry[] {
  const want = new Set(wanted)
  const isWanted = (id: string) => want.has(id) || (id.startsWith(`${repoName}-`) && want.has(id.slice(repoName.length + 1)))
  const out: AskEntry[] = []
  for (const { issue } of corpus) {
    const ask = parseAsk(issue['metadata'], key)
    if (!(ask && issue.status !== 'closed') && !isWanted(issue.id)) continue
    out.push({
      id: issue.id,
      title: issue.title,
      status: issue.status,
      closed_at: issue.closed_at ?? null,
      ask,
    })
  }
  return out
}
