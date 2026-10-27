// the question an agent stored on the bead, pinned above the description with its own answer box

import { useRef, useState } from 'react'
import type { BoardConfig } from '../api'
import type { Ask } from '../asks'
import { raisedText } from '../asks'
import { formatShortDate, formatShortDateTime, relativeTime } from '../format'

interface AskCardProps {
  ask: Ask
  short: string
  config: BoardConfig
  /** resolves true once the answer is on the bead, false when it failed and the text stays */
  onAnswer: (text: string) => Promise<boolean>
}

const VIA: Record<string, string> = { hub: 'from the hub', beadside: 'here' }

/** the open question with its options, or the answer waiting for a session */
export function AskCard({ ask, short, config, onAnswer }: AskCardProps) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const boxRef = useRef<HTMLTextAreaElement>(null)
  const raised = raisedText(ask)
  const since = ask.first_raised ? `first ${formatShortDate(ask.first_raised)}` : ''
  const empty = text.trim().length === 0

  const send = () => {
    if (empty || sending) return
    setSending(true)
    void onAnswer(text.trim()).then((done) => {
      setSending(false)
      if (done) setText('')
    })
  }

  // a chip puts its word in the box, ready to send or to add to
  const pick = (k: string) => {
    setText((prev) => (!prev.trim() || ask.options.some((o) => o.k === prev.trim()) ? k : prev))
    boxRef.current?.focus()
  }

  if (ask.answered) {
    const a = ask.answered
    return (
      <section className="ask answered" aria-label="answered question">
        <div className="askhead">
          <span className="asklabel">answered</span>
          <span title={relativeTime(a.at)}>
            {formatShortDateTime(a.at)}
            {a.via && VIA[a.via] ? `, ${VIA[a.via]}` : ''}
          </span>
          <span className="askwait">waiting for a session to act on it</span>
        </div>
        <p className="askq">{ask.question}</p>
        {a.text ? <p className="askanswer">{a.text}</p> : null}
      </section>
    )
  }

  return (
    <section className="ask" aria-label="question to answer">
      <div className="askhead">
        <span className="asklabel">{ask.title ?? 'question'}</span>
        {raised ? (
          <span className={(ask.days_raised ?? 0) >= 3 ? 'hot' : ''} title={since}>
            {raised}
          </span>
        ) : since ? (
          <span>{since}</span>
        ) : null}
        {ask.due ? <span>due {formatShortDate(ask.due)}</span> : null}
      </div>
      <p className="askq">{ask.question}</p>
      {ask.why ? <p className="askwhy">{ask.why}</p> : null}
      {ask.options.length ? (
        <div className="askopts">
          {ask.options.map((o) => (
            <button
              key={o.k}
              className={text.trim() === o.k ? 'askopt on' : 'askopt'}
              onClick={() => pick(o.k)}
              title={o.k === ask.lean ? 'the lean' : undefined}
            >
              <b>{o.k}</b>
              {o.k === ask.lean ? <span className="asklean">lean</span> : null}
              {o.sub ? <span className="asksub">{o.sub}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      <textarea
        ref={boxRef}
        value={text}
        aria-label={`answer for ${short}`}
        placeholder={ask.options.length ? 'pick an option or write your answer…' : 'write your answer…'}
        rows={2}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            send()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.currentTarget.blur()
          }
        }}
      />
      <div className="askrow">
        <span className="chint">
          answering writes it as your note on {short}
          {config.note.addLabel ? (
            <>
              , labels it <span className="mono">{config.note.addLabel}</span>
            </>
          ) : null}{' '}
          and marks the question answered.
        </span>
        <button className="btn primary" onClick={send} disabled={empty || sending}>
          {sending ? 'answering…' : 'answer'}
        </button>
      </div>
    </section>
  )
}
