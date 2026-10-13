// typed fetch helpers for every endpoint in docs/api.md

export type Status = 'open' | 'in_progress' | 'blocked' | 'deferred' | 'pinned' | 'closed'

export interface Issue {
  id: string
  title: string
  description: string
  status: Status
  priority: 0 | 1 | 2 | 3 | 4
  issue_type: string
  labels: string[]
  owner?: string
  created_by?: string
  created_at: string
  updated_at: string
  closed_at?: string | null
  close_reason?: string
  notes?: string
  comment_count: number
  dependency_count: number
  dependent_count: number
  due_at?: string | null
  defer_until?: string | null
  metadata?: Record<string, unknown>
  /** outgoing edges: this issue depends on depends_on_id, of a kind */
  dependencies?: Dependency[]
  /** list reads only: the newest agent comment after the human's latest note */
  agent_reply?: AgentReply | null
}

export interface Dependency {
  issue_id: string
  depends_on_id: string
  type: string
}

export interface AgentReply {
  at: string
  /** display name of the agent */
  name: string
}

export type AuthorKind = 'human' | 'agent' | 'unknown'

/** the server's reading of a stored author: `human:mike`, `agent:claude`, or an unknown legacy name */
export interface Author {
  kind: AuthorKind
  name: string
  /** the board's own configured human */
  self: boolean
}

export interface Comment {
  id: string
  issue_id: string
  /** the stored bd author string, canonical */
  author: string
  text: string
  created_at: string
  by: Author
}

export type SearchScope = 'all' | 'open' | 'closed'
export type SearchField = 'id' | 'title' | 'description' | 'notes' | 'comment'

export interface SearchHit {
  id: string
  title: string
  status: Status
  priority: number
  labels: string[]
  updated_at: string
  field: SearchField
  excerpt: string
  comment: { id: string; author: string; by: Author; created_at: string } | null
  fields: SearchField[]
  score: number
}

export interface SearchResult {
  query: string
  scope: SearchScope
  terms: string[]
  total: number
  hits: SearchHit[]
}

export interface SessionHit {
  session_id: string
  title: string
  prompt?: string
  day: string
  modified: string
  agent: string
  url: string
}

export interface NoteHit {
  file: string
  line: number
  excerpt: string
}

export interface IssueDetail {
  issue: Issue
  comments: Comment[]
  sessions: SessionHit[] | null
  notes: NoteHit[]
}

export interface LaneConfig {
  label: string
  note: string | null
  glyph: string
  color: string
}

export interface UnlanedConfig {
  title: string
  note: string | null
}

export interface WaitingConfig {
  labels: string[]
  title: string
  note: string | null
}

export interface NoteConfig {
  addLabel: string | null
  offerToClear: string[]
}

export interface InboxConfig {
  labels: string[]
}

export interface ThoughtsConfig {
  label: string
  title: string
  note: string | null
}

export interface CaptureConfig {
  labels: string[]
}

export interface DerivedConfig {
  allFlags: string[]
  hotChips: string[]
}

export interface BoardConfig {
  /** the configured human, or null when the server derived one from git */
  human: { id: string; name: string } | null
  agentsview: string | null
  notesDir: string | null
  lanes: LaneConfig[]
  unlaned: UnlanedConfig
  subLabels: string[]
  waiting: WaitingConfig
  note: NoteConfig
  inbox: InboxConfig
  thoughts: ThoughtsConfig | null
  flags: string[]
  capture: CaptureConfig
  derived: DerivedConfig
}

export interface SessionInfo {
  token: string
  repo: { name: string; path: string }
  agentsview: string | null
  /** the stored author id the board writes comments as */
  me: string
  human: { id: string; name: string }
  config: BoardConfig
}

export interface IssueList {
  issues: Issue[]
  fetchedAt: string
}

/** the stale beads picked for one day */
export interface StalePicks {
  day: string
  ids: string[]
}

/** what the inbox remembers across devices, from bd's key-value store */
export interface InboxState {
  /** the name this board's keys carry */
  device: string
  /** per bead, the newest agent reply any device opened it at */
  seen: Record<string, string>
  /** the day's picks from the device that drew first, null when none has */
  picks: StalePicks | null
}

let token: string | null = null

/** raw json fetch that turns `{ error }` bodies into thrown errors */
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  const text = await res.text()
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      throw new Error(`${path}: response was not json`)
    }
  }
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : `${res.status} ${res.statusText}`
    throw new Error(message)
  }
  return body as T
}

/** session config: write token, repo identity, agentsview url, me, and resolved board config */
export async function getSession(): Promise<SessionInfo> {
  const info = await call<SessionInfo>('/api/session')
  token = info.token
  return info
}

