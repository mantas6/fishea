import { useEffect, useRef, useState, useCallback } from 'react'
import { Game } from './game/Game.js'
import Hud from './Hud.jsx'

export default function App() {
  const gameRef = useRef(null)
  const [hud, setHud] = useState(null)
  const [death, setDeath] = useState(null)
  const [audio, setAudio] = useState({ unlocked: false, muted: false })

  useEffect(() => {
    const container = document.getElementById('game')
    if (!container) return undefined

    const game = new Game(container)
    gameRef.current = game

    // Reflect audio unlock/mute state in the HUD.
    game.audio.onStateChange = (state) => setAudio(state)
    setAudio({ unlocked: game.audio.unlocked, muted: game.audio.muted })

    const unsubs = [
      game.events.on('hud', (snapshot) => setHud(snapshot)),
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

  const handleRestart = useCallback(() => {
    gameRef.current?.restart()
    setDeath(null)
  }, [])

  const handleToggleMute = useCallback(() => {
    const game = gameRef.current
    if (!game) return
    const muted = game.audio.toggleMute()
    setAudio({ unlocked: game.audio.unlocked, muted })
  }, [])

  // M key toggles mute anywhere in the game.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault()
        handleToggleMute()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleToggleMute])

  // Let Enter restart from the death screen (mouse is pointer-locked mid-game).
  useEffect(() => {
    if (!death) return undefined
    const onKey = (e) => {
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
        />
      </div>
    </div>
  )
}
