# InsertPress Planner — notes for Claude Code

Browser app that plans and runs an automated heat-set insert press. Owner: Stephen
(student, Northeastern EXP makerspace). He writes short, casual requests and expects
the technical depth to be filled in. Prefer practical, buildable steps over theory.
Work in stages, commit after each one, and keep every commit runnable.

## The machine
- Arduino Uno + CNC Shield V3, GRBL 1.1, NEMA 17 on X/Y/Z, A4988 drivers.
- Pinecil V2 with a heat-set tip on a spring-floated Z head; float sensor on the
  GRBL probe pin (A5), trips when the tip meets resistance.
- X0 Y0 = inside corner of the fence. Z0 = tip touching the bed, float relaxed.
- G21 G90 G54. Presses use G38.3. Every G-code line under 72 characters.

## Hard rules
- Plain HTML/CSS/JS. No build step, no npm dependencies in the app. Must work from
  `file://` and GitHub Pages.
- Three.js r128 from jsDelivr only (`three.min.js` + `examples/js/controls/OrbitControls.js`).
  `js/viewer2d.js` is the fallback with the same interface; keep both in sync.
- Core logic stays pure (no DOM) and tested in Node with no dependencies.
- Design: dark top bar and stage, light work area, brass `#c09036` the only accent,
  hot orange only for faults. Fonts: Archivo + JetBrains Mono.
- Keep files modular; no file so big it can't be read in one go.
- Nothing may require a keyboard shortcut; every action has a button.

## Commands
```
node test/run-tests.js            # all Node tests (282); must stay green
node test/run-tests.js tray       # one test file
node tools/ui-test.js             # Playwright browser checks (2D + 3D on tools/three-stub.js)
node tools/make-example.js        # rewrite examples/*.stl from js/example.js
node tools/shots.js [dir] [--phone]  # screenshots of every screen, real Three.js (online)
```
`tools/three-stub.js` must only use real r128 API names.

## Versioning (each release)
- Bump the `vN` badge in `index.html`, `?v=N` on every CSS/JS tag, `package.json` version.
- Job files carry `version: N`; older job versions (v3, v4, v5) must still open (`applyJob` in `js/app.js`).
- Update `README.md`.

## Architecture in one breath
Pure engine: `stl.js` (parse, orient incl. face-down matrix), `holes.js`, `tray.js`,
`gcode.js`, `placement.js`, `snap.js`, `collision.js`, `holelist.js`, `measure.js`,
`grbl.js` (parser + streamer), `grbl-sim.js`. Browser: `serial.js`, `store.js`,
`thumb.js`, `viewer.js`/`viewer2d.js`, `ui-*.js` modules that each get `ctx` from
`app.js`. `window.IP.app = { S, viewer, ctx, ui }` is exposed for tests.

- Change settings through `ctx.setSetting(key, value)` (undo + save + side effects).
- Settings fields and labels live in `IP.ui.fields.FIELDS` (`js/ui-setup.js`).
- `ctx.refresh()` recomputes everything; call it after changing job state.

## Tray pickup: things that are easy to break
- Z geometry is in `tray.geometry()`: seat, trip, limit, hang. `docs/v5-plan.md` has the diagram.
- Pickup lines carry markers: `; to P12 m3` on the travel, `; pick P12 m3` on the probe.
  `grbl.prepare()` turns them into `entry.toPocket` / `entry.pick`.
- The streamer gates after every pick (nothing more is sent until its result is
  known), calls `onMiss` on an empty pocket, and calls `remap` right before each
  pocket travel so holes use the pocket that is full now. Don't remove either.
- Live runs pick with G38.3; exported files pick with G38.2 so an empty pocket halts.
- Pick probe trips are expected; they must never count as float-trip faults.
- Inventory is per machine profile in localStorage (`insertpress.tray.v1`).

## State at hand-off (end of v5)
Done and tested in Node + headless Chromium. 3D view checked with real Three.js
r128 (bracket, lid, tray mode, preview, run screen): works.

**The machine is not built yet (Oct 2026); this is a proof of concept.** Don't plan
hardware sessions. USB/Web Serial, tray pickups, and whether a hot tip holds an
insert are untested; iron sizes and tray defaults are guesses. Use the simulator.

Windows dev box: Node + Git via winget, Playwright global (`npm i -g playwright`,
`npx playwright install chromium`); `tools/browser-check.js` finds it.

Next likely work:
1. Stretch: several different parts in one job (needs `S.part` → `S.parts[]`).
2. Per-hole surface touch-off for warped parts.
3. When the machine exists: connect over USB, air pass, one test press, then a tray
   pickup; tune `tripTravel`, `pickupDepth`, `pocketDepth`, iron sizes from real measurements.
