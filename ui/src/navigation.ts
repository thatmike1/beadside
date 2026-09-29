import { shortId } from './model'

/** write a bead hash, adding history only when a user opens a different bead */
export function writeSelectionHash(
  id: string,
  previousId: string | null,
  repoName: string,
  userInitiated: boolean,
): void {
  const short = repoName ? shortId(id, repoName) : id
  if (decodeURIComponent(window.location.hash.slice(1)) === short) return
  const method = userInitiated && previousId !== id ? 'pushState' : 'replaceState'
  window.history[method](null, '', `#${short}`)
}

/** history state of the phone's reading view; the list entry under it carries the same hash */
const READING = 'reading'

/** true when a history entry is the phone's reading view */
export function isReadingState(state: unknown): boolean {
  return typeof state === 'object' && state !== null && (state as { beadside?: unknown }).beadside === READING
}

/**
 * phone: open a bead as its own history entry above the list, so the back gesture
 * returns to the list with the same bead still selected
 */
export function openReading(id: string, repoName: string): void {
  const url = `#${repoName ? shortId(id, repoName) : id}`
  window.history.replaceState(null, '', url)
  window.history.pushState({ beadside: READING }, '', url)
}
