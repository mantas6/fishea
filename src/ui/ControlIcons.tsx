// Inline-SVG icon library for on-screen control prompts, styled like a modern
// PlayStation game. Everything here is pure/presentational — no game state, no
// external assets. Icons are drawn in a 24px-tall viewBox with ~2px strokes so
// they stay crisp at the ~1.4em inline size used in the hint bar and panels.
//
// The single entry point is <ControlIcon id="…" />, which dispatches on the
// typed ControlIconId union from src/game/controlHints.ts.

import type { CSSProperties } from 'react'
import { iconText } from '../game/controlHints.js'
import type { ControlIconId } from '../game/controlHints.js'

// Shared palette --------------------------------------------------------------

const PANEL = 'rgba(4, 16, 34, 0.92)' // dark button body
const EDGE = 'rgba(200, 226, 255, 0.55)' // subtle white-ish border
const LABEL = 'rgba(232, 241, 255, 0.95)' // text / neutral glyph

// Classic PlayStation face-button glyph colours.
const GLYPH = {
  cross: '#7db9e8', // light blue
  circle: '#ff6b6b', // red
  square: '#ff9ff3', // pink
  triangle: '#66d9a5', // green
} as const

const BASE_STYLE: CSSProperties = {
  height: '1.4em',
  width: 'auto',
  verticalAlign: 'middle',
  flex: '0 0 auto',
}

interface SvgProps {
  viewBox: string
  ariaLabel: string
  children: React.ReactNode
}

function Svg({ viewBox, ariaLabel, children }: SvgProps) {
  return (
    <svg
      className="ctl-icon"
      viewBox={viewBox}
      style={BASE_STYLE}
      role="img"
      aria-label={ariaLabel}
      focusable="false"
    >
      {children}
    </svg>
  )
}

// Face buttons ----------------------------------------------------------------

function FaceButton({ id }: { id: 'cross' | 'circle' | 'square' | 'triangle' }) {
  const color = GLYPH[id]
  let glyph: React.ReactNode
  if (id === 'cross') {
    glyph = (
      <g stroke={color} strokeWidth={2.2} strokeLinecap="round">
        <line x1={8} y1={8} x2={16} y2={16} />
        <line x1={16} y1={8} x2={8} y2={16} />
      </g>
    )
  } else if (id === 'circle') {
    glyph = <circle cx={12} cy={12} r={4.6} fill="none" stroke={color} strokeWidth={2.2} />
  } else if (id === 'square') {
    glyph = (
      <rect x={7.6} y={7.6} width={8.8} height={8.8} rx={1.2} fill="none" stroke={color} strokeWidth={2.2} />
    )
  } else {
    glyph = (
      <path
        d="M12 6.8 L16.8 15.6 L7.2 15.6 Z"
        fill="none"
        stroke={color}
        strokeWidth={2.2}
        strokeLinejoin="round"
      />
    )
  }
  return (
    <Svg viewBox="0 0 24 24" ariaLabel={iconText(id)}>
      <circle cx={12} cy={12} r={10.5} fill={PANEL} stroke={EDGE} strokeWidth={1} />
      {glyph}
    </Svg>
  )
}

// Shoulder buttons / triggers -------------------------------------------------

function Shoulder({ id }: { id: 'l1' | 'r1' | 'l2' | 'r2' }) {
  const text = iconText(id)
  return (
    <Svg viewBox="0 0 34 24" ariaLabel={text}>
      <rect x={1} y={4} width={32} height={16} rx={7} fill={PANEL} stroke={EDGE} strokeWidth={1} />
      <text
        x={17}
        y={12}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={10}
        fontWeight={700}
        fontFamily="system-ui, sans-serif"
        fill={LABEL}
      >
        {text}
      </text>
    </Svg>
  )
}

// Analog sticks ---------------------------------------------------------------

function Stick({ id }: { id: 'lstick' | 'rstick' }) {
  const label = id === 'lstick' ? 'L' : 'R'
  return (
    <Svg viewBox="0 0 24 24" ariaLabel={iconText(id)}>
      {/* base ring */}
      <circle cx={12} cy={12} r={10.5} fill={PANEL} stroke={EDGE} strokeWidth={1} />
      {/* directional arrows hint */}
      <g stroke="rgba(200,226,255,0.35)" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M12 2.6 l-1.6 2 h3.2 z" fill="rgba(200,226,255,0.35)" stroke="none" />
        <path d="M12 21.4 l-1.6 -2 h3.2 z" fill="rgba(200,226,255,0.35)" stroke="none" />
        <path d="M2.6 12 l2 -1.6 v3.2 z" fill="rgba(200,226,255,0.35)" stroke="none" />
        <path d="M21.4 12 l-2 -1.6 v3.2 z" fill="rgba(200,226,255,0.35)" stroke="none" />
      </g>
      {/* nub */}
      <circle cx={12} cy={12} r={5.4} fill="rgba(120,200,255,0.18)" stroke={EDGE} strokeWidth={1.2} />
      <text
        x={12}
        y={12}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={7}
        fontWeight={700}
        fontFamily="system-ui, sans-serif"
        fill={LABEL}
      >
        {label}
      </text>
    </Svg>
  )
}

// Analog stick press (L3) -----------------------------------------------------

