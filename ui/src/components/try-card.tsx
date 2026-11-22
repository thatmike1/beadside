// the check an agent left for the human on a ready-to-try bead: what to try, the kit, the steps,
// and the three verdicts. pinned above the description like a stored question

import { useRef, useState } from 'react'
import type { KitItem, TryKit, Verdict } from '../tries'
import { qrPath } from '../tries'
import { lastLine, tryFacts, useStrings, type Strings } from '../i18n'

interface TryCardProps {
  kit: TryKit
  id: string
  short: string
  /** copies text and says so in the toast */
  onCopy: (text: string, what: string) => void
  /** resolves true once the verdict is on the bead, false when it failed and the note stays */
  onVerdict: (verdict: Verdict, note: string) => Promise<boolean>
}

function asksNote(s: Strings): Record<Exclude<Verdict, 'works'>, { label: string; placeholder: string }> {
  return {
    broken: { label: s.tryIt.broken, placeholder: s.tryIt.brokenPlaceholder },
    cant: { label: s.tryIt.cant, placeholder: s.tryIt.cantPlaceholder },
  }
}

const web = (href: string) => /^https?:\/\//i.test(href)

/** an image's src as the board can show it: a web url as is, a local file through the server */
function imageSrc(id: string, index: number, src: string): string {
  return web(src) ? src : `/api/tries/${encodeURIComponent(id)}/image/${index}`
}

function Qr({ text, label }: { text: string; label: string }) {
  const s = useStrings()
  let path: { size: number; d: string } | null = null
  try {
    path = qrPath(text)
  } catch {
    path = null
  }
  if (!path) return null
  return (
    <figure className="tryqr">
      <svg viewBox={`0 0 ${path.size} ${path.size}`} role="img" aria-label={s.tryIt.qr(label)} shapeRendering="crispEdges">
        <rect width={path.size} height={path.size} fill="#fff" />
        <path d={path.d} fill="#000" />
      </svg>
      <figcaption>{label}</figcaption>
    </figure>
  )
}

function Tool({ item, onCopy }: { item: Exclude<KitItem, { type: 'qr' } | { type: 'image' }>; onCopy: TryCardProps['onCopy'] }) {
  const s = useStrings()
  if (item.type === 'spec') {
    return (
      <span className="tryspec">
        <span>{item.label}</span> <b>{item.value}</b>
      </span>
    )
  }
  if (item.type === 'link') {
    return (
      <a className="askopt trytool" href={item.href} target="_blank" rel="noreferrer" title={item.href}>
        <b>{item.label}</b>
        <span className="asklean">{s.tryIt.open}</span>
      </a>
    )
  }
  if (item.type === 'copy') {
    return (
      <button className="askopt trytool" onClick={() => onCopy(item.text, item.label)} title={item.text}>
        <b>{item.label}</b>
        <span className="asklean">{s.tryIt.copy}</span>
      </button>
    )
  }
  // a file: the board cannot open file urls from an http page, so it copies the path; a web href still opens
  return (
    <>
      {item.href && web(item.href) ? (
        <a className="askopt trytool" href={item.href} target="_blank" rel="noreferrer" title={item.href}>
          <b>{item.label}</b>
          <span className="asklean">{s.tryIt.open}</span>
        </a>
      ) : null}
      <button className="askopt trytool" onClick={() => onCopy(item.path, item.label)} title={item.path}>
        <b>{item.href && web(item.href) ? s.tryIt.path : item.label}</b>
        <span className="asklean">{s.tryIt.copy}</span>
        <span className="asksub mono">{item.path}</span>
      </button>
    </>
  )
}

