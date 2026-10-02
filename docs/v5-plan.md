# InsertPress v5 plan

## Ideas a real user would want

| Idea | Adding? |
|---|---|
| Refill pause when the tray runs short (job pauses, you refill, it carries on) | Yes |
| Exported tray files pick with `G38.2`, so an empty pocket stops with ALARM:5 instead of pushing a bare hot tip into the hole | Yes |
| Pickup-depth sanity check: works out whether an empty pocket could still trip the float (tip landing on the pocket floor or the tray top) | Yes |
| Iron collision check at each pocket (part, copies, fence) and the tray block as an obstacle for nearby holes | Yes |
| Auto-fill leaves out copies that would land on the tray | Yes |
| Simulator option to leave pockets physically empty, to practise the live skip | Yes |
| "Pause after this hole" during a run | Yes |
| Finish clock time on the run screen ("done about 3:42 pm") | Yes |
| Z travel limit, checked against travel height | Yes |
| Tip pilot length (how far the tip enters the insert), default 0 = v4 behaviour | Yes |
| Example thumbnails rendered from the meshes | Yes |
| Several different parts in one job | No (stretch goal, not reached) |
| Per-hole surface touch-off for warped parts | No |
| Pre-heat dwell in the pocket | No |

## Settings audit

Visible = shown by default. Advanced = inside a collapsed "Advanced" block. Removed = no control any more; old job files still set it.

| Setting | Decision | Where |
|---|---|---|
| Plastic, iron temperature | Visible | Review step |
| Inserts from: by hand / tray | Visible | Review step, setup tray page |
| Motion (X/Y or Z only) | Visible | Setup: bed |
| Bed travel X, Y, Z (new) | Visible | Setup: bed |
| Park when finished | Visible | Setup: bed |
| Park X/Y, rapid X/Y, rapid Z | Advanced | Setup: bed |
| Fence height | Visible | Setup: fence |
| Tip, tip nut, body sizes | Visible | Setup: iron |
| Carriage width/start, extra clearance, tip pilot (new) | Advanced | Setup: iron |
| Float travel before trip | Visible | Setup: float |
| Touch-off speed, give-up distance, press with G38.3 | Advanced | Setup: float |
| Tray pocket 1, pitch, rows, columns, top height, pocket depth, sizes per row, pickup depth, pickup speed | Visible | Setup: tray |
| Tray edge margin, what to do with an empty pocket | Advanced | Setup: tray |
| Press speed, hold time, finish below surface, slow-down gap, slow lift distance and speed, clearance, load all at start, wall wanted, insert for hand-placed holes | Advanced | Review step |
| Hole size range | Advanced | Holes step tools |
| Cost per insert | Advanced (cost column only shows when it is above 0; default now 0) | Review step |
| Never travel below (minClear) | Removed | auto travel height + Z travel check cover it |
| Time to load one insert | Removed | fixed 4 s in the estimate |

## Screens

```
START
┌─────────────────────────────────────────────────────────────────┐
│ ▮ InsertPress v5                         Machine setup  ● Idle │
├─────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────┐ ┌─────────────────────────┐  │
│  │   ⬆  Open an STL              │ │ Pick up where you left  │  │
│  │      or drop it here          │ │ off: lid · 4 holes      │  │
│  │   Open a saved job            │ │            [Continue]   │  │
│  └───────────────────────────────┘ └─────────────────────────┘  │
│  Recent   [thumb name date] [thumb name date] ...               │
│  Examples [block][bracket][lid][pcb][thin wall][flip][panel]    │
└─────────────────────────────────────────────────────────────────┘

JOB (Part / Holes / Review)
┌─────────────────────────────────────────────────────────────────┐
│ ▮ InsertPress v5  ‹ Start  lid.stl  ↶ ↷      Machine setup ● Run│
├──────────────────────┬──────────────────────────────────────────┤
│ 1 Part ─ 2 Holes ─ 3 Review                 [3D|Top] Fit Iron   │
│ Push the part into   │ ┌tools┐                                  │
│ the fence corner.    │ │ V M │        bed + tray + parts        │
│ ┌ Lay flat ────────┐ │ │ B R │      (snap guides, rotate ring)  │
│ ┌ Position ────────┐ │ └─────┘                                  │
│ ┌ Copies ──────────┐ │                                          │
│ [Back]       [Next ›]│  timeline (Review only)                  │
└──────────────────────┴──────────────────────────────────────────┘

RUN
┌─────────────────────────────────────────────────────────────────┐
│ ▮ InsertPress v5  ‹ Back to plan   lid · 4 inserts      ● Idle  │
├──────────────────────┬──────────────────────────────────────────┤
│ X 123.456   Float ○  │                                          │
│ Y  45.000   Idle     │        live tip over the plan            │
│ Z  20.000            │                                          │
│ ┌ Hole 3: pressing ┐ │                                          │
│ │ [Continue]       │ │                                          │
│ [Run] [Pause] [Stop] │                                          │
│ ▸ Tray  ▸ Move & origin  ▸ Options  ▸ Console                   │
└──────────────────────┴──────────────────────────────────────────┘

MACHINE SETUP (dialog, re-openable)
┌───────────────────────────────────────────────┐
│ Machine setup    profile [My press ▾]     ✕   │
│ Bed ─ Fence ─ Iron ─ Float ─ Tray ─ Done      │
│ ┌──────────┐  A few questions                 │
│ │ drawing  │  [field] [field]                 │
│ └──────────┘  ▸ Advanced                      │
│ Skip setup                     [Back] [Next]  │
└───────────────────────────────────────────────┘
```

## Tray Z geometry

Z is the tip end (the face touched off on the bed as Z0). `p` = tip pilot
length (default 0), `L` = insert length, `T` = tray top, `d` = pocket depth,
`g` = slow-down gap, `t` = float travel before trip, `D` = pickup depth.

```
             tip end ──►  ┌┐   ← seat + g   (G0 down to here)
                          ││
  insert top ───────────  ├┤   ← seat = T − d + L − p      (tip touches)
  stick-up  s = L − d  ▲  ││   ← seat − t   float trips: "picked up"
  tray top  T  ════════╪══╡╞═══ ← seat − D   G38.3 limit: no trip = empty
                       ▼  ││
  pocket floor T − d ──────┘└───
```

* Pick succeeds when the float trips. `D` must be more than `t`.
* An empty pocket must not trip before the limit. If the tip fits the pocket
  bore (insert OD + 0.4) it lands on the floor, so `D < L − p + t`. If it does
  not fit, it lands on the tray top, so `D < s + t`. Both are checked per size.
* Carrying: the insert hangs `h = L − p` below the tip end (the "overhang").
* Travel height, tray mode: `max(partTop + h, T + max(s, 0) + h) + clearance`.
  Hand mode keeps v4: `partTop + L + clearance`.
* Press approach with an insert on the tip: `H + h + g`; press to `H − sink − p`.
  Hand mode: approach `H + L + g`, press to `H − sink − p`.
* Travel that starts or ends within reach of the fence (widest iron part / 2 +
  margin of X 0 or Y 0, e.g. parking at X0 Y0) rises to at least
  `fenceH + clearance` (`fenceH + h + clearance` in tray mode). Every travel
  height, air pass included, is checked against the Z travel.
* Collision check: at each used pocket the iron bottom is `seat − D` (worst
  case: an empty pocket, where the probe runs on to its limit); the tray
  block (height `T + max(s,0)`) is an obstacle for every hole.
* Live runs pick with `G38.3`; a miss skips to the next full pocket (or holds,
  or asks for a refill). Exported files pick with `G38.2` so a miss halts.
