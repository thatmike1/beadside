// the note pinned to the foot of the detail pane: one comment, optionally labelled

import type { RefObject } from 'react'
import type { BoardConfig, Issue } from '../api'
import { useStrings } from '../i18n'

interface NoteBoxProps {
  issue: Issue
  short: string
  config: BoardConfig
  noteRef: RefObject<HTMLTextAreaElement | null>
  value: string
  onChange: (value: string) => void
  clear: boolean
  onClearChange: (value: boolean) => void
  onSend: () => void
  sending: boolean
}

/** write box whose send runs `bd comment` and updates labels via config */
export function NoteBox(props: NoteBoxProps) {
  const s = useStrings()
  const { issue, short, config, noteRef, value, onChange, clear, onClearChange, onSend, sending } =
    props
  const author = config.human ? ` --author ${config.human.id}` : ''
  const presentClears = config.note.offerToClear.filter((l) => issue.labels.includes(l))
  const empty = value.trim().length === 0

  return (
    <div className="composer">
      <div className="cwrap">
        <textarea
          ref={noteRef}
          value={value}
          placeholder={s.note.placeholder(short)}
          aria-label={s.note.placeholder(short)}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              if (!empty && !sending) onSend()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              e.currentTarget.blur()
            }
          }}
        />
        <div className="crow">
          <span className="chint">
            {s.note.runs}{' '}
            <span className="mono">
              bd comments add {short}
              {author}
            </span>
            {config.note.addLabel ? (
              <>
                {' '}
                {s.note.labels} <span className="mono">{config.note.addLabel}</span>
                {s.note.readsFirst}
              </>
            ) : (
              '.'
            )}
          </span>
          <span className="cbtns">
            {presentClears.length > 0 ? (
              <label className="clear">
                <input
                  type="checkbox"
                  checked={clear}
                  onChange={(e) => onClearChange(e.target.checked)}
                />
                {s.note.clear(presentClears)}
              </label>
            ) : null}
            <button className="btn primary" onClick={onSend} disabled={empty || sending}>
              {sending ? s.note.sending : s.note.send}
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}
