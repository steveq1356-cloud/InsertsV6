# InsertPress Planner

A slicer-style planner and machine controller for a heat-set insert press
(GRBL 1.1, NEMA 17 steppers, a Pinecil V2 on a spring-floated Z head, float
sensor on the probe pin). Load an STL, place it on the bed, pick the holes,
check the job, and run it from the browser or download the G-code. No install,
no build step, no server: works from `file://` and GitHub Pages.

## Try it

- **Locally:** open `index.html` in Chrome, Firefox, or Edge. USB needs Chrome or Edge on a desktop.
- **GitHub Pages:** push this repo, then Settings → Pages → Deploy from branch → `main` / root.

The start screen has seven examples, each showing one feature. The 3D view loads
Three.js from jsDelivr; offline the app uses a 2D top view and everything else works.

## What's new in v6

- **3D view:** the part, fence, tray and iron cast soft shadows on a solid bed slab.
- **Safer G-code:** the iron rises to clear the fence before parking or travelling
  near it; every travel height (air pass included) is checked against the Z travel;
  the tray collision check uses the lowest point the iron really reaches.
- **Streaming:** a pause can no longer leave GRBL stuck in a feed hold; replies no
  longer shift after a probe alarm; unplugging mid-run brings back the Run button;
  a refused pickup tries another pocket instead of pressing with an empty tip.
- **Jobs keep your machine:** opening a job or a recent entry keeps your bed, fence,
  iron and tray setup and only takes the job's press settings.
- **Fewer stuck states:** stale hole filters, undo of a lock or a tray size, Recent
  filling up with examples, undo/redo hidden on phones.

## Screens

**Start.** Open an STL (or drop it anywhere), open a saved job, pick up where you
left off after a reload, reopen a recent job, or try an example. The last session
and recent jobs are kept in the browser (STLs in IndexedDB, jobs in localStorage).

**Machine setup** (first-run card, or *Machine setup* in the top bar). Six short
pages: bed travel, fence, iron (drawn to scale), float sensor, insert tray, done.
Each has a drawing, a few fields with defaults, and an Advanced block. Save it as a
machine profile; profiles each keep their own tray inventory.

**Job: Part → Holes → Review.** The step bar is clickable, every step has Back and
Next, and a line under the steps says what to do next. Everything is undoable.

- **Part.** Lay it flat with quarter turns or **Pick the bottom face** (click the
  face that goes on the bed). Drag the part: it snaps to the fence corner, each
  fence, the bed edges and centre, the 10 mm grid, and beside the tray, with guide
  lines and a label. Hold **Alt** to drag freely. The ring at its corner turns it
  (15° steps, 90° sticky). Align buttons: fence corner, left fence, front fence,
  centre. Exact X, Y, angle. **Lock** stops accidental moves. **Copies** in a grid,
  or **Fill the bed** with as many as fit, leaving out any that would land on the tray.
- **Holes.** A simple list with a switch per hole and the insert size. Every hole
  found starts switched on. **Tools** opens filters by size and status, sort,
  multi-select (checkboxes, Ctrl/Cmd-click, Shift-click, Shift-drag in the view),
  bulk changes, shortest path, place by hand, and the hole-size range. Click a row
  for its inspector; drag the numbers to reorder.
- **Review.** Job time with a breakdown (tray trips included), problems, plastic
  and iron temperature, where inserts come from (by hand or the tray), Advanced
  press settings, parts list, the animated preview, and **Go to the machine**,
  **Download G-code**, air pass, 1:1 placement template, copy, save job.

**Run.** Connect over USB or the simulator. Big X/Y/Z readout, GRBL state, float
indicator. **Run job** shows a short checklist first. During the run: progress,
finish time, one prompt at a time with a big **Continue**, Pause, **Pause after
hole**, Stop (feed hold then reset, so position is kept), press-speed override.
Collapsed groups: **Tray** (click pockets to mark them full/empty, Refill),
**Move and set the origin** (jog, fence corner is here, find the bed with the
float, bed is here), **Console**. Run options: start at hole N, test press, air
pass, stop between holes on a float trip, chime, and check mode ($C).

## The insert tray

A fixed block in a corner of the bed with a grid of pockets, one insert per pocket,
one insert size per row. Pocket 1 is the front-left pocket; columns run along +X,
rows along +Y. **The tip is hot during pickup: the tray must be metal or high-temp.**

Each hole: travel at clear height to the next full pocket, drop to just above the
insert, `G38.3` down slowly until the float trips as the tip seats in the insert,
lift, travel, press.

