import { useEffect, useRef } from 'react'
import { Game } from './game/Game.js'

export default function App() {
  const gameRef = useRef(null)

  useEffect(() => {
    const container = document.getElementById('game')
    if (!container) return undefined

    const game = new Game(container)
    gameRef.current = game
    game.start()

    return () => {
      game.dispose()
      gameRef.current = null
    }
  }, [])

  return (
    <div className="app">
      <div id="game" className="game-canvas" />
      <div id="hud" className="hud">
        {/* HUD overlay — populated in future work */}
      </div>
    </div>
  )
}
