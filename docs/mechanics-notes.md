# Legacy Ornamental Mill 1200 — how it works

Domain background for the mill and for this planner. Product decisions live in `requirements.md`. Do not treat this file as a build plan or as a second requirements list.

## How the machine actually works

- **Headstock**: spins the workpiece, either freely (hand crank / motor, indexed to fixed angles or rotated continuously) or coupled to the carriage via change gears.
- **Carriage**: carries the router, travels the length of the workpiece on leadscrews.
- **Change-gear train**: when engaged, couples carriage travel to headstock rotation at a set ratio (swap gears to change the ratio) — this produces a continuous spiral. Disengaged, the two motions are independent.
- **Router orientation**: mounted **vertically** (bit tip plunges into the stock) for rings, beads, coves, tapers, and barley-twist spirals, or **horizontally** (bit’s side rides against the stock) for flutes and pineapple spirals.

## Cut families on the mill

| Family | Carriage | Headstock | Bit orientation |
|---|---|---|---|
| **Ring** (bead / cove / astragal / ball) | parked at one length | one full turn | vertical, tip in |
| **Taper** (turned shape along the length) | travels | rotates | vertical, tip in |
| **Flute / reed** | travels start→end | fixed angle, then index | horizontal, side against stock |
| **Spiral (barley twist)** | travels start→end | geared to travel | vertical, on top |
| **Pineapple** | travels start→end | geared to travel | horizontal, side against stock |

The planner models **plunge** (parked, full revolution), **run / taper**, **flutes** (side-mounted, indexed), and **spiral / pineapple** (run plus geared rotation). Remaining-wood math is `radius(length, θ)`. A flute or spiral does not revolve: 2D remaining wood stays the turned envelope; 3D subtracts the cutter along the path. The **Spiral / pineapple** checkbox uses the same helix for both; a plunge bit (e.g. Magnate 7554) is a barley twist, a flute bit is a pineapple.

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
| Spiral / pineapple | Run with rotation geared to travel. Plunge bit = barley twist; flute bit = pineapple. |
| Hidden cut | Still in the list, temporarily ignored in remaining wood. |

**Turns-per-travel** (spiral / pineapple ratio): in this project “2:1” means **2 inches of travel per turn**, not 2 turns per 1 inch of travel. That ratio is a per-cut parameter (not a fixed default). In a `{turns, travel}` pair that is `{turns: 1, travel: 2}`. **Starts** is how many interleaved helices (4 starts = 90°). **Start (deg)** is the first helix. **Turn** is clockwise, counter-clockwise, or both ways (the same bit in opposite spirals — typical barley twist).

**Circular distance on the mill** depends on mount:

- **Plunge** (bit into the workpiece, tip first): the tip / bottom center of the bit. For a V bit, the point of the V.
- **Side-mounted** (flutes): the bearing. A flute DXF is offset in X by the bearing radius; the shape beyond that is the cut depth. Diameter at bearing matches the wood the bearing rides. The 2D bit image is two circles on the bit axis (inner = bearing, outer = max DXF X). A 1/2″ round with a 3/8″ bearing on 3″ stock sits the axis at 1.6875″ from centerline and cuts 1/4″ deep.

In this app, circular distance is always a **radius** (inches from the blank’s centerline). The typed field is diameter.

## How the planner models remaining wood

Start from **prism stock**: round (diameter), square (side), or hex (**across flats**). Bits **only subtract**.

At each length station, remaining radius is:

```
min(stockRadius(θ), envelopes of every visible cut)
```

A revolved cut’s envelope does not depend on θ (surface of revolution after a full turn). Flutes and spirals do: remaining wood is `min(stock, revolved cuts, groove at (x, θ))`. A shallow diameter-at-tip on fat square/hex stock only nicks the faces. That is correct; do not “help” by sinking the whole bit profile.

A **hidden** cut is skipped. A **run** interpolates from start pose to end pose along the length; if run is off, stored end values are ignored.

Bit shapes come from `bits/*.dxf` (inches, tip at 0,0). The shipped library is that folder, not `docs/bit-catalog.md`. Extra bits can be loaded at runtime with **Add bit**.

## Project file (current)

JSON, format `legacy-1200-project`, default name `spindle.lomp`. Stock plus cuts by **bit id** (DXF filename without extension). Shipped profiles are not copied into the file; Open reloads them from `bits/`. User-loaded bits used in cuts are stored as `customBits`. The file also stores the 2D view box and 3D camera. Pane widths stay in the browser.

A cut records length, circular distance, optional `hidden`, and if run is on: end length and end circular distance. Flute cuts also store `indexIncrementDeg`. A spiral / pineapple cut stores `spiral`, ratio (`spiralTravel` : `spiralTurns`), `spiralStarts`, `spiralStartDeg`, and `spiralDir` (`cw` / `ccw` / `both`).

## 3D preview axes

Mill coordinates stay length / θ / r. The mesh maps **length → −Y** so the headstock is at the top (matching the 2D view). Left-right drag spins around the spindle; you can tumble past the ends and flip the piece over. This is display only, not machine XYZ. Remaining wood is a closed mesh of `radius(length, θ)`. When a spiral is on, the mesh columns twist with the helix so the wrap follows the cutter path.
