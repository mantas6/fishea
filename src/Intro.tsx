// First-load intro overlay. Renders over the (already running) scene. It's
// meant to be *browsable*: clicking the controls tabs or touching a gamepad
// stick/d-pad to inspect the mappings must NOT dismiss it. Dismissal is
// explicit only:
//   - the Start button,
//   - Enter / Space on the keyboard (not "any key"),
//   - a pointerdown OUTSIDE the panel (tap anywhere outside = start),
//   - the gamepad ✕/Cross button (forwarded via Game.onDismissPressed in App).
// While it's up the game is paused (App sets game.paused), so stats don't drain.

import { useEffect, useRef } from 'react'
import type { ActiveSource } from './game/input/normalize.js'
import { isIntroDismissKey } from './game/input/normalize.js'
import ControlsPanel from './ControlsPanel.jsx'
import { ControlIcon } from './ui/ControlIcons.jsx'

interface IntroProps {
  activeSource: ActiveSource
  onDismiss: () => void
}

export default function Intro({ activeSource, onDismiss }: IntroProps) {
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isIntroDismissKey(e.key)) onDismiss()
    }
    const onPointer = (e: PointerEvent) => {
      // Clicks/taps inside the panel (tabs, content) must not dismiss it.
      if (cardRef.current && cardRef.current.contains(e.target as Node)) return
      onDismiss()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [onDismiss])

  return (
    <div className="intro" role="dialog" aria-label="Welcome to fishea">
      <div className="intro-card" ref={cardRef}>
        <h1 className="intro-title">fishea</h1>
        <p className="intro-pitch">Eat smaller fish. Avoid bigger ones. Survive.</p>
        <ControlsPanel activeSource={activeSource} />
        <button
          type="button"
          className="intro-start"
          onClick={onDismiss}
          autoFocus
          aria-label="Press Enter, tap outside, or press Cross to start"
        >
          <span className="cta-line">
            Press <ControlIcon id="key:Enter" />, tap outside, or press{' '}
            <ControlIcon id="cross" /> to start
          </span>
        </button>
      </div>
    </div>
  )
}