export function TryCard({ kit, id, short, onCopy, onVerdict }: TryCardProps) {
  const s = useStrings()
  const ASKS_NOTE = asksNote(s)
  const [asking, setAsking] = useState<Exclude<Verdict, 'works'> | null>(null)
  const [note, setNote] = useState('')
  const [sending, setSending] = useState<Verdict | null>(null)
  const boxRef = useRef<HTMLTextAreaElement>(null)
  const meta = tryFacts(s, kit)
  const visuals = kit.kit.map((item, index) => ({ item, index })).filter(({ item }) => item.type === 'qr' || item.type === 'image')
  const tools = kit.kit.filter((item): item is Exclude<KitItem, { type: 'qr' } | { type: 'image' }> => item.type !== 'qr' && item.type !== 'image')
  // the server numbers images among image items only
  const imageIndex = (index: number) => kit.kit.slice(0, index).filter((k) => k.type === 'image').length

  const send = (verdict: Verdict) => {
    if (sending) return
    const text = note.trim()
    if (verdict !== 'works' && !text) {
      boxRef.current?.focus()
      return
    }
    setSending(verdict)
    void onVerdict(verdict, verdict === 'works' ? '' : text).then((done) => {
      setSending(null)
      if (done) {
        setNote('')
        setAsking(null)
      }
    })
  }

  const open = (verdict: Exclude<Verdict, 'works'>) => {
    setAsking((prev) => (prev === verdict ? null : verdict))
    window.setTimeout(() => boxRef.current?.focus(), 0)
  }

  return (
    <section className="ask try" aria-label={s.tryIt.label}>
      <div className="askhead">
        <span className="asklabel">{s.tryIt.label}</span>
        {kit.app ? <span>{kit.app}</span> : null}
        {meta.map((m) => (
          <span key={m}>{m}</span>
        ))}
        {kit.shipped ? <span>{s.tryIt.shipped(s.shortDate(kit.shipped.split(' ')[0]) || kit.shipped)}</span> : null}
      </div>
      <p className="askq">{kit.title}</p>
      {kit.why ? <p className="askwhy">{kit.why}</p> : null}
      {kit.last ? (
        <p className="trylast" title={s.relative(kit.last.at)}>
          {s.tryIt.lastTime(s.shortDateTime(kit.last.at), lastLine(s, kit.last))}
        </p>
      ) : null}

      <dl className="tryfacts">
        {kit.expect ? (
          <>
            <dt>{s.tryIt.expect}</dt>
            <dd>{kit.expect}</dd>
          </>
        ) : null}
        {kit.verified ? (
          <>
            <dt>{s.tryIt.checked}</dt>
            <dd>{kit.verified}</dd>
          </>
        ) : null}
      </dl>

      {visuals.length ? (
        <div className="tryvisuals">
          {visuals.map(({ item, index }) =>
            item.type === 'qr' ? (
              <Qr key={index} text={item.text} label={item.label} />
            ) : item.type === 'image' ? (
              <figure key={index} className="tryimg">
                <a href={imageSrc(id, imageIndex(index), item.src)} target="_blank" rel="noreferrer">
                  <img src={imageSrc(id, imageIndex(index), item.src)} alt={item.alt} loading="lazy" />
                </a>
                {item.alt ? <figcaption>{item.alt}</figcaption> : null}
              </figure>
            ) : null,
          )}
        </div>
      ) : null}

      {tools.length ? (
        <div className="askopts">
          {tools.map((item, i) => (
            <Tool key={i} item={item} onCopy={onCopy} />
          ))}
        </div>
      ) : null}

      {kit.steps.length ? (
        <ol className="trysteps">
          {kit.steps.map((s) => (
            <li key={s.id}>
              {s.title}
              {s.note ? <span className="trynote"> {s.note}</span> : null}
            </li>
          ))}
        </ol>
      ) : null}

      {asking ? (
        <textarea
          ref={boxRef}
          value={note}
          aria-label={s.tryIt.noteFor(ASKS_NOTE[asking].label, short)}
          placeholder={ASKS_NOTE[asking].placeholder}
          rows={2}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              send(asking)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setAsking(null)
            }
          }}
        />
      ) : null}
      <div className="askrow">
        <span className="chint">
          {asking ? s.tryIt.goesOn(short, asking) : s.tryIt.worksCloses(short)}
        </span>
        <span className="trybtns">
          <button className={asking ? 'btn' : 'btn primary'} onClick={() => send('works')} disabled={sending !== null}>
            {sending === 'works' ? s.tryIt.closing : s.tryIt.works}
          </button>
          {(['broken', 'cant'] as const).map((v) =>
            asking === v ? (
              // the open one sends: same word, now with the note under it
              <button key={v} className="btn primary" onClick={() => send(v)} disabled={sending !== null || !note.trim()}>
                {sending === v ? s.tryIt.sending : ASKS_NOTE[v].label}
              </button>
            ) : (
              <button key={v} className="btn" onClick={() => open(v)} disabled={sending !== null}>
                {ASKS_NOTE[v].label}
              </button>
            ),
          )}
        </span>
      </div>
    </section>
  )
}