```
Z is the tip end (touched off on the bed as Z0)
seat  = trayTop − pocketDepth + L − pilot   tip touches the insert
trip  = seat − tripTravel                   float trips: picked up
limit = seat − pickupDepth                  no trip by here: pocket empty
hang  = L − pilot                           insert below the tip while carried
travel height = max(partTop + hang, trayTop + insert stick-up + hang) + clearance
press: approach H + hang + gap, press to H − sink − pilot
```

- Setup checks that a full pocket trips and an **empty pocket can't also trip** (the
  tip landing on the pocket floor, or on the tray top when the tip is wider than the
  pocket), that pockets are inside the travel, that no part sits on the tray, and
  that pockets are far enough apart for the tip.
- The collision check treats the tray block as an obstacle for nearby holes and
  checks the iron at every pocket it picks from.
- **Inventory** is saved per machine profile. The Review step and the checklist
  warn when the tray is short; the job then pauses for a refill.
- **Live runs** pick with `G38.3`. An empty pocket is marked and the next full one
  tried (or it asks, if you set that), and each hole uses the pocket that is full
  at that moment, not the one planned. Running out holds until you refill.
- **Exported G-code** assigns pockets from the current inventory and picks with
  `G38.2`, so an empty pocket halts with ALARM:5 instead of pressing a bare hot tip
  into the hole. Air passes dip into pockets without probing.
- **Load by hand** is still the default.

## Machine conventions

| What | Convention |
|---|---|
| X0 Y0 | Inside corner of the fence |
| Z0 | Tip touching the bed with the float relaxed |
| Units / mode | `G21 G90 G54` |
| Float sensor | GRBL probe pin (A5); presses use `G38.3` |
| Lines | Every G-code line under 72 characters |

**First run:** an air pass with the iron cold, then one test hole, then a real part.

## Keyboard

Nothing needs these. M / V / H / R: move, holes, place, measure. B: pick the
bottom face. Alt while dragging: no snapping. Shift-drag: select holes. I: iron.
Space: play the preview. F: fit. Ctrl+Z / Ctrl+Shift+Z: undo / redo. Arrows: nudge
the part (Move tool) or jog (run screen). ?: list.

## Project layout

```
index.html           page shell: start, job, run screens and the setup dialog
css/base.css         tokens and shared components
css/layout.css       top bar, start screen, workspace, view overlays
css/panels.css       Part, Holes, Review panes
css/run.css          run screen and machine setup
js/stl.js            STL parsing, orientation (quarter turns, face down), bed drop
js/holes.js          hole detection and wall thickness
js/tray.js           tray pockets, Z geometry, inventory, assignment, checks, path
js/gcode.js          inserts, materials, defaults, checks, G-code (hand and tray), timeline
js/placement.js      position, rotation, copies, align, auto-fill
js/snap.js           snapping while dragging and rotating
js/collision.js      iron collision check (part, copies, fence, tray, pockets)
js/holelist.js       hole list filter/sort/select
js/measure.js        distances and snapping
js/grbl.js           GRBL 1.1 replies, program prep, streamer (pickup gates, live pocket remap)
js/grbl-sim.js       virtual GRBL
js/serial.js         Web Serial and simulator ports
js/store.js          localStorage and IndexedDB
js/thumb.js          part thumbnails without WebGL
js/viewer.js         Three.js view;  js/viewer2d.js  2D top view, same interface
js/ui-start.js  ui-setup.js  ui-part.js  ui-holes.js  ui-review.js  ui-machine.js
js/app.js            state, history, screens, loading, dragging, collisions, sessions
js/example.js        examples and the cell-grid mesher (with round bosses)
examples/            the seven example STLs
test/                Node tests, one file per area
tools/               example generator, browser tests, Three.js stub
```

## Tests

```
node test/run-tests.js          # 282 Node tests, no dependencies
node test/run-tests.js tray     # one file
node tools/ui-test.js           # browser checks with Playwright (2D, and 3D on a Three.js stub)
```

Covers the v4 suite plus: tray pockets, Z geometry, assignment, refill, tray G-code,
the tray time estimate, tray checks, tray-aware ordering, the simulator (a full
pocket trips at pickup depth, an empty one doesn't), live runs that skip empty
pockets and refill, pause after a hole, snapping, rotate and align, auto-fill
around the tray, face down, collision with the tray and at pockets, and every
example's expected holes.

## Not yet tested on hardware

USB streaming, tray pickups, and whether a hot tip holds an insert by friction.
Iron dimensions and tray defaults (pocket depth 2 mm, pickup depth 1 mm, pitch 8 mm)
are guesses: measure yours.

## Roadmap

- Several different parts in one job
- Per-hole surface touch-off for warped parts
- STEP/3MF import

## License

MIT
