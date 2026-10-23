import { maybeDaily } from './classify'

export function startScheduler() {
  const g = globalThis as unknown as { __hgScheduler?: ReturnType<typeof setInterval> }
  if (g.__hgScheduler) return
  const timer = setInterval(() => {
    maybeDaily().catch(() => {})
  }, 30_000)
  timer.unref()
  g.__hgScheduler = timer
}
