// every key the board answers to: the `?` button with its list, and the one-line hint under the index

import { useEffect, useRef } from 'react'
import { useStrings, type KeyRow, type Strings } from '../i18n'

export interface KeyOptions {
  /** the ready-to-try view is on, so `r` switches to it */
  tries: boolean
  /** atlas fixes palette and body font: `f` focuses search and `t` does nothing */
  fixedLook: boolean
}

/** the key list in the order the popover shows it */
export function keyRows(s: Strings, options: KeyOptions): KeyRow[] {
  const k = s.keys
  return [
    { keys: ['↑', '↓', 'j', 'k'], what: k.move },
    { keys: ['enter'], what: k.note },
    { keys: ['ctrl', '⏎'], what: k.send },
    { keys: ['esc'], what: k.leave },
    { keys: ['i', 'b', 'o'], what: k.views },
    ...(options.tries ? [{ keys: ['r'], what: k.tries }] : []),
    { keys: options.fixedLook ? ['s', 'f'] : ['s'], what: k.search },
    { keys: ['/'], what: k.capture },
    { keys: ['c'], what: k.copy },
    { keys: ['n'], what: k.defer },
    { keys: ['m'], what: k.closeBead },
    { keys: ['h', 'l'], what: k.fold },
    ...(options.fixedLook
      ? []
      : [
          { keys: ['t'], what: k.theme },
          { keys: ['f'], what: k.font },
        ]),
    { keys: ['T'], what: k.skin },
    { keys: ['?'], what: k.help },
  ]
}

/** the `?` button and the key list it opens; `?` toggles it from anywhere outside a field */
export function KeyHelp({
  open,
  onOpen,
  options,
}: {
  open: boolean
  onOpen: (open: boolean) => void
  options: KeyOptions
}) {
  const s = useStrings()
  const ref = useRef<HTMLSpanElement>(null)
  // a click anywhere else closes it
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open, onOpen])
  return (
    <span className="keyhelp" ref={ref}>
      <button
        className={open ? 'qmark on' : 'qmark'}
        aria-label={s.keys.title}
        aria-expanded={open}
        title="?"
        onClick={() => onOpen(!open)}
      >
        ?
      </button>
      {open ? (
        <div className="keys" role="dialog" aria-label={s.keys.title}>
          {keyRows(s, options).map(({ keys, what }) => (
            <div className="krow" key={what}>
              <span className="kk">
                {keys.map((k) => (
                  <kbd key={k}>{k}</kbd>
                ))}
              </span>
              <span>{what}</span>
            </div>
          ))}
        </div>
      ) : null}
    </span>
  )
}

/**
 * the one-line hint at the foot of the index: the keys used most, then the whole list behind `?`.
 * the atlas theme shows it; the default theme keeps only the `?` button in the brand row
 */
export function KeyHint({ open, onOpen, options }: { open: boolean; onOpen: (open: boolean) => void; options: KeyOptions }) {
  const s = useStrings()
  return (
    <div className="hint">
      <span>
        <kbd>j</kbd>
        <kbd>k</kbd> {s.keys.move}
      </span>
      <span>
        <kbd>{options.fixedLook ? 'f' : 's'}</kbd> {s.keys.search}
      </span>
      <span>
        <kbd>/</kbd> {s.keys.capture}
      </span>
      <button
        className={open ? 'keysbtn on' : 'keysbtn'}
        aria-expanded={open}
        // the list opens from the brand row; this only toggles it, so a click here must not count as outside
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => onOpen(!open)}
      >
        <kbd>?</kbd> {s.keys.hintHelp}
      </button>
    </div>
  )
}
