// derives the board shape (pinned strip, waiting strip, lanes, thoughts, deferred, closed, counts) from the flat issue list

import type { BoardConfig, Comment, Issue, LaneConfig } from './api'

export interface BoardRow {
  issue: Issue
  /** indented under a group caption */
  child: boolean
  /** also sits in the waiting-on-you section, so the lane row carries a marker */
  waiting: boolean
}

export interface GroupCaption {
  label: string
  /** short id when the caption stands in for an epic with no bead behind it, null for a project label */
  short: string | null
}

export interface BoardGroup {
  key: string
  /** the epic bead heading its children, rendered as a full selectable row */
  head: BoardRow | null
  /** a project label, or an epic id the board has no bead for */
  caption: GroupCaption | null
  rows: BoardRow[]
}

export interface BoardSection {
  key: string
  title: string
  /** axis key when the section is a lane, null otherwise */
  axis: string | null
  note: string | null
  count: number
  /** rendered in the signal colour: the waiting-on-you heading */
  signal: boolean
  /** collapsed to its heading; its rows drop out of keyboard movement */
  folded: boolean
  groups: BoardGroup[]
}

export interface Counts {
  open: number
  inProgress: number
  deferred: number
  waiting: number
  unread: number
}

export interface Board {
  sections: BoardSection[]
  /** every id on screen in visual order, folded sections skipped, for keyboard movement */
  order: string[]
  /** every id in visual order as if nothing were folded, to step off a row that just folded away */
  layout: string[]
  counts: Counts
  byId: Map<string, Issue>
}

export interface BoardOptions {
  config: BoardConfig
  repoName: string
  /** stored fold state; `fallback` is the default for a section nobody has touched */
  isFolded: (sectionKey: string, fallback: boolean) => boolean
}

/** drops the repo prefix: demo-9fz becomes 9fz */
export function shortId(id: string, repoName: string): string {
  const prefix = `${repoName}-`
  return id.startsWith(prefix) ? id.slice(prefix.length) : id
}

/** the epic a dotted id belongs to (x.4 belongs to x), null for a plain id */
export function parentId(id: string): string | null {
  const dot = id.lastIndexOf('.')
  return dot > 0 ? id.slice(0, dot) : null
}

/** the one lane label a bead carries */
export function axisOf(issue: Issue, lanes: LaneConfig[]): string | null {
  const laneLabels = lanes.map((l) => l.label)
  return issue.labels.find((l) => laneLabels.includes(l)) ?? null
}

/** any label that is not a lane label, a flag or a sub-label is a project label */
export function projectOf(issue: Issue, config: BoardConfig): string | null {
  const laneLabels = config.lanes.map((l) => l.label)
  const allFlags = config.derived.allFlags
  const subLabels = config.subLabels
  return (
    issue.labels.find(
      (l) => !laneLabels.includes(l) && !allFlags.includes(l) && !subLabels.includes(l),
    ) ?? null
  )
}

/** sub-labels in the vocabulary order the server gave us */
export function subsOf(issue: Issue, subLabels: string[]): string[] {
  return subLabels.filter((s) => issue.labels.includes(s))
}

/** flags in the vocabulary order the server gave us */
export function flagsOf(issue: Issue, flagLabels: string[]): string[] {
  return flagLabels.filter((f) => issue.labels.includes(f))
}

/** open, in progress or pinned and carrying waiting labels */
export function isWaiting(issue: Issue, config: BoardConfig): boolean {
  if (issue.status !== 'open' && issue.status !== 'in_progress' && issue.status !== 'pinned') return false
  if (config.thoughts && issue.labels.includes(config.thoughts.label)) return false
  if (config.waiting.labels.length === 0) return false
  return config.waiting.labels.some((label) => issue.labels.includes(label))
}

/** captured ideas: shown in their own drawer, counted nowhere */
export function isThought(issue: Issue, config: BoardConfig): boolean {
  return config.thoughts ? issue.labels.includes(config.thoughts.label) : false
}

function byPriorityThenTouched(a: Issue, b: Issue): number {
  return a.priority - b.priority || (b.updated_at ?? '').localeCompare(a.updated_at ?? '')
}

function rows(list: Issue[], child: boolean, config: BoardConfig): BoardRow[] {
  return list.sort(byPriorityThenTouched).map((issue) => ({
    issue,
    child,
    waiting: isWaiting(issue, config),
  }))
}

