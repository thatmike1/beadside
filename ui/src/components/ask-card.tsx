// the question an agent stored on the bead, pinned above the description with its own answer box

import { useRef, useState } from 'react'
import type { BoardConfig } from '../api'
import type { Ask } from '../asks'
import { raisedLine, useStrings } from '../i18n'

interface AskCardProps {
  ask: Ask
  short: string
  config: BoardConfig
  /** resolves true once the answer is on the bead, false when it failed and the text stays */
  onAnswer: (text: string) => Promise<boolean>
}

/** the open question with its options, or the answer waiting for a session */
export function AskCard({ ask, short, config, onAnswer }: AskCardProps) {
  const s = useStrings()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const boxRef = useRef<HTMLTextAreaElement>(null)
  const raised = raisedLine(s, ask)
  const since = ask.first_raised ? s.ask.first(s.shortDate(ask.first_raised)) : ''
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
      <section className="ask answered" aria-label={s.ask.answeredLabel}>
        <div className="askhead">
          <span className="asklabel">{s.ask.answered}</span>
          <span title={s.relative(a.at)}>
            {s.shortDateTime(a.at)}
            {a.via && s.ask.via[a.via] ? `, ${s.ask.via[a.via]}` : ''}
          </span>
          <span className="askwait">{s.ask.waiting}</span>
        </div>
        <p className="askq">{ask.question}</p>
        {a.text ? <p className="askanswer">{a.text}</p> : null}
      </section>
    )
  }

  return (
    <section className="ask" aria-label={s.ask.toAnswer}>
      <div className="askhead">
        <span className="asklabel">{ask.title ?? s.ask.question}</span>
        {raised ? (
          <span className={(ask.days_raised ?? 0) >= 3 ? 'hot' : ''} title={since}>
            {raised}
          </span>
        ) : since ? (
          <span>{since}</span>
        ) : null}
        {ask.due ? <span>{s.ask.due(s.shortDate(ask.due))}</span> : null}
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
              title={o.k === ask.lean ? s.ask.theLean : undefined}
            >
              <b>{o.k}</b>
              {o.k === ask.lean ? <span className="asklean">{s.ask.lean}</span> : null}
              {o.sub ? <span className="asksub">{o.sub}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      <textarea
        ref={boxRef}
        value={text}
        aria-label={s.ask.answerFor(short)}
        placeholder={ask.options.length ? s.ask.pickOrWrite : s.ask.write}
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
          {s.ask.hintStart(short)}
          {config.note.addLabel ? (
            <>
              {s.ask.hintLabel}
              <span className="mono">{config.note.addLabel}</span>
            </>
          ) : null}
          {s.ask.hintEnd}
        </span>
        <button className="btn primary" onClick={send} disabled={empty || sending}>
          {sending ? s.ask.answering : s.ask.answer}
        </button>
      </div>
    </section>
  )
}
