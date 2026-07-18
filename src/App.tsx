import { useEffect, useRef, useState, useCallback } from 'react'
import { Game } from './game/Game.js'
import type { HudSnapshot } from './game/Game.js'
import type { DeathCause } from './game/events.js'
import type { AudioState } from './game/audio/index.js'
import type { ActiveSource } from './game/input/normalize.js'
import Hud from './Hud.jsx'
import Intro from './Intro.jsx'
import HintBar from './HintBar.jsx'
import ControlsPanel from './ControlsPanel.jsx'

interface DeathState {
  cause: DeathCause
}

export default function App() {
  const gameRef = useRef<Game | null>(null)
  const [hud, setHud] = useState<HudSnapshot | null>(null)
  const [death, setDeath] = useState<DeathState | null>(null)
  const [audio, setAudio] = useState<AudioState>({ unlocked: false, muted: false })
  const [introActive, setIntroActive] = useState(true)
  const [helpOpen, setHelpOpen] = useState(false)
  const [activeSource, setActiveSource] = useState<ActiveSource>('keyboard-mouse')
  const [revealKey, setRevealKey] = useState(0)

  useEffect(() => {
    const container = document.getElementById('game')
    if (!container) return undefined

    const game = new Game(container)
    gameRef.current = game

    // Hold survival stats (and AI aggression) until the intro is dismissed.
    game.paused = true

    // Reflect audio unlock/mute state in the HUD.
    game.audio.onStateChange = (state) => setAudio(state)
    setAudio({ unlocked: game.audio.unlocked, muted: game.audio.muted })

    const unsubs = [
      game.events.on('hud', (snapshot) => {
        setHud(snapshot)
        setActiveSource(snapshot.activeSource)
      }),
      game.events.on('player-died', ({ cause }) => setDeath({ cause })),
      game.events.on('player-respawned', () => setDeath(null)),
    ]

    game.start()

    return () => {
      for (const off of unsubs) off()
      game.dispose()
      gameRef.current = null
    }
  }, [])

  const handleDismissIntro = useCallback(() => {
    setIntroActive((active) => {
      if (!active) return active
      const game = gameRef.current
      if (game) game.paused = false
      return false
    })
  }, [])

  // Gamepad button presses can't be caught by window key/pointer listeners, so
  // use Game's narrow bite (✕/Cross) rising-edge hook to dismiss the intro.
  // Stick/d-pad activity still auto-switches the controls tab (via hud events)
  // without skipping the intro.
  useEffect(() => {
    const game = gameRef.current
    if (!game) return undefined
    if (!introActive) {
      game.onDismissPressed = undefined
      return undefined
    }
    game.onDismissPressed = () => handleDismissIntro()
    return () => {
      if (gameRef.current) gameRef.current.onDismissPressed = undefined
    }
  }, [introActive, handleDismissIntro])

  const handleRestart = useCallback(() => {
    gameRef.current?.restart()
    setDeath(null)
  }, [])

  // Gamepad ✕/Cross can't be caught by window key/pointer listeners, so use
  // Game's death-screen restart hook (edge-detected + grace-gated) to restart
  // from a controller. Keyboard (Enter) restart is handled below.
  useEffect(() => {
    const game = gameRef.current
    if (!game) return undefined
    if (!death) {
      game.onRestartPressed = undefined
      return undefined
    }
    game.onRestartPressed = () => handleRestart()
    return () => {
      if (gameRef.current) gameRef.current.onRestartPressed = undefined
    }
  }, [death, handleRestart])

  const handleToggleMute = useCallback(() => {
    const game = gameRef.current
    if (!game) return
    const muted = game.audio.toggleMute()
    setAudio({ unlocked: game.audio.unlocked, muted })
  }, [])

  const handleToggleHelp = useCallback(() => {
    setHelpOpen((open) => {
      // Wake the hint bar again when help closes.
      if (open) setRevealKey((k) => k + 1)
      return !open
    })
  }, [])

  // Global keys: M mute (anywhere), H help toggle (once past the intro).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault()
        handleToggleMute()
        return
      }
      if ((e.key === 'h' || e.key === 'H') && !introActive && !death) {
        e.preventDefault()
        handleToggleHelp()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleToggleMute, handleToggleHelp, introActive, death])

  // Let Enter restart from the death screen (mouse is pointer-locked mid-game).
  useEffect(() => {
    if (!death) return undefined
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleRestart()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [death, handleRestart])

  return (
    <div className="app">
      <div id="game" className="game-canvas" />
      <div id="hud" className="hud">
        <Hud
          snapshot={hud}
          death={death}
          onRestart={handleRestart}
          audio={audio}
          onToggleMute={handleToggleMute}
          onToggleHelp={handleToggleHelp}
        />
        {!introActive && !death ? (
          <HintBar activeSource={activeSource} revealKey={revealKey} />
        ) : null}
        {helpOpen && !introActive && !death ? (
          <div className="help-overlay" role="dialog" aria-label="Controls">
            <div className="help-card">
              <h2 className="help-title">Controls</h2>
              <ControlsPanel activeSource={activeSource} />
              <button type="button" className="help-close" onClick={handleToggleHelp} autoFocus>
                Close (H)
              </button>
            </div>
          </div>
        ) : null}
      </div>
      {introActive ? <Intro activeSource={activeSource} onDismiss={handleDismissIntro} /> : null}
    </div>
  )
}
