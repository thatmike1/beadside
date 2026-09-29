// the phone layout switch: one pane at a time below this width

import { useEffect, useState } from 'react'

/** keep in step with the max-width media query in styles.css */
const NARROW = '(max-width: 760px)'

/** true while the viewport is phone-narrow */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches)
  useEffect(() => {
    const query = window.matchMedia(NARROW)
    const onChange = () => setNarrow(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return narrow
}
