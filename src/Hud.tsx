// Survival HUD overlay. Purely presentational: it renders whatever snapshot
// App feeds it from the game's 'hud' event, and calls onRestart on the death
// screen. The root .hud is pointer-events:none so the canvas stays draggable;
// only the interactive death panel re-enables pointer events.

import type { HudSnapshot } from './game/Game.js'
import type { DeathCause } from './game/events.js'
import type { AudioState } from './game/audio/index.js'

interface BarDef {
  key: keyof HudSnapshot
  label: string
  className: string
  max: keyof HudSnapshot
}

const BARS: BarDef[] = [
  { key: 'hp', label: 'Health', className: 'bar-hp', max: 'hpMax' },
  { key: 'hunger', label: 'Hunger', className: 'bar-hunger', max: 'hungerMax' },
  { key: 'stamina', label: 'Stamina', className: 'bar-stamina', max: 'staminaMax' },
]

interface BarProps {
  label: string
  value: number
  max: number
  className: string
  warn?: boolean
}

function Bar({ label, value, max, className, warn }: BarProps) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return (
    <div className="stat-row">
      <span className="stat-label">{label}</span>
      <div className="stat-track">
        <div
          className={`stat-fill ${className}${warn ? ' is-warn' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="stat-value">{Math.round(value)}</span>
    </div>
  )
}

function deathCopy(cause: DeathCause): { title: string; sub: string } {
  if (cause === 'starved') {
    return { title: 'You starved', sub: 'Nothing left to eat in the deep.' }
  }
  return { title: 'You were eaten', sub: 'A bigger fish got you.' }
}

interface HudProps {
  snapshot: HudSnapshot | null
  death: { cause: DeathCause } | null
  onRestart: () => void
  audio: AudioState
  onToggleMute: () => void
}

export default function Hud({ snapshot, death, onRestart, audio, onToggleMute }: HudProps) {
  if (!snapshot) return null

  const device = snapshot.activeSource === 'gamepad' ? 'Gamepad' : 'Keyboard + mouse'
  const muted = audio?.muted
  const unlocked = audio?.unlocked

  return (
    <>
      <div className="hud-audio">
        <button
          type="button"
          className="hud-mute"
          onClick={onToggleMute}
          aria-pressed={muted ? 'true' : 'false'}
          title="Toggle sound (M)"
        >
          Sound: {muted ? 'off' : 'on'}
        </button>
        {!unlocked && !muted ? (
          <span className="hud-audio-hint">tap/click to enable sound</span>
        ) : null}
      </div>

      <div className="hud-panel hud-stats" aria-hidden={death ? 'true' : 'false'}>
        {BARS.map((b) => (
          <Bar
            key={b.key}
            label={b.label}
            value={snapshot[b.key] as number}
            max={snapshot[b.max] as number}
            className={b.className}
            warn={b.key === 'stamina' && snapshot.exhausted}
          />
        ))}
        <div className="hud-meta">
          <span className="hud-size">
            Size <strong>{snapshot.size.toFixed(2)}</strong>
          </span>
          <span className="hud-device">
            <span className="hud-dot" aria-hidden="true" />
            {device}
          </span>
        </div>
      </div>

      {death ? (
        <div className="hud-death" role="alertdialog" aria-label="Game over">
          <div className="death-card">
            <h1 className="death-title">{deathCopy(death.cause).title}</h1>
            <p className="death-sub">{deathCopy(death.cause).sub}</p>
            <button type="button" className="death-restart" onClick={onRestart} autoFocus>
              Swim again
            </button>
            <p className="death-hint">Press Enter to restart</p>
          </div>
        </div>
      ) : null}
    </>
  )
}