interface Ranked {
  group: BoardGroup
  /** best priority over every bead in the group, epic included */
  priority: number
  /** latest touch over the same beads */
  touched: string
  label: string
}

function ranked(group: BoardGroup, members: Issue[], label: string): Ranked {
  return {
    group,
    priority: Math.min(...members.map((m) => m.priority)),
    touched: members.reduce((t, m) => ((m.updated_at ?? '') > t ? m.updated_at : t), ''),
    label,
  }
}

/**
 * epic groups by parent id, then project-label groups of two or more, then loose beads;
 * everything sorted together by best priority, adjacent loose beads merged into one run
 */
function groupLane(list: Issue[], opts: BoardOptions, byId: Map<string, Issue>): BoardGroup[] {
  const claimed = new Set<string>()
  const entries: Ranked[] = []

  const epics = new Map<string, Issue[]>()
  for (const issue of list) {
    const parent = parentId(issue.id)
    if (!parent) continue
    const kids = epics.get(parent) ?? []
    kids.push(issue)
    epics.set(parent, kids)
  }

  for (const [parent, kids] of epics) {
    kids.forEach((k) => claimed.add(k.id))
    const epic = byId.get(parent)
    if (epic) claimed.add(epic.id)
    const short = shortId(parent, opts.repoName)
    const group: BoardGroup = {
      key: parent,
      head: epic ? { issue: epic, child: false, waiting: isWaiting(epic, opts.config) } : null,
      caption: epic ? null : { label: short, short },
      rows: rows(kids, true, opts.config),
    }
    entries.push(ranked(group, epic ? [epic, ...kids] : kids, epic?.title ?? short))
  }

  const projects = new Map<string, Issue[]>()
  for (const issue of list) {
    if (claimed.has(issue.id)) continue
    const project = projectOf(issue, opts.config)
    if (!project) continue
    const group = projects.get(project) ?? []
    group.push(issue)
    projects.set(project, group)
  }

  for (const [project, members] of projects) {
    if (members.length < 2) continue
    members.forEach((m) => claimed.add(m.id))
    const group: BoardGroup = {
      key: `project:${project}`,
      head: null,
      caption: { label: project, short: null },
      rows: rows([...members], true, opts.config),
    }
    entries.push(ranked(group, members, project))
  }

  for (const issue of list) {
    if (claimed.has(issue.id)) continue
    const group: BoardGroup = {
      key: `loose:${issue.id}`,
      head: null,
      caption: null,
      rows: rows([issue], false, opts.config),
    }
    entries.push(ranked(group, [issue], issue.title))
  }

  entries.sort(
    (a, b) =>
      a.priority - b.priority ||
      b.touched.localeCompare(a.touched) ||
      a.label.localeCompare(b.label),
  )

  const out: BoardGroup[] = []
  for (const { group } of entries) {
    const last = out[out.length - 1]
    const loose = !group.head && !group.caption
    if (loose && last && !last.head && !last.caption) last.rows.push(...group.rows)
    else out.push(group)
  }
  return out
}

/**
 * builds every section of the index in render order, the keyboard order that matches it,
 * and the counts for the header line.
 */
