// shell: queries, selection, writes with undo, keyboard

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from './api'
import type { BoardConfig, Comment, Issue, IssueDetail, IssueList, SearchHit, SearchScope, Status } from './api'
import { buildBoard, linksOf, sectionsHolding, shortId, step } from './model'
import { answerOf, buildInbox, hasUnseenReply, inboxFoldKey, localDay, staleBeads } from './inbox'
import { IndexPane, type View } from './components/index-pane'
import { SNOOZE_UNTIL } from './components/inbox-list'
import { DetailPane, type RevealTarget } from './components/detail-pane'
import { Toast } from './components/toast'
import { useToast } from './use-toast'
import { useFolds } from './use-folds'
import { useLive } from './use-live'
import { beadFromHash, isReadingState, openReading, writeSelectionHash } from './navigation'
import { useNarrow } from './use-narrow'
import { useFont } from './use-font'
import { useTheme } from './use-theme'
import { useInboxMemory } from './use-inbox-memory'

const EMPTY_CONFIG: BoardConfig = {
  agentsview: null,
  notesDir: null,
  lanes: [],
  unlaned: { title: 'open', note: null },
  subLabels: [],
  waiting: { labels: [], title: 'waiting on you', note: null },
  note: { addLabel: null, offerToClear: [] },
  inbox: { labels: [] },
  thoughts: null,
  flags: [],
  capture: { labels: [] },
  asks: null,
  derived: { allFlags: [], hotChips: [] },
  human: null,
}

const SEARCH_DEBOUNCE_MS = 180
/** polling while the server's live feed is off or unreachable */
const POLL_MS = 20_000
/** how often the inbox re-reads the clock for due dates and stale ages */
const CLOCK_MS = 60_000
const DAY_MS = 86_400_000

/** what the ui can tell of a re-date before bd answers: +Nd, +Nw or a plain date */
function guessDue(due: string, now: Date): string | null {
  const relative = /^\+(\d+)([dw])$/.exec(due)
  if (relative) return new Date(now.getTime() + Number(relative[1]) * (relative[2] === 'w' ? 7 : 1) * DAY_MS).toISOString()
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(due)
  if (date) return new Date(Number(date[1]), Number(date[2]) - 1, Number(date[3])).toISOString()
  return null
}

interface WriteSpec {
  /** local guess applied before the server answers */
  optimistic: Issue | null
  call: () => Promise<{ issue: Issue }>
  message: string
  /** inverse action, offered behind the toast's undo button */
  undo: (() => Promise<void>) | null
}

