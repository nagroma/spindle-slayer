# Legacy 1200 spindle preview — requirements

This is the working agreement for the app. **Hard requirements** are decisions we should not change without asking first. **Directional decisions** are the current approach; they can move as we learn, as long as they do not silently undo a hard requirement.

If a new idea would break a hard requirement, stop and ask.

---

## Hard requirements

### What this app is

- A **design planner** for a Legacy Ornamental Mill Model 1200: place bits on a blank and see remaining wood.
- It is **not** a 3D twin of the mill (no carriage/headstock animation, no shop-floor control panel).
- **Cuts on this blank** is the recipe — the list of plunge placements that make the spindle.
- A **project** is that recipe plus the stock. It must be savable as a **file on disk** (JSON) and reopenable later.
- The UI has to be usable without knowing the code.

### Stock and cutting physics

- Start from **prism stock**: round (size = diameter), square (size = side), or hex (size = **across flats**).
- Lengths are in **inches**.
- Bits **only subtract**. No glued-on pommel, no additive beads. A ball only appears if the blank is fat enough for that bit at that diameter.
- **Plunge first** (carriage parked, one full revolution). Flutes are a second cut kind: side-mounted, bearing path uses the same run / taper fields, index increment is 3D only. The model is still `radius(x, θ)`.
- **Circular distance** = tip to workpiece centerline. For a flute bit, this is where the **bearing** sits. The bit axis is offset outward by the DXF bearing radius; the designer does not add that by hand. The UI field is **diameter at tip** (`diameter = 2 × circularDistance`), labeled diameter at bearing when a flute is selected.
- How deep a bit cuts is **the user’s design choice**. Example: 3.5″ square stock with a 3.00″ diameter at the tip only nicks ~0.25″ into the faces. That is correct. Do not “help” by carving the whole bit profile into the wood.
- Taper is a future **cut**, not starting stock.

### Bits

- Bit shapes come from **DXF half-profiles** in `bits/`. Units in those files are **inches**. Tip at (0,0).
- Display name is the **filename without extension** for now. Real names will need characters that cannot live in filenames (`"` and others); that naming system is later.
- The library on screen must **match the `bits/` folder** (add a DXF, it becomes a bit; remove it, it disappears). No separate hand-maintained bit list that can drift.
- Each bit button shows a **small icon of the half-profile**.
- The designer can **add and remove cuts**. Adding a bit from the palette creates a new cut on this blank.

### Views and placement

- **2D**: profile vs centerline (length down, radius left/right). Place the bit; see remaining wood.
- **3D**: remaining wood after a full revolution.
- Drag is **rough** placement. Typed **from headstock (in)** and **diameter at tip (in)** are the precise values.
- 2D has **zoom and scroll along the blank**, no rotation. The drawing stays **left-justified** while you zoom. Do not use dragging a bit as the way to scroll the drawing.
- **Adding or selecting a bit must not change the 2D zoom.** A newly added bit is placed at the **center of the current 2D view** (along the blank). The user is usually already looking where they want to work.

### Layout and memory

- Screen layout is **horizontal**: cuts on the left, 2D in the middle, 3D on the right, with **draggable size controls** between them.
- Stock (type / length / size) sits on the **left** of the top bar, with a compact **3D** quality slider next to it; bit buttons occupy the rest of that bar and **wrap as the window gets wider**.
- Last layout, last 2D camera, last selected cut, and last stock+cuts must come back on the **next run** (refresh / reopen the app).
- Projects are separate files on disk so more than one design can exist.

---

## Directional decisions

These are “this seems like a good direction right now,” not frozen.

### Product shape

- Static Vite + vanilla JS + Three.js, offline-capable. No React.
- Shop-floor recipe text / mill export is later (low priority). The project JSON is the designer’s file, not a substitute for that export.
- First-time empty session still opens on a **demo** (3.5″ × 34″ square, Magnate_7593 at 4″ from headstock, 3.00″ diameter at tip) so the views are not blank.

### Bits pipeline

- Today each `bits/*.dxf` is imported when the app loads (Vite glob in dev/build). Reloading the app (and rebuilding for a shipped `dist/`) is how a new file appears.
- DXF sketches in `bits/` use **Y along the bit axis** and **X as radius**; import **auto-detects** that. The older millimetre reference DXF in `reference/` is a different convention.
- A processed on-disk cache of profiles, picking a subset of bits to show, and a full bit-management UI are medium (favorites, hide, names that are not filenames). Until then: `bits/` is the source of truth. Display name stays the filename.
- JSON for projects, not YAML.

### What is stored where