export function buildBoard(issues: Issue[], opts: BoardOptions): Board {
  const byId = new Map(issues.map((i) => [i.id, i]))
  const live = issues.filter((i) => i.status !== 'closed')
  const counted = live.filter((i) => !isThought(i, opts.config))

  const counts: Counts = {
    open: counted.filter((i) => i.status === 'open').length,
    inProgress: counted.filter((i) => i.status === 'in_progress').length,
    deferred: counted.filter((i) => i.status === 'deferred').length,
    waiting: counted.filter((i) => isWaiting(i, opts.config)).length,
    unread: opts.config.note.addLabel
      ? counted.filter((i) => i.labels.includes(opts.config.note.addLabel!)).length
      : 0,
  }

  // pinned beads stay open indefinitely: one strip at the top instead of a lane row
  const pinned = live.filter((i) => i.status === 'pinned')
  const shown = live.filter((i) => i.status !== 'deferred' && i.status !== 'pinned')
  const sections: BoardSection[] = []

  if (pinned.length) {
    sections.push({
      key: 'pinned',
      title: 'pinned',
      axis: null,
      note: 'standing beads, kept in view',
      count: pinned.length,
      signal: false,
      folded: false,
      groups: [{ key: 'pinned', head: null, caption: null, rows: rows(pinned, false, opts.config) }],
    })
  }

  if (opts.config.waiting.labels.length > 0) {
    // a pinned bead waiting on you still shows here
    const waiting = live.filter((i) => isWaiting(i, opts.config))
    sections.push({
      key: 'waiting',
      title: opts.config.waiting.title,
      axis: null,
      note: opts.config.waiting.note,
      count: waiting.length,
      signal: true,
      folded: false,
      groups: waiting.length
        ? [{ key: 'waiting', head: null, caption: null, rows: rows(waiting, false, opts.config) }]
        : [],
    })
  }

  const laneStock = shown.filter((i) => !isThought(i, opts.config))
  for (const lane of opts.config.lanes) {
    const list = laneStock.filter((i) => axisOf(i, opts.config.lanes) === lane.label)
    if (!list.length) continue
    const groups = groupLane(list, opts, byId)
    sections.push({
      key: `lane:${lane.label}`,
      title: lane.label,
      axis: lane.label,
      note: lane.note,
      count: list.length,
      signal: false,
      folded: false,
      groups,
    })
  }

  const unlabelled = laneStock.filter((i) => axisOf(i, opts.config.lanes) === null)
  if (unlabelled.length) {
    const groups = groupLane(unlabelled, opts, byId)
    sections.push({
      key: 'lane:none',
      title: opts.config.unlaned.title,
      axis: null,
      note: opts.config.unlaned.note,
      count: unlabelled.length,
      signal: false,
      folded: false,
      groups,
    })
  }

  if (opts.config.thoughts) {
    const thoughts = shown.filter((i) => isThought(i, opts.config))
    if (thoughts.length) {
      sections.push({
        key: 'thoughts',
        title: opts.config.thoughts.title,
        axis: null,
        note: opts.config.thoughts.note,
        count: thoughts.length,
        signal: false,
        folded: false,
        groups: [
          {
            key: 'thoughts',
            head: null,
            caption: null,
            rows: rows(thoughts, false, opts.config),
          },
        ],
      })
    }
  }

  const deferred = live.filter((i) => i.status === 'deferred')
  sections.push({
    key: 'deferred',
    title: 'deferred',
    axis: null,
    note: 'parked until you pick them up',
    count: deferred.length,
    signal: false,
    folded: false,
    groups: deferred.length
      ? [
          {
            key: 'deferred',
            head: null,
            caption: null,
            rows: rows(deferred, false, opts.config),
          },
        ]
      : [],
  })

  const closed = issues
    .filter((i) => i.status === 'closed')
    .sort((a, b) => (b.closed_at ?? b.updated_at).localeCompare(a.closed_at ?? a.updated_at))
    .slice(0, 12)
    .map((issue) => ({ issue, child: false, waiting: false }))
  sections.push({
    key: 'closed',
    title: 'recently closed',
    axis: null,
    note: 'the last twelve struck through',
    count: closed.length,
    signal: false,
    folded: false,
    groups: closed.length ? [{ key: 'closed', head: null, caption: null, rows: closed }] : [],
  })

  // untouched sections start folded except pinned and the first one after it, which is waiting on
  // you when that exists
  const lead = sections.findIndex((s) => s.key !== 'pinned')
  sections.forEach((section, index) => {
    section.folded = opts.isFolded(section.key, section.key !== 'pinned' && index !== lead)
  })

  // a bead can show twice (waiting and its lane, an epic heading children in another lane);
  // keyboard movement visits it once, where it first appears
  const order: string[] = []
  const layout: string[] = []
  const onScreen = new Set<string>()
  const laidOut = new Set<string>()
  for (const section of sections) {
    for (const id of sectionIds(section)) {
      if (!laidOut.has(id)) {
        laidOut.add(id)
        layout.push(id)
      }
      if (section.folded || onScreen.has(id)) continue
      onScreen.add(id)
      order.push(id)
    }
  }

  return { sections, order, layout, counts, byId }
}

/** the ids a section renders, epic heads before their children */
function sectionIds(section: BoardSection): string[] {
  return section.groups.flatMap((g) => {
    const ids = g.rows.map((r) => r.issue.id)
    return g.head ? [g.head.issue.id, ...ids] : ids
  })
}