/** the write token, fetching the session first when the ui has not loaded it yet */
async function ensureToken(): Promise<string> {
  if (token) return token
  const info = await getSession()
  return info.token
}

/** a write with the token; a restarted server hands out a new token, so a 403 refetches it once */
async function withToken<T>(send: (token: string) => Promise<T>): Promise<T> {
  const t = await ensureToken()
  try {
    return await send(t)
  } catch (error) {
    if (!(error instanceof Error) || !/x-bd-token/.test(error.message)) throw error
    token = null
    return send(await ensureToken())
  }
}

/** DELETE with the write token; the server only allows beads the board itself filed */
function del<T>(path: string): Promise<T> {
  return withToken((t) => call<T>(path, { method: 'DELETE', headers: { 'x-bd-token': t } }))
}

function post<T>(path: string, body: unknown): Promise<T> {
  return withToken((t) =>
    call<T>(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bd-token': t },
      body: JSON.stringify(body),
    }),
  )
}

/** every issue in the repo, all statuses; the ui filters */
export function getIssues(): Promise<IssueList> {
  return call<IssueList>('/api/issues')
}

/** one issue with its comments, the sessions that mention it and matching notes lines */
export function getIssue(id: string): Promise<IssueDetail> {
  return call<IssueDetail>(`/api/issues/${encodeURIComponent(id)}`)
}

/** ranked full-text search over ids, titles, descriptions, notes and comments */
export function search(query: string, scope: SearchScope, signal?: AbortSignal): Promise<SearchResult> {
  const params = new URLSearchParams({ q: query, scope })
  return call<SearchResult>(`/api/search?${params.toString()}`, signal ? { signal } : undefined)
}

/** runs `bd comments add --author` and updates labels via the server's note config */
export function postComment(
  id: string,
  text: string,
  clear?: boolean,
): Promise<IssueDetail> {
  const body: { text: string; clear?: boolean } =
    clear === undefined ? { text } : { text, clear }
  return post<IssueDetail>(`/api/issues/${encodeURIComponent(id)}/comment`, body)
}

/** close, defer, reopen or plain status change */
export function setStatus(
  id: string,
  status: Status,
  extra?: { reason?: string; until?: string },
): Promise<{ issue: Issue }> {
  return post<{ issue: Issue }>(`/api/issues/${encodeURIComponent(id)}/status`, {
    status,
    ...extra,
  })
}

/** 0 is highest */
export function setPriority(id: string, priority: number): Promise<{ issue: Issue }> {
  return post<{ issue: Issue }>(`/api/issues/${encodeURIComponent(id)}/priority`, { priority })
}

/** one call adds and removes labels together */
export function editLabels(
  id: string,
  change: { add?: string[]; remove?: string[] },
): Promise<{ issue: Issue }> {
  return post<{ issue: Issue }>(`/api/issues/${encodeURIComponent(id)}/labels`, change)
}

/** keeps a stale bead as it is: one metadata stamp moves it out of the stale filter */
export function keepIssue(id: string): Promise<{ issue: Issue }> {
  return post<{ issue: Issue }>(`/api/issues/${encodeURIComponent(id)}/keep`, {})
}

/** re-dates a due bead; bd reads +1w, next monday, a date or an ISO timestamp */
export function setDue(id: string, due: string): Promise<{ issue: Issue }> {
  return post<{ issue: Issue }>(`/api/issues/${encodeURIComponent(id)}/due`, { due })
}

/** quick capture; labels default to server capture config when omitted */
export function createIssue(title: string, labels?: string[]): Promise<{ issue: Issue }> {
  const body: { title: string; labels?: string[] } =
    labels && labels.length ? { title, labels } : { title }
  return post<{ issue: Issue }>('/api/issues', body)
}

/** removes a bead the board just filed; the server refuses any other id */
export function deleteIssue(id: string): Promise<{ deleted: string }> {
  return del<{ deleted: string }>(`/api/issues/${encodeURIComponent(id)}`)
}

/** seen markers and the day's stale picks, shared by every board on this beads database */
export function getInboxState(day: string): Promise<InboxState> {
  return call<InboxState>(`/api/inbox-state?day=${encodeURIComponent(day)}`)
}

/** marks the bead's agent reply seen at `at`, the reply's own timestamp */
export function markSeen(id: string, at: string): Promise<{ id: string; at: string }> {
  return post<{ id: string; at: string }>(`/api/issues/${encodeURIComponent(id)}/seen`, { at })
}

/** stores a day's stale picks; the answer carries the picks that hold, another device's when it drew first */
export function setStalePicks(picks: StalePicks): Promise<InboxState> {
  return post<InboxState>('/api/stale-picks', picks)
}