- **User/layout preferences** (pane widths, 2D zoom/pan, selected cut, 3D mesh quality): browser `localStorage`.
- **Last session recipe** (stock + cuts): also `localStorage`, so a refresh does not lose work.
- **Named projects**: `.lomp` files (JSON). Save is a browser download so Chrome/Edge can show a real Save dialog (name + folder). A short-lived `.tmp` in Downloads is the browser staging the file. Open defaults to `.lomp` and still has All files for old `.json`/`.txt`. The file stores stock and cuts by **bit id** (filename). Profiles are not copied into the file; they are read from `bits/` on open.
- The project file also stores **2D zoom/pan** and the **3D camera** (position + look-at). Open restores those views. Pane splitter widths stay in the browser (`localStorage`), not in the file.

### Display axes (3D)

- Mill: length along the centerline, θ around it (0° = a square/hex **face**), r from the centerline.
- On screen, **length is −Y** (headstock at the top, same as 2D). Left-right drag spins around the spindle. You can tumble and flip the piece over. Lights stay world-fixed. This is a preview, not a mill twin.

### UI details (expected to keep moving)

- Compact bit chips (icon + filename) in the top bar; compact cut list on the left with the typed headstock/diameter fields under it.
- A cut can be **hidden** (still in the list, ignored in remaining wood) without deleting it. Undoable.
- 2D: mouse wheel zooms (pinned left), shift+wheel scrolls along the blank, drag empty space to scroll up/down, +/− and Fit 2D buttons.
- 2D remaining wood is the blank minus the bit’s 2D solid (and the opposite side after a revolution), so the hole follows the bit where they overlap.
- 3D: headstock at the **top**; default view fills the pane at a slight three-quarter tilt. Left-right drag **spins around the spindle**; drag up/down to flip the piece over. Lights stay world-fixed. A **3D** slider next to stock (Fast / Better / Best) sets mesh density. Fast is the original preview; Best is slow. Stored in the browser, not in the `.lomp`.
- Pane splitter defaults and minimum widths are a starting point; users override them.
- Bit count is expected in the **low tens**, not hundreds.

### Photo overlay and tracing (high)

- Recreating a spindle from a picture is the real need (not a pretty JPEG behind the stock).
- **Interactive tracer** is a second page (`trace.html`): click the edge, fit lines/arcs/splines, snap a known radius, merge pieces into one bit, export DXF. Photo opacity is adjustable. Sessions save as `.ltrace`. Same loop for **bit** half-profiles. Stay on bit-matching (join / type / known radius), not CAD handles. Later: constrain each segment to a real bit half-profile (a cut from the side), and treat fit direction per segment rather than as a whole-trace toggle.
- **2D overlay**: load a traced spindle DXF behind the planner profile (inches, headstock at the top). It stays visible while placing bits. An opacity slider fades it. The overlay is a reference only — it does not cut wood. It is stored in the session and in `.lomp`. A raw photo behind the 2D stock is still possible later. Phone photos are perspective; do not squash them into the stock rectangle.

- While building photo tools, keep short notes: `docs/photo-overlay-notes.md`. A prepared (but clipped) test crop is `reference/leg-overlay-3.5x29.5.png`.

### Explicitly later (not in current scope)

- **Spirals** (flutes are in; spirals later).
- In-app photo scaler (medium, only if overlay needs it).
- Better bit display names and full bit-management (medium).
- Taper as its own cut — **deferred**. Current run/taper matches the mill well enough.
- Shop recipe / setup sheet export (low).
- Auto-deploy from GitHub (low; not a product feature).

---

## Vocabulary (keep using these words)

| Term | Meaning |
|---|---|
| Headstock | Zero end of length. “From headstock” is distance along the blank. |
| Circular distance | Tip to centerline, inches. On a flute, the bearing seat. |
| Diameter at tip | `2 × circular distance`. What the designer types. |
| Cut / placement | One bit, parked at one length, at one circular distance (optional run to an end pose). |
| Recipe | The list of cuts on this blank. |
| Project | Stock + recipe, saved as a `.lomp` file (JSON). |
| Run / taper | Bit travels from start pose to end pose along the blank. |
| Hidden cut | Still in the recipe; temporarily skipped when drawing remaining wood. |

---

## Repo docs

- `README.md` — people using or running the app, plus the product backlog.
- This file — working agreement. Hard vs directional. Ask before breaking a hard requirement.
- `NEXT-SESSION.md` — pickup note for the next coding session (often empty).
- `.cursor/rules/` — instructions for the coding agent (LLM-focused).
- `docs/mechanics-notes.md` — mill physics and how remaining wood is modeled.
- `docs/bit-catalog.md` — Magnate catalog excerpt. Live bits are `bits/*.dxf`.

---

## Change rule

Updating a **directional** decision in this file is allowed when we implement it. Changing a **hard** requirement, or a directional choice that would contradict a hard requirement, needs a question first.