/** the sections that render a bead, in board order */
export function sectionsHolding(board: Board, id: string): BoardSection[] {
  return board.sections.filter((s) => sectionIds(s).includes(id))
}

/**
 * the next id keyboard movement lands on, one step down (1) or up (-1). from a row that is
 * folded away it walks the unfolded layout to the nearest row still on screen.
 */
export function step(
  board: Pick<Board, 'order' | 'layout'>,
  from: string | null,
  delta: 1 | -1,
): string | null {
  const { order, layout } = board
  const at = from ? order.indexOf(from) : -1
  if (at >= 0) return order[Math.min(order.length - 1, Math.max(0, at + delta))] ?? null
  const pos = from ? layout.indexOf(from) : -1
  if (pos < 0) return order[0] ?? null
  const onScreen = new Set(order)
  for (let i = pos + delta; i >= 0 && i < layout.length; i += delta) {
    const id = layout[i]
    if (id !== undefined && onScreen.has(id)) return id
  }
  return (delta === 1 ? order[order.length - 1] : order[0]) ?? null
}

export interface LinkGroup {
  key: string
  /** bd show's heading for this kind and direction, lowercased */
  title: string
  ids: string[]
}

/** kinds in display order; out is read from the bead holding the edge, in from the other end */
const LINK_KINDS: { key: string; types: string[]; out: string; in: string }[] = [
  { key: 'parent', types: ['parent-child'], out: 'parent', in: 'children' },
  { key: 'blocks', types: ['blocks'], out: 'depends on', in: 'blocks' },
  // bd writes the related kind under two names
  { key: 'related', types: ['related', 'relates-to'], out: 'related', in: 'related' },
  { key: 'discovered', types: ['discovered-from'], out: 'discovered from', in: 'discovered' },
  { key: 'supersedes', types: ['supersedes'], out: 'superseded by', in: 'supersedes' },
]

/**
 * the bead's dependencies and dependents grouped by kind, headed the way `bd show` heads them.
 * related has no direction, so both ends land in one group. a kind the board does not know
 * keeps its own name.
 */
export function linksOf(id: string, issues: Issue[]): LinkGroup[] {
  const groups = new Map<string, LinkGroup>()
  const add = (key: string, title: string, other: string) => {
    if (other === id) return
    const group = groups.get(key) ?? { key, title, ids: [] }
    if (!group.ids.includes(other)) group.ids.push(other)
    groups.set(key, group)
  }
  for (const issue of issues) {
    for (const edge of issue.dependencies ?? []) {
      const outward = edge.issue_id === id
      if (!outward && edge.depends_on_id !== id) continue
      const kind = LINK_KINDS.find((k) => k.types.includes(edge.type))
      const other = outward ? edge.depends_on_id : edge.issue_id
      if (!kind) {
        add(`${edge.type}:${outward ? 'out' : 'in'}`, outward ? edge.type : `${edge.type} (inbound)`, other)
        continue
      }
      const same = kind.out === kind.in
      add(same ? kind.key : `${kind.key}:${outward ? 'out' : 'in'}`, outward ? kind.out : kind.in, other)
    }
  }
  const rank = (key: string) => {
    const at = LINK_KINDS.findIndex((k) => key === k.key || key.startsWith(`${k.key}:`))
    return (at < 0 ? LINK_KINDS.length : at) * 2 + (key.endsWith(':in') ? 1 : 0)
  }
  return [...groups.values()].sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key))
}

/**
 * the note an unread flag points at: the newest comment the board's human wrote. comments from
 * before authors were recorded fall back to the newest unknown one; an agent reply never counts.
 */
export function unreadNote(comments: Comment[]): Comment | undefined {
  const newest = (match: (c: Comment) => boolean) => [...comments].reverse().find(match)
  return newest((c) => c.by.self) ?? newest((c) => c.by.kind === 'unknown')
}

/** the order the comment thread reads in; bd hands it over oldest first */
export type CommentOrder = 'oldest' | 'newest'

