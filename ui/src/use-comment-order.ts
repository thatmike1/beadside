// oldest or newest first for the comment thread, remembered like the theme

import { useCallback, useEffect, useState } from 'react'
import type { CommentOrder } from './model'

const STORAGE_KEY = 'beadside:comment-order'

function isOrder(value: unknown): value is CommentOrder {
  return value === 'oldest' || value === 'newest'
}

function stored(): CommentOrder {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return isOrder(value) ? value : 'oldest'
  } catch {
    return 'oldest'
  }
}

export interface CommentOrderControl {
  order: CommentOrder
  /** flips the order and remembers it */
  toggle: () => void
}

/** the comment order, oldest first until the toggle is used */
export function useCommentOrder(): CommentOrderControl {
  const [order, setOrder] = useState<CommentOrder>(stored)

  // another tab of the board flipped it
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && isOrder(e.newValue)) setOrder(e.newValue)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const toggle = useCallback(() => {
    setOrder((prev) => {
      const next: CommentOrder = prev === 'oldest' ? 'newest' : 'oldest'
      try {
        window.localStorage.setItem(STORAGE_KEY, next)
      } catch {
        // storage full or blocked: the order still holds for this page
      }
      return next
    })
  }, [])

  return { order, toggle }
}
