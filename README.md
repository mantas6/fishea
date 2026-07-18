# fishea — 3d fish survival

A third-person 3D fish survival game built with React, Three.js and Vite.

**Play:** https://mantas6.github.io/fishea/

## Survival

Eat smaller fish to grow and stay fed; avoid bigger fish that bite. The HUD
(top-left) tracks three stats:

- **Health** — drops when a bigger fish bites you or when you starve;
  regenerates slowly while well fed.
- **Hunger** — drains over time. Eat prey to top it back up; hitting empty
  starts draining health.
- **Stamina** — spent while sprinting and refilled while cruising. Empty it and
  you're locked out of sprinting until it recovers.

Get eaten or starve and a game-over screen appears — hit **Swim again** (or
press **Enter**) to restart with a fresh ocean.

## Audio

All sound is generated at runtime with the Web Audio API — there are no audio
assets. Procedural SFX cover biting, eating, missed bites, taking damage, a
death sting and a sprint swish, plus a tension heartbeat that fades in when
health drops below 30%. A generative ambient track (slow detuned pads under a
wandering lowpass filter, with sparse pentatonic plucks) plays underneath.

Sound is enabled on your first click/keypress (browser autoplay policy). Toggle
it with the **Sound: on/off** button (top-right) or the **M** key.

## Controls

An intro screen greets you on first load with the pitch and a controls
reference (Keyboard/Mouse and PS4 tabs — the tab for your active device is
highlighted). Press any key, click/tap, press a gamepad button, or hit the
✕ button to dismiss it and start; survival stats stay frozen until you do.

During play a compact hint bar at the bottom shows the controls for the active
device and quietly fades after ~20s (it reappears when you switch devices or
open help). Press **H** or the **?** button (top-right) to reopen the full
controls overlay at any time.

A connected controller takes priority automatically whenever it's in use;
otherwise keyboard + mouse are active. The HUD device indicator follows the
last-used input.

### Keyboard & mouse

| Action    | Input                                    |
| --------- | ---------------------------------------- |
| Swim      | `W` `A` `D` (`S` brakes — no reverse)    |
| Look      | Mouse (click to lock) or arrow keys      |
| Swim up   | `Space`                                  |
| Swim down | `Ctrl` or `C`                            |
| Sprint    | `Shift` (hold)                           |
| Bite/eat  | Left mouse button                        |
| Mute      | `M`                                      |
| Help      | `H`                                      |

### PS4 / DualShock controller

| Action    | Input                                    |
| --------- | ---------------------------------------- |
| Swim      | Left stick (stick down brakes — no reverse) |
| Look      | Right stick                              |
| Swim up   | `R1` (or D-pad up)                       |
| Swim down | `L2` (or D-pad down)                     |
| Sprint    | `L1` (or `R2`)                           |
| Bite/eat  | `✕` Cross (or `▢` Square)                |

## Development

```bash
npm install       # install dependencies
npm run dev       # start the dev server
npm run typecheck # type-check with tsc (no emit)
npm test          # run tests once
npm run build     # production build into dist/
```

## Project structure

- `src/` — React components and app entry (`main.tsx`, `App.tsx`).
- `src/game/` — game logic as plain, testable TypeScript modules.
- `src/__tests__/` — tests (run with Vitest).

The project is written in TypeScript. `npm run typecheck` runs `tsc --noEmit`
against `tsconfig.json`.