/** the thread in the chosen order; comments with the same or an unreadable time keep bd's order */
export function orderComments(comments: Comment[], order: CommentOrder): Comment[] {
  const at = (c: Comment) => {
    const t = Date.parse(c.created_at)
    return Number.isNaN(t) ? 0 : t
  }
  const sorted = comments
    .map((comment, index) => ({ comment, index }))
    .sort((a, b) => at(a.comment) - at(b.comment) || a.index - b.index)
    .map(({ comment }) => comment)
  return order === 'newest' ? sorted.reverse() : sorted
}

const commentTime = (c: Comment): number => {
  const t = Date.parse(c.created_at)
  return Number.isNaN(t) ? NaN : t
}

/** the newest comment the board's human wrote, the note the read marker and reply tags hang off */
export function latestNote(comments: Comment[]): Comment | undefined {
  let latest: Comment | undefined
  for (const c of comments) {
    if (!c.by.self) continue
    if (!latest || commentTime(c) >= commentTime(latest)) latest = c
  }
  return latest
}

/**
 * ids of the agent comments written after the human's latest note: the answers, as against older
 * status updates. the same reading as the list's `agent_reply`; legacy unknown authors count as
 * neither side, and a bead the human never commented on has none
 */
export function repliesAfterNote(comments: Comment[]): Set<string> {
  const note = latestNote(comments)
  const at = note ? commentTime(note) : NaN
  if (Number.isNaN(at)) return new Set()
  return new Set(comments.filter((c) => c.by.kind === 'agent' && commentTime(c) > at).map((c) => c.id))
}

/** about two rows of comment text in the wide pane: a first line longer than this is not a headline */
export const HEADLINE_MAX = 200
/** a comment this short, in at most this many lines, reads whole and never folds */
const FOLD_MIN_CHARS = 300
const FOLD_MIN_LINES = 3
/** a fold that would hide less than this is not worth a click */
const FOLD_MIN_HIDDEN = 40
/** words whose trailing dot does not end a sentence */
const ABBREVIATIONS = /(?:^|[\s(])(?:e\.g|i\.e|etc|vs|cf|approx|incl|resp|ca|al|[A-Z])\.$/

/** markdown that must not be cut open: an odd count of backticks, or more openers than closers */
function balanced(text: string): boolean {
  const count = (re: RegExp) => (text.match(re) ?? []).length
  return (
    count(/`/g) % 2 === 0 && count(/\(/g) <= count(/\)/g) && count(/\[/g) <= count(/\]/g) && count(/\*\*/g) % 2 === 0
  )
}

/** the first sentence of a line: up to the first ., ! or ? followed by a space, not inside code or a link */
function firstSentence(line: string): string | null {
  const end = /[.!?](?=\s+\S)/g
  for (const match of line.matchAll(end)) {
    const head = line.slice(0, match.index + 1)
    if (head.length < 12 || ABBREVIATIONS.test(head) || !balanced(head)) continue
    return head
  }
  return null
}

/** the line cut at the last space before HEADLINE_MAX that leaves its markdown whole, with an ellipsis */
function wordCut(line: string): string | null {
  for (let at = line.lastIndexOf(' ', HEADLINE_MAX); at > HEADLINE_MAX / 2; at = line.lastIndexOf(' ', at - 1)) {
    const head = line.slice(0, at).replace(/[\s,;:–-]+$/, '')
    if (balanced(head)) return `${head}…`
  }
  return null
}

/**
 * where a comment folds: the headline shown while the rest waits behind "more", or null when it
 * reads whole. the headline is the first line, which is the convention (one plain line, a blank
 * line, then the detail). a first line past about two rows, the usual shape of a comment written
 * as one paragraph, gives its first sentence instead, and a first sentence that runs past three
 * rows is cut at a word with an ellipsis. a comment that opens with a code fence or a table
 * does not fold.
 */
export function foldPoint(text: string): string | null {
  const body = text.trim()
  const lines = body.split('\n')
  if (body.length <= FOLD_MIN_CHARS && lines.length <= FOLD_MIN_LINES) return null
  const first = lines[0]!.trimEnd()
  if (/^\s*(```|~~~|\|)/.test(first)) return null
  let head: string | null = first.length <= HEADLINE_MAX && balanced(first) ? first : firstSentence(first)
  if (!head || head.length > HEADLINE_MAX * 1.5) head = wordCut(first)
  if (!head) return null
  return body.length - head.length >= FOLD_MIN_HIDDEN ? head : null
}
