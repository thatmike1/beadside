// the left index: counts, quick capture, sections of one-line rows, keyboard hint

import { useEffect, useLayoutEffect, useRef } from 'react'
import type { CSSProperties, RefObject } from 'react'
import type { BoardConfig, Issue, SearchHit, SearchResult, SearchScope } from '../api'
import type { Board, BoardRow } from '../model'
import { axisOf } from '../model'
import type { Inbox } from '../inbox'
import { axisStyle, formatTime, laneColor } from '../format'
import type { Theme } from '../use-theme'
import { SearchResults } from './search-results'
import { InboxList, StaleList, type RowActions } from './inbox-list'
import { Row } from './row'

/** the inbox lands first; the board is the lanes, stale the board filtered to old open work */
export type View = 'inbox' | 'board' | 'stale'

interface IndexPaneProps {
  board: Board
  repoName: string
  config: BoardConfig
  selected: string | null
  onSelect: (id: string) => void
  onToggleSection: (sectionKey: string) => void
  captureRef: RefObject<HTMLInputElement | null>
  captureValue: string
  onCaptureChange: (value: string) => void
  onCaptureSubmit: () => void
  fetchedAt: string | undefined
  search: SearchProps
  theme: Theme
  onToggleTheme: () => void
  view: View
  onView: (view: View) => void
  inbox: Inbox
  stale: Issue[]
  now: Date
  actions: RowActions
}

export interface SearchProps {
  ref: RefObject<HTMLInputElement | null>
  value: string
  onChange: (value: string) => void
  scope: SearchScope
  onScope: (scope: SearchScope) => void
  /** the query the result belongs to */
  query: string
  result: SearchResult | undefined
  loading: boolean
  error: string | null
  onPick: (hit: SearchHit) => void
  /** arrow keys in the box step through hits */
  onMove: (delta: 1 | -1) => void
  /** enter opens the current hit and hands the keyboard to the list */
  onSubmit: () => void
  onClear: () => void
}

const SCOPES: { scope: SearchScope; label: string }[] = [
  { scope: 'all', label: 'all' },
  { scope: 'open', label: 'open' },
  { scope: 'closed', label: 'closed' },
]

