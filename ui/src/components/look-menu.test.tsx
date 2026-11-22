import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StringsContext, stringsFor } from '../i18n'
import { isSkin, nextSkin, resolveSkin } from '../use-skin'
import { LookMenu, type LookProps } from './look-menu'

const noop = () => {}
const BASE: LookProps = {
  skin: 'default',
  onSkin: noop,
  mode: 'system',
  onMode: noop,
  font: 'figtree',
  onFont: noop,
}

function render(props: Partial<LookProps>, { open = true, locale = 'en' as 'en' | 'cs' } = {}): string {
  return renderToStaticMarkup(
    <StringsContext.Provider value={stringsFor(locale)}>
      <LookMenu {...BASE} {...props} initialOpen={open} />
    </StringsContext.Provider>,
  )
}

describe('look menu', () => {
  it('stays a single button until opened', () => {
    const html = render({}, { open: false })
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('>look</button>')
    expect(html).not.toContain('role="dialog"')
  })

  it('offers theme, mode and font with the current ones pressed', () => {
    const html = render({ mode: 'dark', font: 'ubuntu' })
    expect(html).toContain('aria-label="theme"')
    expect(html).toMatch(/class="on" aria-pressed="true">ledger</)
    expect(html).toMatch(/class="on" aria-pressed="true">dark</)
    expect(html).toMatch(/class="on" aria-pressed="true">ubuntu</)
    expect(html).toMatch(/aria-pressed="false">atlas</)
    expect(html).not.toContain('disabled')
  })

  it('greys out mode and font in atlas and says why', () => {
    const html = render({ skin: 'atlas' })
    expect(html).toMatch(/class="on" aria-pressed="true">atlas</)
    expect(html.match(/disabled=""/g)).toHaveLength(5)
    expect(html).toContain('atlas is light only')
  })

  it('reads in czech', () => {
    const html = render({ skin: 'atlas' }, { locale: 'cs' })
    expect(html).toContain('>vzhled</button>')
    expect(html).toContain('>podle systému</button>')
    expect(html).toContain('atlas je jen světlý')
  })
})

describe('skin order', () => {
  it('lets a pick beat the config, the config beat the remembered look', () => {
    expect(resolveSkin('default', 'atlas', 'atlas')).toBe('default')
    expect(resolveSkin(null, 'atlas', null)).toBe('atlas')
    expect(resolveSkin(null, 'default', 'atlas')).toBe('default')
    expect(resolveSkin(null, null, 'atlas')).toBe('atlas')
    expect(resolveSkin(null, null, null)).toBe('default')
  })

  it('cycles through every look and knows only those', () => {
    expect(nextSkin('default')).toBe('atlas')
    expect(nextSkin('atlas')).toBe('default')
    expect(isSkin('atlas')).toBe(true)
    expect(isSkin('neon')).toBe(false)
    expect(isSkin(null)).toBe(false)
  })
})
