// one toast at a time: a line of text and, for every write except comments, an undo that runs for 8s

import { useCallback, useEffect, useRef, useState } from 'react'

export interface ToastState {
  id: number
  message: string
  undo: (() => Promise<void>) | null
  tone: 'plain' | 'error'
}

const LIFETIME = 8000

export interface Toaster {
  toast: ToastState | null
  /** show a message, optionally with the inverse action behind an undo button */
  show: (message: string, undo?: () => Promise<void>) => void
  /** show a failure; no undo, same lifetime */
  fail: (message: string) => void
  dismiss: () => void
  runUndo: () => void
}

/** the toast's own words; english unless the board passes its locale's */
export interface ToastCopy {
  undone: string
  undoFailed: string
}

const EN_COPY: ToastCopy = { undone: 'undone', undoFailed: 'undo failed' }

/** toast state with its own timer, reset on every new message */
export function useToast(copy: ToastCopy = EN_COPY): Toaster {
  const copyRef = useRef(copy)
  copyRef.current = copy
  const [toast, setToast] = useState<ToastState | null>(null)
  const timer = useRef<number | null>(null)
  const seq = useRef(0)

  const arm = useCallback((next: ToastState) => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    setToast(next)
    timer.current = window.setTimeout(() => setToast(null), LIFETIME)
  }, [])

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    [],
  )

  const show = useCallback(
    (message: string, undo?: () => Promise<void>) => {
      seq.current += 1
      arm({ id: seq.current, message, undo: undo ?? null, tone: 'plain' })
    },
    [arm],
  )

  const fail = useCallback(
    (message: string) => {
      seq.current += 1
      arm({ id: seq.current, message, undo: null, tone: 'error' })
    },
    [arm],
  )

  const dismiss = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    setToast(null)
  }, [])

  const runUndo = useCallback(() => {
    setToast((current) => {
      if (!current?.undo) return current
      void current
        .undo()
        .then(() => show(copyRef.current.undone))
        .catch((error: unknown) => fail(error instanceof Error ? error.message : copyRef.current.undoFailed))
      return null
    })
  }, [show, fail])

  return { toast, show, fail, dismiss, runUndo }
}