/** left pane: the whole ledger as one dense scrollable index */
export function IndexPane(props: IndexPaneProps) {
  const {
    board,
    repoName,
    config,
    selected,
    onSelect,
    onToggleSection,
    captureRef,
    captureValue,
    onCaptureChange,
    onCaptureSubmit,
    fetchedAt,
    search,
    theme,
    onToggleTheme,
    view,
    onView,
    inbox,
    stale,
    now,
    actions,
  } = props
  const listProps = { ...actions, repoName, config, selected, now, onSelect }
  const listRef = useRef<HTMLDivElement>(null)
  const searching = search.value.trim().length > 0
  const boardScroll = useRef(0)
  const wasSearching = useRef(false)

  // entering a search remembers where the board was scrolled; clearing puts it back
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list || searching === wasSearching.current) return
    if (searching) {
      list.scrollTop = 0
    } else {
      list.scrollTop = boardScroll.current
    }
    wasSearching.current = searching
  }, [searching])

  // keep the selected row on screen as the selection moves; a refetch or a fold elsewhere
  // must not drag the list back to it
  useEffect(() => {
    if (!selected || !listRef.current) return
    const el = listRef.current.querySelector(`[data-id="${CSS.escape(selected)}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const { counts } = board
  const capturePlaceholder =
    config.capture.labels.length > 0
      ? `capture a thought, enter files it as ${config.capture.labels.join(' + ')}`
      : 'capture a thought, enter files it'

  return (
    <aside className="index">
      <div className="ihead">
        <div className="brand">
          <b>beadside</b>
          <span>{repoName}</span>
          {fetchedAt ? <span className="stale">read {formatTime(fetchedAt)}</span> : null}
          <button
            className="theme"
            onClick={onToggleTheme}
            aria-label={`switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            title="t"
          >
            {theme === 'dark' ? 'light' : 'dark'}
          </button>
        </div>
        <div className="counts">
          <em>{counts.open}</em> open<span className="sep">/</span>
          <em>{counts.inProgress}</em> in progress<span className="sep">/</span>
          <em>{counts.deferred}</em> deferred
          {config.waiting.labels.length > 0 ? (
            <>
              <span className="sep">/</span>
              <span className={counts.waiting ? 'hot' : ''}>
                <em>{counts.waiting}</em> waiting on you
              </span>
            </>
          ) : null}
          {config.note.addLabel ? (
            <>
              <span className="sep">/</span>
              <span className={counts.unread ? 'hot' : ''}>
                <em>{counts.unread}</em> carrying your note
              </span>
            </>
          ) : null}
        </div>
      </div>

      <div className="views" role="tablist" aria-label="view">
        {(
          [
            ['inbox', 'inbox', inbox.count, 'i'],
            ['board', 'board', null, 'b'],
            ['stale', 'stale', stale.length, 'o'],
          ] as const
        ).map(([key, label, n, kbd]) => (
          <button
            key={key}
            role="tab"
            aria-selected={view === key}
            className={view === key ? 'on' : ''}
            onClick={() => onView(key)}
            title={kbd}
          >
            {label}
            {n !== null ? <span className={key === 'inbox' && n ? 'n hot' : 'n'}>{n}</span> : null}
          </button>
        ))}
      </div>

      <div className="search">
        <input
          ref={search.ref}
          value={search.value}
          type="search"
          aria-label="search beads"
          placeholder="search titles, descriptions, notes, comments"
          onChange={(e) => {
            if (!searching && e.target.value.trim() && listRef.current) boardScroll.current = listRef.current.scrollTop
            search.onChange(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              search.onMove(e.key === 'ArrowDown' ? 1 : -1)
            } else if (e.key === 'Enter') {
              e.preventDefault()
              search.onSubmit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              if (search.value) search.onClear()
              else e.currentTarget.blur()
            }
          }}
        />
        {search.value ? (
          <button className="sclear" onClick={search.onClear} aria-label="clear search">
            &times;
          </button>
        ) : null}
        <span className="scopes" role="radiogroup" aria-label="search scope">
          {SCOPES.map(({ scope, label }) => (
            <button
              key={scope}
              role="radio"
              aria-checked={search.scope === scope}
              className={search.scope === scope ? 'on' : ''}
              onClick={() => search.onScope(scope)}
            >
              {label}
            </button>
          ))}
        </span>
      </div>

      <div className="capture" hidden={searching}>
        <input
          ref={captureRef}
          value={captureValue}
          placeholder={capturePlaceholder}
          onChange={(e) => onCaptureChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onCaptureSubmit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              if (captureValue) onCaptureChange('')
              else e.currentTarget.blur()
            }
          }}
        />
      </div>

      <div className="ilist" ref={listRef}>
        {searching ? (
          <SearchResults
            query={search.query}
            scope={search.scope}
            result={search.result}
            loading={search.loading}
            error={search.error}
            repoName={repoName}
            selected={selected}
            onPick={search.onPick}
          />
        ) : null}
        {!searching && view === 'inbox' ? (
          <InboxList {...listProps} inbox={inbox} onBoard={() => onView('board')} />
        ) : null}
        {!searching && view === 'stale' ? <StaleList {...listProps} stale={stale} /> : null}
        {searching || view !== 'board' ? null : board.sections.map((section) => {
          const color = laneColor(section.axis, config)
          return (
            <div className={section.folded ? 'sec folded' : 'sec'} key={section.key}>
              <button
                className={section.signal ? 'sechead hot' : 'sechead'}
                aria-expanded={!section.folded}
                onClick={() => onToggleSection(section.key)}
              >
                <span style={color ? { color } : undefined}>{section.title}</span>
                <span className="n">{section.count}</span>
                {section.note ? <span className="note">{section.note}</span> : null}
              </button>
              <div className="secrule" />
              {/* always rendered so the fold can animate; inert while folded so nothing inside takes focus */}
              <div className="secbody" inert={section.folded}>
                <div className="secbody-in">
                  {section.groups.map((group) => {
                    const rowFor = (row: BoardRow) => (
                      <Row
                        key={row.issue.id}
                        row={row}
                        axis={section.axis ?? axisOf(row.issue, config.lanes)}
                        repoName={repoName}
                        config={config}
                        selected={row.issue.id === selected}
                        showWaitDot={section.key !== 'waiting'}
                        onSelect={onSelect}
                      />
                    )
                    if (!group.head && !group.caption) {
                      return <div key={group.key}>{group.rows.map(rowFor)}</div>
                    }
                    return (
                      <div key={group.key} className="group">
                        {group.head ? (
                          rowFor(group.head)
                        ) : (
                          <div className="row caption">
                            <span />
                            <span className="mono rid">{group.caption?.short ?? ''}</span>
                            <span className="rt">
                              <span className="chip">{group.caption?.label}</span>
                              <span className="gn">{group.rows.length}</span>
                            </span>
                          </div>
                        )}
                        <div
                          className="kids"
                          style={axisStyle(section.axis, config) as CSSProperties}
                        >
                          {group.rows.map(rowFor)}
                        </div>
                      </div>
                    )
                  })}
                  {section.groups.length === 0 ? (
                    <div className="grouphead">
                      <span className="gt">nothing {section.signal ? 'waiting' : 'here'}</span>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="hint">
        <span>
          <kbd>&#8593;</kbd>
          <kbd>&#8595;</kbd> <kbd>j</kbd>
          <kbd>k</kbd> move
        </span>
        <span>
          <kbd>enter</kbd> note
        </span>
        <span>
          <kbd>esc</kbd> leave
        </span>
        <span>
          <kbd>c</kbd> copy id
        </span>
        <span>
          <kbd>n</kbd> defer
        </span>
        <span>
          <kbd>m</kbd> close
        </span>
        <span>
          <kbd>h</kbd>
          <kbd>l</kbd> fold
        </span>
        <span>
          <kbd>i</kbd>
          <kbd>b</kbd>
          <kbd>o</kbd> inbox, board, stale
        </span>
        <span>
          <kbd>s</kbd> search
        </span>
        <span>
          <kbd>/</kbd> capture
        </span>
        <span>
          <kbd>t</kbd> theme
        </span>
      </div>
    </aside>
  )
}
