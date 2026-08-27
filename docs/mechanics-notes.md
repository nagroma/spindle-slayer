# Legacy Ornamental Mill 1200 — how it works

Domain background for the mill and for this planner. Product decisions live in `requirements.md`. Do not treat this file as a build plan or as a second requirements list.

## How the machine actually works

- **Headstock**: spins the workpiece, either freely (hand crank / motor, indexed to fixed angles or rotated continuously) or coupled to the carriage via change gears.
- **Carriage**: carries the router, travels the length of the workpiece on leadscrews.
- **Change-gear train**: when engaged, couples carriage travel to headstock rotation at a set ratio (swap gears to change the ratio) — this produces a continuous spiral. Disengaged, the two motions are independent.
- **Router orientation**: mounted **vertically** (bit tip plunges into the stock) for rings, beads, coves, and tapers, or **horizontally** (bit’s side rides against the stock) for flutes and spirals.

## Cut families on the mill

| Family | Carriage | Headstock | Bit orientation |
|---|---|---|---|
| **Ring** (bead / cove / astragal / ball) | parked at one length | one full turn | vertical, tip in |
| **Taper** (turned shape along the length) | travels | rotates | vertical, tip in |
| **Flute / reed** | travels start→end | fixed angle, then index | horizontal, side against stock |
| **Spiral** | travels start→end | geared to travel | horizontal, side against stock |

The planner today models **plunge** (parked, full revolution) and **run / taper** (the same bit travels from a start pose to an end pose). Flutes and spirals are later; the remaining-wood math is already `radius(length, θ)` so those can be added without starting over.

## Vocabulary

Use these words in the app and in docs. Longer product rules are in `requirements.md`.

| Term | Meaning |
|---|---|
| Headstock | Zero end of length. “From headstock” is distance along the blank. |
| Circular distance | Tip to centerline, inches. |
| Diameter at tip | `2 × circular distance`. What the designer types. |
| Cut / placement | One bit at one length (and optional run to an end pose). |
| Recipe | The list of cuts on this blank. |
| Project | Stock + recipe, saved as a `.lomp` file (JSON; old `.json` still opens). |
| Run / taper | The bit travels from start headstock/diameter to end headstock/diameter. |
| Hidden cut | Still in the list, temporarily ignored in remaining wood. |

**Turns-per-travel** (for a future spiral): in this project “2:1” means **2 inches of travel per turn**, not 2 turns per 1 inch of travel. In a `{turns, travel}` pair that is `{turns: 1, travel: 2}`.

**Circular distance on the mill** depends on mount:

- **Plunge** (bit into the workpiece, tip first): the tip / bottom center of the bit. For a V bit, the point of the V.
- **Side-mounted** (later, flutes/spirals): the point on the bit farthest from the bit’s own axis. A flat end mill run the full length leaves a cylinder at that radius.

In this app, circular distance is always a **radius** (inches from the blank’s centerline). The typed field is diameter.

## How the planner models remaining wood

Start from **prism stock**: round (diameter), square (side), or hex (**across flats**). Bits **only subtract**.

At each length station, remaining radius is:

```
min(stockRadius(θ), envelopes of every visible cut)
```

A cut’s envelope does not depend on θ (surface of revolution after a full turn). A shallow diameter-at-tip on fat square/hex stock only nicks the faces. That is correct; do not “help” by sinking the whole bit profile.

A **hidden** cut is skipped. A **run** interpolates from start pose to end pose along the length; if run is off, stored end values are ignored.

Bit shapes come from `bits/*.dxf` (inches, tip at 0,0). The live library is that folder, not `docs/bit-catalog.md`.

## Project file (current)

JSON, format `legacy-1200-project`, default name `spindle.lomp`. Stock plus cuts by **bit id** (DXF filename without extension). Profiles are not copied into the file; Open reloads them from `bits/`. The file also stores the 2D view box and 3D camera. Pane widths stay in the browser.

A cut records length, circular distance, optional `hidden`, and if run is on: end length and end circular distance.

## 3D preview axes

Mill coordinates stay length / θ / r. The mesh maps **length → −Y** so the headstock is at the top (matching the 2D view). Left-right drag spins around the spindle; you can tumble past the ends and flip the piece over. This is display only, not machine XYZ.

## Older experiment (not the planner UI)

`src/recipe.js`, `src/bits.js`, and `src/view2d.js` are leftover from an earlier “operations list + unrolled view” experiment (rings / flutes / spirals as typed ops, bits traveling inside the recipe). The planner UI does not use that path. Keep them until we decide to delete or revive them; do not document them as how the app works.
