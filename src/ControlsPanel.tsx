// Shared controls reference with Keyboard/Mouse vs Gamepad tabs. Used by both
// the intro screen and the in-game help overlay. The tab defaults to (and
// follows) the last active input device, but can be switched manually.

import { useEffect, useState } from 'react'
import type { ActiveSource } from './game/input/normalize.js'
import { controlRows } from './game/controlHints.js'

interface TabDef {
  id: ActiveSource
  label: string
}

const TABS: TabDef[] = [
  { id: 'keyboard-mouse', label: 'Keyboard & mouse' },
  { id: 'gamepad', label: 'PS4 controller' },
]

interface ControlsPanelProps {
  activeSource: ActiveSource
}

export default function ControlsPanel({ activeSource }: ControlsPanelProps) {
  const [tab, setTab] = useState<ActiveSource>(activeSource)

  // Follow the active device automatically (e.g. plug in / use a gamepad).
  useEffect(() => setTab(activeSource), [activeSource])

  const rows = controlRows(tab)

  return (
    <div className="controls-panel">
      <div className="controls-tabs" role="tablist" aria-label="Control scheme">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id ? 'true' : 'false'}
            className={`controls-tab${tab === t.id ? ' is-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <dl className="controls-list">
        {rows.map((row) => (
          <div className="controls-row" key={row.action}>
            <dt className="controls-action">{row.action}</dt>
            <dd className="controls-input">{row.input}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
