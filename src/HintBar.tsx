// Unobtrusive bottom hint bar showing controls for the active input device.
// Auto-fades after ~20s of play and reappears on device switch or when
// `revealKey` changes (e.g. after the help overlay closes).

import { useEffect, useState } from 'react'
import type { ActiveSource } from './game/input/normalize.js'
import { controlHints } from './game/controlHints.js'

const FADE_AFTER_MS = 20_000

interface HintBarProps {
  activeSource: ActiveSource
  revealKey?: number
}

export default function HintBar({ activeSource, revealKey = 0 }: HintBarProps) {
  const [visible, setVisible] = useState(true)

  // Show, then fade after a while. Resets whenever the device switches or
  // revealKey bumps, so the bar reappears on those events.
  useEffect(() => {
    setVisible(true)
    const t = window.setTimeout(() => setVisible(false), FADE_AFTER_MS)
    return () => window.clearTimeout(t)
  }, [activeSource, revealKey])

  return (
    <div className={`hint-bar${visible ? '' : ' is-hidden'}`} aria-hidden={visible ? 'false' : 'true'}>
      {controlHints(activeSource)}
    </div>
  )
}
