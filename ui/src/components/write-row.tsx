// compact write controls in the detail header: priority, status verbs, labels

import { useState } from 'react'
import type { Issue, Status } from '../api'

interface WriteRowProps {
  issue: Issue
  knownLabels: string[]
  onPriority: (priority: number) => void
  onStatus: (status: Status) => void
  onLabels: (change: { add?: string[]; remove?: string[] }) => void
}

const PRIORITIES = [0, 1, 2, 3, 4]

/** bd accepts labels of 1 to 128 characters with no whitespace */
function validLabel(value: string): boolean {
  return value.length > 0 && value.length <= 128 && !/\s/.test(value)
}

/** the second row of the detail header: everything writable except the note */
export function WriteRow({ issue, knownLabels, onPriority, onStatus, onLabels }: WriteRowProps) {
  const [draft, setDraft] = useState('')
  const closed = issue.status === 'closed'
  const deferred = issue.status === 'deferred'
  const pinned = issue.status === 'pinned'
  const suggestions = knownLabels.filter((l) => !issue.labels.includes(l))

  const add = () => {
    const value = draft.trim()
    if (!validLabel(value) || issue.labels.includes(value)) return
    setDraft('')
    onLabels({ add: [value] })
  }

  return (
    <div className="writerow">
      <div className="stepper">
        <span className="lab">priority</span>
        {PRIORITIES.map((p) => (
          <button
            key={p}
            className={p === issue.priority ? 'on' : ''}
            onClick={() => onPriority(p)}
            title={`set priority ${p}`}
          >
            p{p}
          </button>
        ))}
      </div>

      <div className="verbs">
        {!deferred && !closed && !pinned ? <button onClick={() => onStatus('pinned')}>pin</button> : null}
        {pinned ? <button onClick={() => onStatus('open')}>unpin</button> : null}
        {!deferred && !closed && !pinned ? <button onClick={() => onStatus('deferred')}>defer</button> : null}
        {!closed ? <button onClick={() => onStatus('closed')}>close</button> : null}
        {closed || deferred ? <button onClick={() => onStatus('open')}>reopen</button> : null}
      </div>

      <div className="labeled">
        <span>labels</span>
        {issue.labels.map((label) => (
          <span className="chip" key={label}>
            {label}
            <button onClick={() => onLabels({ remove: [label] })} title={`remove ${label}`}>
              &times;
            </button>
          </span>
        ))}
        <input
          list="known-labels"
          value={draft}
          placeholder="add label"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setDraft('')
              e.currentTarget.blur()
            }
          }}
        />
        <datalist id="known-labels">
          {suggestions.map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>
        <button className="add" onClick={add} disabled={!validLabel(draft.trim())}>
          add
        </button>
      </div>
    </div>
  )
}