function StickPress({ id }: { id: 'l3' }) {
  const label = iconText(id) // 'L3'
  const highlight = 'rgba(120,200,255,0.85)'
  return (
    <Svg viewBox="0 0 24 24" ariaLabel={label}>
      {/* base ring */}
      <circle cx={12} cy={12} r={10.5} fill={PANEL} stroke={EDGE} strokeWidth={1} />
      {/* press chevrons pointing into the nub (down = "push in") */}
      <g stroke={highlight} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M9 3.6 l3 2.6 l3 -2.6" />
      </g>
      {/* pressed nub (filled to read as depressed) */}
      <circle cx={12} cy={13} r={5.6} fill={highlight} opacity={0.85} stroke={EDGE} strokeWidth={1.2} />
      <text
        x={12}
        y={13}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={7}
        fontWeight={700}
        fontFamily="system-ui, sans-serif"
        fill={LABEL}
      >
        {label}
      </text>
    </Svg>
  )
}

// D-pad -----------------------------------------------------------------------

type DpadDir = 'up' | 'down' | 'left' | 'right' | null

function Dpad({ dir }: { dir: DpadDir }) {
  const active = 'rgba(120,200,255,0.85)'
  const arm = (d: Exclude<DpadDir, null>) => (dir === d ? active : PANEL)
  const label =
    dir === null
      ? 'D-pad'
      : `D-pad ${dir}`
  return (
    <Svg viewBox="0 0 24 24" ariaLabel={label}>
      {/* vertical arm */}
      <rect x={9} y={2.5} width={6} height={19} rx={1.6} fill={PANEL} stroke={EDGE} strokeWidth={1} />
      {/* horizontal arm */}
      <rect x={2.5} y={9} width={19} height={6} rx={1.6} fill={PANEL} stroke={EDGE} strokeWidth={1} />
      {/* highlighted direction caps */}
      {dir === 'up' && <rect x={9} y={2.5} width={6} height={6.5} rx={1.6} fill={arm('up')} />}
      {dir === 'down' && <rect x={9} y={15} width={6} height={6.5} rx={1.6} fill={arm('down')} />}
      {dir === 'left' && <rect x={2.5} y={9} width={6.5} height={6} rx={1.6} fill={arm('left')} />}
      {dir === 'right' && <rect x={15} y={9} width={6.5} height={6} rx={1.6} fill={arm('right')} />}
    </Svg>
  )
}

// Mouse -----------------------------------------------------------------------

function Mouse({ leftActive }: { leftActive: boolean }) {
  const highlight = 'rgba(120,200,255,0.85)'
  return (
    <Svg viewBox="0 0 24 24" ariaLabel={leftActive ? 'Left mouse button' : 'Mouse'}>
      {/* left button fill (top-left region) when active */}
      {leftActive && (
        <path
          d="M12 2.2 C8.3 2.4 5.5 5.1 5.5 9 L5.5 11 L12 11 L12 2.2 Z"
          fill={highlight}
          opacity={0.85}
        />
      )}
      {/* body outline */}
      <rect x={5.5} y={2.2} width={13} height={19.6} rx={6.5} fill="none" stroke={EDGE} strokeWidth={1.4} />
      {/* button split lines */}
      <line x1={12} y1={2.4} x2={12} y2={11} stroke={EDGE} strokeWidth={1.2} />
      <line x1={5.7} y1={11} x2={18.3} y2={11} stroke={EDGE} strokeWidth={1.2} />
    </Svg>
  )
}

// Keyboard keycaps ------------------------------------------------------------

function Keycap({ label }: { label: string }) {
  // Width grows with label length so multi-char keys (Shift, Space) fit.
  const chars = label.length
  const w = chars <= 1 ? 22 : 14 + chars * 7
  const cx = w / 2
  return (
    <Svg viewBox={`0 0 ${w} 24`} ariaLabel={label}>
      {/* drop shadow / 3D base */}
      <rect x={1} y={3} width={w - 2} height={19} rx={4} fill="rgba(0,0,0,0.35)" />
      {/* keycap face */}
      <rect x={1} y={1} width={w - 2} height={19} rx={4} fill={PANEL} stroke={EDGE} strokeWidth={1} />
      <text
        x={cx}
        y={11}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={chars <= 1 ? 11 : 9}
        fontWeight={600}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        fill={LABEL}
      >
        {label}
      </text>
    </Svg>
  )
}

// Dispatcher ------------------------------------------------------------------

/** Render a single control icon by its typed id. */
export function ControlIcon({ id }: { id: ControlIconId }) {
  switch (id) {
    case 'cross':
    case 'circle':
    case 'square':
    case 'triangle':
      return <FaceButton id={id} />
    case 'l1':
    case 'r1':
    case 'l2':
    case 'r2':
      return <Shoulder id={id} />
    case 'lstick':
    case 'rstick':
      return <Stick id={id} />
    case 'l3':
      return <StickPress id={id} />
    case 'dpad':
      return <Dpad dir={null} />
    case 'dpad-up':
      return <Dpad dir="up" />
    case 'dpad-down':
      return <Dpad dir="down" />
    case 'dpad-left':
      return <Dpad dir="left" />
    case 'dpad-right':
      return <Dpad dir="right" />
    case 'mouse':
      return <Mouse leftActive={false} />
    case 'mouse-left':
      return <Mouse leftActive />
    default:
      // key:* — keycap with the label after the colon.
      return <Keycap label={id.slice(4)} />
  }
}

/** Render a group of icons inline (used by hint tokens & reference rows). */
export function ControlIconGroup({ ids }: { ids: ControlIconId[] }) {
  return (
    <span className="ctl-icon-group">
      {ids.map((id, i) => (
        <ControlIcon key={`${id}-${i}`} id={id} />
      ))}
    </span>
  )
}
