// full-text search over issue ids, titles, descriptions, notes and comments. the http route
// and the `beadside search` cli both call `searchIssues`, so a query returns the same hits
// on the board and for an agent.
import { classifyAuthor, type Author, type HumanIdentity } from './authors'
import type { IssueWithComments, Status } from './bd'

export type SearchScope = 'all' | 'open' | 'closed'
export type SearchField = 'id' | 'title' | 'description' | 'notes' | 'comment'

export const SCOPES: readonly SearchScope[] = ['all', 'open', 'closed']

export interface SearchHit {
  id: string
  title: string
  status: Status
  priority: number
  labels: string[]
  updated_at: string
  /** the field the excerpt comes from, the strongest match on the issue */
  field: SearchField
  /** whitespace-collapsed text around the first match; the description lead for id and title hits */
  excerpt: string
  /** set when `field` is `comment` */
  comment: { id: string; author: string; by: Author; created_at: string } | null
  /** every field any query term was found in */
  fields: SearchField[]
  score: number
}

export interface SearchResult {
  query: string
  scope: SearchScope
  /** the lowercased terms matched, for highlighting */
  terms: string[]
  /** matches before the limit was applied */
  total: number
  hits: SearchHit[]
}

export interface SearchOptions {
  scope?: SearchScope
  limit?: number
  human: HumanIdentity
}

export const DEFAULT_LIMIT = 50
const EXCERPT_BEFORE = 60
const EXCERPT_AFTER = 140

/** lowercase and strip diacritics one utf-16 unit at a time, so indexes line up with the source */
function fold(text: string): string {
  let out = ''
  for (const ch of text) {
    if (ch.length !== 1) {
      out += ch
      continue
    }
    const base = ch.normalize('NFD')[0] ?? ch
    out += base.toLowerCase()[0] ?? ch
  }
  return out
}

/** splits a query into terms; "quoted words" stay one term */
export function parseQuery(query: string): string[] {
  const terms: string[] = []
  for (const match of query.matchAll(/"([^"]*)"|(\S+)/g)) {
    const term = fold((match[1] ?? match[2] ?? '').trim().replace(/\s+/g, ' '))
    if (term && !terms.includes(term)) terms.push(term)
  }
  return terms
}

/** the id without its repo prefix: `ccChat-general-1x78.1` gives `1x78.1` */
function shortOf(id: string): string {
  const base = id.replace(/\.\d+$/, '')
  const cut = base.lastIndexOf('-')
  return cut > 0 ? id.slice(cut + 1) : id
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** a window of text around the first term found, cut on word boundaries */
export function excerptAround(text: string, terms: string[], phrase: string): string {
  const flat = collapse(text)
  const folded = fold(flat)
  let at = phrase ? folded.indexOf(phrase) : -1
  if (at < 0) {
    for (const term of terms) {
      const found = folded.indexOf(term)
      if (found >= 0 && (at < 0 || found < at)) at = found
    }
  }
  if (at < 0) at = 0
  let start = Math.max(0, at - EXCERPT_BEFORE)
  let end = Math.min(flat.length, at + EXCERPT_AFTER)
  if (start > 0) {
    const space = flat.indexOf(' ', start)
    if (space >= 0 && space < at) start = space + 1
  }
  if (end < flat.length) {
    const space = flat.lastIndexOf(' ', end)
    if (space > at) end = space
  }
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`
}

function inScope(status: Status, scope: SearchScope): boolean {
  if (scope === 'closed') return status === 'closed'
  if (scope === 'open') return status !== 'closed'
  return true
}

interface Candidate {
  field: SearchField
  text: string
  score: number
  comment: SearchHit['comment']
  /** later comments win a tie, so the freshest mention is the one shown */
  order: number
}

const BODY_BONUS: Record<SearchField, number> = { id: 0, title: 0, description: 3, notes: 2, comment: 1 }

/** scores one text field: the whole query as a phrase beats every term, which beats some */
function scoreText(folded: string, terms: string[], phrase: string, field: SearchField): number {
  const found = terms.filter((term) => folded.includes(term)).length
  if (!found) return 0
  const title = field === 'title'
  if (phrase && terms.length > 1 && folded.includes(phrase)) return (title ? 400 : 120) + BODY_BONUS[field]
  if (found === terms.length) return (title ? 300 : 80) + BODY_BONUS[field]
  return found + BODY_BONUS[field] / 10
}

/**
 * ranks issues against a query. an issue matches when every term appears somewhere in it;
 * an exact id (full or short) ranks first, then title matches, then body-only matches.
 */
export function searchIssues(corpus: IssueWithComments[], query: string, options: SearchOptions): SearchResult {
  const scope = options.scope ?? 'all'
  const limit = options.limit ?? DEFAULT_LIMIT
  const terms = parseQuery(query)
  const phrase = fold(collapse(query.replace(/"/g, '')))
  if (!terms.length) return { query, scope, terms, total: 0, hits: [] }

  const hits: SearchHit[] = []
  for (const { issue, comments } of corpus) {
    if (!inScope(issue.status, scope)) continue

    const id = fold(issue.id)
    const short = fold(shortOf(issue.id))
    const candidates: Candidate[] = []
    const covered = new Set<string>()
    const fields = new Set<SearchField>()

    const consider = (field: SearchField, text: string, comment: SearchHit['comment'] = null, order = 0) => {
      if (!text) return
      const folded = fold(collapse(text))
      for (const term of terms) {
        if (folded.includes(term)) {
          covered.add(term)
          fields.add(field)
        }
      }
      const score = scoreText(folded, terms, phrase, field)
      if (score > 0) candidates.push({ field, text, score, comment, order })
    }

    if (terms.length === 1 && (id === terms[0] || short === terms[0])) {
      candidates.push({ field: 'id', text: issue.id, score: 1000, comment: null, order: 0 })
      covered.add(terms[0]!)
      fields.add('id')
    } else {
      for (const term of terms) {
        if (id.includes(term)) {
          covered.add(term)
          fields.add('id')
        }
      }
      if (terms.length === 1 && id.includes(terms[0]!)) {
        candidates.push({ field: 'id', text: issue.id, score: 250, comment: null, order: 0 })
      }
    }
    consider('title', issue.title)
    consider('description', issue.description)
    consider('notes', typeof issue.notes === 'string' ? issue.notes : '')
    comments.forEach((c, index) =>
      consider(
        'comment',
        c.text,
        { id: c.id, author: c.author, by: classifyAuthor(c.author, options.human), created_at: c.created_at },
        index,
      ),
    )

    if (covered.size < terms.length) continue
    candidates.sort((a, b) => b.score - a.score || b.order - a.order)
    const best = candidates[0]
    // every term is somewhere in the issue but no single field holds them all
    const score = best && best.score >= 80 ? best.score : 20
    const field = best?.field ?? [...fields][0] ?? 'title'
    const lead = field === 'id' || field === 'title'
    const excerpt = lead
      ? excerptAround(issue.description, [], '')
      : excerptAround(best?.text ?? '', terms, phrase)

    hits.push({
      id: issue.id,
      title: issue.title,
      status: issue.status,
      priority: issue.priority,
      labels: issue.labels,
      updated_at: issue.updated_at,
      field,
      excerpt,
      comment: field === 'comment' ? (best?.comment ?? null) : null,
      fields: (['id', 'title', 'description', 'notes', 'comment'] as const).filter((f) => fields.has(f)),
      score,
    })
  }

  hits.sort((a, b) => b.score - a.score || (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
  return { query, scope, terms, total: hits.length, hits: hits.slice(0, limit) }
}