/** the whole board: dense index on the left, one bead open on the right */
export function App() {
  const qc = useQueryClient()
  const live = useLive(qc)
  const toaster = useToast()
  const folds = useFolds()
  const { setFolded } = folds
  const [view, setView] = useState<View>('inbox')
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), CLOCK_MS)
    return () => window.clearInterval(timer)
  }, [])
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const captureRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const narrow = useNarrow()
  const { theme, toggle: toggleTheme } = useTheme()
  const { font, toggle: toggleFont } = useFont()
  // phone only: the open bead covers the list; its own history entry, so back returns to the list
  const [reading, setReading] = useState(() => isReadingState(window.history.state))

  const sessionQuery = useQuery({
    queryKey: ['session'],
    queryFn: api.getSession,
    staleTime: Infinity,
  })
  const issuesQuery = useQuery({
    queryKey: ['issues'],
    queryFn: api.getIssues,
    refetchInterval: live ? false : POLL_MS,
    refetchOnWindowFocus: true,
  })

  const [selected, setSelected] = useState<string | null>(null)
  // the bead the user opened: a click, a key, a link. a selection the board made by itself
  // (first paint, stepping off a row that left) never marks a reply seen
  const [opened, setOpened] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [clears, setClears] = useState<Record<string, boolean>>({})
  const [capture, setCapture] = useState('')
  const [sending, setSending] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [scope, setScope] = useState<SearchScope>('all')
  const [revealTarget, setRevealTarget] = useState<RevealTarget | null>(null)
  // replies opened this visit, in the order read: they stay in the inbox, marked read, until a
  // reload or a view switch. `holding` is the open one, which keeps its place until the selection moves
  const [visitRead, setVisitRead] = useState<string[]>([])
  const [holding, setHolding] = useState<string | null>(null)
  const [help, setHelp] = useState(false)
  const searching = searchInput.trim().length > 0

  useEffect(() => {
    if (!searchInput.trim()) {
      setSearchQuery('')
      return
    }
    const timer = window.setTimeout(() => setSearchQuery(searchInput.trim()), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  const searchQueryResult = useQuery({
    queryKey: ['search', searchQuery, scope],
    queryFn: ({ signal }) => api.search(searchQuery, scope, signal),
    enabled: searchQuery.length > 0,
    placeholderData: keepPreviousData,
    refetchInterval: live ? false : POLL_MS,
    refetchOnWindowFocus: true,
  })
  const searchResult = searching ? searchQueryResult.data : undefined

  const session = sessionQuery.data
  const repoName = session?.repo.name ?? ''
  const config = session?.config ?? EMPTY_CONFIG
  const humanName = session?.human.name ?? 'you'
  const issues = issuesQuery.data?.issues

  const board = useMemo(
    () =>
      buildBoard(issues ?? [], {
        config,
        repoName,
        isFolded: folds.isFolded,
      }),
    [issues, config, repoName, folds.isFolded],
  )

  const stale = useMemo(() => staleBeads(issues ?? [], now, config), [issues, now, config])
  const memory = useInboxMemory(localDay(now), issues ? stale : null, toaster.fail)
  const { seen, markSeen, picks } = memory
  const inbox = useMemo(
    () =>
      buildInbox(issues ?? [], {
        config,
        now,
        seen,
        picks,
        read: visitRead,
        holding,
        isFolded: folds.isFolded,
      }),
    [issues, config, now, seen, picks, visitRead, holding, folds.isFolded],
  )
  const staleNav = useMemo(() => {
    const order = stale.map((i) => i.id)
    return { order, layout: order }
  }, [stale])
  // keyboard movement walks whichever list is on screen
  const nav = view === 'inbox' ? inbox : view === 'stale' ? staleNav : board

  const knownLabels = useMemo(() => {
    const seen = new Set<string>([
      ...config.lanes.map((l) => l.label),
      ...config.derived.allFlags,
      ...config.subLabels,
    ])
    for (const issue of issues ?? []) for (const label of issue.labels) seen.add(label)
    return [...seen]
  }, [issues, config])

  const select = useCallback(
    (id: string, userInitiated = true) => {
      if (!id) return
      setSelected(id)
      if (userInitiated) setOpened(id)
      writeSelectionHash(id, selected, repoName, userInitiated)
    },
    [selected, repoName],
  )

  // on a phone a tap opens the bead over the list; on a wide screen it only moves the selection
  const open = useCallback(
    (id: string) => {
      if (!narrow) {
        select(id)
        return
      }
      setSelected(id)
      setOpened(id)
      openReading(id, repoName)
      setReading(true)
    },
    [narrow, select, repoName],
  )

  useEffect(() => {
    const onPop = (e: PopStateEvent) => setReading(isReadingState(e.state))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const closeReading = useCallback(() => {
    if (isReadingState(window.history.state)) window.history.back()
    else setReading(false)
  }, [])

  // a bead reached through the hash may sit only inside folded sections: open the first of them
  const reveal = useCallback(
    (id: string) => {
      const holding = sectionsHolding(board, id)
      const first = holding[0]
      if (first && holding.every((s) => s.folded)) folds.setFolded(first.key, false)
    },
    [board, folds],
  )

  // first paint: the hash wins and opens in the detail pane, the list still landing on the inbox.
  // otherwise the board opens its first row, and the inbox opens nothing: an unread reply waits
  // for the user, and an empty inbox's finished state stands alone
  const firstPaint = useRef(true)
  useEffect(() => {
    if (selected || !issues?.length) return
    // the issues can land before the session that names the repo; a short hash waits for it
    const found = firstPaint.current
      ? beadFromHash(window.location.hash, issues.map((i) => i.id), session ? repoName : null)
      : { wait: false as const, id: null }
    if (found.wait) return
    firstPaint.current = false
    if (found.id) {
      reveal(found.id)
      select(found.id, false)
      setOpened(found.id)
      return
    }
    if (view === 'inbox') return
    const next = nav.order[0] ?? null
    if (next) select(next, false)
  }, [selected, issues, session, nav.order, view, repoName, select, reveal])

  // opening a bead marks its answer seen, an agent reply or a close after the human's note. the row holds its place while open, then drops to
  // the bottom of replies, marked read, until the list is rebuilt
  const openIssue = selected && selected === opened ? board.byId.get(selected) : undefined
  useEffect(() => {
    const answer = openIssue ? answerOf(openIssue) : null
    if (!memory.ready || !openIssue || !answer || !hasUnseenReply(openIssue, seen)) return
    const id = openIssue.id
    markSeen(id, answer.at)
    setHolding(id)
    setVisitRead((prev) => [...prev.filter((other) => other !== id), id])
  }, [memory.ready, openIssue, seen, markSeen])
  useEffect(() => {
    if (holding && holding !== selected) setHolding(null)
  }, [holding, selected])

  // the hash is editable, so follow it when it changes under us
  useEffect(() => {
    const onHash = () => {
      const wanted = decodeURIComponent(window.location.hash.slice(1))
      const match = (issues ?? []).find(
        (i) => i.id === wanted || shortId(i.id, repoName) === wanted,
      )
      if (match) {
        reveal(match.id)
        setSelected(match.id)
        setOpened(match.id)
      }
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [issues, repoName, reveal])

  const detailQuery = useQuery({
    queryKey: ['issue', selected],
    queryFn: () => api.getIssue(selected as string),
    enabled: selected !== null,
  })

  const applyIssue = useCallback(
    (next: Issue) => {
      qc.setQueryData<IssueList>(['issues'], (prev) =>
        prev
          ? {
              ...prev,
              // a write reads the issue back from bd show, which has no agent_reply or note_at:
              // keep the list's until the refetch
              issues: prev.issues.map((i) =>
                i.id === next.id
                  ? { ...next, agent_reply: next.agent_reply ?? i.agent_reply ?? null, note_at: next.note_at ?? i.note_at ?? null }
                  : i,
              ),
            }
          : prev,
      )
      qc.setQueryData<IssueDetail>(['issue', next.id], (prev) =>
        prev ? { ...prev, issue: next } : prev,
      )
    },
    [qc],
  )

  const refresh = useCallback(
    (id: string | null) => {
      void qc.invalidateQueries({ queryKey: ['issues'] })
      void qc.invalidateQueries({ queryKey: ['search'] })
      if (id) void qc.invalidateQueries({ queryKey: ['issue', id] })
    },
    [qc],
  )

  const write = useCallback(
    async (id: string, spec: WriteSpec) => {
      if (spec.optimistic) applyIssue(spec.optimistic)
      try {
        const { issue } = await spec.call()
        applyIssue(issue)
        // a close from this board is the human's own, not an answer for the inbox to bring back
        if (issue.status === 'closed' && issue.closed_at) markSeen(issue.id, issue.closed_at)
        toaster.show(spec.message, spec.undo ?? undefined)
      } catch (error: unknown) {
        toaster.fail(error instanceof Error ? error.message : 'write failed')
      } finally {
        refresh(id)
      }
    },
    [applyIssue, refresh, toaster, markSeen],
  )

  // the polled list is the record of truth for status, labels and priority; the detail
  // query adds notes, comments and the two joins
  const selectedIssue = selected ? board.byId.get(selected) : undefined
  const current = selectedIssue ?? detailQuery.data?.issue

  const onPriority = useCallback(
    (priority: number) => {
      if (!current) return
      const before = current.priority
      if (before === priority) return
      const id = current.id
      const short = shortId(id, repoName)
      void write(id, {
        optimistic: { ...current, priority: priority as Issue['priority'] },
        call: () => api.setPriority(id, priority),
        message: `${short} set to p${priority}`,
        undo: async () => {
          await api.setPriority(id, before)
          refresh(id)
        },
      })
    },
    [current, repoName, write, refresh],
  )

  const changeStatus = useCallback(
    (issue: Issue, status: Status, extra?: { reason?: string; until?: string }, message?: string) => {
      const before = issue.status
      if (before === status) return
      const id = issue.id
      const short = shortId(id, repoName)
      const verb =
        status === 'closed' || status === 'deferred' || status === 'pinned'
          ? status
          : before === 'pinned'
            ? 'unpinned'
            : 'reopened'
      void write(id, {
        optimistic: { ...issue, status },
        call: () => api.setStatus(id, status, extra),
        message: message ?? `${short} ${verb}`,
        undo: async () => {
          await api.setStatus(id, before)
          refresh(id)
        },
      })
    },
    [repoName, write, refresh],
  )

  const onStatus = useCallback(
    (status: Status) => {
      if (current) changeStatus(current, status)
    },
    [current, changeStatus],
  )

  // a verdict from a row: the bead leaves the list, so an open one hands the selection on
  const stepOff = useCallback(
    (id: string) => {
      if (id !== selected) return
      const below = step(nav, id, 1)
      const next = below && below !== id ? below : step(nav, id, -1)
      if (next && next !== id) select(next, false)
    },
    [nav, selected, select],
  )

  const rowActions = useMemo(
    () => ({
      onRedate: (issue: Issue, due: string) => {
        const id = issue.id
        const before = issue.due_at ?? null
        const guess = guessDue(due, new Date())
        stepOff(id)
        void write(id, {
          optimistic: guess ? { ...issue, due_at: guess } : null,
          call: () => api.setDue(id, due),
          message: `${shortId(id, repoName)} due ${due}`,
          undo: before
            ? async () => {
                await api.setDue(id, before)
                refresh(id)
              }
            : null,
        })
      },
      onKeep: (issue: Issue) => {
        const id = issue.id
        stepOff(id)
        // bd moves updated_at; there is no writing the old one back, so no undo
        void write(id, {
          optimistic: { ...issue, updated_at: new Date().toISOString() },
          call: () => api.keepIssue(id),
          message: `${shortId(id, repoName)} kept, off the stale list for 30 days`,
          undo: null,
        })
      },
      onSnooze: (issue: Issue) => {
        stepOff(issue.id)
        changeStatus(issue, 'deferred', { until: SNOOZE_UNTIL }, `${shortId(issue.id, repoName)} snoozed 4 weeks`)
      },
      onClose: (issue: Issue) => {
        stepOff(issue.id)
        changeStatus(issue, 'closed', { reason: 'stale, closed from beadside' })
      },
    }),
    [stepOff, write, repoName, refresh, changeStatus],
  )

  const changeView = useCallback(
    (next: View) => {
      setView(next)
      // a view switch rebuilds the inbox: replies read so far leave it
      setVisitRead([])
      setHolding(null)
      const order = next === 'inbox' ? inbox.order : next === 'stale' ? staleNav.order : board.order
      if (selected && order.includes(selected)) return
      const first = order[0]
      if (first) select(first, false)
    },
    [inbox.order, staleNav.order, board.order, selected, select],
  )

  const links = useMemo(
    () => (current ? linksOf(current.id, issues ?? []) : []),
    [current, issues],
  )

  const openLink = useCallback(
    (id: string) => {
      if (view === 'board') reveal(id)
      open(id)
    },
    [view, reveal, open],
  )

  const onLabels = useCallback(
    (change: { add?: string[]; remove?: string[] }) => {
      if (!current) return
      const id = current.id
      const short = shortId(id, repoName)
      const add = change.add ?? []
      const remove = change.remove ?? []
      if (!add.length && !remove.length) return
      const labels = current.labels.filter((l) => !remove.includes(l)).concat(add)
      const what = add.length ? `+${add.join(' +')}` : `-${remove.join(' -')}`
      void write(id, {
        optimistic: { ...current, labels },
        call: () => api.editLabels(id, change),
        message: `${short} ${what}`,
        undo: async () => {
          await api.editLabels(id, { add: remove, remove: add })
          refresh(id)
        },
      })
    },
    [current, repoName, write, refresh],
  )

  const onSend = useCallback(() => {
    if (!current || !session) return
    const id = current.id
    const text = (drafts[id] ?? '').trim()
    if (!text || sending) return
    const presentClears = config.note.offerToClear.filter((l) => current.labels.includes(l))
    const clear = presentClears.length > 0 && (clears[id] ?? true)
    // the note and its label changes show at once; the server's detail replaces them when
    // bd is done, which takes seconds and up to ~20 s when a `bd sync` holds the lock
    const before = current
    const labels = current.labels.filter((l) => !(clear && presentClears.includes(l)))
    const addLabel = config.note.addLabel
    if (addLabel && !labels.includes(addLabel)) labels.push(addLabel)
    const pending: Comment = {
      id: `pending-${Date.now()}`,
      issue_id: id,
      author: session.me,
      text,
      created_at: new Date().toISOString(),
      by: { kind: 'human', name: session.human.name, self: true },
    }
    void qc.cancelQueries({ queryKey: ['issue', id] })
    qc.setQueryData<IssueDetail>(['issue', id], (prev) =>
      prev ? { ...prev, comments: [...prev.comments, pending] } : prev,
    )
    applyIssue({ ...current, labels, comment_count: current.comment_count + 1 })
    setDrafts((prev) => ({ ...prev, [id]: '' }))
    setSending(true)
    void api
      .postComment(id, text, clear)
      .then((detail) => {
        qc.setQueryData<IssueDetail>(['issue', id], detail)
        applyIssue(detail.issue)
        const short = shortId(id, repoName)
        let msg = `note on ${short}`
        if (addLabel) msg += `, ${addLabel} set`
        if (clear) msg += `, ${presentClears.join(', ')} cleared`
        toaster.show(msg)
      })
      .catch((error: unknown) => {
        qc.setQueryData<IssueDetail>(['issue', id], (prev) =>
          prev ? { ...prev, comments: prev.comments.filter((c) => c.id !== pending.id) } : prev,
        )
        applyIssue(before)
        // give the text back unless a new draft was started meanwhile
        setDrafts((prev) => (prev[id] ? prev : { ...prev, [id]: text }))
        toaster.fail(error instanceof Error ? error.message : 'comment failed')
      })
      .finally(() => {
        setSending(false)
        refresh(id)
      })
  }, [current, session, drafts, clears, sending, qc, applyIssue, toaster, repoName, refresh, config])

  // answering a stored question: the server writes the note and stamps the question; the card
  // keeps its text until bd is done, and gets it back when the write fails
  const onAnswer = useCallback(
    async (text: string): Promise<boolean> => {
      if (!current) return false
      const id = current.id
      const presentClears = config.note.offerToClear.filter((l) => current.labels.includes(l))
      const clear = presentClears.length > 0 ? (clears[id] ?? true) : undefined
      try {
        const detail = await api.answerAsk(id, text, clear)
        qc.setQueryData<IssueDetail>(['issue', id], detail)
        applyIssue(detail.issue)
        let msg = `answered ${shortId(id, repoName)}`
        if (config.note.addLabel) msg += `, ${config.note.addLabel} set`
        if (clear) msg += `, ${presentClears.join(', ')} cleared`
        toaster.show(msg)
        return true
      } catch (error: unknown) {
        toaster.fail(error instanceof Error ? error.message : 'answer failed')
        return false
      } finally {
        refresh(id)
      }
    },
    [current, config, clears, qc, applyIssue, repoName, toaster, refresh],
  )

  const onCaptureSubmit = useCallback(() => {
    const title = capture.trim()
    if (!title) return
    setCapture('')
    void api
      .createIssue(title)
      .then(({ issue }) => {
        qc.setQueryData<IssueList>(['issues'], (prev) =>
          prev ? { ...prev, issues: [...prev.issues, issue] } : prev,
        )
        select(issue.id, false)
        const labelText =
          config.capture.labels.length > 0
            ? ` as ${config.capture.labels.join(' + ')}`
            : ''
        toaster.show(`filed ${shortId(issue.id, repoName)}${labelText}`, async () => {
          await api.deleteIssue(issue.id)
          qc.setQueryData<IssueList>(['issues'], (prev) =>
            prev ? { ...prev, issues: prev.issues.filter((i) => i.id !== issue.id) } : prev,
          )
          setSelected(null)
          window.history.replaceState(null, '', ' ')
          refresh(null)
        })
      })
      .catch((error: unknown) => {
        setCapture(title)
        toaster.fail(error instanceof Error ? error.message : 'capture failed')
      })
      .finally(() => refresh(null))
  }, [capture, qc, select, toaster, repoName, refresh, config])

  // board sections by their key, inbox sections by their fold key; both live in one store
  const onToggleSection = useCallback(
    (sectionKey: string) => {
      const section =
        board.sections.find((s) => s.key === sectionKey) ??
        inbox.sections.find((s) => inboxFoldKey(s.key) === sectionKey)
      if (section) setFolded(sectionKey, !section.folded)
    },
    [board, inbox, setFolded],
  )

  const onCopyId = useCallback(
    (id: string) => {
      const short = shortId(id, repoName)
      void navigator.clipboard.writeText(short).then(
        () => toaster.show(`copied ${short}`),
        () => toaster.fail(`could not copy ${short}`),
      )
    },
    [repoName, toaster],
  )

  const pickHit = useCallback(
    (hit: SearchHit) => {
      open(hit.id)
      setRevealTarget((prev) => ({
        id: hit.id,
        field: hit.field,
        commentId: hit.comment?.id ?? null,
        seq: (prev?.seq ?? 0) + 1,
      }))
    },
    [open],
  )

  const moveHit = useCallback(
    (delta: 1 | -1) => {
      const hits = searchResult?.hits ?? []
      if (!hits.length) return
      const at = selected ? hits.findIndex((h) => h.id === selected) : -1
      const next = at < 0 ? hits[0] : hits[Math.min(hits.length - 1, Math.max(0, at + delta))]
      if (next) pickHit(next)
    },
    [searchResult, selected, pickHit],
  )

  const clearSearch = useCallback(() => {
    setSearchInput('')
    setRevealTarget(null)
  }, [])

  const submitSearch = useCallback(() => {
    const hits = searchResult?.hits ?? []
    const current = hits.find((h) => h.id === selected) ?? hits[0]
    if (current) pickHit(current)
    if (hits.length) searchRef.current?.blur()
  }, [searchResult, selected, pickHit])

  // keyboard: movement, folds, the note box, copy, defer and close, search, quick capture, theme, body font
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true
      if (typing) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      if (searching && (e.key === 'ArrowDown' || e.key === 'j' || e.key === 'ArrowUp' || e.key === 'k')) {
        e.preventDefault()
        moveHit(e.key === 'ArrowDown' || e.key === 'j' ? 1 : -1)
      } else if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault()
        const next = step(nav, selected, 1)
        if (next) select(next)
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault()
        const next = step(nav, selected, -1)
        if (next) select(next)
      } else if (!searching && (e.key === 'i' || e.key === 'b' || e.key === 'o')) {
        e.preventDefault()
        changeView(e.key === 'i' ? 'inbox' : e.key === 'b' ? 'board' : 'stale')
      } else if (e.key === 's') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      } else if ((searching || view === 'stale') && (e.key === 'h' || e.key === 'l')) {
        // folds belong to the board and the inbox; the results and the stale filter have none
      } else if (e.key === 'h' || e.key === 'l') {
        e.preventDefault()
        if (!selected) return
        const fold = e.key === 'h'
        const key =
          view === 'inbox'
            ? inbox.sections
                .filter((s) => s.folded !== fold && s.rows.some((i) => i.id === selected))
                .map((s) => inboxFoldKey(s.key))[0]
            : sectionsHolding(board, selected).find((s) => s.folded !== fold)?.key
        if (key) setFolded(key, fold)
      } else if (e.key === 'c') {
        e.preventDefault()
        if (selected) onCopyId(selected)
      } else if (e.key === 'n' || e.key === 'm') {
        e.preventDefault()
        const status = e.key === 'n' ? 'deferred' : 'closed'
        if (!selected || board.byId.get(selected)?.status === status) return
        // the bead leaves its section, so the selection moves on to the row below it
        onStatus(status)
        // in search results the bead stays listed, so the selection stays with it
        if (searching) return
        const below = step(nav, selected, 1)
        const next = below && below !== selected ? below : step(nav, selected, -1)
        if (next && next !== selected) select(next, false)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        noteRef.current?.focus()
      } else if (e.key === '?') {
        e.preventDefault()
        setHelp((open) => !open)
      } else if (e.key === 'Escape') {
        setHelp(false)
        if (searching) clearSearch()
        ;(document.activeElement as HTMLElement | null)?.blur()
      } else if (e.key === '/') {
        e.preventDefault()
        captureRef.current?.focus()
      } else if (e.key === 't') {
        e.preventDefault()
        toggleTheme()
      } else if (e.key === 'f') {
        e.preventDefault()
        toggleFont()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [board, inbox, nav, view, changeView, selected, select, setFolded, onCopyId, onStatus, searching, moveHit, clearSearch, toggleTheme, toggleFont])

  if (sessionQuery.isError || issuesQuery.isError) {
    const error = sessionQuery.error ?? issuesQuery.error
    return (
      <div className="loading">
        no answer from the beadside server on /api. {error instanceof Error ? error.message : ''}
      </div>
    )
  }
  // the shared seen markers too, or every reply would flash unread first
  if (!session || !issues || !memory.ready) return <div className="loading">reading the ledger…</div>

  const draft = selected ? (drafts[selected] ?? '') : ''
  const clear = selected ? (clears[selected] ?? true) : true

  return (
    <>
      <div className={reading ? 'app reading' : 'app'}>
        <IndexPane
          board={board}
          repoName={repoName}
          config={config}
          selected={selected}
          onSelect={open}
          onToggleSection={onToggleSection}
          captureRef={captureRef}
          captureValue={capture}
          onCaptureChange={setCapture}
          onCaptureSubmit={onCaptureSubmit}
          fetchedAt={issuesQuery.data?.fetchedAt}
          theme={theme}
          onToggleTheme={toggleTheme}
          font={font}
          onToggleFont={toggleFont}
          help={help}
          onHelp={setHelp}
          view={view}
          onView={changeView}
          inbox={inbox}
          stale={stale}
          now={now}
          actions={rowActions}
          search={{
            ref: searchRef,
            value: searchInput,
            onChange: setSearchInput,
            scope,
            onScope: setScope,
            query: searchResult?.query ?? searchQuery,
            result: searchResult,
            loading:
              searching &&
              (searchInput.trim() !== searchQuery || searchQueryResult.isFetching || searchQueryResult.isPlaceholderData),
            error: searchQueryResult.isError
              ? searchQueryResult.error instanceof Error
                ? searchQueryResult.error.message
                : 'search failed'
              : null,
            onPick: pickHit,
            onMove: moveHit,
            onSubmit: submitSearch,
            onClear: clearSearch,
          }}
        />
        <DetailPane
          issue={current}
          detail={detailQuery.data}
          repoName={repoName}
          config={config}
          human={humanName}
          knownLabels={knownLabels}
          reveal={revealTarget}
          noteRef={noteRef}
          note={draft}
          onNoteChange={(value) => {
            if (selected) setDrafts((prev) => ({ ...prev, [selected]: value }))
          }}
          clear={clear}
          onClearChange={(value) => {
            if (selected) setClears((prev) => ({ ...prev, [selected]: value }))
          }}
          onSend={onSend}
          sending={sending}
          onPriority={onPriority}
          onStatus={onStatus}
          onLabels={onLabels}
          onCopyId={onCopyId}
          onBack={closeReading}
          links={links}
          byId={board.byId}
          onOpenLink={openLink}
          folds={folds}
          onAnswer={onAnswer}
        />
      </div>
      <Toast toast={toaster.toast} onUndo={toaster.runUndo} onDismiss={toaster.dismiss} />
    </>
  )
}
