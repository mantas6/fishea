// First-load intro overlay. Renders over the (already running) scene and is
// dismissed by any key / click / tap / gamepad button, or the ✕ button. While
// it's up the game is paused (App sets game.paused), so stats don't drain.

import { useEffect } from 'react'
import type { ActiveSource } from './game/input/normalize.js'
import ControlsPanel from './ControlsPanel.jsx'

interface IntroProps {
  activeSource: ActiveSource
  onDismiss: () => void
}

export default function Intro({ activeSource, onDismiss }: IntroProps) {
  // Dismiss on any keyboard/pointer input. Gamepad presses are forwarded from
  // Game.onInputActivity in App, so no polling is needed here.
  useEffect(() => {
    const dismiss = () => onDismiss()
    window.addEventListener('keydown', dismiss)
    window.addEventListener('pointerdown', dismiss)
    return () => {
      window.removeEventListener('keydown', dismiss)
      window.removeEventListener('pointerdown', dismiss)
    }
  }, [onDismiss])

  return (
    <div className="intro" role="dialog" aria-label="Welcome to fishea">
      <div className="intro-card">
        <h1 className="intro-title">fishea</h1>
        <p className="intro-pitch">Eat smaller fish. Avoid bigger ones. Survive.</p>
        <ControlsPanel activeSource={activeSource} />
        <button type="button" className="intro-start" onClick={onDismiss} autoFocus>
          Press any key / click / tap or ✕ to start
        </button>
      </div>
    </div>
  )
}
