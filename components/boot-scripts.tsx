'use client'

import { useEffect } from 'react'

const started = new Set<string>()

function load(src: string) {
  return new Promise<void>((resolve, reject) => {
    const el = document.createElement('script')
    el.src = src
    el.async = false
    el.onload = () => resolve()
    el.onerror = () => reject(new Error(src))
    document.body.appendChild(el)
  })
}

export function BootScripts({ src }: { src: string }) {
  useEffect(() => {
    const pending = src.split(',').map((item) => item.trim()).filter((item) => item && !started.has(item))
    pending.forEach((item) => started.add(item))
    if (!pending.length) return
    pending.reduce((chain, item) => chain.then(() => load(item)), Promise.resolve()).catch(() => {})
  }, [src])
  return null
}
