// the look menu in the brand row: theme (ledger or atlas), light or dark, body font, in one popover

import { useEffect, useRef, useState } from 'react'
import { useStrings } from '../i18n'
import type { BodyFont } from '../use-font'
import { SKINS, type Skin } from '../use-skin'
import type { ThemeMode } from '../use-theme'

const MODES: readonly ThemeMode[] = ['system', 'light', 'dark']
const FONTS: readonly BodyFont[] = ['figtree', 'ubuntu']

export interface LookProps {
  skin: Skin
  onSkin: (skin: Skin) => void
  mode: ThemeMode
  onMode: (mode: ThemeMode) => void
  font: BodyFont
  onFont: (font: BodyFont) => void
}

/** atlas brings its own palette and type, so light/dark and the body font only apply to the ledger */
export function fixedLook(skin: Skin): boolean {
  return skin === 'atlas'
}

function Choices<T extends string>({
  label,
  options,
  value,
  text,
  onPick,
  disabled = false,
}: {
  label: string
  options: readonly T[]
  value: T
  text: (option: T) => string
  onPick: (option: T) => void
  disabled?: boolean
}) {
  return (
    <div className="lrow" role="group" aria-label={label}>
      <span className="lab">{label}</span>
      <span className="seg">
        {options.map((option) => {
          const on = option === value
          return (
            <button
              key={option}
              className={on ? 'on' : ''}
              aria-pressed={on}
              disabled={disabled}
              onClick={() => {
                if (!on) onPick(option)
              }}
            >
              {text(option)}
            </button>
          )
        })}
      </span>
    </div>
  )
}

/** the button and its popover; a click elsewhere or `Esc` closes it */
export function LookMenu({ skin, onSkin, mode, onMode, font, onFont, initialOpen = false }: LookProps & { initialOpen?: boolean }) {
  const s = useStrings()
  const [open, setOpen] = useState(initialOpen)
  const ref = useRef<HTMLSpanElement>(null)
  const fixed = fixedLook(skin)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <span className="lookmenu" ref={ref}>
      <button
        className={open ? 'theme lookbtn on' : 'theme lookbtn'}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="T"
        onClick={() => setOpen(!open)}
      >
        {s.look.button}
      </button>
      {open ? (
        <div className="looks" role="dialog" aria-label={s.look.button}>
          <Choices label={s.look.skin} options={SKINS} value={skin} text={(k) => s.look.skins[k]} onPick={onSkin} />
          <Choices
            label={s.look.mode}
            options={MODES}
            value={mode}
            text={(m) => s.look.modes[m]}
            onPick={onMode}
            disabled={fixed}
          />
          <Choices label={s.look.font} options={FONTS} value={font} text={(f) => f} onPick={onFont} disabled={fixed} />
          {fixed ? <p className="lnote">{s.look.fixed}</p> : null}
        </div>
      ) : null}
    </span>
  )
}
