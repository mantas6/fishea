// Survival HUD overlay. Purely presentational: it renders whatever snapshot
// App feeds it from the game's 'hud' event, and calls onRestart on the death
// screen. The root .hud is pointer-events:none so the canvas stays draggable;
// only the interactive death panel re-enables pointer events.

const BARS = [
  { key: 'hp', label: 'Health', className: 'bar-hp', max: 'hpMax' },
  { key: 'hunger', label: 'Hunger', className: 'bar-hunger', max: 'hungerMax' },
  { key: 'stamina', label: 'Stamina', className: 'bar-stamina', max: 'staminaMax' },
]

function Bar({ label, value, max, className, warn }) {
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

function deathCopy(cause) {
  if (cause === 'starved') {
    return { title: 'You starved', sub: 'Nothing left to eat in the deep.' }
  }
  return { title: 'You were eaten', sub: 'A bigger fish got you.' }
}

export default function Hud({ snapshot, death, onRestart, audio, onToggleMute }) {
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
          <span className="hud-audio-hint">click to enable sound</span>
        ) : null}
      </div>

      <div className="hud-panel hud-stats" aria-hidden={death ? 'true' : 'false'}>
        {BARS.map((b) => (
          <Bar
            key={b.key}
            label={b.label}
            value={snapshot[b.key]}
            max={snapshot[b.max]}
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
