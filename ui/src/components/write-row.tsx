// compact write controls in the detail header: priority, status, labels

import { useState } from 'react'
import type { Issue, Status } from '../api'
import { useStrings } from '../i18n'

interface WriteRowProps {
  issue: Issue
  knownLabels: string[]
  onPriority: (priority: number) => void
  onStatus: (status: Status) => void
  onLabels: (change: { add?: string[]; remove?: string[] }) => void
}

const PRIORITIES = [0, 1, 2, 3, 4]

/** the statuses one click sets, in the order the switch shows them */
export const SWITCH_STATUSES: readonly Status[] = ['open', 'in_progress', 'pinned', 'deferred', 'closed']

/** the switch's segments: blocked is set by dependencies, not by hand, so it only shows while it holds */
export function statusSegments(current: Status): Status[] {
  return SWITCH_STATUSES.includes(current) ? [...SWITCH_STATUSES] : [...SWITCH_STATUSES, current]
}

/** bd accepts labels of 1 to 128 characters with no whitespace */
function validLabel(value: string): boolean {
  return value.length > 0 && value.length <= 128 && !/\s/.test(value)
}

/** the second row of the detail header: everything writable except the note */
export function WriteRow({ issue, knownLabels, onPriority, onStatus, onLabels }: WriteRowProps) {
  const s = useStrings()
  const [draft, setDraft] = useState('')
  const suggestions = knownLabels.filter((l) => !issue.labels.includes(l))

  const add = () => {
    const value = draft.trim()
    if (!validLabel(value) || issue.labels.includes(value)) return
    setDraft('')
    onLabels({ add: [value] })
  }

  return (
    <div className="writerow">
      <div className="stepper" role="group" aria-label={s.write.priority}>
        <span className="lab">{s.write.priority}</span>
        {PRIORITIES.map((p) => (
          <button
            key={p}
            className={p === issue.priority ? 'on' : ''}
            aria-pressed={p === issue.priority}
            onClick={() => onPriority(p)}
            title={s.write.setPriority(p)}
          >
            p{p}
          </button>
        ))}
      </div>

      <div className="segments" role="group" aria-label={s.write.status}>
        <span className="lab">{s.write.status}</span>
        <span className="seg">
          {statusSegments(issue.status).map((status) => {
            const on = status === issue.status
            return (
              <button
                key={status}
                className={on ? `on st-${status}` : `st-${status}`}
                aria-pressed={on}
                disabled={!SWITCH_STATUSES.includes(status)}
                onClick={() => {
                  if (!on) onStatus(status)
                }}
              >
                {s.status[status]}
              </button>
            )
          })}
        </span>
      </div>

      <div className="labeled">
        <span className="lab">{s.write.labels}</span>
        {issue.labels.map((label) => (
          <span className="chip" key={label}>
            {label}
            <button
              onClick={() => onLabels({ remove: [label] })}
              title={s.write.remove(label)}
              aria-label={s.write.remove(label)}
            >
              &times;
            </button>
          </span>
        ))}
        <input
          list="known-labels"
          value={draft}
          placeholder={s.write.addLabel}
          aria-label={s.write.addLabel}
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
          {s.write.add}
        </button>
      </div>
    </div>
  )
}
