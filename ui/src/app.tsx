// shell: queries, selection, writes with undo, keyboard

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from './api'
import type { BoardConfig, Issue, IssueDetail, IssueList, SearchHit, SearchScope, Status } from './api'
import { buildBoard, sectionsHolding, shortId, step } from './model'
import { IndexPane } from './components/index-pane'
import { DetailPane, type RevealTarget } from './components/detail-pane'
import { Toast } from './components/toast'
import { useToast } from './use-toast'
import { useFolds } from './use-folds'
import { useLive } from './use-live'
import { writeSelectionHash } from './navigation'

const EMPTY_CONFIG: BoardConfig = {
  agentsview: null,
  notesDir: null,
  lanes: [],
  unlaned: { title: 'open', note: null },
  subLabels: [],
  waiting: { labels: [], title: 'waiting on you', note: null },
  note: { addLabel: null, offerToClear: [] },
  thoughts: null,
  flags: [],
  capture: { labels: [] },
  derived: { allFlags: [], hotChips: [] },
  human: null,
}

const SEARCH_DEBOUNCE_MS = 180
/** polling while the server's live feed is off or unreachable */
const POLL_MS = 20_000

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
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const captureRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

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
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [clears, setClears] = useState<Record<string, boolean>>({})
  const [capture, setCapture] = useState('')
  const [sending, setSending] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [scope, setScope] = useState<SearchScope>('all')
  const [revealTarget, setRevealTarget] = useState<RevealTarget | null>(null)
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
      writeSelectionHash(id, selected, repoName, userInitiated)
    },
    [selected, repoName],
  )

  // a bead reached through the hash may sit only inside folded sections: open the first of them
  const reveal = useCallback(
    (id: string) => {
      const holding = sectionsHolding(board, id)
      const first = holding[0]
      if (first && holding.every((s) => s.folded)) folds.setFolded(first.key, false)
    },
    [board, folds],
  )

  // first paint: the hash wins, otherwise the first row of the index
  useEffect(() => {
    if (selected || !issues?.length) return
    const wanted = decodeURIComponent(window.location.hash.slice(1))
    const match = wanted
      ? issues.find((i) => i.id === wanted || shortId(i.id, repoName) === wanted)
      : undefined
    const next = match?.id ?? board.order[0] ?? issues[0]?.id ?? null
    if (next) {
      if (match) reveal(match.id)
      select(next, false)
    }
  }, [selected, issues, board.order, repoName, select, reveal])

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
        prev ? { ...prev, issues: prev.issues.map((i) => (i.id === next.id ? next : i)) } : prev,
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
        toaster.show(spec.message, spec.undo ?? undefined)
      } catch (error: unknown) {
        toaster.fail(error instanceof Error ? error.message : 'write failed')
      } finally {
        refresh(id)
      }
    },
    [applyIssue, refresh, toaster],
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

  const onStatus = useCallback(
    (status: Status) => {
      if (!current) return
      const before = current.status
      if (before === status) return
      const id = current.id
      const short = shortId(id, repoName)
      const verb = status === 'closed' ? 'closed' : status === 'deferred' ? 'deferred' : 'reopened'
      void write(id, {
        optimistic: { ...current, status },
        call: () => api.setStatus(id, status),
        message: `${short} ${verb}`,
        undo: async () => {
          await api.setStatus(id, before)
          refresh(id)
        },
      })
    },
    [current, repoName, write, refresh],
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
    if (!current) return
    const id = current.id
    const text = (drafts[id] ?? '').trim()
    if (!text || sending) return
    const presentClears = config.note.offerToClear.filter((l) => current.labels.includes(l))
    const clear = presentClears.length > 0 && (clears[id] ?? true)
    setSending(true)
    void api
      .postComment(id, text, clear)
      .then((detail) => {
        qc.setQueryData<IssueDetail>(['issue', id], detail)
        applyIssue(detail.issue)
        setDrafts((prev) => ({ ...prev, [id]: '' }))
        const short = shortId(id, repoName)
        let msg = `note on ${short}`
        if (config.note.addLabel) msg += `, ${config.note.addLabel} set`
        if (clear) msg += `, ${presentClears.join(', ')} cleared`
        toaster.show(msg)
      })
      .catch((error: unknown) => {
        toaster.fail(error instanceof Error ? error.message : 'comment failed')
      })
      .finally(() => {
        setSending(false)
        refresh(id)
      })
  }, [current, drafts, clears, sending, qc, applyIssue, toaster, repoName, refresh, config])

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

  const onToggleSection = useCallback(
    (sectionKey: string) => {
      const section = board.sections.find((s) => s.key === sectionKey)
      if (section) setFolded(sectionKey, !section.folded)
    },
    [board, setFolded],
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
      select(hit.id)
      setRevealTarget((prev) => ({
        id: hit.id,
        field: hit.field,
        commentId: hit.comment?.id ?? null,
        seq: (prev?.seq ?? 0) + 1,
      }))
    },
    [select],
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

  // keyboard: movement, folds, the note box, copy, defer and close, search, quick capture
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
        const next = step(board, selected, 1)
        if (next) select(next)
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault()
        const next = step(board, selected, -1)
        if (next) select(next)
      } else if (e.key === 's') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      } else if (searching && (e.key === 'h' || e.key === 'l')) {
        // folds belong to the board, which is hidden behind the results
      } else if (e.key === 'h' || e.key === 'l') {
        e.preventDefault()
        if (!selected) return
        const fold = e.key === 'h'
        const section = sectionsHolding(board, selected).find((s) => s.folded !== fold)
        if (section) setFolded(section.key, fold)
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
        const below = step(board, selected, 1)
        const next = below && below !== selected ? below : step(board, selected, -1)
        if (next && next !== selected) select(next, false)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        noteRef.current?.focus()
      } else if (e.key === 'Escape') {
        if (searching) clearSearch()
        ;(document.activeElement as HTMLElement | null)?.blur()
      } else if (e.key === '/') {
        e.preventDefault()
        captureRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [board, selected, select, setFolded, onCopyId, onStatus, searching, moveHit, clearSearch])

  if (sessionQuery.isError || issuesQuery.isError) {
    const error = sessionQuery.error ?? issuesQuery.error
    return (
      <div className="loading">
        no answer from the bd-board server on /api. {error instanceof Error ? error.message : ''}
      </div>
    )
  }
  if (!session || !issues) return <div className="loading">reading the ledger…</div>

  const draft = selected ? (drafts[selected] ?? '') : ''
  const clear = selected ? (clears[selected] ?? true) : true

  return (
    <>
      <div className="app">
        <IndexPane
          board={board}
          repoName={repoName}
          config={config}
          selected={selected}
          onSelect={select}
          onToggleSection={onToggleSection}
          captureRef={captureRef}
          captureValue={capture}
          onCaptureChange={setCapture}
          onCaptureSubmit={onCaptureSubmit}
          fetchedAt={issuesQuery.data?.fetchedAt}
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
        />
      </div>
      <Toast toast={toaster.toast} onUndo={toaster.runUndo} onDismiss={toaster.dismiss} />
    </>
  )
}
