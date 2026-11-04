// checks waiting on the human: a bead labelled tryIt.label carries a kit under tryIt.key in its
// metadata (what to try, where, what success looks like). the human gives one of three verdicts
// and each has fixed effects on the bead; see "ready to try" in the README. the kit is read
// leniently, since agents write it by hand
import { BdError, type Comment, type Issue, type IssueWithComments } from './bd'

export const VERDICTS = ['works', 'broken', 'cant'] as const
export type Verdict = (typeof VERDICTS)[number]

/** one kit primitive, as the quick-job kit defines them; unknown fields are kept */
export type KitItem =
  | { type: 'spec'; label: string; value: string }
  | { type: 'copy'; label: string; text: string }
  | { type: 'link'; label: string; href: string }
  | { type: 'path'; label: string; path: string; href: string | null }
  | { type: 'qr'; label: string; text: string }
  | { type: 'image'; src: string; alt: string }

export interface TryStep {
  id: string
  title: string
  note: string | null
}

export interface TryLast {
  result: Verdict
  at: string
  note: string | null
}

export interface TryKit {
  title: string
  app: string | null
  where: string | null
  why: string | null
  verified: string | null
  expect: string | null
  shipped: string | null
  minutes: number | null
  kit: KitItem[]
  steps: TryStep[]
  /** the last verdict, written by the verdict route */
  last: TryLast | null
}

/** one bead's check as `/api/tries` lists it */
export interface TryEntry {
  id: string
  title: string
  status: Issue['status']
  /** null when the bead carries the label but no kit the board can read */
  try: TryKit | null
}

/** the stored note is cut here; the comment carries the whole of it */
export const MAX_NOTE_TEXT = 500

const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null)

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

function parseKitItem(value: unknown): KitItem | null {
  const r = record(value)
  if (!r) return null
  const label = str(r['label'])
  switch (r['type']) {
    case 'spec': {
      const v = str(r['value'])
      return label && v ? { type: 'spec', label, value: v } : null
    }
    case 'copy': {
      const text = str(r['text'])
      return text ? { type: 'copy', label: label ?? text, text } : null
    }
    case 'link': {
      const href = str(r['href'])
      return href ? { type: 'link', label: label ?? href, href } : null
    }
    case 'path': {
      const path = str(r['path'])
      return path ? { type: 'path', label: label ?? path, path, href: str(r['href']) } : null
    }
    case 'qr': {
      const text = str(r['text'])
      return text ? { type: 'qr', label: label ?? text, text } : null
    }
    case 'image': {
      const src = str(r['src'])
      return src ? { type: 'image', src, alt: str(r['alt']) ?? '' } : null
    }
    default:
      return null
  }
}

function parseLast(value: unknown): TryLast | null {
  const r = record(value)
  if (!r) return null
  const result = r['result']
  const at = str(r['at'])
  if (!at || typeof result !== 'string' || !(VERDICTS as readonly string[]).includes(result)) return null
  return { result: result as Verdict, at, note: str(r['note']) }
}

/** the raw stored kit under `key`, as an object to merge a verdict into */
export function rawTry(metadata: unknown, key: string): Record<string, unknown> | null {
  const meta = record(metadata)
  return meta ? record(meta[key]) : null
}

/** the kit stored under `key` in a bead's metadata, or null when there is none it can read */
export function parseTry(metadata: unknown, key: string): TryKit | null {
  const r = rawTry(metadata, key)
  if (!r) return null
  const title = str(r['title'])
  if (!title) return null
  const steps: TryStep[] = []
  const rawSteps = Array.isArray(r['steps']) ? r['steps'] : []
  rawSteps.forEach((item, i) => {
    if (typeof item === 'string' && item.trim()) {
      steps.push({ id: String(i + 1), title: item.trim(), note: null })
      return
    }
    const s = record(item)
    const stepTitle = s ? str(s['title']) : null
    if (s && stepTitle) steps.push({ id: str(s['id']) ?? String(i + 1), title: stepTitle, note: str(s['note']) })
  })
  const minutes = r['minutes']
  return {
    title,
    app: str(r['app']),
    where: str(r['where']),
    why: str(r['why']),
    verified: str(r['verified']),
    expect: str(r['expect']),
    shipped: str(r['shipped']),
    minutes: typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0 ? minutes : null,
    kit: (Array.isArray(r['kit']) ? r['kit'] : []).map(parseKitItem).filter((k): k is KitItem => k !== null),
    steps,
    last: parseLast(r['last']),
  }
}

/** throws unless `value` is one of the three verdicts */
export function assertVerdict(value: unknown): Verdict {
  if (typeof value !== 'string' || !(VERDICTS as readonly string[]).includes(value)) {
    throw new BdError(`verdict must be one of ${VERDICTS.join(', ')}`)
  }
  return value as Verdict
}

/** the note, trimmed; broken and cant need one, works takes one optionally */
export function assertVerdictNote(verdict: Verdict, value: unknown): string | null {
  if (value !== undefined && value !== null && typeof value !== 'string') throw new BdError('note must be a string')
  const note = typeof value === 'string' && value.trim() ? value.trim() : null
  if (!note && verdict !== 'works') {
    throw new BdError(
      verdict === 'broken' ? 'a broken verdict needs a note: what you saw' : "a couldn't-check verdict needs a note: what stopped you",
    )
  }
  return note
}

/** the comment the verdict leaves, written as the human */
export function verdictComment(verdict: Verdict, title: string, note: string | null, expect: string | null): string {
  if (verdict === 'works') {
    const parts = [`You tried ${title}: it works.`]
    if (expect) parts.push(`Expected: ${expect}`)
    if (note) parts.push(note)
    return parts.join('\n\n')
  }
  if (verdict === 'broken') return `You tried ${title}: still broken.\n\n${note ?? ''}`.trim()
  return `You couldn't check ${title}.\n\n${note ?? ''}`.trim()
}

/** the stored kit with `last` set; every other field is kept as written */
export function withLast(
  raw: Record<string, unknown>,
  last: { result: Verdict; at: Date; note: string | null },
): Record<string, unknown> {
  const note = last.note && last.note.length > MAX_NOTE_TEXT ? `${last.note.slice(0, MAX_NOTE_TEXT - 1)}…` : last.note
  return { ...raw, last: { result: last.result, at: last.at.toISOString(), note } }
}

/** true when the human's latest comment is `text`, left within `windowMs`: the verdict's comment landed already */
export function verdictPosted(comments: Comment[], author: string, text: string, now: Date, windowMs = 15 * 60_000): boolean {
  const mine = comments.filter((c) => c.author === author)
  const last = mine[mine.length - 1]
  if (!last || last.text.trim() !== text.trim()) return false
  const at = Date.parse(last.created_at)
  return Number.isFinite(at) && now.getTime() - at <= windowMs
}

/** every bead that is not closed and carries the label, kit or not, sorted by app then title */
export function tryEntries(corpus: IssueWithComments[], label: string, key: string): TryEntry[] {
  const out: TryEntry[] = []
  for (const { issue } of corpus) {
    if (issue.status === 'closed' || !issue.labels.includes(label)) continue
    out.push({ id: issue.id, title: issue.title, status: issue.status, try: parseTry(issue['metadata'], key) })
  }
  const app = (e: TryEntry) => e.try?.app ?? '￿'
  return out.sort((a, b) => app(a).localeCompare(app(b)) || (a.try?.title ?? a.title).localeCompare(b.try?.title ?? b.title))
}
